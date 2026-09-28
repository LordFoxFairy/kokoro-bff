import assert from "node:assert/strict"
import { test } from "node:test"
import { readFile, access } from "node:fs/promises"

async function moduleAt(path) {
  assert.equal(
    await access(new URL(`../src/${path}.ts`, import.meta.url)).then(
      () => true,
      () => false,
    ),
    true,
    `${path} implemented`,
  )
  return import(`../dist/${path}.js`)
}
async function multipart(values = [new File([new Uint8Array([0, 255, 13, 10])], "Fox.TXT", { type: "application/octet-stream" })]) {
  const form = new FormData()
  for (const value of values) form.append("files", value)
  const request = new Request("http://example.test", { method: "POST", body: form })
  return [request.headers.get("content-type"), Buffer.from(await request.arrayBuffer())]
}

test("native multipart parser preserves exact bytes, mixed-case boundary and Unicode filenames", async () => {
  const { parseProjectResource } = await moduleAt("http/project-resource-input")
  const [contentType, body] = await multipart()
  const value = await parseProjectResource(contentType, body)
  assert.equal(value.filename, "Fox.TXT")
  assert.deepEqual([...value.bytes], [0, 255, 13, 10])
  assert.equal(value.sha256.length, 64)
  const [ct, b] = await multipart([new File(["hello"], "狐狸🦊.txt")])
  assert.equal((await parseProjectResource(ct, b)).filename, "狐狸🦊.txt")
})

test("multipart rejects missing/multiple files, text fields, malformed data and total size overflow", async () => {
  const { parseProjectResource } = await moduleAt("http/project-resource-input")
  for (const values of [[], [new File(["a"], "a"), new File(["b"], "b")], ["not-a-file"], [new File(["a"], ".")]]) {
    await assert.rejects(parseProjectResource(...(await multipart(values))))
  }
  await assert.rejects(parseProjectResource("multipart/form-data; boundary=x", Buffer.from("broken")))
  await assert.rejects(parseProjectResource("application/json", Buffer.from("{}")))
  await assert.rejects(parseProjectResource("multipart/form-data; boundary=x", Buffer.alloc(1024 * 1024 + 1)))
})

function fixture() {
  const receipts = new Map()
  const calls = []
  const input = {
    filename: "fox.txt",
    mimeType: "text/plain",
    bytes: Buffer.from("hello"),
    sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  }
  let completed = false
  const asset = {
    upload_id: "upload-1",
    asset_id: "asset-1",
    filename: "fox.txt",
    mime_type: "text/plain",
    size_bytes: "5",
    content_sha256: input.sha256,
    scan_state: "clean",
  }
  const store = {
    async getReceipt(key) {
      return receipts.get(key) ?? null
    },
    async claimReceipt(key, fingerprint) {
      if (receipts.has(key)) return { claimed: false, receipt: receipts.get(key) }
      receipts.set(key, { fingerprint, status: 102, body: {} })
      return { claimed: true, receipt: null }
    },
    async putReceipt(key, value) {
      receipts.set(key, value)
    },
    async releaseReceipt(key) {
      if (receipts.get(key)?.status === 102) receipts.delete(key)
    },
  }
  const storage = {
    async createUpload() {
      calls.push("create")
      assert.equal(completed, false, "never recreate completed upload")
      return {
        uploadId: "upload-1",
        reference: { url: "http://objects.test/put", method: "PUT", headers: { "content-type": "text/plain" }, expiresAt: Date.now() + 60_000 },
      }
    },
    async getUploadStatus() {
      calls.push("status")
      return { state: completed ? "completed" : "pending", assetId: completed ? "asset-1" : null, sha256: input.sha256, sizeBytes: "5", mimeType: "text/plain" }
    },
    async put() {
      calls.push("put")
      assert.equal(
        [...receipts.values()].some((r) => r.status === 200 && r.body.upload_id === "upload-1"),
        true,
        "durable checkpoint before PUT",
      )
    },
    async completeUpload() {
      calls.push("complete")
      completed = true
      return { assetId: "asset-1", scanState: "clean" }
    },
    async getAsset() {
      calls.push("asset")
      return asset
    },
    async abortUpload() {
      calls.push("abort")
    },
  }
  const context = { tenantId: "tenant-1", subjectId: "subject-1", projectId: "project-1", key: "public-key", requestId: "request-1" }
  return { receipts, calls, input, store, storage, context, asset }
}

