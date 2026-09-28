import assert from "node:assert/strict"
import { test } from "node:test"
import { readFile } from "node:fs/promises"

const sha = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
const input = { filename: "fox.txt", mimeType: "text/plain", bytes: Buffer.from("hello"), sha256: sha }
const context = { tenantId: "tenant-1", subjectId: "subject-1", key: "key-1", requestId: "request-1" }

test("public personal upload declares one bounded file, stable errors and no internal upload reference", async () => {
  const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const operation = source.split("  /v1/library/files:")[1]?.split("  /v1/billing/plans:")[0] ?? ""
  for (const marker of [
    "operationId: uploadLibraryFile",
    "x-kokoro-idempotency: required",
    "x-kokoro-permission: storage.library.write",
    "IdempotencyKey",
    "multipart/form-data",
    "maxItems: 1",
    "1048576",
    "PersonalFileUploadResponse",
    "'200':",
    "'400':",
    "'409':",
    "'413':",
    "'422':",
    "'502':",
    "'503':",
  ])
    assert.ok(operation.includes(marker), marker)
  const shape = source.split("    PersonalFileUploadResponse:")[1]?.split("    LibraryFileListResponse:")[0] ?? ""
  for (const marker of ["kind", "enum: [file]", "asset_id", "filename", "mime_type", "size_bytes", "content_sha256", "scan_state"])
    assert.ok(shape.includes(marker), marker)
  assert.doesNotMatch(shape, /upload_id|download_url|created_at|artifact_id/u)
})

test("personal parser accepts one exact file and rejects extra fields or over-budget body", async () => {
  const { parsePersonalFile } = await import("../dist/http/personal-file-input.js")
  const form = new FormData()
  form.append("files", new File([input.bytes], input.filename, { type: input.mimeType }))
  const request = new Request("http://bff.test", { method: "POST", body: form })
  const value = await parsePersonalFile(request.headers.get("content-type"), Buffer.from(await request.arrayBuffer()))
  assert.equal(value.sha256, sha)
  assert.equal(value.filename, "fox.txt")
  const extra = new FormData()
  extra.append("files", new File([input.bytes], "fox.txt"))
  extra.append("subject_id", "other")
  const bad = new Request("http://bff.test", { method: "POST", body: extra })
  await assert.rejects(parsePersonalFile(bad.headers.get("content-type"), Buffer.from(await bad.arrayBuffer())), (error) => error.status === 400)
  await assert.rejects(parsePersonalFile("multipart/form-data; boundary=x", Buffer.alloc(1024 * 1024 + 1)), (error) => error.status === 413)
})

function fixture() {
  const rows = new Map()
  const calls = []
  let completed = false
  const receipts = {
    async getReceipt(scope) {
      return rows.get(scope) ?? null
    },
    async claimReceipt(scope, fingerprint) {
      const prior = rows.get(scope)
      if (prior) return { claimed: false, receipt: prior }
      rows.set(scope, { fingerprint, status: 102, body: {} })
      return { claimed: true, receipt: null }
    },
    async putReceipt(scope, value) {
      rows.set(scope, value)
    },
    async releaseReceipt(scope) {
      if (rows.get(scope)?.status === 102) rows.delete(scope)
    },
  }
  const storage = {
    async createUpload(commandId, digest) {
      calls.push(["create", commandId, digest])
      return {
        uploadId: "upload-1",
        reference: { url: "http://objects.test/put", method: "PUT", headers: { "content-type": "text/plain" }, expiresAt: Date.now() + 60_000 },
      }
    },
    async getUploadStatus() {
      calls.push(["status"])
      return { state: completed ? "completed" : "pending", assetId: completed ? "asset-1" : null, sha256: sha, sizeBytes: "5", mimeType: "text/plain" }
    },
    async put() {
      calls.push(["put"])
      assert.ok(
        [...rows.keys()].some((scope) => scope.includes("personal-file-upload:v1") && rows.get(scope).body.upload_id === "upload-1"),
        "checkpoint before PUT",
      )
    },
    async completeUpload() {
      calls.push(["complete"])
      completed = true
      return { assetId: "asset-1", scanState: "clean" }
    },
    async getAsset() {
      calls.push(["asset"])
      return { asset_id: "asset-1", filename: "fox.txt", mime_type: "text/plain", size_bytes: "5", content_sha256: sha, scan_state: "clean" }
    },
    async abortUpload() {
      calls.push(["abort"])
    },
  }
  return { rows, calls, receipts, storage }
}

