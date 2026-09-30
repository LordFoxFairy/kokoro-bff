import assert from "node:assert/strict"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { request as httpRequest } from "node:http"
import test from "node:test"
import { Code, ConnectError } from "@connectrpc/connect"

import { createLiveTestBffServer } from "./doubles/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"

const config = {
  host: "127.0.0.1",
  port: 0,
  mode: "live",
  domain: "dev.kokoro.localhost",
  tenantId: "tenant",
  iamBaseUrl: null,
  sharedSecret: "secret",
  upstreamSecret: null,
  upstreamTimeoutMs: 100,
  upstreamMaxResponseBytes: 1048576,
  schedulerServiceToken: null,
  schedulerTargetUrl: null,
  agentEnabled: false,
  postgresUrl: null,
  redisUrl: null,
  agUi: DEFAULT_AGUI_CONFIG,
  upstreams: {},
  skillDraft: { enabled: false, platformBaseUrl: null, credentialFile: null, timeoutMs: 100 },
}
const headers = {
  authorization: "Bearer session",
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "secret",
  "idempotency-key": "publish-1",
}
const result = () => ({
  sourceRef: { value: "skill:skill-1" },
  revision: 1n,
  status: 2,
  eventId: "123e4567-e89b-42d3-a456-426614174000",
  replayed: false,
})
async function withServer(client, run, admission = { verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "user" } }) }) {
  const server = createLiveTestBffServer(config, { sessionAdmission: admission, skillDraftClient: client })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}
const post = (base, body, other = {}, path = "/v1/skills/skill-1/publish") =>
  fetch(base + path, { method: "POST", headers: { ...headers, ...other }, ...(body === undefined ? {} : { body }) })

test("Publish default-off candidate stays out of Platform and has strict envelope", async () => {
  await withServer(null, async (base) => {
    const response = await post(base)
    assert.equal(response.status, 503)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.ok(response.headers.get("x-request-id"))
    assert.deepEqual(Object.keys(await response.json()), ["error"])
  })
})

test("Publish accepts exactly zero bytes and projects active owner result", async () => {
  const calls = []
  await withServer(
    {
      publish: async (command) => {
        calls.push(command)
        return result()
      },
    },
    async (base) => {
      const response = await post(base)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.ok(response.headers.get("x-request-id"))
      assert.deepEqual(await response.json(), {
        data: { source_ref: "skill:skill-1", revision: "1", status: "active", event_id: result().eventId, replayed: false },
      })
    },
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].tenant, "tenant")
  assert.equal(calls[0].user, "user")
  assert.equal(calls[0].skillId, "skill-1")
  assert.match(calls[0].digest, /^[a-f0-9]{64}$/u)
})

test("Publish projector matches all eight owner v4 command vectors", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../contract/vendor/kokoro-platform/6519ae9a7dba63586474d2860f6725d3165b701e/execution-operations-v5/manifest.json", import.meta.url),
      "utf8",
    ),
  )
  assert.equal(manifest.baseArtifact.aggregateSha256, "902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79")
})
test("Publish generated Connect descriptor has fixed visibility and active result", async () => {
  const { create, toBinary, fromBinary } = await import("@bufbuild/protobuf")
  const { PublishSkillRequestSchema, PublishSkillResponseSchema, SkillCatalogService, SkillScopeKind, SkillStatus } =
    await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  assert.equal(SkillCatalogService.method.publishSkill.name, "PublishSkill")
  assert.equal(SkillScopeKind.PERSONAL, 1)
  assert.equal(SkillStatus.ACTIVE, 2)
  assert.deepEqual(
    PublishSkillRequestSchema.fields.map((field) => [field.name, field.number]),
    [
      ["request_id", 1],
      ["command", 2],
      ["skill_id", 3],
      ["visibility", 4],
      ["product_context", 5],
    ],
  )
  assert.deepEqual(
    PublishSkillResponseSchema.fields.map((field) => [field.name, field.number]),
    [
      ["source_ref", 1],
      ["revision", 2],
      ["status", 3],
      ["event_id", 4],
      ["replayed", 5],
    ],
  )
  const message = create(PublishSkillRequestSchema, {
    requestId: "request-1",
    command: { commandId: "command-1", requestDigest: "a".repeat(64) },
    skillId: { value: "skill-1" },
    visibility: SkillScopeKind.PERSONAL,
    productContext: { subjectId: "user", ownerScope: { kind: "user", id: "user" } },
  })
  assert.deepEqual(fromBinary(PublishSkillRequestSchema, toBinary(PublishSkillRequestSchema, message)), message)
})

