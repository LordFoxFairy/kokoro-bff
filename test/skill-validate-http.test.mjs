import assert from "node:assert/strict"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
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
  "content-type": "application/json",
  "idempotency-key": "validate-1",
}
const input = { expected_state_version: "7", attempt_id: "attempt-1" }
const manifestIdentityV2 = `zip-v2:sha256:${"b".repeat(64)}`
const manifestIdentitySkillMd = `skill-md-v1:sha256:${"c".repeat(64)}`
const result = () => ({
  stateVersion: 1n,
  skillId: { value: "skill-1" },
  seriesId: { value: "series-1" },
  valid: true,
  contentDigest: "a".repeat(64),
  manifestIdentity: manifestIdentityV2,
  replayed: false,
})
async function withServer(client, run, admission = { verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "user" } }) }) {
  const server = createLiveTestBffServer(config, {
    skillAuthorization: { check: async () => ({ ok: true }) },
    sessionAdmission: admission,
    skillDraftClient: client,
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}
const post = (base, body = input, other = {}) =>
  fetch(`${base}/v1/skills/skill-1/validate`, {
    method: "POST",
    headers: { ...headers, ...other },
    body: JSON.stringify(body),
  })

test("Validate default-off candidate does not reach Platform", async () => {
  await withServer(null, async (base) => {
    const response = await post(base)
    assert.equal(response.status, 503)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.ok(response.headers.get("x-request-id"))
    assert.equal((await response.json()).error.code, "skill_dependency_unavailable")
  })
})

test("Validate projector matches all eight owner v4 command vectors", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../contract/vendor/kokoro-platform/91bc3655ebd3648cb8f8ccddfacb5628bdeb1c5c/execution-operations-v5/manifest.json", import.meta.url),
      "utf8",
    ),
  )
  assert.equal(manifest.baseArtifact.aggregateSha256, "902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79")
})
test("Validate returns strict V2 validated owner projection", async () => {
  const calls = []
  await withServer(
    {
      validateDraft: async (command) => {
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
        data: {
          state_version: "1",
          skill_id: "skill-1",
          series_id: "series-1",
          valid: true,
          content_digest: "a".repeat(64),
          manifest_identity: manifestIdentityV2,
          replayed: false,
        },
      })
    },
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].tenant, "tenant")
  assert.equal(calls[0].user, "user")
  assert.equal(calls[0].skillId, "skill-1")
  assert.equal(calls[0].attemptId, "attempt-1")
  assert.match(calls[0].digest, /^[a-f0-9]{64}$/u)
})

test("Validate projects the current skill-md-v1 canonical owner identity", async () => {
  await withServer(
    {
      validateDraft: async () => ({
        ...result(),
        manifestIdentity: manifestIdentitySkillMd,
      }),
    },
    async (base) => {
      const response = await post(base)
      assert.equal(response.status, 200)
      assert.equal((await response.json()).data.manifest_identity, manifestIdentitySkillMd)
    },
  )
})