test("durable upload checkpoint allows reconstructed service to recover completed upload without a second asset", async () => {
  const { uploadProjectResource } = await moduleAt("application/project-resource-upload")
  const f = fixture()
  assert.deepEqual(await uploadProjectResource(f.context, f.input, f.store, f.storage, AbortSignal.timeout(5000)), f.asset)
  f.calls.length = 0
  assert.deepEqual(await uploadProjectResource({ ...f.context, requestId: "request-2" }, f.input, f.store, f.storage, AbortSignal.timeout(5000)), f.asset)
  assert.deepEqual(f.calls, ["status", "asset"])
  await assert.rejects(uploadProjectResource(f.context, { ...f.input, filename: "changed.txt" }, f.store, f.storage, AbortSignal.timeout(5000)), /conflict/)
})

test("unknown Complete result retains checkpoint and never aborts an already-completed asset", async () => {
  const { uploadProjectResource } = await moduleAt("application/project-resource-upload")
  const f = fixture(),
    complete = f.storage.completeUpload
  f.storage.completeUpload = async () => {
    await complete()
    throw new Error("response lost")
  }
  await assert.rejects(uploadProjectResource(f.context, f.input, f.store, f.storage, AbortSignal.timeout(5000)))
  assert.equal(f.calls.includes("abort"), false)
  f.calls.length = 0
  assert.deepEqual(await uploadProjectResource(f.context, f.input, f.store, f.storage, AbortSignal.timeout(5000)), f.asset)
  assert.deepEqual(f.calls, ["status", "asset"])
})

test("PUT failure attempts Abort and checkpoint write failure sends no object bytes", async () => {
  const { uploadProjectResource } = await moduleAt("application/project-resource-upload")
  const f = fixture()
  f.storage.put = async () => {
    throw new Error("PUT unavailable")
  }
  await assert.rejects(uploadProjectResource(f.context, f.input, f.store, f.storage, AbortSignal.timeout(5000)))
  assert.equal(f.calls.includes("abort"), true)
  const g = fixture()
  g.store.putReceipt = async () => {
    throw new Error("DB unavailable")
  }
  await assert.rejects(uploadProjectResource(g.context, g.input, g.store, g.storage, AbortSignal.timeout(5000)))
  assert.equal(g.calls.includes("put"), false)
})

test("Storage transfer rejects arbitrary origins, redirect, credentials and unexpected headers", async () => {
  const { putStorageBytes } = await moduleAt("infrastructure/clients/storage/transfer")
  const valid = { url: "http://objects.test/file?signature=opaque", method: "PUT", headers: { "content-type": "text/plain" }, expiresAt: Date.now() + 60000 }
  let calls = 0
  const fetcher = async (url, init) => {
    calls++
    assert.equal(init.redirect, "error")
    assert.deepEqual(init.headers, { "content-type": "text/plain" })
    return new Response(null, { status: 200 })
  }
  await putStorageBytes(valid, Buffer.from("hello"), "text/plain", "http://objects.test", AbortSignal.timeout(5000), fetcher)
  for (const change of [
    { url: "http://metadata.test/file" },
    { url: "http://u:p@objects.test/file" },
    { method: "GET" },
    { headers: { authorization: "secret" } },
    { expiresAt: Date.now() - 1 },
  ]) {
    await assert.rejects(
      putStorageBytes({ ...valid, ...change }, Buffer.from("hello"), "text/plain", "http://objects.test", AbortSignal.timeout(5000), fetcher),
    )
  }
  assert.equal(calls, 1)
})