test("real generated Publish Connect client sends fixed PERSONAL and catalog credential, not user Bearer", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { CatalogConnectClient } = await import("../dist/infrastructure/clients/platform/catalog-connect.js")
  const { SkillCatalogService, SkillScopeKind } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  let calls = 0
  const owner = createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(SkillCatalogService, {
          publishSkill(request, context) {
            calls++
            assert.equal(context.requestHeader.get("authorization"), "Bearer catalog-machine")
            assert.equal(context.requestHeader.get("x-tenant-ref"), "tenant")
            assert.equal(request.requestId, "request-1")
            assert.equal(request.command?.commandId, "command-1")
            assert.equal(request.command?.requestDigest, "a".repeat(64))
            assert.equal(request.skillId?.value, "skill-1")
            assert.equal(request.visibility, SkillScopeKind.PERSONAL)
            assert.equal(request.productContext?.subjectId, "user")
            assert.equal(request.productContext?.ownerScope?.kind, "user")
            assert.equal(request.productContext?.ownerScope?.id, "user")
            return result()
          },
        })
      },
    }),
  )
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  try {
    const client = new CatalogConnectClient(`http://127.0.0.1:${owner.address().port}`, { get: async () => "catalog-machine" }, 1000)
    const response = await client.publish({
      requestId: "request-1",
      commandId: "command-1",
      digest: "a".repeat(64),
      tenant: "tenant",
      user: "user",
      skillId: "skill-1",
    })
    assert.equal(response.sourceRef?.value, "skill:skill-1")
    assert.equal(calls, 1)
  } finally {
    await new Promise((resolve) => owner.close(resolve))
  }
})

test("Publish refuses every nonzero body, oversized body, invalid path and key before owner", async () => {
  let calls = 0
  await withServer(
    {
      publish: async () => {
        calls++
        return result()
      },
    },
    async (base) => {
      for (const body of ["{}", "null", " ", "\n", "visibility=1", JSON.stringify({ tenant: "other" })]) {
        const response = await post(base, body)
        assert.equal(response.status, 400, body)
        assert.equal((await response.json()).error.code, "invalid_skill_request")
      }
      const oversized = await post(base, "x".repeat(70_000))
      assert.equal(oversized.status, 413)
      assert.equal((await oversized.json()).error.code, "request_body_too_large")
      for (const path of ["/v1/skills/skill-1/publish?x=1", "/v1/skills/bad%20id/publish", "/v1/skills/%73kill-1/publish"]) {
        const response = await post(base, undefined, {}, path)
        assert.equal(response.status, 400, path)
      }
      for (const key of ["", "a,b", "x".repeat(129)]) {
        const response = await post(base, undefined, { "idempotency-key": key })
        assert.equal(response.status, 400)
      }
    },
  )
  assert.equal(calls, 0)
})

