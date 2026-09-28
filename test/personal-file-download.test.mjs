import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const bytes = Buffer.from("hello")
const sha = createHash("sha256").update(bytes).digest("hex")
const storage = { baseUrl: "http://storage.test", secret: "storage-secret", objectOrigin: "http://objects.test" }
const identity = { namespace: "tenant-1", userId: "subject-1" }

test("personal download is a versioned binary Product operation with stable errors", async () => {
  const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const operation = source.split("  /v1/library/files/{asset_id}/content:")[1]?.split("  /v1/billing/plans:")[0] ?? ""
  for (const marker of [
    "operationId: downloadLibraryFile",
    "x-kokoro-idempotency: none",
    "x-kokoro-permission: storage.library.read",
    "'*/*':",
    "format: binary",
    "Content-Disposition:",
    "Referrer-Policy:",
    "x-request-id:",
    "'200':",
    "'400':",
    "'401':",
    "'403':",
    "'404':",
    "'429':",
    "'502':",
    "'503':",
  ])
    assert.ok(operation.includes(marker), marker)
})

test("personal Storage download checks ASSET/CLEAN before signing, verifies exact metadata and bytes, and carries admitted scope", async () => {
  const { PersonalFileDownloadClient } = await import("../dist/infrastructure/clients/storage/personal-file-download.js")
  const { createRouterTransport, ConnectError, Code } = await import("@connectrpc/connect")
  const { StorageService, UploadPurpose, ScanState } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  const calls = []
  let asset = {
    assetId: "asset-1",
    filename: "fox.txt",
    mimeType: "text/plain",
    contentSha256: sha,
    sizeBytes: 5n,
    uploadPurpose: UploadPurpose.ASSET,
    scanState: ScanState.CLEAN,
  }
  let reference = {
    assetId: "asset-1",
    contentSha256: sha,
    sizeBytes: 5n,
    mimeType: "text/plain",
    scanState: ScanState.CLEAN,
    downloadReference: {
      url: "http://objects.test/download?sig=secret",
      method: "GET",
      requiredHeaders: {},
      expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) },
    },
  }
  let referenceError = null
  const transport = createRouterTransport((router) =>
    router.service(StorageService, {
      getAsset(req, ctx) {
        calls.push(["asset", req, ctx])
        return asset
      },
      getDownloadReference(req, ctx) {
        calls.push(["reference", req, ctx])
        if (referenceError !== null) throw referenceError
        return reference
      },
    }),
  )
  const fetchCalls = []
  const fetchImpl = async (url, options) => {
    fetchCalls.push({ url, options })
    return new Response(bytes, { status: 200 })
  }
  const client = new PersonalFileDownloadClient(storage, { tenantId: "tenant-1", subjectId: "subject-1", requestId: "request-1" }, transport, fetchImpl)
  assert.deepEqual(await client.download("asset-1", AbortSignal.timeout(5000)), { bytes, mimeType: "text/plain", filename: "fox.txt" })
  assert.deepEqual(
    calls.map(([name]) => name),
    ["asset", "reference"],
  )
  assert.equal(calls[0][1].assetId, "asset-1")
  assert.equal(calls[1][1].contentSha256, sha)
  assert.ok(calls[1][1].command?.commandId)
  assert.ok(calls[1][1].command?.requestDigest)
  for (const [, , ctx] of calls)
    for (const [key, value] of Object.entries({
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "storage-secret",
      "x-kokoro-tenant-id": "tenant-1",
      "x-kokoro-subject-id": "subject-1",
      "x-kokoro-scope-kind": "personal",
      "x-kokoro-scope-id": "subject-1",
      "x-kokoro-request-id": "request-1",
    }))
      assert.equal(ctx.requestHeader.get(key), value)
  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].options.redirect, "manual")
  assert.equal(fetchCalls[0].options.credentials, "omit")
  assert.equal(fetchCalls[0].options.headers?.authorization, undefined)
  assert.equal(fetchCalls[0].options.headers?.cookie, undefined)

  asset = { ...asset, uploadPurpose: UploadPurpose.CAPABILITY_PACKAGE }
  await assert.rejects(client.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 404)
  assert.equal(fetchCalls.length, 1)
  asset = { ...asset, uploadPurpose: UploadPurpose.ASSET, scanState: ScanState.PENDING }
  await assert.rejects(client.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 404)
  asset = { ...asset, scanState: ScanState.CLEAN }
  reference = { ...reference, sizeBytes: 6n }
  await assert.rejects(client.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 502)
  reference = { ...reference, sizeBytes: 5n, downloadReference: { ...reference.downloadReference, url: "http://evil.test/x" } }
  await assert.rejects(client.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 502)
  reference = { ...reference, downloadReference: { ...reference.downloadReference, url: "http://objects.test/x", expiresAt: { seconds: 1n } } }
  await assert.rejects(client.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 502)
  reference = { ...reference, downloadReference: { ...reference.downloadReference, expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) } } }
  const badBytesClient = new PersonalFileDownloadClient(
    storage,
    { tenantId: "tenant-1", subjectId: "subject-1", requestId: "request-2" },
    transport,
    async () => new Response("bad", { status: 200 }),
  )
  await assert.rejects(badBytesClient.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 502)
  const redirectClient = new PersonalFileDownloadClient(
    storage,
    { tenantId: "tenant-1", subjectId: "subject-1", requestId: "request-3" },
    transport,
    async () => new Response(null, { status: 302, headers: { location: "http://evil.test/" } }),
  )
  await assert.rejects(redirectClient.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 502)
  referenceError = new ConnectError("object version or digest is unhealthy", Code.FailedPrecondition)
  const fetchesBefore = fetchCalls.length
  await assert.rejects(
    client.download("asset-1", AbortSignal.timeout(5000)),
    (error) => error.status === 502 && error.code === "storage_response_invalid" && !error.message.includes("object version"),
  )
  assert.equal(fetchCalls.length, fetchesBefore, "failed reference must not fetch or expose bytes")
})

