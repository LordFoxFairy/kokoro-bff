import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"

const identity = { namespace: "tenant-1", userId: "subject-1" }
const storage = { baseUrl: "http://storage.test", secret: "storage-secret", objectOrigin: "http://objects.test" }

test("Library requires explicit file or artifact kind and bounded single-valued page query", async () => {
  const { libraryFileListInput } = await import("../dist/http/library-file-list-input.js")
  assert.deepEqual(libraryFileListInput(new URLSearchParams("kind=file")), { kind: "file", limit: 50, cursor: "", query: "", type: "all" })
  assert.deepEqual(libraryFileListInput(new URLSearchParams("kind=artifact&limit=100&cursor=opaque.token")), {
    kind: "artifact",
    limit: 100,
    cursor: "opaque.token",
    query: "",
    type: "all",
  })
  assert.deepEqual(libraryFileListInput(new URLSearchParams("kind=artifact&q=%20Re%CC%81SUME%CC%81%20&type=documents")), {
    kind: "artifact",
    limit: 50,
    cursor: "",
    query: "résumé",
    type: "documents",
  })
  assert.equal(libraryFileListInput(new URLSearchParams({ kind: "artifact", q: "😀".repeat(200) })).query.length, 400)
  assert.equal(libraryFileListInput(new URLSearchParams({ kind: "artifact", q: "İ".repeat(200) })).query, "i\u0307".repeat(200))
  const { libraryArtifactType } = await import("../dist/application/library-artifact-filter.js")
  for (const [mime, title, type] of [
    ["application/vnd.presentation", "x", "slides"],
    ["text/csv", "x", "spreadsheets"],
    ["IMAGE/PNG", "x", "images"],
    ["audio/mpeg", "x", "audio"],
    ["video/mp4", "x", "video"],
    ["application/pdf", "x", "documents"],
    ["application/zip", "x", "other"],
  ])
    assert.equal(libraryArtifactType(mime, title), type)
  for (const query of [
    "kind=file&q=x&q=y",
    "kind=file&q=%00",
    "kind=file&type=video",
    "kind=artifact&type=media",
    "kind=artifact&q=x&q=y",
    "kind=artifact&type=all&type=all",
    "kind=artifact&type=unknown",
    "kind=artifact&q=%00",
    `kind=artifact&q=${"😀".repeat(201)}`,
    "",
    "kind=",
    "kind=all",
    "kind=file&kind=file",
    "kind=file&limit=0",
    "kind=file&limit=101",
    "kind=file&limit=01",
    "kind=file&limit=1&limit=2",
    "kind=file&cursor=",
    "kind=file&cursor=%00",
    "kind=file&tenant_id=evil",
    `kind=file&cursor=${"x".repeat(4097)}`,
  ]) {
    assert.throws(
      () => libraryFileListInput(new URLSearchParams(query)),
      (error) => error.status === 400,
      query,
    )
  }
})

test("personal Connect list sends only admitted identity and validates CLEAN ASSET page", async () => {
  const { PersonalFileListClient } = await import("../dist/infrastructure/clients/storage/personal-file-list.js")
  const { createRouterTransport } = await import("@connectrpc/connect")
  const { StorageService } = await import("../dist/generated/storage-connect/kokoro/storage/v3/storage_pb.js")
  const calls = []
  const item = {
    assetId: "asset-1",
    filename: "fox.txt",
    mimeType: "text/plain",
    contentSha256: "a".repeat(64),
    sizeBytes: 5n,
    uploadPurpose: 2,
    origin: 1,
    scanState: 2,
    createdAt: { seconds: 1700000000n, nanos: 0 },
  }
  let reply = () => ({ items: [item], nextCursor: "more" })
  const transport = createRouterTransport((router) =>
    router.service(StorageService, {
      listAssets(req, ctx) {
        calls.push({ req, ctx })
        return reply(req)
      },
    }),
  )
  const client = new PersonalFileListClient(storage, { tenantId: "tenant-1", subjectId: "subject-1", requestId: "request-1" }, transport)
  assert.deepEqual(await client.listAssets({ limit: 1, cursor: "previous", query: "", type: "all" }, AbortSignal.timeout(5000)), {
    items: [
      {
        kind: "file",
        asset_id: "asset-1",
        filename: "fox.txt",
        mime_type: "text/plain",
        content_sha256: "a".repeat(64),
        size_bytes: "5",
        scan_state: "clean",
        created_at: "2023-11-14T22:13:20Z",
      },
    ],
    next_cursor: "more",
  })
  assert.equal(calls[0].req.limit, 1)
  assert.equal(calls[0].req.cursor, "previous")
  for (const [key, value] of Object.entries({
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "storage-secret",
    "x-kokoro-tenant-id": "tenant-1",
    "x-kokoro-subject-id": "subject-1",
    "x-kokoro-request-id": "request-1",
    "x-kokoro-scope-kind": "personal",
    "x-kokoro-scope-id": "subject-1",
  }))
    assert.equal(calls[0].ctx.requestHeader.get(key), value)
  assert.equal(calls[0].ctx.requestHeader.get("authorization"), null)
  reply = () => ({ items: [{ ...item, scanState: 3 }] })
  await assert.rejects(client.listAssets({ limit: 1, cursor: "", query: "", type: "all" }, AbortSignal.timeout(5000)), (error) => error.status === 502)
  reply = () => ({ items: [{ ...item, uploadPurpose: 1 }] })
  await assert.rejects(client.listAssets({ limit: 1, cursor: "", query: "", type: "all" }, AbortSignal.timeout(5000)), (error) => error.status === 502)
  const { ConnectError, Code } = await import("@connectrpc/connect")
  reply = () => {
    throw new ConnectError("private cursor", Code.InvalidArgument)
  }
  await assert.rejects(
    client.listAssets({ limit: 1, cursor: "foreign", query: "", type: "all" }, AbortSignal.timeout(5000)),
    (error) => error.status === 400 && error.code === "invalid_library_page",
  )
  reply = () => {
    throw new ConnectError("private details", Code.Unavailable)
  }
  await assert.rejects(
    client.listAssets({ limit: 1, cursor: "", query: "", type: "all" }, AbortSignal.timeout(5000)),
    (error) => error.status === 503 && !error.message.includes("private"),
  )
})