test("Publish rejects duplicate Idempotency-Key and bounds request ID", async () => {
  let calls = 0
  await withServer(
    {
      publish: async () => {
        calls++
        return result()
      },
    },
    async (base) => {
      const duplicate = await new Promise((resolve, reject) => {
        const req = httpRequest(
          `${base}/v1/skills/skill-1/publish`,
          { method: "POST", headers: { ...headers, "idempotency-key": ["publish-1", "publish-2"] } },
          (res) => {
            const chunks = []
            res.on("data", (chunk) => chunks.push(chunk))
            res.once("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }))
          },
        )
        req.once("error", reject)
        req.end()
      })
      assert.equal(duplicate.status, 400)
      assert.equal(duplicate.body.error.code, "invalid_idempotency_key")
      const longId = await post(base, undefined, { "x-request-id": "r".repeat(129) })
      assert.equal(longId.status, 200)
      assert.ok(longId.headers.get("x-request-id")?.length <= 128)
      assert.notEqual(longId.headers.get("x-request-id"), "r".repeat(129))
    },
  )
  assert.equal(calls, 1)
})

test("Publish re-admits every replay and refuses revoked or foreign tenant before owner", async () => {
  let calls = 0
  let admits = 0
  await withServer(
    { publish: async () => ({ ...result(), replayed: calls++ > 0 }) },
    async (base) => {
      const first = await post(base)
      assert.equal(first.status, 200)
      const replay = await post(base)
      assert.equal(replay.status, 200)
      assert.equal((await replay.json()).data.replayed, true)
      const revoked = await post(base)
      assert.equal(revoked.status, 401)
      assert.equal((await revoked.json()).error.code, "session_invalid")
      assert.equal(revoked.headers.get("cache-control"), "no-store")
    },
    {
      verify: async () =>
        ++admits <= 2 ? { ok: true, identity: { namespace: "tenant", userId: "user" } } : { ok: false, status: 401, code: "session_invalid" },
    },
  )
  assert.equal(calls, 2)
  assert.equal(admits, 3)
  calls = 0
  await withServer(
    {
      publish: async () => {
        calls++
        return result()
      },
    },
    async (base) => {
      const foreign = await post(base)
      assert.equal(foreign.status, 403)
      assert.equal((await foreign.json()).error.code, "product_tenant_forbidden")
    },
    { verify: async () => ({ ok: true, identity: { namespace: "foreign", userId: "user" } }) },
  )
  assert.equal(calls, 0)
})

test("Publish command identity binds operation, trusted tenant/user, skill/key; same-key ACK recovery is stable", async () => {
  const calls = []
  await withServer(
    {
      publish: async (command) => {
        calls.push(command)
        return { ...result(), replayed: calls.length > 1 }
      },
    },
    async (base) => {
      assert.equal((await post(base)).status, 200)
      assert.equal((await post(base)).status, 200)
      assert.equal((await post(base, undefined, { "idempotency-key": "publish-2" })).status, 200)
    },
  )
  assert.equal(calls[0].commandId, calls[1].commandId)
  assert.equal(calls[0].digest, calls[1].digest)
  assert.notEqual(calls[0].commandId, calls[2].commandId)
  assert.equal(calls[0].digest, calls[2].digest)
  await withServer(
    {
      publish: async (command) => {
        calls.push(command)
        return result()
      },
    },
    async (base) => {
      assert.equal((await post(base)).status, 200)
    },
    { verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "other" } }) },
  )
  assert.notEqual(calls[0].commandId, calls[3].commandId)
  assert.notEqual(calls[0].digest, calls[3].digest)
  const recovered = []
  let admits = 0
  await withServer(
    {
      publish: async (command) => {
        recovered.push(command)
        if (recovered.length === 1) throw new ConnectError("private lost ACK", Code.DeadlineExceeded)
        return { ...result(), replayed: true }
      },
    },
    async (base) => {
      assert.equal((await post(base)).status, 503)
      const reply = await post(base)
      assert.equal(reply.status, 200)
      assert.equal((await reply.json()).data.event_id, result().eventId)
    },
    {
      verify: async () => {
        admits++
        return { ok: true, identity: { namespace: "tenant", userId: "user" } }
      },
    },
  )
  assert.equal(admits, 2)
  assert.equal(recovered[0].commandId, recovered[1].commandId)
  assert.equal(recovered[0].digest, recovered[1].digest)
})