test("personal checkpoint is isolated from Project and recovers unknown Complete without a new Asset", async () => {
  const { uploadPersonalFile } = await import("../dist/application/personal-file-upload.js")
  const f = fixture()
  const complete = f.storage.completeUpload
  f.storage.completeUpload = async (...args) => {
    await complete(...args)
    throw new Error("lost response")
  }
  await assert.rejects(uploadPersonalFile(context, input, f.receipts, f.storage, AbortSignal.timeout(5000)))
  assert.equal(
    f.calls.some(([name]) => name === "abort"),
    false,
  )
  assert.ok([...f.rows.keys()].some((scope) => scope.includes("personal-file-upload:v1")))
  assert.ok([...f.rows.keys()].every((scope) => !scope.includes("project-resource-upload:v1")))
  f.calls.length = 0
  assert.deepEqual(await uploadPersonalFile(context, input, f.receipts, f.storage, AbortSignal.timeout(5000)), {
    kind: "file",
    asset_id: "asset-1",
    filename: "fox.txt",
    mime_type: "text/plain",
    size_bytes: "5",
    content_sha256: sha,
    scan_state: "clean",
  })
  assert.deepEqual(
    f.calls.map(([name]) => name),
    ["status", "asset"],
  )
  await assert.rejects(
    uploadPersonalFile(context, { ...input, filename: "different.txt" }, f.receipts, f.storage, AbortSignal.timeout(5000)),
    (error) => error.status === 409,
  )
})

test("temporary PUT failure after a durable checkpoint keeps the original upload recoverable", async () => {
  const { uploadPersonalFile } = await import("../dist/application/personal-file-upload.js")
  const { PersonalFileError } = await import("../dist/application/personal-file-upload.error.js")
  const f = fixture()
  const originalPut = f.storage.put
  let failOnce = true
  f.storage.put = async (...args) => {
    if (failOnce) {
      failOnce = false
      throw new PersonalFileError("storage_unavailable", 503, true)
    }
    return originalPut(...args)
  }
  await assert.rejects(
    uploadPersonalFile(context, input, f.receipts, f.storage, AbortSignal.timeout(5000)),
    (error) => error.code === "storage_unavailable" && error.status === 503,
  )
  assert.ok([...f.rows.keys()].some((scope) => scope.includes("personal-file-upload:v1") && f.rows.get(scope).body.upload_id === "upload-1"))
  assert.equal(
    f.calls.some(([operation]) => operation === "abort"),
    false,
    "checkpointed upload must remain pending for same-key retry",
  )
  assert.equal((await uploadPersonalFile(context, input, f.receipts, f.storage, AbortSignal.timeout(5000))).asset_id, "asset-1")
  assert.equal(
    f.calls.some(([operation]) => operation === "abort"),
    false,
  )
})

test("conditional receipt persistence rejects CAS zero rows instead of acknowledging success", async () => {
  const { PostgresIdempotencyRepository } = await import("../dist/infrastructure/postgres/idempotency-repository.js")
  const repository = new PostgresIdempotencyRepository({
    async query() {
      return { rowCount: 0, rows: [] }
    },
  })
  await assert.rejects(repository.putReceipt("scope", { fingerprint: sha, status: 200, body: {} }))
})

test("checkpoint persistence failure is a recoverable store error and cannot reach object PUT", async () => {
  const { uploadPersonalFile } = await import("../dist/application/personal-file-upload.js")
  const f = fixture()
  f.receipts.putReceipt = async () => {
    throw new Error("database unavailable")
  }
  await assert.rejects(
    uploadPersonalFile(context, input, f.receipts, f.storage, AbortSignal.timeout(5000)),
    (error) => error.code === "file_checkpoint_unavailable" && error.status === 503,
  )
  assert.equal(
    f.calls.some(([operation]) => operation === "put"),
    false,
  )
})

test("temporary checkpoint write failure replays stable Create without aborting the original upload", async () => {
  const { uploadPersonalFile } = await import("../dist/application/personal-file-upload.js")
  const f = fixture()
  const originalPutReceipt = f.receipts.putReceipt
  let failOnce = true
  f.receipts.putReceipt = async (...args) => {
    if (failOnce) {
      failOnce = false
      throw new Error("temporary database failure")
    }
    return originalPutReceipt(...args)
  }
  await assert.rejects(
    uploadPersonalFile(context, input, f.receipts, f.storage, AbortSignal.timeout(5000)),
    (error) => error.code === "file_checkpoint_unavailable" && error.status === 503,
  )
  assert.equal(
    f.calls.some(([operation]) => operation === "abort"),
    false,
  )
  assert.equal((await uploadPersonalFile(context, input, f.receipts, f.storage, AbortSignal.timeout(5000))).asset_id, "asset-1")
  const createCommands = f.calls.filter(([operation]) => operation === "create").map(([, commandId]) => commandId)
  assert.equal(new Set(createCommands).size, 1)
  assert.equal(
    f.calls.some(([operation]) => operation === "abort"),
    false,
  )
})