test("Library route builds personal scope anew, has response header, and never turns faults into empty success", async () => {
  const { libraryFileListRoute } = await import("../dist/http/routes/library-file-list.js")
  const scopes = []
  const invoke = async (
    query,
    userId = "subject-1",
    factory = (_config, scope) => {
      scopes.push(scope)
      return {
        async listAssets(input) {
          return { items: [], next_cursor: input.cursor ? null : "next" }
        },
      }
    },
  ) => {
    const request = new EventEmitter()
    request.url = `/v1/library${query}`
    request.headers = {}
    const response = new EventEmitter()
    response.setHeader = (key, value) => {
      response.headers ??= {}
      response.headers[key.toLowerCase()] = value
    }
    response.writeHead = (status, headers) => {
      response.status = status
      response.headers = { ...response.headers, ...headers }
    }
    response.end = (body) => {
      response.body = JSON.parse(body)
      response.writableEnded = true
    }
    await libraryFileListRoute(request, response, { storage }, { requestId: "req-1", identity: { ...identity, userId } }, factory)
    return response
  }
  const first = await invoke("?kind=file")
  assert.equal(first.status, 200)
  assert.equal(first.headers["x-request-id"], "req-1")
  assert.deepEqual(first.body.data, { items: [], next_cursor: "next" })
  const second = await invoke("?kind=file&cursor=next", "subject-2")
  assert.equal(second.status, 200)
  assert.deepEqual(scopes, [
    { tenantId: "tenant-1", subjectId: "subject-1", requestId: "req-1" },
    { tenantId: "tenant-1", subjectId: "subject-2", requestId: "req-1" },
  ])
  const missing = await invoke("")
  assert.equal(missing.status, 400)
  assert.equal(missing.body.error.code, "invalid_library_kind")
  const fault = await invoke("?kind=file", "subject-1", () => ({
    async listAssets() {
      throw new Error("private owner details")
    },
  }))
  assert.equal(fault.status, 503)
  assert.equal(fault.body.error.code, "storage_unavailable")
  assert.ok(!JSON.stringify(fault.body).includes("private owner details"))
})

async function startLibraryTestApp(config, sessionAdmission, repository) {
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  const { BFF_CONFIG, BFF_DATABASE, LIBRARY_ARTIFACT_REPOSITORY, SESSION_ADMISSION } = await import("../dist/common/tokens.js")
  const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
  const { AccountModule } = await import("../dist/modules/account/account.module.js")
  const unexpected = () => assert.fail("Library HTTP fixture must not use an unconfigured database")
  const builder = Test.createTestingModule({ imports: [AccountModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(SESSION_ADMISSION)
    .useValue(sessionAdmission)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpected, connect: unexpected }, ready: unexpected })
  if (repository !== undefined) builder.overrideProvider(LIBRARY_ARTIFACT_REPOSITORY).useValue(repository)
  const ref = await builder.compile()
  const app = ref.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  try {
    await app.listen(0, "127.0.0.1")
    return { base: await app.getUrl(), close: () => app.close() }
  } catch (error) {
    await app.close()
    throw error
  }
}

