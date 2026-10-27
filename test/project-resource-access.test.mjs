import { AssetOrigin } from "../src/generated/storage-connect/kokoro/storage/v3/storage_pb.ts"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const bytes = Buffer.from("project bytes")
const sha = createHash("sha256").update(bytes).digest("hex")
const storage = { baseUrl: "http://storage.test", secret: "fixture-secret", objectOrigin: "http://objects.test" }
const scope = { tenantId: "tenant-1", subjectId: "subject-1", projectId: "project-1", requestId: "request-1" }

// The published wire, not internal source text, is the regression oracle.
test("Project item metadata, bytes and keyed delete are explicitly governed operations", async () => {
  const { load } = await import("js-yaml")
  const doc = load(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"))
  const item = doc.paths["/v1/projects/{projectId}/resources/{asset_id}"]
  assert.ok(item, "the Project resource item must exist")
  assert.equal(item.get.operationId, "getProjectResource")
  assert.equal(item.delete.operationId, "deleteProjectResource")
  assert.equal(item.delete["x-kokoro-permission"], "project.update")
  assert.equal(item.delete["x-kokoro-idempotency"], "required")
  assert.equal(doc.paths["/v1/projects/{projectId}/resources/{asset_id}/download"].get.operationId, "downloadProjectResource")
})

async function fixture(patch = {}) {
  const { ProjectResourceAccessClient } = await import("../src/infrastructure/clients/storage/project-resource-access.ts")
  const { createRouterTransport } = await import("@connectrpc/connect")
  const { StorageService } = await import("../src/generated/storage-connect/kokoro/storage/v3/storage_pb.ts")
  const calls = []
  const asset = {
    assetId: "asset-1",
    filename: "project.txt",
    mimeType: "text/plain",
    contentSha256: sha,
    sizeBytes: BigInt(bytes.length),
    uploadPurpose: 2,
    scanState: 2,
    origin: AssetOrigin.UPLOADED,
  }
  const reference = {
    assetId: asset.assetId,
    contentSha256: sha,
    sizeBytes: asset.sizeBytes,
    mimeType: asset.mimeType,
    scanState: 2,
    downloadReference: {
      url: "http://objects.test/object?signature=fixture",
      method: "GET",
      requiredHeaders: {},
      expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) },
    },
  }
  const transport = createRouterTransport((router) =>
    router.service(StorageService, {
      getAsset(req, ctx) {
        calls.push(["get", req, ctx])
        return patch.asset ? patch.asset(req, ctx, asset) : asset
      },
      getDownloadReference(req, ctx) {
        calls.push(["reference", req, ctx])
        return patch.reference ? patch.reference(req, ctx, reference) : reference
      },
      deleteAsset(req, ctx) {
        calls.push(["delete", req, ctx])
        return patch.delete ? patch.delete(req, ctx) : { assetId: req.assetId, deletedAt: { seconds: 1700000000n, nanos: 123000000 }, replayed: false }
      },
    }),
  )
  return { client: new ProjectResourceAccessClient(storage, scope, transport), calls, asset }
}

test("Project access asserts the current trusted canonical scope, never personal scope or body identity", async () => {
  const f = await fixture()
  const item = await f.client.get("asset-1", AbortSignal.timeout(5000))
  assert.deepEqual(item, {
    asset_id: "asset-1",
    filename: "project.txt",
    mime_type: "text/plain",
    size_bytes: String(bytes.length),
    content_sha256: sha,
    scan_state: "clean",
  })
  await f.client.downloadReference(item, AbortSignal.timeout(5000))
  for (const [, req, ctx] of f.calls) {
    assert.equal(ctx.requestHeader.get("x-kokoro-scope-kind"), "project")
    assert.equal(ctx.requestHeader.get("x-kokoro-scope-id"), scope.projectId)
    assert.equal(ctx.requestHeader.get("x-kokoro-subject-id"), scope.subjectId)
    assert.equal(ctx.requestHeader.get("x-kokoro-tenant-id"), scope.tenantId)
    assert.equal(ctx.requestHeader.get("authorization"), null)
    assert.equal(Object.hasOwn(req, "tenantId"), false)
  }
  assert.equal(f.calls[1][1].contentSha256, sha)
})