test("download route emits only fully validated bytes with safe headers and JSON errors", async () => {
  const { personalFileDownloadRoute } = await import("../dist/http/routes/personal-file-download.js")
  const invoke = async (url, download = async () => ({ bytes, mimeType: "text/plain", filename: "x/é\r\n.txt" })) => {
    const request = new EventEmitter()
    request.url = url
    request.headers = {}
    const response = new EventEmitter()
    response.headers = {}
    response.setHeader = (key, value) => {
      response.headers[key.toLowerCase()] = value
    }
    response.writeHead = (status, headers) => {
      response.status = status
      response.headers = { ...response.headers, ...headers }
    }
    response.end = (body) => {
      response.body = body
      response.writableEnded = true
    }
    await personalFileDownloadRoute(request, response, { storage }, { requestId: "req-1", identity }, "asset-1", () => ({ download }))
    return response
  }
  const result = await invoke("/v1/library/files/asset-1/content")
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, bytes)
  assert.equal(result.headers["x-request-id"], "req-1")
  assert.equal(result.headers["cache-control"], "no-store")
  assert.equal(result.headers["referrer-policy"], "no-referrer")
  assert.equal(result.headers["x-content-type-options"], "nosniff")
  assert.equal(result.headers["content-length"], 5)
  assert.match(result.headers["content-disposition"], /^attachment; filename="[^"]+"; filename\*=UTF-8''/u)
  assert.doesNotMatch(result.headers["content-disposition"], /\r|\n|\//u)
  const special = await invoke("/v1/library/files/asset-1/content", async () => ({ bytes, mimeType: "text/plain", filename: "a'()*.txt" }))
  assert.match(special.headers["content-disposition"], /filename\*=UTF-8''a%27%28%29%2A\.txt$/u)
  const invalid = await invoke("/v1/library/files/asset-1/content?subject_id=evil")
  assert.equal(invalid.status, 400)
  assert.equal(JSON.parse(invalid.body).error.code, "invalid_library_file")
  assert.equal(invalid.headers["referrer-policy"], "no-referrer")
  assert.equal(invalid.headers["x-content-type-options"], "nosniff")
  const fault = await invoke("/v1/library/files/asset-1/content", async () => {
    throw new Error("signed-secret-url")
  })
  assert.equal(fault.status, 503)
  assert.equal(JSON.parse(fault.body).error.code, "storage_unavailable")
  assert.ok(!String(fault.body).includes("signed-secret-url"))
})