test("Storage v2 facade uses generated Connect calls and only trusted project metadata", async () => {
  const { StorageUploadClient } = await moduleAt("infrastructure/clients/storage/client")
  const { createRouterTransport } = await import("@connectrpc/connect")
  const { StorageService, UploadPurpose } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  const f = fixture()
  const transport = createRouterTransport((router) =>
    router.service(StorageService, {
      createUpload(request, context) {
        assert.equal(context.requestHeader.get("x-kokoro-service"), "web-bff")
        assert.equal(context.requestHeader.get("x-kokoro-internal-secret"), "storage-secret")
        assert.equal(context.requestHeader.get("x-kokoro-scope-kind"), "project")
        assert.equal(context.requestHeader.get("x-kokoro-scope-id"), "project-1")
        assert.equal(context.requestHeader.get("x-kokoro-subject-id"), "subject-1")
        assert.equal(context.requestHeader.get("authorization"), null)
        assert.equal(request.uploadPurpose, UploadPurpose.ASSET)
        assert.equal(request.sizeBytes, 5n)
        assert.equal(request.contentSha256, f.input.sha256)
        return {
          uploadId: "upload-1",
          uploadReference: {
            url: "http://objects.test/a",
            method: "PUT",
            requiredHeaders: { "content-type": "text/plain" },
            expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60), nanos: 0 },
          },
        }
      },
    }),
  )
  const client = new StorageUploadClient(
    { baseUrl: "http://storage.test", secret: "storage-secret", objectOrigin: "http://objects.test" },
    f.context,
    transport,
  )
  assert.equal((await client.createUpload("command-1", "a".repeat(64), f.input, AbortSignal.timeout(5000))).uploadId, "upload-1")
})

test("project resource route resolves current ownership before replay and uses canonical project id", async () => {
  const { projectResourceRoute } = await moduleAt("http/routes/project-resource")
  const { EventEmitter } = await import("node:events")
  const f = fixture(),
    context = { identity: { namespace: "tenant-1", userId: "subject-1" }, requestId: "request-1" }
  let visible = true,
    calls = 0
  const store = {
    ...f.store,
    services: {
      projects: {
        async find(scope, id) {
          assert.deepEqual(scope, { tenantId: "tenant-1", subjectId: "subject-1" })
          assert.equal(id, "project-slug")
          return visible ? { id: "project-1" } : null
        },
      },
    },
  }
  const form = new FormData()
  form.append("files", new File(["hello"], "hello.txt", { type: "text/plain" }))
  const wire = new Request("http://bff.test", { method: "POST", body: form })
  const body = Buffer.from(await wire.arrayBuffer())
  const invoke = async () => {
    const req = new EventEmitter()
    req.headers = { "content-type": wire.headers.get("content-type"), "idempotency-key": "public-key" }
    const res = new EventEmitter()
    res.writeHead = (status) => {
      res.status = status
    }
    res.end = (data) => {
      res.body = JSON.parse(data)
      res.writableEnded = true
    }
    await projectResourceRoute(
      req,
      res,
      { storage: { baseUrl: "http://storage.test", secret: "secret", objectOrigin: "http://objects.test" } },
      context,
      "project-slug",
      body,
      store,
      new Map(),
      (_config, uploadContext) => {
        calls++
        assert.equal(uploadContext.projectId, "project-1")
        return f.storage
      },
    )
    return res
  }
  assert.equal((await invoke()).status, 200)
  assert.equal((await invoke()).status, 200)
  assert.equal(calls, 1)
  visible = false
  assert.equal((await invoke()).status, 404)
  assert.equal(calls, 1)
})

test("Storage configuration is independent, atomic and origin-only", async () => {
  const { loadConfig } = await import("../dist/config/runtime.js")
  const env = {
    KOKORO_BFF_SHARED_SECRET: "secret",
    KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/app?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
  }
  assert.equal(loadConfig(env).storage, undefined)
  assert.throws(() => loadConfig({ ...env, KOKORO_STORAGE_RPC_BASE_URL: "http://storage.test" }))
  const configured = {
    ...env,
    KOKORO_STORAGE_RPC_BASE_URL: "http://storage.test",
    KOKORO_STORAGE_OBJECT_ORIGIN: "http://objects.test",
    KOKORO_BFF_STORAGE_SECRET: "independent-secret",
  }
  assert.deepEqual(loadConfig(configured).storage, { baseUrl: "http://storage.test", objectOrigin: "http://objects.test", secret: "independent-secret" })
  for (const origin of ["file:///tmp/objects", "http://user:pass@objects.test", "http://objects.test/a", "http://objects.test?secret=a"])
    assert.throws(() => loadConfig({ ...configured, KOKORO_STORAGE_OBJECT_ORIGIN: origin }))
})

