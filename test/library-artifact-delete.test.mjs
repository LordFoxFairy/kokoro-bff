import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { test } from "node:test"

test("Library Artifact DELETE checks current ownership and recovers the exact Storage retirement without a metadata preflight", async () => {
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  const { Code, ConnectError } = await import("@connectrpc/connect")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { create, toBinary } = await import("@bufbuild/protobuf")
  const { StorageService } = await import("../dist/generated/storage-connect/kokoro/storage/v3/storage_pb.js")
  const { ErrorCode, ErrorDetailSchema } = await import("../dist/generated/storage-connect/kokoro/common/v1/common_pb.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { BFF_CONFIG, BFF_DATABASE, LIBRARY_ARTIFACT_REPOSITORY, SESSION_ADMISSION } = await import("../dist/common/tokens.js")
  const { AccountModule } = await import("../dist/modules/account/account.module.js")
  const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
  let app
  let owner
  const calls = []
  let receipt
  let admissions = 0
  const retiredAt = { seconds: 1700000000n, nanos: 123000000 }
  const source = (artifactId) => ({
    conversationId: "conversation-1",
    artifactId,
    runId: "source-run-1",
    sourceAssetId: "asset-" + artifactId,
    sourceArtifactKind: "document",
    sourceContentSha256: "a".repeat(64),
    deliveredAt: "2023-11-14T22:13:20Z",
    projectRef: null,
  })
  function ownerError(ctx, status, code, retryable = false) {
    const id = ctx.requestHeader.get("x-kokoro-request-id")
    return new ConnectError(
      "private",
      status,
      {
        "x-request-id": id,
        "x-kokoro-error-code": ErrorCode[code],
        "x-kokoro-retryable": String(retryable),
      },
      [{ type: ErrorDetailSchema.typeName, value: toBinary(ErrorDetailSchema, create(ErrorDetailSchema, { code, requestId: id, retryable })) }],
    )
  }
  try {
    owner = createServer(
      connectNodeAdapter({
        routes(router) {
          router.service(StorageService, {
            getFinalArtifact() {
              assert.fail("delete/recovery must not require FINAL metadata before the owner command")
            },
            deleteFinalArtifact(req, ctx) {
              assert.equal(ctx.requestHeader.get("x-kokoro-service"), "web-bff")
              assert.equal(ctx.requestHeader.get("x-kokoro-scope-kind"), "conversation")
              assert.equal(ctx.requestHeader.get("x-kokoro-scope-id"), "conversation-1")
              assert.equal(ctx.requestHeader.get("x-kokoro-subject-id"), "subject-1")
              assert.equal(ctx.requestHeader.get("cookie"), null)
              assert.equal(ctx.requestHeader.get("authorization"), null)
              assert.equal(req.sourceRunId, "source-run-1")
              assert.equal(req.assetId, "asset-" + req.artifactId)
              assert.equal(req.contentSha256, "a".repeat(64))
              assert.ok(req.command)
              calls.push({ artifactId: req.artifactId, ...req.command })
              if (!receipt) {
                receipt = req.command
                // Storage commits but the upstream transport loses the first result.
                throw new ConnectError("private transport", Code.Unavailable)
              }
              if (req.command.commandId !== receipt.commandId) throw ownerError(ctx, Code.NotFound, ErrorCode.NOT_FOUND)
              if (req.command.requestDigest !== receipt.requestDigest) throw ownerError(ctx, Code.AlreadyExists, ErrorCode.COMMAND_DIGEST_MISMATCH)
              return { artifactId: req.artifactId, retiredAt, replayed: true }
            },
          })
        },
      }),
    )
    owner.listen(0, "127.0.0.1")
    await once(owner, "listening")
    const config = loadConfig({
      KOKORO_TENANT_ID: "tenant-1",
      KOKORO_IAM_WEB_ORIGIN: "https://web.example.test",
      KOKORO_BFF_SHARED_SECRET: "web-secret",
      KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/app?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
      KOKORO_STORAGE_RPC_BASE_URL: `http://127.0.0.1:${owner.address().port}`,
      KOKORO_BFF_STORAGE_SECRET: "storage-secret",
      KOKORO_STORAGE_OBJECT_ORIGIN: "http://objects.test",
    })
    const module = await Test.createTestingModule({ imports: [AccountModule] })
      .overrideProvider(BFF_CONFIG)
      .useValue(config)
      .overrideProvider(BFF_DATABASE)
      .useValue({ pool: {}, ready: () => undefined })
      .overrideProvider(SESSION_ADMISSION)
      .useValue({
        async verify({ cookie }) {
          admissions++
          return { ok: true, identity: { namespace: "tenant-1", userId: cookie.endsWith("other") ? "subject-2" : "subject-1" } }
        },
      })
      .overrideProvider(LIBRARY_ARTIFACT_REPOSITORY)
      .useValue({
        async findCandidate(tenant, subject, conversationId, artifactId) {
          return tenant === "tenant-1" && subject === "subject-1" && conversationId === "conversation-1" ? source(artifactId) : null
        },
      })
      .compile()
    app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
    await app.listen(0, "127.0.0.1")
    const base = await app.getUrl()
    const remove = async (artifactId, key, { token = "mine", body } = {}) => {
      const response = await fetch(`${base}/v1/library/artifacts/conversation-1/${artifactId}`, {
        method: "DELETE",
        ...(body === undefined ? {} : { body }),
        headers: {
          cookie: `kokoro-issuer.session_token=${token}`,
          origin: "https://web.example.test",
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "web-secret",
          "x-kokoro-request-id": "artifact-delete-http",
          "idempotency-key": key,
        },
      })
      return [response.status, await response.json()]
    }
    assert.deepEqual((await remove("one", "first-key"))[0], 503)
    const [status, ack] = await remove("one", "first-key")
    assert.equal(status, 200)
    assert.deepEqual(ack, { data: { conversation_id: "conversation-1", artifact_id: "one", deleted_at: "2023-11-14T22:13:20.123Z", replayed: true } })
    assert.deepEqual(calls[0], calls[1])
    assert.equal((await remove("two", "first-key"))[1].error.code, "idempotency_conflict")
    assert.equal((await remove("one", "another-key"))[1].error.code, "library_artifact_not_found")
    assert.equal((await remove("one", "first-key", { token: "other" }))[0], 404)
    assert.equal((await remove("one", "first-key", { body: "x" }))[0], 400)
    assert.equal(admissions, 5)
    assert.equal(calls.length, 4)
  } finally {
    await app?.close()
    if (owner?.listening) await new Promise((resolve) => owner.close(resolve))
  }
})
