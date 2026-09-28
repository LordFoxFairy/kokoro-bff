import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

test("public project-resource GET declares exact bounded page and metadata only", async () => {
  const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const operation = source.split("  /v1/projects/{projectId}/resources:")[1].split("    post:")[0]
  assert.match(operation, /operationId: listProjectResources/)
  assert.match(operation, /maximum: 100/)
  assert.match(operation, /default: 50/)
  assert.match(operation, /maxLength: 4096/)
  assert.match(operation, /x-kokoro-idempotency: none/)
  assert.match(operation, /ProjectResourceListResponse/)
  for (const status of [200, 400, 401, 403, 404, 429, 502, 503]) assert.ok(operation.includes(`'${status}':`))
  const shape = source.split("    ProjectResourceListResponse:")[1]?.split("    ProjectResourceUploadResponse:")[0]
  assert.ok(shape)
  for (const field of ["items", "next_cursor", "asset_id", "filename", "mime_type", "size_bytes", "content_sha256", "scan_state", "created_at"])
    assert.ok(shape.includes(field), field)
  assert.doesNotMatch(shape, /upload_id|download_url|upload_reference/)
})

const context = { tenantId: "tenant-1", subjectId: "subject-1", projectId: "project-1", requestId: "request-1" }
const storageConfig = { baseUrl: "http://storage.test", secret: "storage-secret", objectOrigin: "http://objects.test" }
async function fixture(overrides = {}) {
  const { StorageUploadClient } = await import("../dist/infrastructure/clients/storage/client.js")
  const { createRouterTransport } = await import("@connectrpc/connect")
  const { StorageService } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  const item = {
    assetId: "asset-1",
    filename: "fox.txt",
    mimeType: "text/plain",
    sizeBytes: 5n,
    contentSha256: "a".repeat(64),
    uploadPurpose: 2,
    origin: 1,
    scanState: 2,
    createdAt: { seconds: 1700000000n, nanos: 123456000 },
  }
  const calls = []
  const transport = createRouterTransport((router) =>
    router.service(StorageService, {
      listAssets(req, ctx) {
        calls.push({ req, ctx })
        return overrides.reply?.(req, ctx, item) ?? { items: [item], nextCursor: "next-page" }
      },
    }),
  )
  return { client: new StorageUploadClient(storageConfig, context, transport), calls, item }
}

test("generated ListAssets facade sends trusted project headers and returns lossless bounded page", async () => {
  const f = await fixture()
  const page = await f.client.listAssets({ limit: 1, cursor: "previous" }, AbortSignal.timeout(5000))
  assert.deepEqual(page, {
    items: [
      {
        asset_id: "asset-1",
        filename: "fox.txt",
        mime_type: "text/plain",
        size_bytes: "5",
        content_sha256: "a".repeat(64),
        scan_state: "clean",
        created_at: "2023-11-14T22:13:20.123456Z",
      },
    ],
    next_cursor: "next-page",
  })
  assert.equal(f.calls[0].req.limit, 1)
  assert.equal(f.calls[0].req.cursor, "previous")
  for (const [header, value] of Object.entries({
    "x-kokoro-service": "web-bff",
    "x-kokoro-tenant-id": "tenant-1",
    "x-kokoro-subject-id": "subject-1",
    "x-kokoro-scope-kind": "project",
    "x-kokoro-scope-id": "project-1",
    "x-kokoro-request-id": "request-1",
    "x-kokoro-internal-secret": "storage-secret",
  }))
    assert.equal(f.calls[0].ctx.requestHeader.get(header), value)
  assert.equal(f.calls[0].ctx.requestHeader.get("authorization"), null)
  const empty = await fixture({ reply: () => ({ items: [] }) })
  assert.deepEqual(await empty.client.listAssets({ limit: 50, cursor: "" }, AbortSignal.timeout(5000)), { items: [], next_cursor: null })
})

test("ListAssets rejects unsafe metadata, filtering drift, duplicate items and broken pagination", async () => {
  const patches = [
    { scanState: 3 },
    { scanState: 4 },
    { scanState: 1 },
    { uploadPurpose: 1 },
    { origin: 0 },
    { assetId: "" },
    { filename: "../bad" },
    { mimeType: "invalid" },
    { contentSha256: "not-sha" },
    { createdAt: undefined },
    { createdAt: { seconds: 0n, nanos: -1 } },
  ]
  for (const patch of patches) {
    const f = await fixture({ reply: (_req, _ctx, item) => ({ items: [{ ...item, ...patch }] }) })
    await assert.rejects(f.client.listAssets({ limit: 1, cursor: "" }, AbortSignal.timeout(5000)), (e) => e.status === 502)
  }
  for (const reply of [
    (_r, _c, item) => ({ items: [item, item] }),
    () => ({ items: [], nextCursor: "orphan" }),
    (_r, _c, item) => ({ items: [item], nextCursor: "" }),
    (_r, _c, item) => ({ items: [item], nextCursor: "x".repeat(4097) }),
  ]) {
    const f = await fixture({ reply })
    await assert.rejects(f.client.listAssets({ limit: 1, cursor: "" }, AbortSignal.timeout(5000)), (e) => e.status === 502)
  }
})