test("unsafe Asset metadata and download-reference mismatch cannot produce a verified resource", async () => {
  for (const patch of [
    { assetId: "other" },
    { uploadPurpose: 3 },
    { origin: 0 },
    { origin: 99 },
    { scanState: 1 },
    { contentSha256: "bad" },
    { filename: "../bad" },
    { mimeType: "text/plain\r\nx:bad" },
    { sizeBytes: -1n },
  ]) {
    const f = await fixture({ asset: (_r, _c, asset) => ({ ...asset, ...patch }) })
    await assert.rejects(f.client.get("asset-1", AbortSignal.timeout(5000)))
    assert.equal(f.calls.length, 1)
  }
  const f = await fixture({ reference: (_r, _c, reference) => ({ ...reference, contentSha256: "b".repeat(64) }) })
  const item = await f.client.get("asset-1", AbortSignal.timeout(5000))
  await assert.rejects(f.client.downloadReference(item, AbortSignal.timeout(5000)), (e) => e.status === 502)
})

function response() {
  const res = new EventEmitter()
  res.headers = {}
  res.destroyed = false
  res.writableEnded = false
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = v
  }
  res.writeHead = (status, headers) => {
    res.statusCode = status
    Object.assign(res.headers, headers)
  }
  res.end = (body) => {
    res.body = body
    res.writableEnded = true
  }
  return res
}
function request(method, url, key) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = {}
  req.rawHeaders = []
  if (key !== undefined) {
    req.headers["idempotency-key"] = key
    req.rawHeaders.push("Idempotency-Key", key)
  }
  return req
}
const context = { requestId: "request-1", identity: { namespace: "tenant-1", userId: "subject-1" } }
const store = {
  services: {
    projects: {
      find: async (scope, ref) =>
        scope.tenantId === "tenant-1" && scope.subjectId === "subject-1" && ["slug", "project-1"].includes(ref) ? { id: "project-1" } : null,
    },
  },
}

test("metadata route freshly checks owner and canonical Project before any Storage call", async () => {
  const { projectResourceReadRoute } = await import("../src/http/routes/project-resource-read.ts")
  const calls = []
  const factory = (_cfg, s) => {
    calls.push(s)
    return { get: async () => ({ asset_id: "asset-1" }) }
  }
  for (const identity of [
    { namespace: "wrong", userId: "subject-1" },
    { namespace: "tenant-1", userId: "wrong" },
  ]) {
    const res = response()
    await projectResourceReadRoute(
      request("GET", "/v1/projects/slug/resources/asset-1"),
      res,
      { storage },
      { ...context, identity },
      "slug",
      "asset-1",
      false,
      store,
      factory,
    )
    assert.equal(res.statusCode, 404)
  }
  assert.equal(calls.length, 0)
  const res = response()
  await projectResourceReadRoute(request("GET", "/v1/projects/slug/resources/asset-1"), res, { storage }, context, "slug", "asset-1", false, store, factory)
  assert.equal(res.statusCode, 200)
  assert.equal(calls[0].projectId, "project-1")
  for (const suffix of ["?scope_id=forged", "?download=true"]) {
    const bad = response()
    await projectResourceReadRoute(
      request("GET", "/v1/projects/slug/resources/asset-1" + suffix),
      bad,
      { storage },
      context,
      "slug",
      "asset-1",
      false,
      store,
      factory,
    )
    assert.equal(bad.statusCode, 400)
  }
})

export { fixture, request, response, context, store, storage, scope, bytes, sha }

test("Public28.1 restores the complete Public28 bytes and ordered census without relaxing any parent hash", async () => {
  const { restorePublic28ProjectResourceContract, projectResourcePublic28Sha256, projectResourceParentBaseline } =
    await import("../scripts/project-resource-access-public-contract.mjs")
  const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  assert.equal(createHash("sha256").update(restorePublic28ProjectResourceContract(source)).digest("hex"), projectResourcePublic28Sha256)
  const inventory = JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
  assert.equal(inventory.length, 190)
  assert.equal(projectResourceParentBaseline(inventory).length, 187)
  for (const tamper of [
    source.replace("summary: Read one currently owned clean Project resource", "summary: changed"),
    source.replace("scan_state: { type: string, const: clean }", "scan_state: { type: string }"),
    source.replace("title: Kokoro BFF Public API", "title: tampered parent"),
  ]) {
    if (tamper !== source) assert.throws(() => restorePublic28ProjectResourceContract(tamper), /drift/)
  }
})

