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
const input = { attempt_id: "attempt-1" }
const result = () => ({
  skillId: { value: "skill-1" },
  seriesId: { value: "series-1" },
  valid: true,
  contentDigest: "a".repeat(64),
  manifestIdentity: `zip-v1:sha256:${"b".repeat(64)}`,
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
  const { projectValidateSkillDraft } = await import("../dist/infrastructure/clients/platform/validate-skill-draft-projector.js")
  const source = new URL(
    "../contract/vendor/kokoro-platform/263a28f1e55745bd1829a61f68228d775751adbc/execution-operations-v4/vectors/command-projection.json",
    import.meta.url,
  )
  const vectors = JSON.parse(await readFile(source, "utf8")).vectors.filter((vector) => vector.operation === "skill.validate_draft")
  assert.equal(vectors.length, 8)
  for (const vector of vectors) {
    const raw = Buffer.from(vector.rawBase64, "base64")
    if (vector.expectedError !== "none") {
      assert.throws(() => projectValidateSkillDraft(raw), { message: vector.expectedError }, vector.name)
      continue
    }
    const projected = projectValidateSkillDraft(raw)
    assert.deepEqual(projected.projection, vector.projection, vector.name)
    assert.equal(Buffer.from(projected.canonical).toString("base64"), vector.canonicalBase64, vector.name)
    assert.equal(projected.sha256, vector.sha256, vector.name)
  }
})

test("Validate returns strict validated owner projection", async () => {
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
          skill_id: "skill-1",
          series_id: "series-1",
          valid: true,
          content_digest: "a".repeat(64),
          manifest_identity: `zip-v1:sha256:${"b".repeat(64)}`,
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
      assert.equal((await post(base, { attempt_id: "attempt-2" })).status, 200)
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
      const conflict = await post(base, { attempt_id: "attempt-2" })
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
    { replayed: "true" },
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