test("outer receipt release/reclaim cannot erase a terminal upload checkpoint", async () => {
  const { uploadProjectResource } = await moduleAt("application/project-resource-upload")
  const { mutationTicket, commitReceipt } = await import("../dist/application/idempotency.js")
  const f = fixture(),
    context = { identity: { namespace: "tenant-1", userId: "subject-1" }, requestId: "request-1" },
    memory = new Map()
  const outer = await mutationTicket("public-key", "POST", "/projects/project-1/resources", context, "fingerprint", memory, f.store)
  await uploadProjectResource(f.context, f.input, f.store, f.storage, AbortSignal.timeout(5000))
  await commitReceipt(memory, outer.ticket, 503, {})
  const reclaimed = await mutationTicket("public-key", "POST", "/projects/project-1/resources", context, "fingerprint", memory, f.store)
  assert.ok(reclaimed.ticket)
  f.calls.length = 0
  await uploadProjectResource(f.context, f.input, f.store, f.storage, AbortSignal.timeout(5000))
  assert.deepEqual(f.calls, ["status", "asset"])
  const checkpoint = [...f.receipts.entries()].find(([key]) => key.includes("project-resource-upload:v1"))
  assert.equal(checkpoint[1].status, 200)
})

test("public project resource contract is a bounded single file with explicit asset information", async () => {
  const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const operation = source.split("  /v1/projects/{projectId}/resources:")[1].split("  /v1/projects/{projectId}/skills/")[0]
  assert.match(operation, /minItems: 1/)
  assert.match(operation, /maxItems: 1/)
  assert.match(operation, /1048576/)
  assert.match(operation, /ProjectResourceUploadResponse/)
  assert.match(operation, /'413':/)
  assert.match(operation, /'502':/)
  for (const field of ["upload_id", "asset_id", "content_sha256", "scan_state", "size_bytes"])
    assert.ok(source.split("    ProjectResourceUploadResponse:")[1].split("    RequestId:")[0].includes(field))
})