test("Project attachment downloads exceed the old personal 1MiB cap, remain completely verified and clean their owned spool", async () => {
  const { createServer } = await import("node:http")
  const { once } = await import("node:events")
  const { projectResourceReadRoute } = await import("../src/http/routes/project-resource-read.ts")
  const { spoolVerifiedArtifact } = await import("../src/infrastructure/clients/storage/artifact-download-transfer.ts")
  const body = Buffer.alloc(1_048_577, 0x70)
  const digest = createHash("sha256").update(body).digest("hex")
  const item = {
    asset_id: "asset-1",
    filename: "项目.txt",
    mime_type: "text/plain",
    size_bytes: String(body.length),
    content_sha256: digest,
    scan_state: "clean",
  }
  const reference = { url: "http://objects.test/project?signature=fixture", method: "GET", requiredHeaders: {}, expiresAt: Date.now() + 60_000 }
  let cleanups = 0
  let corrupted = false
  let revoked = false
  let reads = 0
  const ownStore = {
    services: {
      projects: {
        find: async () => {
          reads++
          return revoked && reads % 2 === 0 ? null : { id: "project-1" }
        },
      },
    },
  }
  const factory = () => ({ get: async () => item, downloadReference: async () => reference })
  const spooler = async (...args) => {
    const spool = await spoolVerifiedArtifact(...args, async () => new Response(corrupted ? Buffer.alloc(body.length) : body))
    return {
      ...spool,
      cleanup: async () => {
        cleanups++
        await spool.cleanup()
      },
    }
  }
  const server = createServer((request, response) => {
    void projectResourceReadRoute(request, response, { storage }, context, "slug", "asset-1", true, ownStore, factory, spooler)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const url = `http://127.0.0.1:${server.address().port}/v1/projects/slug/resources/asset-1/download`
  try {
    let result = await fetch(url)
    assert.equal(result.status, 200)
    assert.equal(result.headers.get("content-length"), String(body.length))
    assert.equal(result.headers.get("cache-control"), "no-store")
    assert.match(result.headers.get("content-disposition"), /attachment;/)
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), body)
    for (let i = 0; i < 100 && cleanups < 1; i++) await new Promise((resolve) => setImmediate(resolve))
    assert.equal(cleanups, 1)
    corrupted = true
    result = await fetch(url)
    assert.equal(result.status, 502)
    assert.equal((await result.json()).error.code, "storage_response_invalid")
    corrupted = false
    revoked = true
    reads = 0
    result = await fetch(url)
    assert.equal(result.status, 404)
    assert.equal((await result.json()).error.code, "project_not_found")
    assert.equal(cleanups, 2)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("Project ownership cancellation wins over a store response which has not settled", async () => {
  const { currentResourceProject } = await import("../src/http/project-resource-access.ts")
  const abort = new AbortController()
  let settle
  const pending = new Promise((resolve) => {
    settle = resolve
  })
  const result = currentResourceProject(
    { services: { projects: { find: () => pending } } },
    { tenantId: "tenant-1", subjectId: "subject-1" },
    "project-1",
    abort.signal,
  )
  abort.abort()
  await assert.rejects(result, (e) => e.status === 503)
  settle({ id: "project-1" })
})

test("actual BFF and Connect HTTP registration freshly admits Project item reads and exact lost-ACK delete recovery", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ConnectError, Code } = await import("@connectrpc/connect")
  const { StorageService } = await import("../src/generated/storage-connect/kokoro/storage/v3/storage_pb.ts")
  const { createBffServer } = await import("../src/bootstrap/server.ts")
  const { loadConfig } = await import("../src/config/runtime.ts")
  const servers = []
  const calls = []
  let deleted = false
  let originalCommand = null
  let admissions = 0
  const listen = async (server) => {
    servers.push(server)
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    return `http://127.0.0.1:${server.address().port}`
  }
  try {
    const objectOrigin = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-length": bytes.length })
        res.end(bytes)
      }),
    )
    const owner = await listen(
      createServer(
        connectNodeAdapter({
          routes(router) {
            router.service(StorageService, {
              getAsset(req, ctx) {
                calls.push(["get", ctx.requestHeader.get("x-kokoro-scope-id")])
                assert.equal(ctx.requestHeader.get("x-kokoro-scope-kind"), "project")
                if (deleted) throw new ConnectError("gone", Code.NotFound)
                return {
                  assetId: req.assetId,
                  filename: "project.txt",
                  mimeType: "text/plain",
                  sizeBytes: BigInt(bytes.length),
                  contentSha256: sha,
                  scanState: 2,
                  uploadPurpose: 2,
                  origin: AssetOrigin.UPLOADED,
                }
              },
              getDownloadReference(req, ctx) {
                calls.push(["reference", ctx.requestHeader.get("x-kokoro-scope-id")])
                return {
                  assetId: req.assetId,
                  contentSha256: sha,
                  sizeBytes: BigInt(bytes.length),
                  mimeType: "text/plain",
                  scanState: 2,
                  downloadReference: {
                    url: objectOrigin + "/object?sig=fixture",
                    method: "GET",
                    requiredHeaders: {},
                    expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) },
                  },
                }
              },
              deleteAsset(req, ctx) {
                calls.push(["delete", ctx.requestHeader.get("x-kokoro-scope-id")])
                if (!deleted) {
                  deleted = true
                  originalCommand = req.command
                  throw new ConnectError("owner committed but ACK lost", Code.Unavailable)
                }
                assert.deepEqual(req.command, originalCommand)
                return { assetId: req.assetId, deletedAt: { seconds: 1700000000n }, replayed: true }
              },
            })
          },
        }),
      ),
    )
    const cfg = loadConfig({
      KOKORO_TENANT_ID: "tenant-1",
      KOKORO_BFF_SHARED_SECRET: "web-secret",
      KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/app?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
      KOKORO_STORAGE_RPC_BASE_URL: owner,
      KOKORO_BFF_STORAGE_SECRET: "fixture-secret",
      KOKORO_STORAGE_OBJECT_ORIGIN: objectOrigin,
    })
    const bff = await listen(
      createBffServer(cfg, {
        readiness: async () => {},
        businessStore: store,
        sessionAdmission: {
          verify: async ({ token }) => {
            admissions++
            return { ok: true, identity: { namespace: "tenant-1", userId: token === "other" ? "other" : "subject-1" } }
          },
        },
      }),
    )
    const headers = {
      authorization: "Bearer user",
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "web-secret",
      "x-kokoro-request-id": "project-http",
      "x-kokoro-scope-id": "forged",
      "x-kokoro-subject-id": "forged",
    }
    const path = "/v1/projects/slug/resources/asset-1"
    let result = await fetch(bff + path, { headers })
    assert.equal(result.status, 200)
    assert.equal((await result.json()).data.resource.asset_id, "asset-1")
    result = await fetch(bff + path + "/download", { headers })
    assert.equal(result.status, 200)
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes)
    const before = calls.length
    result = await fetch(bff + path, { headers: { ...headers, authorization: "Bearer other" } })
    assert.equal(result.status, 404)
    assert.equal(calls.length, before)
    const remove = { method: "DELETE", headers: { ...headers, "idempotency-key": "original-key" } }
    result = await fetch(bff + path, remove)
    assert.equal(result.status, 503)
    assert.equal((await result.json()).error.code, "project_resource_delete_unknown")
    result = await fetch(bff + path, remove)
    assert.equal(result.status, 200)
    assert.equal((await result.json()).data.replayed, true)
    assert.equal(admissions, 5)
    assert.ok(calls.every(([, project]) => project === "project-1"))
    assert.deepEqual(
      calls.slice(-2).map(([op]) => op),
      ["delete", "delete"],
    )
  } finally {
    for (const server of servers.reverse()) {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

test("ordinary Project Asset origin is the same closed UPLOADED/GENERATED set as the list", async () => {
  for (const origin of [AssetOrigin.UNSPECIFIED, 99]) {
    const f = await fixture({ asset: (_request, _context, asset) => ({ ...asset, origin }) })
    await assert.rejects(f.client.get("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 502 && error.code === "storage_response_invalid")
    assert.deepEqual(
      f.calls.map(([operation]) => operation),
      ["get"],
    )
  }
  for (const origin of [AssetOrigin.UPLOADED, AssetOrigin.GENERATED]) {
    const f = await fixture({ asset: (_request, _context, asset) => ({ ...asset, origin }) })
    assert.equal((await f.client.get("asset-1", AbortSignal.timeout(5000))).asset_id, "asset-1")
  }
})