test("personal file DELETE uses native admission and the original Storage command after an uncertain result", async () => {
  const { createServer } = await import("node:http")
  const { create, toBinary } = await import("@bufbuild/protobuf")
  const { Code, ConnectError } = await import("@connectrpc/connect")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { ErrorCode, ErrorDetailSchema } = await import("../dist/generated/storage-connect/kokoro/common/v1/common_pb.js")
  const { StorageService } = await import("../dist/generated/storage-connect/kokoro/storage/v3/storage_pb.js")
  const { once } = await import("node:events")
  const calls = []
  const committed = { assetId: "asset:one", deletedAt: { seconds: 1700000000n, nanos: 123000000 }, replayed: true }
  let app
  let admissions = 0
  function error(ctx, status, code, retryable = false, extra = {}) {
    const id = ctx.requestHeader.get("x-kokoro-request-id")
    return new ConnectError("private owner diagnostic", status, {
      "x-request-id": id, "x-kokoro-error-code": ErrorCode[code], "x-kokoro-retryable": String(retryable), ...extra,
    }, [{ type: ErrorDetailSchema.typeName, value: toBinary(ErrorDetailSchema, create(ErrorDetailSchema, { code, requestId: id, retryable })) }])
  }
  const owner = createServer(connectNodeAdapter({
    routes(router) {
      router.service(StorageService, {
        getAsset() { assert.fail("delete/recovery must not read GetAsset first") },
        deleteAsset(req, ctx) {
          const get = (key) => ctx.requestHeader.get(key)
          assert.equal(get("x-kokoro-service"), "web-bff")
          assert.equal(get("x-kokoro-internal-secret"), "storage-secret")
          assert.equal(get("x-kokoro-tenant-id"), "tenant-1")
          assert.equal(get("x-kokoro-scope-kind"), "personal")
          assert.equal(get("x-kokoro-scope-id"), get("x-kokoro-subject-id"))
          assert.equal(get("cookie"), null)
          assert.equal(get("authorization"), null)
          assert.ok(req.command)
          calls.push({ command: req.command, subject: get("x-kokoro-subject-id"), asset: req.assetId })
          if (get("x-kokoro-subject-id") === "other") throw error(ctx, Code.NotFound, ErrorCode.NOT_FOUND)
          if (req.assetId === "asset:bad-ack") return { ...committed, assetId: "wrong-asset" }
          if (req.assetId === "asset:limited") throw error(ctx, Code.ResourceExhausted, ErrorCode.RATE_LIMITED, true, { "retry-after": "17" })
          if (req.assetId === "asset:bad-rate") throw error(ctx, Code.ResourceExhausted, ErrorCode.RATE_LIMITED)
          if (req.assetId === "asset:inconsistent") throw error(ctx, Code.NotFound, ErrorCode.CONFLICT)
          if (req.assetId === "asset:in-progress") throw error(ctx, Code.Aborted, ErrorCode.CONFLICT, true)
          if (req.assetId === "asset:conflict") throw error(ctx, Code.AlreadyExists, ErrorCode.CONFLICT)
          if (req.assetId === "asset:precondition") throw error(ctx, Code.FailedPrecondition, ErrorCode.PRECONDITION_FAILED)
          if (calls.length === 1) throw new ConnectError("committed; lost ACK", Code.Unavailable)
          if (req.command.commandId !== calls[0].command.commandId) throw error(ctx, Code.NotFound, ErrorCode.NOT_FOUND)
          if (req.command.requestDigest !== calls[0].command.requestDigest) throw error(ctx, Code.AlreadyExists, ErrorCode.COMMAND_DIGEST_MISMATCH)
          return committed
        },
      })
    },
  }))
  try {
    owner.listen(0, "127.0.0.1")
    await once(owner, "listening")
    app = await startLibraryTestApp(loadConfig({
      KOKORO_TENANT_ID: "tenant-1",
      KOKORO_IAM_WEB_ORIGIN: "https://web.example.test",
      KOKORO_BFF_SHARED_SECRET: "web-secret",
      KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/app?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
      KOKORO_STORAGE_RPC_BASE_URL: `http://127.0.0.1:${owner.address().port}`,
      KOKORO_BFF_STORAGE_SECRET: "storage-secret",
      KOKORO_STORAGE_OBJECT_ORIGIN: "http://objects.test",
    }), { async verify({ cookie }) {
      admissions++
      const token = cookie.split("=")[1]
      if (token === "revoked") return { ok: false, status: 401, code: "session_invalid" }
      return { ok: true, identity: { namespace: token === "outside" ? "tenant-other" : "tenant-1", userId: token === "other" ? "other" : "subject-1" } }
    } })
    const drop = (path = "asset%3Aone", key = "original-key", token = "user", options = {}) =>
      fetch(`${app.base}/v1/library/files/${path}`, { method: "DELETE", headers: {
        cookie: `kokoro-issuer.session_token=${token}`, origin: "https://web.example.test",
        "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "web-secret",
        "x-kokoro-request-id": "delete-request",
        "x-kokoro-subject-id": "forged", "x-kokoro-scope-id": "forged",
        "idempotency-key": key, ...options.headers,
      }, ...(options.body === undefined ? {} : { body: options.body }) })
    const expectError = async (response, status, code, retryable = false) => {
      assert.equal(response.status, status)
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.equal(response.headers.get("x-request-id"), "delete-request")
      const body = await response.json()
      assert.deepEqual(Object.keys(body), ["error"])
      assert.deepEqual(Object.keys(body.error).sort(), ["code", "message", "retryable"])
      assert.equal(body.error.code, code)
      assert.equal(body.error.retryable, retryable)
      assert.ok(!body.error.message.includes("diagnostic"))
    }

    await expectError(await drop(), 503, "storage_unavailable", true)
    await expectError(await drop("asset%3Aone", "original-key", "revoked"), 401, "session_invalid")
    assert.equal(calls.length, 1)
    const replay = await drop()
    assert.equal(replay.status, 200)
    assert.equal(replay.headers.get("cache-control"), "no-store")
    assert.equal(replay.headers.get("x-request-id"), "delete-request")
    assert.deepEqual(await replay.json(), { data: { asset_id: "asset:one", deleted_at: "2023-11-14T22:13:20.123Z", replayed: true } })
    assert.deepEqual(calls[1], calls[0])
    assert.equal(calls[0].subject, "subject-1")
    assert.equal(admissions, 3)
    await expectError(await drop("asset%3Atwo"), 409, "idempotency_conflict")
    assert.equal(calls[2].command.commandId, calls[0].command.commandId)
    assert.notEqual(calls[2].command.requestDigest, calls[0].command.requestDigest)
    await expectError(await drop("asset%3Aone", "new-key"), 404, "file_not_found")
    assert.notEqual(calls[3].command.commandId, calls[0].command.commandId)
    await expectError(await drop("asset%3Aone", "original-key", "other"), 404, "file_not_found")
    assert.equal(calls[4].subject, "other")
    assert.notEqual(calls[4].command.commandId, calls[0].command.commandId)
    await expectError(await drop("asset%3Abad-ack"), 502, "storage_response_invalid")
    await expectError(await drop("asset%3Ainconsistent"), 502, "storage_response_invalid")
    const limited = await drop("asset%3Alimited")
    assert.equal(limited.headers.get("retry-after"), "17")
    await expectError(limited, 429, "storage_rate_limited", true)
    await expectError(await drop("asset%3Abad-rate"), 502, "storage_response_invalid")
    await expectError(await drop("asset%3Ain-progress"), 409, "file_delete_conflict", true)
    await expectError(await drop("asset%3Aconflict"), 409, "file_delete_conflict")
    await expectError(await drop("asset%3Aprecondition"), 409, "file_delete_precondition_failed")
    const beforeRejected = calls.length
    await expectError(await drop("asset%3Aone", "original-key", "outside"), 403, "product_tenant_forbidden")
    await expectError(await drop("asset%3Aone?scope_id=other"), 400, "invalid_file_delete_request")
    await expectError(await drop("asset%3Aone", "a,b"), 400, "invalid_idempotency_key")
    await expectError(await drop("asset%3Aone", "original-key", "user", { body: "untrusted" }), 400, "invalid_file_delete_request")
    await expectError(await drop("asset%3Aone", "original-key", "user", { headers: { "if-match": '"old"' } }), 400, "invalid_file_delete_request")
    assert.equal(calls.length, beforeRejected)
  } finally {
    await app?.close()
    owner.closeAllConnections()
    await new Promise((resolve) => owner.close(resolve))
  }
})