test("Validate generated Connect schema carries v4 typed attempt selector", async () => {
  const { create, fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const { ValidateSkillDraftRequestSchema, ValidateSkillDraftResponseSchema, SkillCatalogService } =
    await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  assert.equal(SkillCatalogService.method.validateSkillDraft.name, "ValidateSkillDraft")
  assert.deepEqual(
    ValidateSkillDraftRequestSchema.fields.map((field) => [field.name, field.number]),
    [
      ["request_id", 1],
      ["command", 2],
      ["skill_id", 3],
      ["product_context", 6],
      ["attempt_id", 7],
      ["expected_state_version", 8],
    ],
  )
  assert.deepEqual(
    ValidateSkillDraftResponseSchema.fields.map((field) => [field.name, field.number]),
    [
      ["skill_id", 1],
      ["valid", 2],
      ["content_digest", 3],
      ["manifest_identity", 4],
      ["replayed", 5],
      ["series_id", 6],
      ["state_version", 7],
      ["original_name", 8],
      ["file_count", 9],
    ],
  )
  const request = create(ValidateSkillDraftRequestSchema, {
    requestId: "request-1",
    command: { commandId: "command-1", requestDigest: "a".repeat(64) },
    skillId: { value: "skill-1" },
    productContext: { subjectId: "user", ownerScope: { kind: "user", id: "user" } },
    attemptId: "attempt-1",
  })
  assert.deepEqual(fromBinary(ValidateSkillDraftRequestSchema, toBinary(ValidateSkillDraftRequestSchema, request)), request)
})

test("Validate rejects aliases, extra fields, malformed key and duplicate JSON before owner", async () => {
  let calls = 0
  await withServer(
    {
      validateDraft: async () => {
        calls++
        return result()
      },
    },
    async (base) => {
      for (const body of [
        {},
        { attempt_id: "" },
        { attempt_id: " " },
        { attempt_id: 1 },
        { ...input, asset_id: "asset" },
        { ...input, content_sha256: "a".repeat(64) },
        { ...input, tenant: "other" },
        { ...input, manifest_identity: "zip-v1:sha256:x" },
      ]) {
        const response = await post(base, body)
        assert.equal(response.status, 400, JSON.stringify(body))
        assert.equal((await response.json()).error.code, "invalid_skill_request")
      }
      assert.equal((await post(base, input, { "idempotency-key": "" })).status, 400)
      assert.equal((await post(base, input, { "content-type": "text/plain" })).status, 400)
      const duplicate = await fetch(`${base}/v1/skills/skill-1/validate`, { method: "POST", headers, body: '{"attempt_id":"attempt-1","attempt_id":"other"}' })
      assert.equal(duplicate.status, 400)
      const oversized = await fetch(`${base}/v1/skills/skill-1/validate`, { method: "POST", headers, body: `{"padding":"${"x".repeat(70_000)}"}` })
      assert.equal(oversized.status, 413)
      assert.equal((await oversized.json()).error.code, "request_body_too_large")
      for (const path of ["/v1/skills/skill-1/validate?x=1", "/v1/skills/bad%20id/validate", "/v1/skills/%73kill-1/validate"]) {
        const response = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(input) })
        assert.equal(response.status, 400)
      }
    },
  )
  assert.equal(calls, 0)
})

test("Validate rejects duplicated Idempotency-Key and bounds request ID", async () => {
  const { request: httpRequest } = await import("node:http")
  let calls = 0
  await withServer(
    {
      validateDraft: async () => {
        calls++
        return result()
      },
    },
    async (base) => {
      const received = await new Promise((resolve, reject) => {
        const req = httpRequest(
          `${base}/v1/skills/skill-1/validate`,
          { method: "POST", headers: { ...headers, "idempotency-key": ["validate-1", "validate-2"] } },
          (res) => {
            const chunks = []
            res.on("data", (chunk) => chunks.push(chunk))
            res.once("end", () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }))
          },
        )
        req.once("error", reject)
        req.end(JSON.stringify(input))
      })
      assert.equal(received.status, 400)
      assert.equal(received.body.error.code, "invalid_idempotency_key")
      assert.equal(received.headers["cache-control"], "no-store")
      const longId = await post(base, input, { "x-request-id": "r".repeat(129) })
      assert.equal(longId.status, 200)
      assert.ok(longId.headers.get("x-request-id")?.length <= 128)
      assert.notEqual(longId.headers.get("x-request-id"), "r".repeat(129))
    },
  )
  assert.equal(calls, 1)
})

test("Validate re-admits replay and refuses revoked, foreign tenant before owner", async () => {
  let calls = 0
  let admits = 0
  await withServer(
    { validateDraft: async () => ({ ...result(), replayed: calls++ > 0 }) },
    async (base) => {
      assert.equal((await post(base)).status, 200)
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
      validateDraft: async () => {
        calls++
        return result()
      },
    },
    async (base) => {
      const response = await post(base)
      assert.equal(response.status, 403)
      assert.equal((await response.json()).error.code, "product_tenant_forbidden")
    },
    { verify: async () => ({ ok: true, identity: { namespace: "foreign", userId: "user" } }) },
  )
  assert.equal(calls, 0)
})

