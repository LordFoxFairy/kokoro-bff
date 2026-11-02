import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import { createRouterTransport, ConnectError, Code } from "@connectrpc/connect"
import { create, toBinary } from "@bufbuild/protobuf"
import { ProjectResourceAccessClient } from "../src/infrastructure/clients/storage/project-resource-access.ts"
import { StorageService } from "../src/generated/storage-connect/kokoro/storage/v3/storage_pb.ts"
import { ErrorDetailSchema, ErrorCode } from "../src/generated/storage-connect/kokoro/common/v1/common_pb.ts"
import { projectResourceDeleteRoute } from "../src/http/routes/project-resource-delete.ts"
const storage = { baseUrl: "http://storage.test", secret: "fixture-secret", objectOrigin: "http://objects.test" }
const context = { tenantId: "tenant-1", subjectId: "subject-1", projectId: "project-1", requestId: "request-1" }
const committed = { assetId: "asset-1", deletedAt: { seconds: 1700000000n, nanos: 123000000 }, replayed: false }
function client(handler, overrides = {}) {
  const calls = []
  const transport = createRouterTransport((router) =>
    router.service(StorageService, {
      deleteAsset(req, ctx) {
        calls.push({ req, ctx })
        return handler(req, ctx, calls.length)
      },
      getAsset() {
        assert.fail("deleted receipt recovery must never require visible GetAsset")
      },
    }),
  )
  return { client: new ProjectResourceAccessClient(storage, { ...context, ...overrides }, transport), calls }
}
function ownerError(connectCode, errorCode, retryable = false) {
  return new ConnectError(
    "owner private diagnostic",
    connectCode,
    { "x-request-id": "request-1", "x-kokoro-error-code": ErrorCode[errorCode], "x-kokoro-retryable": String(retryable) },
    [
      {
        type: ErrorDetailSchema.typeName,
        value: toBinary(ErrorDetailSchema, create(ErrorDetailSchema, { code: errorCode, requestId: "request-1", retryable })),
      },
    ],
  )
}

test("lost delete ACK recovers the exact owner command after client recreation, without GetAsset", async () => {
  const seen = []
  let first = true
  const make = () =>
    client((req) => {
      seen.push(req)
      if (first) {
        first = false
        throw new ConnectError("ACK lost", Code.Unavailable)
      }
      return { ...committed, replayed: true }
    })
  await assert.rejects(
    make().client.delete("asset-1", "original-key", AbortSignal.timeout(5000)),
    (e) => e.code === "project_resource_delete_unknown" && e.status === 503,
  )
  const next = make()
  assert.deepEqual(await next.client.delete("asset-1", "original-key", AbortSignal.timeout(5000)), {
    asset_id: "asset-1",
    deleted_at: "2023-11-14T22:13:20.123Z",
    replayed: true,
  })
  assert.deepEqual(seen[0], seen[1])
  assert.equal(next.calls[0].ctx.requestHeader.get("x-kokoro-scope-kind"), "project")
  assert.equal(next.calls[0].ctx.requestHeader.get("x-kokoro-scope-id"), "project-1")
  const fresh = client((req) => ({ ...committed, assetId: req.assetId }))
  await fresh.client.delete("asset-1", "another-key", AbortSignal.timeout(5000))
  assert.notEqual(fresh.calls[0].req.command.commandId, seen[0].command.commandId)
})

test("owner deletion namespaces include canonical Project and actor; acknowledgements are exact and closed", async () => {
  const keys = []
  for (const overrides of [{}, { projectId: "project-2" }, { subjectId: "subject-2" }, { tenantId: "tenant-2" }]) {
    const f = client(() => committed, overrides)
    await f.client.delete("asset-1", "same-key", AbortSignal.timeout(5000))
    keys.push(f.calls[0].req.command.commandId)
  }
  assert.equal(new Set(keys).size, 4)
  for (const patch of [{ assetId: "other" }, { deletedAt: undefined }, { deletedAt: { seconds: 0n, nanos: -1 } }]) {
    const f = client(() => ({ ...committed, ...patch }))
    await assert.rejects(f.client.delete("asset-1", "same-key", AbortSignal.timeout(5000)), (e) => e.status === 502 && e.retryable)
  }
})