test("Publish owner receipt preserves same event for same-key replay and rejects distinct-key active publish", async () => {
  const seen = new Map()
  await withServer(
    {
      publish: async (command) => {
        const previous = seen.get(command.commandId)
        if (previous !== undefined && previous !== command.digest) throw new ConnectError("private key conflict", Code.AlreadyExists)
        if (previous === undefined && seen.size > 0) throw new ConnectError("private already active", Code.FailedPrecondition)
        seen.set(command.commandId, command.digest)
        return { ...result(), replayed: previous !== undefined }
      },
    },
    async (base) => {
      const first = await post(base)
      assert.equal(first.status, 200)
      const firstEvent = (await first.json()).data.event_id
      const replay = await post(base)
      assert.equal(replay.status, 200)
      assert.deepEqual(await replay.json(), { data: { source_ref: "skill:skill-1", revision: "1", status: "active", event_id: firstEvent, replayed: true } })
      const different = await post(base, undefined, { "idempotency-key": "publish-2" })
      assert.equal(different.status, 412)
      assert.equal((await different.json()).error.code, "skill_precondition_failed")
    },
  )
})

test("Publish maps stable owner codes and only publish_snapshot_conflict Aborted to 412", async () => {
  for (const [code, reason, status, publicCode] of [
    [Code.AlreadyExists, null, 409, "skill_idempotency_conflict"],
    [Code.Aborted, null, 409, "skill_command_in_progress"],
    [Code.Aborted, "publish_snapshot_conflict", 412, "skill_precondition_failed"],
    [Code.Aborted, "other", 409, "skill_command_in_progress"],
    [Code.FailedPrecondition, null, 412, "skill_precondition_failed"],
    [Code.NotFound, null, 404, "skill_not_found"],
    [Code.PermissionDenied, null, 404, "skill_not_found"],
    [Code.DeadlineExceeded, null, 503, "skill_dependency_unavailable"],
  ])
    await withServer(
      {
        publish: async () => {
          const error = new ConnectError("private stale / infected / busy", code)
          if (reason !== null) error.metadata.set("x-kokoro-error-code", reason)
          throw error
        },
      },
      async (base) => {
        const response = await post(base)
        assert.equal(response.status, status, String(reason))
        const body = await response.json()
        assert.equal(body.error.code, publicCode)
        assert.equal(JSON.stringify(body).includes("private"), false)
      },
    )
})

test("Publish rejects malformed owner response instead of partial success", async () => {
  for (const invalid of [
    { sourceRef: { value: "skill:other" } },
    { sourceRef: undefined },
    { sourceRef: { value: 1 } },
    { revision: 0n },
    { revision: -1n },
    { revision: "1" },
    { revision: 18_446_744_073_709_551_616n },
    { status: 1 },
    { status: "ACTIVE" },
    { eventId: "" },
    { eventId: "not-a-uuid" },
    { replayed: "true" },
  ])
    await withServer({ publish: async () => ({ ...result(), ...invalid }) }, async (base) => {
      const response = await post(base)
      assert.equal(response.status, 502, Object.keys(invalid).join(","))
      assert.equal((await response.json()).error.code, "skill_response_invalid")
    })
})

test("Publish forwards only bounded Retry-After", async () => {
  for (const retry of ["3", "0", "999999", "junk", null])
    await withServer(
      {
        publish: async () => {
          const error = new ConnectError("private rate limit", Code.ResourceExhausted)
          if (retry !== null) error.metadata.set("retry-after", retry)
          throw error
        },
      },
      async (base) => {
        const response = await post(base)
        assert.equal(response.status, 429)
        assert.equal((await response.json()).error.code, "skill_rate_limited")
        assert.equal(response.headers.get("retry-after"), retry === "3" ? "3" : null)
      },
    )
})

test("Publish client disconnect aborts in-flight owner stage", async () => {
  let reachedResolve
  const reached = new Promise((resolve) => {
    reachedResolve = resolve
  })
  let abortedResolve
  const aborted = new Promise((resolve) => {
    abortedResolve = resolve
  })
  await withServer(
    {
      publish: async (_command, signal) => {
        reachedResolve()
        await new Promise((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              abortedResolve()
              resolve()
            },
            { once: true },
          ),
        )
        throw signal.reason
      },
    },
    async (base) => {
      const url = new URL("/v1/skills/skill-1/publish", base)
      const req = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers })
      req.on("error", () => {})
      req.end()
      await reached
      req.destroy()
      await aborted
    },
  )
})