test("Validate command identity binds trusted tenant, user, skill and key; digest binds attempt", async () => {
  const calls = []
  await withServer(
    {
      validateDraft: async (command) => {
        calls.push(command)
        return result()
      },
    },
    async (base) => {
      assert.equal((await post(base)).status, 200)
      assert.equal((await post(base)).status, 200)
      assert.equal((await post(base, { ...input, attempt_id: "attempt-2" })).status, 200)
      assert.equal((await post(base, input, { "idempotency-key": "validate-2" })).status, 200)
    },
  )
  assert.equal(calls[0].commandId, calls[1].commandId)
  assert.equal(calls[0].digest, calls[1].digest)
  assert.equal(calls[0].commandId, calls[2].commandId)
  assert.notEqual(calls[0].digest, calls[2].digest)
  assert.notEqual(calls[0].commandId, calls[3].commandId)
  assert.equal(calls[0].digest, calls[3].digest)
  await withServer(
    {
      validateDraft: async (command) => {
        calls.push(command)
        return result()
      },
    },
    async (base) => {
      assert.equal((await post(base)).status, 200)
    },
    { verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "other" } }) },
  )
  assert.notEqual(calls[0].commandId, calls[4].commandId)
  assert.notEqual(calls[0].digest, calls[4].digest)
})

test("Validate owner receipt can conflict on same key and recover unknown ACK with same identity", async () => {
  const seen = new Map()
  await withServer(
    {
      validateDraft: async (command) => {
        const previous = seen.get(command.commandId)
        if (previous && previous !== command.digest) throw new ConnectError("private conflict", Code.AlreadyExists)
        seen.set(command.commandId, command.digest)
        return { ...result(), replayed: previous !== undefined }
      },
    },
    async (base) => {
      assert.equal((await post(base)).status, 200)
      assert.equal((await post(base)).status, 200)
      const conflict = await post(base, { ...input, attempt_id: "attempt-2" })
      assert.equal(conflict.status, 409)
      assert.equal((await conflict.json()).error.code, "skill_idempotency_conflict")
    },
  )
  const commands = []
  let admits = 0
  await withServer(
    {
      validateDraft: async (command) => {
        commands.push(command)
        if (commands.length === 1) throw new ConnectError("private lost ACK", Code.DeadlineExceeded)
        return { ...result(), replayed: true }
      },
    },
    async (base) => {
      assert.equal((await post(base)).status, 503)
      const recovered = await post(base)
      assert.equal(recovered.status, 200)
      assert.equal((await recovered.json()).data.replayed, true)
    },
    {
      verify: async () => {
        admits++
        return { ok: true, identity: { namespace: "tenant", userId: "user" } }
      },
    },
  )
  assert.equal(admits, 2)
  assert.equal(commands[0].commandId, commands[1].commandId)
  assert.equal(commands[0].digest, commands[1].digest)
})

test("Validate maps owner precondition, conflicts, privacy and dependency errors by code", async () => {
  for (const [code, status, publicCode] of [
    [Code.AlreadyExists, 409, "skill_idempotency_conflict"],
    [Code.Aborted, 409, "skill_command_in_progress"],
    [Code.FailedPrecondition, 412, "skill_precondition_failed"],
    [Code.NotFound, 404, "skill_not_found"],
    [Code.PermissionDenied, 404, "skill_not_found"],
    [Code.DeadlineExceeded, 503, "skill_dependency_unavailable"],
  ])
    await withServer(
      {
        validateDraft: async () => {
          throw new ConnectError("private infected/stale/ZIP", code)
        },
      },
      async (base) => {
        const response = await post(base)
        assert.equal(response.status, status)
        const body = await response.json()
        assert.equal(body.error.code, publicCode)
        assert.equal(JSON.stringify(body).includes("private"), false)
      },
    )
})