test("only a complete trusted owner rejection is terminal; bare 409/in-progress/transport stay unknown", async () => {
  for (const error of [
    new ConnectError("bare conflict", Code.AlreadyExists),
    ownerError(Code.Aborted, ErrorCode.CONFLICT, true),
    new ConnectError("deadline", Code.DeadlineExceeded),
    new Error("network"),
  ]) {
    const f = client(() => {
      throw error
    })
    await assert.rejects(f.client.delete("asset-1", "key", AbortSignal.timeout(5000)), (e) => e.status === 503 && e.code === "project_resource_delete_unknown")
  }
  for (const [error, status] of [
    [ownerError(Code.NotFound, ErrorCode.NOT_FOUND), 404],
    [ownerError(Code.AlreadyExists, ErrorCode.COMMAND_DIGEST_MISMATCH), 409],
  ]) {
    const f = client(() => {
      throw error
    })
    await assert.rejects(f.client.delete("asset-1", "key", AbortSignal.timeout(5000)), (e) => e.status === status && !e.message.includes("private"))
  }
})
function req(key = "original-key", suffix = "") {
  const r = new EventEmitter()
  r.method = "DELETE"
  r.url = "/v1/projects/slug/resources/asset-1" + suffix
  r.headers = { "idempotency-key": key }
  r.rawHeaders = ["Idempotency-Key", key]
  return r
}
function res() {
  const r = new EventEmitter()
  r.headers = {}
  r.destroyed = false
  r.writableEnded = false
  r.setHeader = (k, v) => {
    r.headers[k] = v
  }
  r.writeHead = (s, h) => {
    r.statusCode = s
    Object.assign(r.headers, h)
  }
  r.end = (b) => {
    r.body = b
    r.writableEnded = true
  }
  return r
}
const auth = { requestId: "request-1", identity: { namespace: "tenant-1", userId: "subject-1" } }

test("DELETE rechecks current ownership before every replay and never substitutes scope release", async () => {
  let owned = true
  const calls = []
  const store = {
    services: {
      projects: {
        find: async (scope, id) => (owned && scope.tenantId === "tenant-1" && scope.subjectId === "subject-1" && id === "slug" ? { id: "project-1" } : null),
      },
    },
  }
  const factory = (_cfg, scope) => ({
    delete: async (id, key) => {
      calls.push({ scope, id, key })
      return { asset_id: id, deleted_at: "2023-11-14T22:13:20.123Z", replayed: true }
    },
  })
  const first = res()
  await projectResourceDeleteRoute(req(), first, { storage }, auth, "slug", "asset-1", store, factory)
  assert.equal(first.statusCode, 200)
  assert.equal(calls[0].scope.projectId, "project-1")
  owned = false
  const revoked = res()
  await projectResourceDeleteRoute(req(), revoked, { storage }, auth, "slug", "asset-1", store, factory)
  assert.equal(revoked.statusCode, 404)
  assert.equal(calls.length, 1)
  for (const r of [
    req("key", "?scope_id=other"),
    Object.assign(req(), { headers: { "content-length": "1" }, rawHeaders: ["Idempotency-Key", "original-key", "Content-Length", "1"] }),
    Object.assign(req(), { rawHeaders: ["Idempotency-Key", "a", "Idempotency-Key", "b"] }),
  ]) {
    const rejected = res()
    await projectResourceDeleteRoute(r, rejected, { storage }, auth, "slug", "asset-1", store, factory)
    assert.equal(rejected.statusCode, 400)
  }
  assert.equal(calls.length, 1)
})

test("canceled old Project deletion cannot publish a late acknowledgement", async () => {
  let release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  const request = req()
  const response = res()
  const store = { services: { projects: { find: async () => ({ id: "project-1" }) } } }
  const factory = () => ({ delete: async () => pending })
  const operation = projectResourceDeleteRoute(request, response, { storage }, auth, "slug", "asset-1", store, factory)
  await new Promise((resolve) => setImmediate(resolve))
  response.destroyed = true
  response.emit("close")
  release({ asset_id: "asset-1", deleted_at: "2023-11-14T22:13:20.123Z", replayed: false })
  await operation
  assert.equal(response.statusCode, undefined)
})