test("ListAssets maps invalid cursor to 400 and dependency faults without fake empty success", async () => {
  const { ConnectError, Code } = await import("@connectrpc/connect")
  for (const [code, status] of [
    [Code.InvalidArgument, 400],
    [Code.Unavailable, 503],
    [Code.DeadlineExceeded, 503],
    [Code.Unauthenticated, 503],
    [Code.PermissionDenied, 503],
    [Code.Internal, 502],
    [Code.Unimplemented, 502],
  ]) {
    const f = await fixture({
      reply: () => {
        throw new ConnectError("private owner details", code)
      },
    })
    await assert.rejects(
      f.client.listAssets({ limit: 50, cursor: "tampered" }, AbortSignal.timeout(5000)),
      (e) => e.status === status && !e.message.includes("private"),
    )
  }
})

test("list query rejects unknown/duplicate/oversized pagination rather than forwarding identity", async () => {
  const { projectResourceListInput } = await import("../dist/http/project-resource-list-input.js")
  assert.deepEqual(projectResourceListInput(new URLSearchParams()), { limit: 50, cursor: "" })
  assert.deepEqual(projectResourceListInput(new URLSearchParams("limit=100&cursor=opaque.token")), { limit: 100, cursor: "opaque.token" })
  for (const query of [
    "limit=0",
    "limit=101",
    "limit=1.2",
    "limit=01",
    "limit=1&limit=2",
    "cursor=",
    "cursor=a&cursor=b",
    "tenant_id=forged",
    "scope_id=forged",
    "cursor=%00",
    `cursor=${"x".repeat(4097)}`,
  ])
    assert.throws(
      () => projectResourceListInput(new URLSearchParams(query)),
      (e) => e.status === 400,
    )
})

test("GET route checks current owner before Storage and binds every page to canonical project and subject", async () => {
  const { projectResourceListRoute } = await import("../dist/http/routes/project-resource-list.js")
  const { EventEmitter } = await import("node:events")
  let calls = 0
  const scopes = []
  const store = {
    services: {
      projects: {
        async find(scope, ref) {
          scopes.push(scope)
          return scope.tenantId === "tenant-1" && scope.subjectId === "subject-1" && ref === "slug" ? { id: "project-1" } : null
        },
      },
    },
  }
  const config = { storage: storageConfig }
  const invoke = async (identity = { namespace: "tenant-1", userId: "subject-1" }, ref = "slug", query = "", factory) => {
    const req = new EventEmitter()
    req.url = `/v1/projects/${ref}/resources${query}`
    req.headers = {}
    const res = new EventEmitter()
    res.writeHead = (status, headers) => {
      res.status = status
      res.headers = headers
    }
    res.end = (data) => {
      res.body = JSON.parse(data)
      res.writableEnded = true
    }
    await projectResourceListRoute(
      req,
      res,
      config,
      { requestId: "req-list", identity },
      ref,
      store,
      factory ??
        ((_cfg, ctx) => {
          calls++
          assert.deepEqual(ctx, { ...context, requestId: "req-list" })
          return {
            async listAssets(input) {
              return { items: [], next_cursor: input.cursor ? null : "opaque" }
            },
          }
        }),
    )
    return res
  }
  let res = await invoke()
  assert.equal(res.status, 200)
  assert.equal(res.headers["cache-control"], "no-store")
  assert.equal(res.body.meta.request_id, "req-list")
  res = await invoke(undefined, "slug", "?limit=50&cursor=opaque")
  assert.equal(res.status, 200)
  assert.equal(res.body.data.next_cursor, null)
  assert.equal(calls, 2)
  for (const [identity, ref] of [
    [{ namespace: "other", userId: "subject-1" }, "slug"],
    [{ namespace: "tenant-1", userId: "other" }, "slug"],
    [undefined, "other-project"],
  ])
    assert.equal((await invoke(identity, ref)).status, 404)
  assert.equal(calls, 2, "unauthorized projects never create a Storage transport")
  assert.equal((await invoke(undefined, "slug", "?subject_id=forged")).status, 400)
  assert.equal(calls, 2)
  res = await invoke(undefined, "slug", "", () => ({
    async listAssets() {
      throw new Error("private dependency details")
    },
  }))
  assert.equal(res.status, 503)
  assert.equal(res.body.data, undefined)
  assert.ok(!JSON.stringify(res.body).includes("private"))
  assert.ok(scopes.length >= 6)
})