test("personal Storage Connect adapter sends trusted personal scope, ASSET purpose and rejects non-CLEAN owner data", async () => {
  const { PersonalFileUploadClient } = await import("../dist/infrastructure/clients/storage/personal-file-upload.js")
  const { createRouterTransport } = await import("@connectrpc/connect")
  const { StorageService, UploadPurpose, UploadState, ScanState } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  let scanState = ScanState.CLEAN
  let purpose = UploadPurpose.ASSET
  const headers = []
  const transport = createRouterTransport((router) =>
    router.service(StorageService, {
      createUpload(request, ctx) {
        headers.push(ctx.requestHeader)
        assert.equal(request.uploadPurpose, UploadPurpose.ASSET)
        assert.equal(request.contentSha256, sha)
        return {
          uploadId: "upload-1",
          uploadReference: {
            url: "http://objects.test/file",
            method: "PUT",
            requiredHeaders: { "content-type": "text/plain" },
            expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) },
          },
        }
      },
      getUploadStatus() {
        return { uploadId: "upload-1", state: UploadState.COMPLETED, expectedSha256: sha, expectedSizeBytes: 5n, mimeType: "text/plain", assetId: "asset-1" }
      },
      completeUpload() {
        return { uploadId: "upload-1", assetId: "asset-1", scanState }
      },
      getAsset() {
        return { assetId: "asset-1", filename: "fox.txt", mimeType: "text/plain", sizeBytes: 5n, contentSha256: sha, uploadPurpose: purpose, scanState }
      },
    }),
  )
  const client = new PersonalFileUploadClient(
    { baseUrl: "http://storage.test", secret: "storage-secret", objectOrigin: "http://objects.test" },
    context,
    transport,
  )
  assert.equal((await client.createUpload("command", sha, input, AbortSignal.timeout(5000))).uploadId, "upload-1")
  for (const [name, value] of Object.entries({
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "storage-secret",
    "x-kokoro-tenant-id": "tenant-1",
    "x-kokoro-subject-id": "subject-1",
    "x-kokoro-scope-kind": "personal",
    "x-kokoro-scope-id": "subject-1",
    "x-kokoro-request-id": "request-1",
  }))
    assert.equal(headers[0].get(name), value)
  assert.equal(headers[0].get("authorization"), null)
  assert.equal((await client.getUploadStatus("upload-1", AbortSignal.timeout(5000))).assetId, "asset-1")
  assert.equal((await client.completeUpload("complete", sha, "upload-1", input, AbortSignal.timeout(5000))).scanState, "clean")
  assert.equal((await client.getAsset("upload-1", "asset-1", input, AbortSignal.timeout(5000))).asset_id, "asset-1")
  purpose = UploadPurpose.ARTIFACT
  await assert.rejects(client.getAsset("upload-1", "asset-1", input, AbortSignal.timeout(5000)), (error) => error.status === 502)
  purpose = UploadPurpose.ASSET
  scanState = ScanState.INFECTED
  await assert.rejects(client.completeUpload("complete", sha, "upload-1", input, AbortSignal.timeout(5000)), (error) => error.status === 422)
  scanState = ScanState.PENDING
  await assert.rejects(client.getAsset("upload-1", "asset-1", input, AbortSignal.timeout(5000)), (error) => error.status === 503)
})