test("live Product HTTP re-admits each page and calls personal Storage Connect without trusting forged identity", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ConnectError, Code } = await import("@connectrpc/connect")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { StorageService } = await import("../dist/generated/storage-connect/kokoro/storage/v3/storage_pb.js")
  const servers = []
  let app
  const calls = []
  let admissions = 0
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
                const subject = ctx.requestHeader.get("x-kokoro-subject-id")
                const scope = ctx.requestHeader.get("x-kokoro-scope-id")
                calls.push({
                  subject,
                  scope,
                  kind: ctx.requestHeader.get("x-kokoro-scope-kind"),
                  tenant: ctx.requestHeader.get("x-kokoro-tenant-id"),
                  cursor: req.cursor,
                  query: req.query,
                  fileType: req.fileType,
                })
                if (subject !== scope || ctx.requestHeader.get("x-kokoro-scope-kind") !== "personal") throw new ConnectError("forbidden", Code.PermissionDenied)
                if (req.cursor && subject !== "subject-1") throw new ConnectError("cross-subject cursor", Code.InvalidArgument)
                return {
                  items: [
                    {
                      assetId: req.cursor ? "asset-2" : "asset-1",
                      filename: "fox.txt",
                      mimeType: "text/plain",
                      contentSha256: "a".repeat(64),
                      sizeBytes: 5n,
                      uploadPurpose: 2,
                      origin: 1,
                      scanState: 2,
                      createdAt: { seconds: 1700000000n },
                    },
                  ],
                  ...(req.cursor ? {} : { nextCursor: "page-2" }),
                }
              },
            })
          },
        }),
      ),
    )
    const config = loadConfig({
      KOKORO_TENANT_ID: "tenant-1",
      KOKORO_IAM_WEB_ORIGIN: "https://web.example.test",
      KOKORO_BFF_SHARED_SECRET: "web-secret",
      KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/app?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
      KOKORO_STORAGE_RPC_BASE_URL: owner,
      KOKORO_BFF_STORAGE_SECRET: "storage-secret",
      KOKORO_STORAGE_OBJECT_ORIGIN: "http://objects.test",
    })
    app = await startLibraryTestApp(config, {
      async verify({ cookie }) {
        const token = cookie.slice("kokoro-issuer.session_token=".length)
        admissions++
        return { ok: true, identity: { namespace: "tenant-1", userId: token === "other" ? "subject-2" : "subject-1" } }
      },
    })
    const bff = app.base
    const get = async (query, token = "user") => {
      const response = await fetch(`${bff}/v1/library${query}`, {
        headers: {
          cookie: `kokoro-issuer.session_token=${token}`,
          origin: "https://web.example.test",
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "web-secret",
          "x-kokoro-request-id": "library-http",
          "x-kokoro-subject-id": "forged",
          "x-kokoro-scope-id": "forged",
        },
      })
      return { status: response.status, requestId: response.headers.get("x-request-id"), body: await response.json() }
    }
    const first = await get("?kind=file")
    assert.equal(first.status, 200, JSON.stringify(first))
    assert.equal(first.body.data.items[0].kind, "file")
    assert.equal(first.body.data.next_cursor, "page-2")
    assert.equal((await get("?kind=file&cursor=page-2")).status, 200)
    const crossed = await get("?kind=file&cursor=page-2", "other")
    assert.equal(crossed.status, 400)
    assert.equal(crossed.body.error.code, "invalid_library_page")
    assert.equal(crossed.requestId, "library-http")
    const filtered = await get("?kind=file&limit=1&q=%20Re%CC%81SUME%CC%81%25_%20&type=documents")
    assert.equal(filtered.status, 200, JSON.stringify(filtered))
    assert.equal(filtered.body.data.next_cursor, "page-2")
    assert.equal((await get("?kind=file&q=fox&type=video")).status, 400)
    assert.equal(admissions, 5)
    assert.deepEqual(calls, [
      { subject: "subject-1", scope: "subject-1", kind: "personal", tenant: "tenant-1", cursor: "", query: "", fileType: 0 },
      { subject: "subject-1", scope: "subject-1", kind: "personal", tenant: "tenant-1", cursor: "page-2", query: "", fileType: 0 },
      { subject: "subject-2", scope: "subject-2", kind: "personal", tenant: "tenant-1", cursor: "page-2", query: "", fileType: 0 },
      { subject: "subject-1", scope: "subject-1", kind: "personal", tenant: "tenant-1", cursor: "", query: " Re\u0301SUME\u0301%_ ", fileType: 1 },
    ])
  } finally {
    try {
      await app?.close()
    } finally {
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
    }
  }
})