test("Validate maps only owner package_attempt_conflict Aborted metadata to stale-attempt 412", async () => {
  for (const [reason, status, code] of [
    ["package_attempt_conflict", 412, "skill_precondition_failed"],
    ["command_in_progress", 409, "skill_command_in_progress"],
    [null, 409, "skill_command_in_progress"],
  ])
    await withServer(
      {
        validateDraft: async () => {
          const error = new ConnectError("private stale attempt or busy command", Code.Aborted)
          if (reason !== null) error.metadata.set("x-kokoro-error-code", reason)
          throw error
        },
      },
      async (base) => {
        const response = await post(base)
        assert.equal(response.status, status, String(reason))
        const body = await response.json()
        assert.equal(body.error.code, code)
        assert.equal(JSON.stringify(body).includes("private"), false)
      },
    )
})

test("Validate rejects malformed owner result instead of partial public success", async () => {
  for (const invalid of [
    { skillId: { value: "other" } },
    { skillId: undefined },
    { seriesId: { value: "" } },
    { seriesId: { value: 1 } },
    { valid: false },
    { contentDigest: "A".repeat(64) },
    { contentDigest: "" },
    { manifestIdentity: "zip-v1:sha256:bad" },
    { manifestIdentity: "ZIP-V1:SHA256:" + "b".repeat(64) },
    { manifestIdentity: `zip-v2:sha256:${"b".repeat(63)}` },
    { manifestIdentity: `zip-v2:sha256:${"b".repeat(65)}` },
    { manifestIdentity: `zip-v2:sha256:${"B".repeat(64)}` },
    { manifestIdentity: `ZIP-V2:SHA256:${"b".repeat(64)}` },
    { manifestIdentity: `prefix-${manifestIdentityV2}` },
    { manifestIdentity: `${manifestIdentityV2}-suffix` },
    { manifestIdentity: `skill-md-v1:sha256:${"C".repeat(64)}` },
    { manifestIdentity: ` skill-md-v1:sha256:${"c".repeat(64)}` },
    { manifestIdentity: `skill-md-v1:sha256:${"c".repeat(64)} ` },
    { manifestIdentity: `skill-md-v2:sha256:${"c".repeat(64)}` },
    { replayed: "true" },
    { manifestIdentity: `zip-v1:sha256:${"b".repeat(64)}` },
  ])
    await withServer({ validateDraft: async () => ({ ...result(), ...invalid }) }, async (base) => {
      const response = await post(base)
      assert.equal(response.status, 502, JSON.stringify(invalid))
      assert.equal((await response.json()).error.code, "skill_response_invalid")
    })
})