test("HTTP GET uses generated owner pagination and never calls Storage for another project or subject", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ConnectError, Code } = await import("@connectrpc/connect")
  const { createBffServer } = await import("../dist/bootstrap/server.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { StorageService } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  const servers = []
  let calls = 0
  let unavailable = false
  const listen = async (server) => {
    servers.push(server)
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    return `http://127.0.0.1:${server.address().port}`
  }
  try {
    const owner = await listen(
      createServer(
        connectNodeAdapter({
          routes(router) {
            router.service(StorageService, {
              listAssets(req, ctx) {
                calls++
                assert.equal(ctx.requestHeader.get("x-kokoro-scope-id"), "project-1")
                assert.equal(ctx.requestHeader.get("x-kokoro-subject-id"), "subject-1")
                assert.equal(ctx.requestHeader.get("x-kokoro-tenant-id"), "tenant-1")
                assert.equal(req.limit, 1)
                if (unavailable) throw new ConnectError("private owner failure", Code.Unavailable)
                if (req.cursor !== "" && req.cursor !== "second") throw new ConnectError("cursor scope mismatch", Code.InvalidArgument)
                return {
                  items: [
                    {
                      assetId: req.cursor ? "asset-2" : "asset-1",
                      filename: "fox.txt",
                      mimeType: "text/plain",
                      sizeBytes: 5n,
                      contentSha256: "a".repeat(64),
                      uploadPurpose: 2,
                      origin: 1,
                      scanState: 2,
                      createdAt: { seconds: 1700000000n },
                    },
                  ],
                  ...(req.cursor ? {} : { nextCursor: "second" }),
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
      KOKORO_STORAGE_OBJECT_ORIGIN: "http://objects.test",
    })
    const bff = await listen(
      createBffServer(config, {
        readiness: async () => {},
        businessStore: {
          services: {
            projects: {
              async find(scope, ref) {
                return scope.subjectId === "subject-1" && ref === "slug" ? { id: "project-1" } : null
              },
            },
          },
        },
        sessionAdmission: {
          async verify({ token }) {
            return { ok: true, identity: { namespace: "tenant-1", userId: token === "other" ? "other" : "subject-1" } }
          },
        },
      }),
    )
    const get = async (path, token = "user") => {
      const response = await fetch(`${bff}/v1/projects/${path}`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "web-secret",
          "x-request-id": "request-list",
          "x-kokoro-principal-id": "forged",
        },
      })
      return { status: response.status, headers: response.headers, body: await response.json() }
    }
    let result = await get("slug/resources?limit=1")
    assert.equal(result.status, 200)
    assert.equal(result.body.data.items[0].asset_id, "asset-1")
    assert.equal(result.body.data.next_cursor, "second")
    assert.equal(result.headers.get("x-request-id"), "request-list")
    assert.equal(result.headers.get("cache-control"), "no-store")
    assert.ok(!JSON.stringify(result.body).includes("upload_id"))
    result = await get("slug/resources?limit=1&cursor=second")
    assert.equal(result.body.data.items[0].asset_id, "asset-2")
    assert.equal(result.body.data.next_cursor, null)
    assert.equal(calls, 2)
    assert.equal((await get("other-project/resources?limit=1")).status, 404)
    assert.equal((await get("slug/resources?limit=1", "other")).status, 404)
    assert.equal(calls, 2)
    assert.equal((await get("slug/resources?limit=1&scope_id=other")).status, 400)
    assert.equal(calls, 2)
    assert.equal((await get("slug/resources?limit=1&cursor=wrong-scope")).status, 400)
    unavailable = true
    result = await get("slug/resources?limit=1")
    assert.equal(result.status, 503)
    assert.equal(result.body.data, undefined)
    assert.ok(!JSON.stringify(result.body).includes("private"))
  } finally {
    for (const server of servers.reverse()) {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

test("GET metadata uses the same owner values as the POST completed asset projection", async () => {
  const { createRouterTransport } = await import("@connectrpc/connect")
  const { StorageService } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  const { StorageUploadClient } = await import("../dist/infrastructure/clients/storage/client.js")
  const item = {
    assetId: "asset-1",
    filename: "fox.txt",
    mimeType: "text/plain",
    contentSha256: "a".repeat(64),
    sizeBytes: 5n,
    uploadPurpose: 2,
    origin: 1,
    scanState: 2,
    createdAt: { seconds: 1700000000n },
  }
  const transport = createRouterTransport((router) => router.service(StorageService, { getAsset: () => item, listAssets: () => ({ items: [item] }) }))
  const client = new StorageUploadClient(storageConfig, context, transport)
  const uploaded = await client.getAsset(
    "upload-1",
    "asset-1",
    { filename: "fox.txt", mimeType: "text/plain", bytes: new Uint8Array(5), sha256: "a".repeat(64) },
    AbortSignal.timeout(5000),
  )
  const page = await client.listAssets({ limit: 50, cursor: "" }, AbortSignal.timeout(5000))
  const { upload_id, ...metadata } = uploaded
  const { created_at, ...listed } = page.items[0]
  assert.equal(upload_id, "upload-1")
  assert.ok(created_at)
  assert.deepEqual(listed, metadata)
})