test("Artifact owner consumer checks trusted conversation scope and immutable receipt against FINAL CLEAN item", async () => {
  const { FinalArtifactClient } = await import("../dist/infrastructure/clients/storage/final-artifact.js")
  const { createRouterTransport, ConnectError, Code } = await import("@connectrpc/connect")
  const { StorageService, ArtifactKind } = await import("../dist/generated/storage-connect/kokoro/storage/v3/storage_pb.js")
  const association = {
    conversationId: "conversation-1",
    artifactId: "artifact-1",
    runId: "run-1",
    sourceAssetId: "asset-1",
    sourceArtifactKind: "document",
    sourceContentSha256: "a".repeat(64),
    deliveredAt: "2023-11-14T22:13:20.000Z",
  }
  const calls = []
  let item = {
    artifactId: "artifact-1",
    assetId: "asset-1",
    contentSha256: "a".repeat(64),
    kind: ArtifactKind.DOCUMENT,
    title: "Report",
    sourceRunId: "run-1",
    filename: "report.txt",
    mimeType: "text/plain",
    sizeBytes: 5n,
    createdAt: { seconds: 1700000000n },
    finalizedAt: { seconds: 1700000001n },
  }
  let fault = null
  let reference = {
    artifactId: "artifact-1",
    assetId: "asset-1",
    contentSha256: "a".repeat(64),
    downloadReference: {
      url: "http://objects.test/original?sig=secret",
      method: "GET",
      requiredHeaders: {},
      expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) },
    },
  }
  const transport = createRouterTransport((router) =>
    router.service(StorageService, {
      getFinalArtifact(req, ctx) {
        calls.push([req, ctx])
        if (fault) throw fault
        return { item }
      },
      getFinalArtifactDownloadReference(req, ctx) {
        calls.push([req, ctx])
        return reference
      },
    }),
  )
  const client = new FinalArtifactClient(
    storage,
    { tenantId: "tenant-1", subjectId: "subject-1", conversationId: "conversation-1", requestId: "req-1" },
    transport,
  )
  const result = await client.get(association, AbortSignal.timeout(5000))
  assert.deepEqual(result, {
    kind: "artifact",
    conversation_id: "conversation-1",
    artifact_id: "artifact-1",
    asset_id: "asset-1",
    artifact_kind: "document",
    title: "Report",
    filename: "report.txt",
    mime_type: "text/plain",
    size_bytes: "5",
    content_sha256: "a".repeat(64),
    source_run_id: "run-1",
    delivered_at: "2023-11-14T22:13:20.000Z",
  })
  assert.equal(calls[0][0].artifactId, "artifact-1")
  const signed = await client.downloadReference(result, AbortSignal.timeout(5000))
  assert.equal(signed.method, "GET")
  assert.equal(calls[1][0].artifactId, "artifact-1")
  assert.ok(calls[1][0].command?.commandId)
  assert.ok(calls[1][0].command?.requestDigest)
  for (const [key, value] of Object.entries({
    "x-kokoro-service": "web-bff",
    "x-kokoro-tenant-id": "tenant-1",
    "x-kokoro-subject-id": "subject-1",
    "x-kokoro-scope-kind": "conversation",
    "x-kokoro-scope-id": "conversation-1",
    "x-kokoro-request-id": "req-1",
  }))
    assert.equal(calls[0][1].requestHeader.get(key), value)
  reference = { ...reference, assetId: "asset-other" }
  await assert.rejects(client.downloadReference(result, AbortSignal.timeout(5000)), (error) => error.status === 502)
  for (const changed of [
    { assetId: "asset-other" },
    { contentSha256: "b".repeat(64) },
    { kind: ArtifactKind.UNSPECIFIED },
    { kind: 99 },
    { sourceRunId: "run-other" },
    { sizeBytes: 1_073_741_825n },
    { title: "" },
  ]) {
    item = { ...item, ...changed }
    await assert.rejects(client.get(association, AbortSignal.timeout(5000)), (error) => error.status === 502)
    item = {
      ...item,
      ...result,
      artifactId: "artifact-1",
      assetId: "asset-1",
      contentSha256: "a".repeat(64),
      kind: ArtifactKind.DOCUMENT,
      title: "Report",
      sourceRunId: "run-1",
      filename: "report.txt",
      mimeType: "text/plain",
      sizeBytes: 5n,
    }
  }
  item = undefined
  await assert.rejects(client.get(association, AbortSignal.timeout(5000)), (error) => error.status === 502)
  fault = new ConnectError("private artifact", Code.NotFound)
  await assert.rejects(client.get(association, AbortSignal.timeout(5000)), (error) => error.status === 404 && !error.message.includes("private"))
  fault = new ConnectError("secret owner failure", Code.Unavailable)
  await assert.rejects(client.get(association, AbortSignal.timeout(5000)), (error) => error.status === 503 && !error.message.includes("secret"))
  fault = new ConnectError("service policy drift", Code.PermissionDenied)
  await assert.rejects(client.get(association, AbortSignal.timeout(5000)), (error) => error.status === 503 && !error.message.includes("policy"))
})

