import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"

const identity = { namespace: "tenant-1", userId: "subject-1" }
const storage = { baseUrl: "http://storage.test", secret: "storage-secret", objectOrigin: "http://objects.test" }

test("Library requires explicit file or artifact kind and bounded single-valued page query", async () => {
  const { libraryFileListInput } = await import("../dist/http/library-file-list-input.js")
  assert.deepEqual(libraryFileListInput(new URLSearchParams("kind=file")), { kind: "file", limit: 50, cursor: "" })
  assert.deepEqual(libraryFileListInput(new URLSearchParams("kind=artifact&limit=100&cursor=opaque.token")), {
    kind: "artifact",
    limit: 100,
    cursor: "opaque.token",
  })
  for (const query of [
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
  const { StorageService } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
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
  assert.deepEqual(await client.listAssets({ limit: 1, cursor: "previous" }, AbortSignal.timeout(5000)), {
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
  await assert.rejects(client.listAssets({ limit: 1, cursor: "" }, AbortSignal.timeout(5000)), (error) => error.status === 502)
  reply = () => ({ items: [{ ...item, uploadPurpose: 1 }] })
  await assert.rejects(client.listAssets({ limit: 1, cursor: "" }, AbortSignal.timeout(5000)), (error) => error.status === 502)
  const { ConnectError, Code } = await import("@connectrpc/connect")
  reply = () => {
    throw new ConnectError("private cursor", Code.InvalidArgument)
  }
  await assert.rejects(
    client.listAssets({ limit: 1, cursor: "foreign" }, AbortSignal.timeout(5000)),
    (error) => error.status === 400 && error.code === "invalid_library_page",
  )
  reply = () => {
    throw new ConnectError("private details", Code.Unavailable)
  }
  await assert.rejects(
    client.listAssets({ limit: 1, cursor: "" }, AbortSignal.timeout(5000)),
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

test("live Product HTTP re-admits each page and calls personal Storage Connect without trusting forged identity", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ConnectError, Code } = await import("@connectrpc/connect")
  const { createBffServer } = await import("../dist/bootstrap/server.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { StorageService } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  const servers = []
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
        businessStore: null,
        sessionAdmission: {
          async verify({ token }) {
            admissions++
            return { ok: true, identity: { namespace: "tenant-1", userId: token === "other" ? "subject-2" : "subject-1" } }
          },
        },
      }),
    )
    const get = async (query, token = "user") => {
      const response = await fetch(`${bff}/v1/library${query}`, {
        headers: {
          authorization: `Bearer ${token}`,
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
    assert.equal(admissions, 3)
    assert.deepEqual(calls, [
      { subject: "subject-1", scope: "subject-1", kind: "personal", tenant: "tenant-1", cursor: "" },
      { subject: "subject-1", scope: "subject-1", kind: "personal", tenant: "tenant-1", cursor: "page-2" },
      { subject: "subject-2", scope: "subject-2", kind: "personal", tenant: "tenant-1", cursor: "page-2" },
    ])
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  }
})

test("Artifact owner consumer checks trusted conversation scope and immutable receipt against FINAL CLEAN item", async () => {
  const { FinalArtifactClient } = await import("../dist/infrastructure/clients/storage/final-artifact.js")
  const { createRouterTransport, ConnectError, Code } = await import("@connectrpc/connect")
  const { StorageService, ArtifactKind } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
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
      { kind: "artifact", limit: 1, cursor },
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
  const { createBffServer } = await import("../dist/bootstrap/server.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { StorageService, ArtifactKind } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  const bytes = Buffer.from("hello")
  const digest = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex")
  const servers = []
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
        return subject === "subject-1" && conversationId === "conversation-1" && artifactId === "artifact-1" ? association : null
      },
    }
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
        businessStore: { artifactLibrary: repository, ready: async () => {}, close: async () => {} },
        sessionAdmission: {
          async verify({ token }) {
            admissions++
            return {
              ok: true,
              identity: { namespace: token === "outside" ? "tenant-other" : "tenant-1", userId: token === "other" ? "subject-other" : "subject-1" },
            }
          },
        },
      }),
    )
    const get = (path, token = "user") =>
      fetch(`${bff}${path}`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "web-secret",
          "x-kokoro-request-id": "artifact-http",
          "x-kokoro-subject-id": "forged",
          "x-kokoro-scope-id": "forged",
        },
      })
    const page = await get("/v1/library?kind=artifact")
    assert.equal(page.status, 200)
    assert.equal((await page.json()).data.items[0].artifact_id, "artifact-1")
    const item = await get("/v1/library/artifacts/conversation-1/artifact-1")
    assert.equal(item.status, 200)
    assert.equal((await item.json()).data.source_run_id, "run-1")
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
    assert.equal(admissions, 6)
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  }
})