test("personal route claims after input validation, persists success, replays within subject and isolates other subjects", async () => {
  const { personalFileUploadRoute } = await import("../dist/http/routes/personal-file-upload.js")
  const { EventEmitter } = await import("node:events")
  const f = fixture()
  const form = new FormData()
  form.append("files", new File([input.bytes], input.filename, { type: input.mimeType }))
  const wire = new Request("http://bff.test", { method: "POST", body: form })
  const body = Buffer.from(await wire.arrayBuffer())
  const scopes = []
  const invoke = async (subject = "subject-1", url = "/v1/library/files", payload = body, rawKeys = ["key-1"]) => {
    const request = new EventEmitter()
    request.url = url
    request.headers = { "content-type": wire.headers.get("content-type"), "idempotency-key": rawKeys.length === 1 ? rawKeys[0].trim() : rawKeys.join(", ") }
    request.rawHeaders = ["Content-Type", wire.headers.get("content-type"), ...rawKeys.flatMap((key) => ["Idempotency-Key", key])]
    const response = new EventEmitter()
    response.setHeader = (key, value) => {
      response.headers ??= {}
      response.headers[key.toLowerCase()] = value
    }
    response.writeHead = (status, headers) => {
      response.status = status
      response.headers = { ...response.headers, ...headers }
    }
    response.end = (data) => {
      response.body = JSON.parse(data)
      response.writableEnded = true
    }
    await personalFileUploadRoute(
      request,
      response,
      { storage: { baseUrl: "http://storage.test", secret: "storage-secret", objectOrigin: "http://objects.test" } },
      { identity: { namespace: "tenant-1", userId: subject }, requestId: "request-1" },
      payload,
      f.receipts,
      new Map(),
      (_cfg, ctx) => {
        scopes.push(ctx)
        return f.storage
      },
    )
    return response
  }
  const first = await invoke()
  assert.equal(first.status, 200)
  assert.equal(first.headers["x-request-id"], "request-1")
  assert.deepEqual(first.body.data.file, {
    kind: "file",
    asset_id: "asset-1",
    filename: "fox.txt",
    mime_type: "text/plain",
    size_bytes: "5",
    content_sha256: sha,
    scan_state: "clean",
  })
  assert.equal((await invoke()).status, 200)
  assert.equal(scopes.length, 1, "same-subject durable public receipt replays before Storage")
  assert.equal((await invoke("subject-2")).status, 200)
  assert.equal(scopes.length, 2, "other subject has its own receipt and Storage scope")
  assert.equal(scopes[1].subjectId, "subject-2")
  assert.equal((await invoke("subject-1", "/v1/library/files?subject_id=forged")).status, 400)
  assert.equal((await invoke("subject-1", "/v1/library/files", Buffer.from("broken"))).status, 400)
  for (const rawKeys of [["key-1", "key-2"], ["key-1,key-2"], [" key-1 "], ["  "]]) {
    const rejected = await invoke("subject-1", "/v1/library/files", body, rawKeys)
    assert.equal(rejected.status, 400)
    assert.equal(rejected.body.error.code, "invalid_idempotency_key")
  }
  assert.equal(scopes.length, 2, "invalid input does not replay or open Storage")
})