test("Artifact Library scans only bounded authorized candidates and binds keyset to current identity", async () => {
  const { libraryArtifactListRoute } = await import("../dist/http/routes/library-artifact-list.js")
  const { ProjectResourceError } = await import("../dist/application/project-resource.error.js")
  const seen = []
  const associations = ["conversation-a", "conversation-b", "conversation-c"].map((conversationId, index) => ({
    conversationId,
    artifactId: `artifact-${index}`,
    runId: `run-${index}`,
    sourceAssetId: `asset-${index}`,
    sourceArtifactKind: "document",
    sourceContentSha256: "a".repeat(64),
    deliveredAt: `2023-11-14T22:13:2${2 - index}.000Z`,
  }))
  const repository = {
    async listCandidates(tenant, subject, position, limit) {
      seen.push({ tenant, subject, position, limit })
      return associations.filter((item) => !position || item.deliveredAt < position.deliveredAt)
    },
  }
  const invoke = async (cursor = "", subjectId = "subject-1", repo = repository) => {
    const request = new EventEmitter()
    request.headers = {}
    const response = new EventEmitter()
    response.setHeader = (key, value) => {
      response.headers ??= {}
      response.headers[key.toLowerCase()] = value
    }
    response.writeHead = (status, headers) => {
      response.status = status
      response.headers = { ...response.headers, ...headers }
    }
    response.end = (body) => {
      response.body = JSON.parse(body)
      response.writableEnded = true
    }
    await libraryArtifactListRoute(
      request,
      response,
      { storage },
      { requestId: "req-1", identity: { namespace: "tenant-1", userId: subjectId } },
      { kind: "artifact", limit: 1, cursor, query: "", type: "all" },
      repo,
      (_storage, scope) => ({
        async get(item) {
          assert.equal(scope.conversationId, item.conversationId)
          if (item.artifactId === "artifact-0") throw new ProjectResourceError("library_artifact_not_found", 404)
          return { kind: "artifact", artifact_id: item.artifactId }
        },
      }),
    )
    return response
  }
  const first = await invoke()
  assert.equal(first.status, 200)
  assert.deepEqual(
    first.body.data.items.map((item) => item.artifact_id),
    ["artifact-1"],
  )
  assert.ok(first.body.data.next_cursor)
  assert.equal(seen[0].limit, 6)
  const second = await invoke(first.body.data.next_cursor)
  assert.equal(second.status, 200)
  assert.deepEqual(
    second.body.data.items.map((item) => item.artifact_id),
    ["artifact-2"],
  )
  assert.equal(second.body.data.next_cursor, null)
  assert.equal(seen[1].position.artifactId, "artifact-1")
  const crossed = await invoke(first.body.data.next_cursor, "other-subject")
  assert.equal(crossed.status, 400)
  assert.equal(crossed.body.error.code, "invalid_library_page")
  const missing = await invoke("", "subject-1", null)
  assert.equal(missing.status, 503)
})