test("live Product HTTP re-admits every download and never returns another subject's bytes", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ConnectError, Code } = await import("@connectrpc/connect")
  const { StorageService, UploadPurpose, ScanState } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  const { createBffServer } = await import("../dist/bootstrap/server.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const servers = []
  const calls = []
  let admissions = 0
  let objectGets = 0
  const listen = async (server) => {
    servers.push(server)
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    return `http://127.0.0.1:${server.address().port}`
  }
  try {
    const objectOrigin = await listen(
      createServer((_request, response) => {
        objectGets++
        response.writeHead(200, { "content-type": "text/plain", "content-length": bytes.length })
        response.end(bytes)
      }),
    )
    const owner = await listen(
      createServer(
        connectNodeAdapter({
          routes(router) {
            router.service(StorageService, {
              getAsset(req, ctx) {
                const subject = ctx.requestHeader.get("x-kokoro-subject-id")
                calls.push(["asset", subject, ctx.requestHeader.get("x-kokoro-scope-id"), ctx.requestHeader.get("x-kokoro-scope-kind")])
                if (subject !== "subject-1" || req.assetId !== "asset-1") throw new ConnectError("private", Code.NotFound)
                return {
                  assetId: "asset-1",
                  filename: "fox.txt",
                  mimeType: "text/plain",
                  contentSha256: sha,
                  sizeBytes: 5n,
                  uploadPurpose: UploadPurpose.ASSET,
                  scanState: ScanState.CLEAN,
                }
              },
              getDownloadReference(req, ctx) {
                calls.push([
                  "reference",
                  ctx.requestHeader.get("x-kokoro-subject-id"),
                  ctx.requestHeader.get("x-kokoro-scope-id"),
                  ctx.requestHeader.get("x-kokoro-scope-kind"),
                ])
                assert.equal(req.contentSha256, sha)
                return {
                  assetId: "asset-1",
                  contentSha256: sha,
                  sizeBytes: 5n,
                  mimeType: "text/plain",
                  scanState: ScanState.CLEAN,
                  downloadReference: {
                    url: `${objectOrigin}/file?sig=private`,
                    method: "GET",
                    requiredHeaders: {},
                    expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) },
                  },
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
      KOKORO_STORAGE_OBJECT_ORIGIN: objectOrigin,
    })
    const bff = await listen(
      createBffServer(config, {
        readiness: async () => {},
        businessStore: null,
        sessionAdmission: {
          async verify({ token }) {
            admissions++
            return { ok: true, identity: { namespace: "tenant-1", userId: token === "other" ? "subject-2" : "subject-1" } }
          },
        },
      }),
    )
    const get = async (token = "user", path = "/v1/library/files/asset-1/content") =>
      fetch(`${bff}${path}`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "web-secret",
          "x-kokoro-request-id": "download-http",
          "x-kokoro-subject-id": "forged",
          "x-kokoro-scope-id": "forged",
        },
      })
    const own = await get()
    assert.equal(own.status, 200)
    assert.deepEqual(Buffer.from(await own.arrayBuffer()), bytes)
    assert.equal(own.headers.get("x-request-id"), "download-http")
    assert.equal(own.headers.get("cache-control"), "no-store")
    const other = await get("other")
    assert.equal(other.status, 404)
    assert.equal((await other.json()).error.code, "library_file_not_found")
    const invalid = await get("user", "/v1/library/files/asset-1/content?subject_id=other")
    assert.equal(invalid.status, 400)
    assert.equal((await invalid.json()).error.code, "invalid_library_file")
    assert.equal(admissions, 3)
    assert.equal(objectGets, 1)
    assert.deepEqual(calls, [
      ["asset", "subject-1", "subject-1", "personal"],
      ["reference", "subject-1", "subject-1", "personal"],
      ["asset", "subject-2", "subject-2", "personal"],
    ])
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  }
})

test("bounded GET transfer rejects unsafe references, oversized bytes and cancellation before public success", async () => {
  const { readPersonalFileBytes } = await import("../dist/infrastructure/clients/storage/personal-file-download-transfer.js")
  const valid = { url: "http://objects.test/file?sig=private", method: "GET", requiredHeaders: {}, expiresAt: Date.now() + 60_000 }
  const signal = AbortSignal.timeout(5000)
  const neverFetch = async () => {
    throw new Error("must not fetch")
  }
  for (const reference of [
    { ...valid, method: "PUT" },
    { ...valid, requiredHeaders: { authorization: "Bearer secret" } },
    { ...valid, url: "http://objects.test@evil.test/file" },
    { ...valid, url: "http://objects.test/file#fragment" },
    { ...valid, expiresAt: Date.now() - 1 },
  ])
    await assert.rejects(readPersonalFileBytes(reference, 5, sha, storage.objectOrigin, signal, neverFetch), (error) => error.status === 502)

  await assert.rejects(
    readPersonalFileBytes(valid, 5, sha, storage.objectOrigin, signal, async () => new Response("hello!", { status: 200 })),
    (error) => error.status === 502,
  )
  await assert.rejects(
    readPersonalFileBytes(valid, 5, sha, storage.objectOrigin, signal, async () => new Response("other", { status: 200 })),
    (error) => error.status === 502,
  )
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(
    readPersonalFileBytes(valid, 5, sha, storage.objectOrigin, cancelled.signal, async (_url, options) => {
      assert.equal(options.signal.aborted, true)
      throw new DOMException("cancelled", "AbortError")
    }),
    (error) => error.status === 503,
  )
})