test("HTTP composition performs Connect upload and exact presigned PUT then replays without another asset", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { createBffServer } = await import("../dist/bootstrap/server.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { StorageService, UploadState, ScanState, UploadPurpose } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  const f = fixture(),
    servers = []
  const listen = async (server) => {
    servers.push(server)
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    return `http://127.0.0.1:${server.address().port}`
  }
  let puts = 0,
    creates = 0,
    completes = 0,
    allowed = true
  try {
    const objects = await listen(
      createServer(async (req, res) => {
        assert.equal(req.method, "PUT")
        assert.equal(req.headers.authorization, undefined)
        assert.equal(req.headers["x-kokoro-internal-secret"], undefined)
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        assert.deepEqual(Buffer.concat(chunks), f.input.bytes)
        puts++
        res.end()
      }),
    )
    const storage = await listen(
      createServer(
        connectNodeAdapter({
          routes(router) {
            router.service(StorageService, {
              createUpload(req, ctx) {
                creates++
                assert.equal(ctx.requestHeader.get("x-kokoro-scope-id"), "project-1")
                assert.equal(ctx.requestHeader.get("x-kokoro-tenant-id"), "tenant-1")
                assert.equal(ctx.requestHeader.get("x-kokoro-internal-secret"), "storage-secret")
                assert.equal(req.contentSha256, f.input.sha256)
                return {
                  uploadId: "upload-1",
                  uploadReference: {
                    url: `${objects}/object`,
                    method: "PUT",
                    requiredHeaders: { "content-type": "text/plain" },
                    expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) },
                  },
                }
              },
              getUploadStatus() {
                return {
                  uploadId: "upload-1",
                  state: completes ? UploadState.COMPLETED : UploadState.PENDING,
                  expectedSha256: f.input.sha256,
                  expectedSizeBytes: 5n,
                  mimeType: "text/plain",
                  ...(completes ? { assetId: "asset-1" } : {}),
                }
              },
              completeUpload() {
                completes++
                return { uploadId: "upload-1", assetId: "asset-1", scanState: ScanState.CLEAN }
              },
              getAsset() {
                return {
                  assetId: "asset-1",
                  contentSha256: f.input.sha256,
                  sizeBytes: 5n,
                  mimeType: "text/plain",
                  filename: "fox.txt",
                  uploadPurpose: UploadPurpose.ASSET,
                  scanState: ScanState.CLEAN,
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
      KOKORO_STORAGE_RPC_BASE_URL: storage,
      KOKORO_STORAGE_OBJECT_ORIGIN: objects,
      KOKORO_BFF_STORAGE_SECRET: "storage-secret",
    })
    const store = {
      ...f.store,
      services: {
        projects: {
          async find(scope) {
            assert.deepEqual(scope, { tenantId: "tenant-1", subjectId: "subject-1" })
            return allowed ? { id: "project-1" } : null
          },
        },
      },
    }
    let failFinalReceipt = true
    const persist = store.putReceipt
    store.putReceipt = async (key, receipt) => {
      if (key.includes('"POST"') && failFinalReceipt) {
        failFinalReceipt = false
        throw new Error("final receipt temporarily unavailable")
      }
      await persist(key, receipt)
    }
    const bff = await listen(
      createBffServer(config, {
        businessStore: store,
        readiness: async () => {},
        sessionAdmission: {
          async verify() {
            return { ok: true, identity: { namespace: "tenant-1", userId: "subject-1" } }
          },
        },
      }),
    )
    const upload = async (files = 1) => {
      const form = new FormData()
      for (let i = 0; i < files; i++) form.append("files", new File([f.input.bytes], "fox.txt", { type: "text/plain" }))
      return fetch(`${bff}/v1/projects/slug/resources`, {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "web-secret",
          "idempotency-key": "key-1",
          "x-kokoro-tenant-id": "forged",
        },
        body: form,
      })
    }
    let response = await upload()
    assert.equal(response.status, 503)
    await response.arrayBuffer()
    response = await upload()
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    assert.equal((await response.json()).data.resources[0].asset_id, "asset-1")
    response = await upload()
    assert.equal(response.status, 200)
    await response.arrayBuffer()
    assert.equal(puts, 1)
    assert.equal(completes, 1)
    assert.equal(creates, 2)
    response = await upload(2)
    assert.equal(response.status, 400)
    await response.arrayBuffer()
    allowed = false
    response = await upload()
    assert.equal(response.status, 404)
    await response.arrayBuffer()
    assert.equal(completes, 1)
  } finally {
    for (const server of servers.reverse()) {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

test("both Complete and GetAsset require CLEAN; infection and pending scans have stable typed errors", async () => {
  const { StorageUploadClient } = await moduleAt("infrastructure/clients/storage/client")
  const { createRouterTransport } = await import("@connectrpc/connect")
  const { StorageService, ScanState, UploadPurpose } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  for (const [scanState, code, status, retryable] of [
    [ScanState.INFECTED, "resource_file_infected", 422, false],
    [ScanState.UNKNOWN, "resource_scan_pending", 503, true],
    [ScanState.PENDING, "resource_scan_pending", 503, true],
    [999, "storage_response_invalid", 502, false],
  ]) {
    const f = fixture()
    const transport = createRouterTransport((router) =>
      router.service(StorageService, {
        completeUpload() {
          return { uploadId: "upload-1", assetId: "asset-1", scanState }
        },
        getAsset() {
          return {
            assetId: "asset-1",
            filename: f.input.filename,
            mimeType: f.input.mimeType,
            sizeBytes: 5n,
            contentSha256: f.input.sha256,
            uploadPurpose: UploadPurpose.ASSET,
            scanState,
          }
        },
      }),
    )
    const client = new StorageUploadClient({ baseUrl: "http://storage.test", secret: "secret", objectOrigin: "http://objects.test" }, f.context, transport)
    const match = (error) => error.code === code && error.status === status && error.retryable === retryable
    await assert.rejects(client.completeUpload("complete", "a".repeat(64), "upload-1", f.input, AbortSignal.timeout(5000)), match)
    await assert.rejects(client.getAsset("upload-1", "asset-1", f.input, AbortSignal.timeout(5000)), match)
  }
})

test("quarantined completion returns no resource; same-key retries retain one asset and only clean recovers", async () => {
  const { StorageUploadClient } = await moduleAt("infrastructure/clients/storage/client")
  const { projectResourceRoute } = await moduleAt("http/routes/project-resource")
  const { createRouterTransport } = await import("@connectrpc/connect")
  const { EventEmitter } = await import("node:events")
  const { StorageService, ScanState, UploadState, UploadPurpose } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  for (const initialScan of [ScanState.INFECTED, ScanState.UNKNOWN, ScanState.PENDING]) {
    const f = fixture()
    let scan = initialScan,
      creates = 0,
      puts = 0,
      completes = 0,
      reads = 0
    const transport = createRouterTransport((router) =>
      router.service(StorageService, {
        createUpload() {
          creates++
          return {
            uploadId: "upload-1",
            uploadReference: {
              url: "http://objects.test/object",
              method: "PUT",
              requiredHeaders: { "content-type": "text/plain" },
              expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) },
            },
          }
        },
        getUploadStatus() {
          return {
            uploadId: "upload-1",
            state: completes ? UploadState.COMPLETED : UploadState.PENDING,
            assetId: completes ? "asset-1" : undefined,
            expectedSha256: f.input.sha256,
            expectedSizeBytes: 5n,
            mimeType: "text/plain",
          }
        },
        completeUpload() {
          completes++
          return { uploadId: "upload-1", assetId: "asset-1", scanState: scan }
        },
        getAsset() {
          reads++
          return {
            assetId: "asset-1",
            filename: f.input.filename,
            mimeType: f.input.mimeType,
            sizeBytes: 5n,
            contentSha256: f.input.sha256,
            uploadPurpose: UploadPurpose.ASSET,
            scanState: scan,
          }
        },
        abortUpload() {
          assert.fail("never abort completed/quarantined assets")
        },
        getDownloadReference() {
          assert.fail("never issue a download reference")
        },
      }),
    )
    const config = { storage: { baseUrl: "http://storage.test", secret: "secret", objectOrigin: "http://objects.test" } }
    const store = {
      ...f.store,
      services: {
        projects: {
          async find() {
            return { id: "project-1" }
          },
        },
      },
    }
    const [contentType, body] = await multipart([new File([f.input.bytes], f.input.filename, { type: f.input.mimeType })])
    const invoke = async () => {
      const request = new EventEmitter()
      request.headers = { "content-type": contentType, "idempotency-key": "same-key" }
      const response = new EventEmitter()
      response.writeHead = (status) => {
        response.status = status
      }
      response.end = (bytes) => {
        response.body = JSON.parse(bytes)
        response.writableEnded = true
      }
      await projectResourceRoute(
        request,
        response,
        config,
        { identity: { namespace: "tenant-1", userId: "subject-1" }, requestId: "request" },
        "slug",
        body,
        store,
        new Map(),
        (cfg, ctx) => {
          const client = new StorageUploadClient(cfg, ctx, transport)
          client.put = async () => {
            puts++
          }
          return client
        },
      )
      return response
    }
    const expected = initialScan === ScanState.INFECTED ? [422, "resource_file_infected"] : [503, "resource_scan_pending"]
    const first = await invoke()
    assert.equal(first.status, expected[0])
    assert.equal(first.body.error.code, expected[1])
    assert.equal(first.body.data, undefined)
    assert.equal(reads, 0, "Complete scan is checked before asset lookup")
    const retry = await invoke()
    assert.equal(retry.status, expected[0])
    assert.equal(retry.body.error.code, expected[1])
    assert.equal(retry.body.data, undefined)
    scan = ScanState.CLEAN
    const recovered = await invoke()
    assert.equal(recovered.status, initialScan === ScanState.INFECTED ? 422 : 200)
    if (initialScan !== ScanState.INFECTED) assert.equal(recovered.body.data.resources[0].scan_state, "clean")
    assert.equal(creates, 2)
    assert.equal(puts, 1)
    assert.equal(completes, 1)
  }
})