test("private Artifact Product HTTP list, item and download keep original bytes behind current admission", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { StorageService, ArtifactKind } = await import("../dist/generated/storage-connect/kokoro/storage/v3/storage_pb.js")
  const bytes = Buffer.from("hello")
  const digest = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex")
  const servers = []
  let app
  const listen = async (server) => {
    servers.push(server)
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    return `http://127.0.0.1:${server.address().port}`
  }
  const association = {
    conversationId: "conversation-1",
    artifactId: "artifact-1",
    runId: "run-1",
    sourceAssetId: "asset-1",
    sourceArtifactKind: "document",
    sourceContentSha256: digest,
    deliveredAt: "2023-11-14T22:13:20.000Z",
  }
  let objectBytes = bytes
  let ownerCalls = 0
  let repoCalls = 0
  let admissions = 0
  const projectId = "project_00000000-0000-0000-0000-000000000001"
  let projectRef = projectId
  try {
    const objectOrigin = await listen(
      createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/octet-stream", "content-length": objectBytes.length })
        response.end(objectBytes)
      }),
    )
    const owner = await listen(
      createServer(
        connectNodeAdapter({
          routes(router) {
            router.service(StorageService, {
              getFinalArtifact(req, ctx) {
                ownerCalls++
                assert.equal(ctx.requestHeader.get("x-kokoro-scope-kind"), "conversation")
                assert.equal(ctx.requestHeader.get("x-kokoro-scope-id"), "conversation-1")
                assert.equal(ctx.requestHeader.get("x-kokoro-subject-id"), "subject-1")
                assert.equal(req.artifactId, "artifact-1")
                return {
                  item: {
                    artifactId: "artifact-1",
                    assetId: "asset-1",
                    contentSha256: digest,
                    kind: ArtifactKind.DOCUMENT,
                    title: "Report",
                    sourceRunId: "run-1",
                    filename: "report.txt",
                    mimeType: "text/plain",
                    sizeBytes: 5n,
                    createdAt: { seconds: 1700000000n },
                    finalizedAt: { seconds: 1700000001n },
                  },
                }
              },
              getFinalArtifactDownloadReference(req, ctx) {
                ownerCalls++
                assert.equal(ctx.requestHeader.get("x-kokoro-scope-id"), "conversation-1")
                assert.equal(req.artifactId, "artifact-1")
                return {
                  artifactId: "artifact-1",
                  assetId: "asset-1",
                  contentSha256: digest,
                  downloadReference: {
                    url: `${objectOrigin}/original?sig=private`,
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
    const repository = {
      async listCandidates(_tenant, subject) {
        repoCalls++
        return subject === "subject-1" ? [association] : []
      },
      async findCandidate(_tenant, subject, conversationId, artifactId) {
        repoCalls++
        return subject === "subject-1" && conversationId === "conversation-1" && artifactId === "artifact-1" ? { ...association, projectRef } : null
      },
    }
    const config = loadConfig({
      KOKORO_TENANT_ID: "tenant-1",
      KOKORO_IAM_WEB_ORIGIN: "https://web.example.test",
      KOKORO_BFF_SHARED_SECRET: "web-secret",
      KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/app?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
      KOKORO_STORAGE_RPC_BASE_URL: owner,
      KOKORO_BFF_STORAGE_SECRET: "storage-secret",
      KOKORO_STORAGE_OBJECT_ORIGIN: objectOrigin,
    })
    app = await startLibraryTestApp(
      config,
      {
        async verify({ cookie }) {
          const token = cookie.slice("kokoro-issuer.session_token=".length)
          admissions++
          return {
            ok: true,
            identity: { namespace: token === "outside" ? "tenant-other" : "tenant-1", userId: token === "other" ? "subject-other" : "subject-1" },
          }
        },
      },
      repository,
    )
    const bff = app.base
    const get = (path, token = "user") =>
      fetch(`${bff}${path}`, {
        headers: {
          cookie: `kokoro-issuer.session_token=${token}`,
          origin: "https://web.example.test",
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "web-secret",
          "x-kokoro-request-id": "artifact-http",
          "x-kokoro-subject-id": "forged",
          "x-kokoro-scope-id": "forged",
        },
      })
    const page = await get("/v1/library?kind=artifact")
    assert.equal(page.status, 200)
    const listed = (await page.json()).data.items[0]
    assert.equal(listed.artifact_id, "artifact-1")
    assert.equal(Object.hasOwn(listed, "project_ref"), false)
    const filtered = await get("/v1/library?kind=artifact&q=REPORT.TXT&type=documents")
    assert.equal(filtered.status, 200)
    assert.equal((await filtered.json()).data.items[0].artifact_id, "artifact-1")
    const excluded = await get("/v1/library?kind=artifact&q=report&type=images")
    assert.equal(excluded.status, 200)
    assert.deepEqual((await excluded.json()).data, { items: [], next_cursor: null })
    const detailPath = "/v1/library/artifacts/conversation-1/artifact-1"
    for (const target of [projectId, null, undefined]) {
      projectRef = target
      const item = await get(detailPath)
      assert.equal(item.status, 200)
      assert.deepEqual((await item.json()).data, target === undefined ? listed : { ...listed, project_ref: target })
    }
    const download = await get("/v1/library/artifacts/conversation-1/artifact-1/content")
    assert.equal(download.status, 200)
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes)
    assert.equal(download.headers.get("content-disposition"), "attachment; filename=\"report.txt\"; filename*=UTF-8''report.txt")
    assert.equal(download.headers.get("cache-control"), "no-store")
    assert.equal(download.headers.get("x-content-type-options"), "nosniff")
    objectBytes = Buffer.from("wrong")
    const tampered = await get("/v1/library/artifacts/conversation-1/artifact-1/content")
    assert.equal(tampered.status, 502)
    assert.equal((await tampered.json()).error.code, "storage_response_invalid")
    const beforePrivate = ownerCalls
    const invisible = await get("/v1/library/artifacts/conversation-1/artifact-1/content", "other")
    assert.equal(invisible.status, 404)
    assert.equal((await invisible.json()).error.code, "library_artifact_not_found")
    assert.equal(ownerCalls, beforePrivate)
    const beforeCrossTenant = repoCalls
    const crossed = await get("/v1/library/artifacts/conversation-1/artifact-1", "outside")
    assert.equal(crossed.status, 403)
    assert.equal((await crossed.json()).error.code, "product_tenant_forbidden")
    assert.equal(repoCalls, beforeCrossTenant)
    assert.equal(admissions, 10)
  } finally {
    try {
      await app?.close()
    } finally {
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
    }
  }
})

test("Artifact filters use current FINAL metadata across bounded candidate windows and bind every normalized query", async () => {
  const { libraryArtifactListRoute } = await import("../dist/http/routes/library-artifact-list.js")
  const { ProjectResourceError } = await import("../dist/application/project-resource.error.js")
  const associations = Array.from({ length: 7 }, (_, i) => ({
    conversationId: "c",
    artifactId: `a${i}`,
    runId: "r",
    sourceAssetId: `s${i}`,
    sourceArtifactKind: "document",
    sourceContentSha256: "a".repeat(64),
    deliveredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 20 - i)).toISOString(),
  }))
  const calls = [],
    positions = []
  let ownerFailure = false,
    cancelAfterOwner = false
  const repo = {
    async listCandidates(tenant, subject, position, limit) {
      positions.push({ tenant, subject, position, limit })
      return associations.filter((a) => !position || a.deliveredAt < position.deliveredAt).slice(0, limit)
    },
  }
  const invoke = async (cursor = "", query = "résumé", type = "documents", userId = "subject-1", limit = 1, namespace = "tenant-1") => {
    const req = new EventEmitter()
    req.headers = {}
    const res = new EventEmitter()
    res.setHeader = () => {}
    res.writeHead = (status) => {
      res.status = status
    }
    res.end = (bytes) => {
      res.body = JSON.parse(bytes)
      res.writableEnded = true
    }
    await libraryArtifactListRoute(
      req,
      res,
      { storage },
      { requestId: "filter", identity: { namespace, userId } },
      { kind: "artifact", limit, cursor, query, type },
      repo,
      () => ({
        async get(a) {
          calls.push(a.artifactId)
          if (cancelAfterOwner) req.emit("aborted")
          if (ownerFailure) throw new ProjectResourceError("storage_unavailable", 503, true)
          return {
            kind: "artifact",
            artifact_id: a.artifactId,
            title: "Current owner title",
            filename: a.artifactId === "a5" ? "RÉSUMÉ.txt" : "other.txt",
            mime_type: "TEXT/PLAIN",
          }
        },
      }),
    )
    return res
  }
  const first = await invoke()
  assert.equal(first.status, 200)
  assert.deepEqual(first.body.data.items, [])
  assert.ok(first.body.data.next_cursor)
  assert.equal(calls.length, 5)
  assert.equal(positions[0].limit, 6)
  const cursor = first.body.data.next_cursor
  const beforeInvalid = calls.length
  for (const input of [
    ["other", "documents", "subject-1"],
    ["résumé", "images", "subject-1"],
    ["résumé", "documents", "other-user"],
    ["résumé", "documents", "subject-1", 2],
    ["résumé", "documents", "subject-1", 1, "other-tenant"],
  ]) {
    const r = await invoke(cursor, ...input)
    assert.equal(r.status, 400)
    assert.equal(r.body.error.code, "invalid_library_page")
  }
  const retired = await invoke(cursor.replace("art2_", "art1_"))
  assert.equal(retired.status, 400)
  assert.equal(calls.length, beforeInvalid)
  assert.equal(positions.length, 1)
  const second = await invoke(cursor)
  assert.equal(second.status, 200)
  assert.deepEqual(
    second.body.data.items.map((i) => i.artifact_id),
    ["a5"],
  )
  assert.ok(second.body.data.next_cursor)
  const last = await invoke(second.body.data.next_cursor)
  assert.deepEqual(last.body.data, { items: [], next_cursor: null })
  assert.equal(positions[1].position.artifactId, "a4")
  ownerFailure = true
  const failed = await invoke()
  assert.equal(failed.status, 503)
  assert.equal(failed.body.data, undefined)
  ownerFailure = false
  cancelAfterOwner = true
  const cancelled = await invoke("", "", "all")
  assert.equal(cancelled.status, 503)
  assert.equal(cancelled.body.data, undefined)
})