test("live Product POST recovers lost Complete through personal Connect, persists result, and re-admits before replay", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ConnectError, Code } = await import("@connectrpc/connect")
  const { createBffServer } = await import("../dist/bootstrap/server.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { StorageService, UploadPurpose, UploadState, ScanState } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  const servers = []
  const rows = new Map()
  let puts = 0
  let completes = 0
  let admissions = 0
  let revoked = false
  let completed = false
  const store = {
    async getReceipt(scope) {
      return rows.get(scope) ?? null
    },
    async claimReceipt(scope, fingerprint) {
      const prior = rows.get(scope)
      if (prior) return { claimed: false, receipt: prior }
      rows.set(scope, { fingerprint, status: 102, body: {} })
      return { claimed: true, receipt: null }
    },
    async putReceipt(scope, receipt) {
      rows.set(scope, receipt)
    },
    async releaseReceipt(scope) {
      if (rows.get(scope)?.status === 102) rows.delete(scope)
    },
  }
  const listen = async (server) => {
    servers.push(server)
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    return `http://127.0.0.1:${server.address().port}`
  }
  try {
    const objects = await listen(
      createServer(async (request, response) => {
        assert.equal(request.method, "PUT")
        assert.equal(request.headers.authorization, undefined)
        assert.equal(request.headers["x-kokoro-internal-secret"], undefined)
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        assert.deepEqual(Buffer.concat(chunks), input.bytes)
        puts++
        response.end()
      }),
    )
    const owner = await listen(
      createServer(
        connectNodeAdapter({
          routes(router) {
            router.service(StorageService, {
              createUpload(request, ctx) {
                assert.equal(ctx.requestHeader.get("x-kokoro-scope-kind"), "personal")
                assert.equal(ctx.requestHeader.get("x-kokoro-scope-id"), "subject-1")
                assert.equal(ctx.requestHeader.get("x-kokoro-subject-id"), "subject-1")
                assert.equal(ctx.requestHeader.get("x-kokoro-tenant-id"), "tenant-1")
                assert.equal(request.uploadPurpose, UploadPurpose.ASSET)
                return {
                  uploadId: "upload-1",
                  uploadReference: {
                    url: `${objects}/file`,
                    method: "PUT",
                    requiredHeaders: { "content-type": "text/plain" },
                    expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) },
                  },
                }
              },
              getUploadStatus() {
                return {
                  uploadId: "upload-1",
                  state: completed ? UploadState.COMPLETED : UploadState.PENDING,
                  expectedSha256: sha,
                  expectedSizeBytes: 5n,
                  mimeType: "text/plain",
                  ...(completed ? { assetId: "asset-1" } : {}),
                }
              },
              completeUpload() {
                completes++
                completed = true
                throw new ConnectError("lost after commit", Code.Unavailable)
              },
              getAsset() {
                return {
                  assetId: "asset-1",
                  filename: "fox.txt",
                  mimeType: "text/plain",
                  sizeBytes: 5n,
                  contentSha256: sha,
                  uploadPurpose: UploadPurpose.ASSET,
                  scanState: ScanState.CLEAN,
                }
              },
              listAssets(_request, ctx) {
                if (ctx.requestHeader.get("x-kokoro-subject-id") !== "subject-1") return { items: [] }
                return {
                  items: [
                    {
                      assetId: "asset-1",
                      filename: "fox.txt",
                      mimeType: "text/plain",
                      sizeBytes: 5n,
                      contentSha256: sha,
                      uploadPurpose: UploadPurpose.ASSET,
                      origin: 1,
                      scanState: ScanState.CLEAN,
                      createdAt: { seconds: 1700000000n },
                    },
                  ],
                }
              },
            })
          },
        }),
      ),
    )
    const config = loadConfig({
      KOKORO_TENANT_ID: "tenant-1",
      KOKORO_BFF_SHARED_SECRET: "web-secret",
      KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/app?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
      KOKORO_STORAGE_RPC_BASE_URL: owner,
      KOKORO_BFF_STORAGE_SECRET: "storage-secret",
      KOKORO_STORAGE_OBJECT_ORIGIN: objects,
    })
    const bff = await listen(
      createBffServer(config, {
        businessStore: store,
        readiness: async () => {},
        sessionAdmission: {
          async verify({ token }) {
            admissions++
            return revoked
              ? { ok: false, status: 401, code: "session_invalid" }
              : { ok: true, identity: { namespace: "tenant-1", userId: token === "other" ? "subject-2" : "subject-1" } }
          },
        },
      }),
    )
    const form = new FormData()
    form.append("files", new File([input.bytes], input.filename, { type: input.mimeType }))
    const wire = new Request("http://bff.test", { method: "POST", body: form })
    const body = Buffer.from(await wire.arrayBuffer())
    const post = async () => {
      const response = await fetch(`${bff}/v1/library/files`, {
        method: "POST",
        headers: {
          authorization: "Bearer owner",
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "web-secret",
          "x-kokoro-request-id": "upload-request",
          "idempotency-key": "same-key",
          "content-type": wire.headers.get("content-type"),
          "x-kokoro-subject-id": "forged",
        },
        body,
      })
      return { status: response.status, requestId: response.headers.get("x-request-id"), body: await response.json() }
    }
    const uncertain = await post()
    assert.equal(uncertain.status, 503)
    assert.equal(uncertain.requestId, "upload-request")
    assert.equal(puts, 1)
    assert.equal(completes, 1)
    assert.ok([...rows.keys()].some((scope) => scope.includes("personal-file-upload:v1")))
    const recovered = await post()
    assert.equal(recovered.status, 200)
    assert.equal(recovered.body.data.file.asset_id, "asset-1")
    assert.equal(puts, 1, "restart-style retry does not re-PUT a completed upload")
    assert.equal(completes, 1)
    assert.equal((await post()).status, 200, "terminal public receipt replays")
    const listing = await fetch(`${bff}/v1/library?kind=file`, {
      headers: { authorization: "Bearer owner", "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "web-secret" },
    })
    assert.equal(listing.status, 200)
    assert.equal((await listing.json()).data.items[0].asset_id, "asset-1")
    revoked = true
    const denied = await post()
    assert.equal(denied.status, 401, "current IAM admission precedes any terminal receipt replay")
    assert.equal(puts, 1)
    assert.equal(admissions, 5)
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  }
})