test("Validate rate limit only forwards bounded Retry-After", async () => {
  for (const retry of ["3", "0", "999999", "junk", null])
    await withServer(
      {
        validateDraft: async () => {
          const error = new ConnectError("private limit", Code.ResourceExhausted)
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

test("Validate client disconnect aborts in-flight owner stage", async () => {
  const { request: httpRequest } = await import("node:http")
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
      validateDraft: async (_command, signal) => {
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
      const url = new URL("/v1/skills/skill-1/validate", base)
      const req = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers })
      req.on("error", () => {})
      req.end(JSON.stringify(input))
      await reached
      req.destroy()
      await aborted
    },
  )
})

test("Public13 validate missing CAS rejects before owner", async () => {
  let calls = 0
  await withServer(
    {
      validateDraft: async () => {
        calls++
        return result()
      },
    },
    async (base) => {
      const { expected_state_version: _, ...missing } = input
      assert.equal((await post(base, missing)).status, 400)
      assert.equal(calls, 0)
    },
  )
})

test("Public13 validate rejects invalid CAS before owner and preserves the signed64 string boundary", async () => {
  let calls = 0
  await withServer(
    {
      validateDraft: async (command) => {
        calls++
        assert.equal(command.expectedStateVersion, "9223372036854775807")
        return result()
      },
    },
    async (base) => {
      for (const version of [null, 7, "0", "01", "-1", "1.0", " 7", "9223372036854775808", "18446744073709551615"])
        assert.equal((await post(base, { ...input, expected_state_version: version })).status, 400)
      const duplicate = await fetch(`${base}/v1/skills/skill-1/validate`, {
        method: "POST",
        headers,
        body: JSON.stringify(input).replace('"expected_state_version":"7"', '"expected_state_version":"7","expected_state_version":"8"'),
      })
      assert.equal(duplicate.status, 400)
      assert.equal(calls, 0)
      assert.equal((await post(base, { ...input, expected_state_version: "9223372036854775807" })).status, 200)
      assert.equal(calls, 1)
    },
  )
})
test("Public13 validate actual generated wire binds CAS and same-key recovery without guessing a new version", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { toJson } = await import("@bufbuild/protobuf")
  const { CatalogConnectClient } = await import("../dist/infrastructure/clients/platform/catalog-connect.js")
  const { SkillCatalogService } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const { projectSkillProductCommand } = await import("../dist/infrastructure/clients/platform/create-skill-draft-projector.js")
  let calls = 0,
    committed = 0,
    unknown = true
  const receipts = new Map()
  const seen = []
  const owner = createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(SkillCatalogService, {
          validateSkillDraft(request, context) {
            calls++
            context.responseHeader.set("x-kokoro-request-id", request.requestId)
            context.responseHeader.set("cache-control", "no-store")
            assert.equal(context.requestHeader.get("authorization"), "Bearer public13-catalog-fixture")
            assert.equal(context.requestHeader.get("x-tenant-ref"), "tenant")
            assert.equal(request.productContext?.subjectId, "user")
            const wire = toJson(SkillCatalogService.method.validateSkillDraft.input, request, { useProtoFieldName: true })
            delete wire.request_id
            delete wire.command
            const digest = projectSkillProductCommand(
              JSON.stringify({
                command_digest_version: "3.0.0",
                fq_method: "kokoro.platform.v1.SkillCatalogService/ValidateSkillDraft",
                tenant_ref: "tenant",
                request: wire,
              }),
              true,
            ).sha256
            assert.equal(request.command.requestDigest, digest)
            seen.push({ commandId: request.command.commandId, digest, version: request.expectedStateVersion })
            const previous = receipts.get(request.command.commandId)
            if (previous) {
              if (previous.digest !== digest) throw new ConnectError("fixture digest conflict", Code.AlreadyExists)
              return { ...previous.ack, replayed: true }
            }
            if (request.expectedStateVersion !== 7n) throw new ConnectError("fixture stale CAS", Code.FailedPrecondition)
            const ack = { ...result(), stateVersion: 8n }
            receipts.set(request.command.commandId, { digest, ack })
            committed++
            if (unknown) {
              unknown = false
              throw new ConnectError("fixture ACK loss", Code.Unavailable)
            }
            return ack
          },
        })
      },
    }),
  )
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  try {
    const client = new CatalogConnectClient(`http://127.0.0.1:${owner.address().port}`, { get: async () => "public13-catalog-fixture", retire() {} }, 1000)
    await withServer(client, async (base) => {
      assert.equal((await post(base, { ...input, expected_state_version: "6" }, { "idempotency-key": "public13-stale" })).status, 412)
      assert.equal(committed, 0)
      assert.equal((await post(base, input, { "idempotency-key": "public13-unknown" })).status, 503)
      assert.equal(committed, 1)
      const replay = await post(base, input, { "idempotency-key": "public13-unknown" })
      assert.equal(replay.status, 200)
      const body = await replay.json()
      assert.equal(body.data.state_version, "8")
      assert.equal(body.data.replayed, true)
      assert.deepEqual(seen[1], seen[2])
      assert.equal(committed, 1)
      assert.equal((await post(base, { ...input, expected_state_version: "8" }, { "idempotency-key": "public13-unknown" })).status, 409)
      assert.equal(committed, 1)
      assert.equal((await post(base, { ...input, expected_state_version: "6" }, { "idempotency-key": "public13-stale-after" })).status, 412)
      const correct = await post(base, input, { "idempotency-key": "public13-correct" })
      assert.equal(correct.status, 200)
      assert.equal((await correct.json()).data.state_version, "8")
      assert.equal(committed, 2)
      assert.equal(calls, 6)
    })
  } finally {
    await new Promise((resolve) => owner.close(resolve))
  }
})
