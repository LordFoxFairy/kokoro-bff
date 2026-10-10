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
  "idempotency-key": "complete-1",
}
const input = {
  expected_state_version: "7",
  source_version_id: "OPAQUE+/=",
  attempt_id: "attempt-1",
  upload_id: "upload-1",
  content_sha256: "a".repeat(64),
  size_bytes: 143,
}
const result = () => ({
  stateVersion: 1n,
  skillId: { value: "skill-1" },
  attemptId: "attempt-1",
  attemptEpoch: 1n,
  uploadId: "upload-1",
  assetId: "asset-1",
  phase: 4,
  replayed: false,
  contentSha256: "a".repeat(64),
  scanState: 2,
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
  fetch(`${base}/v1/skills/skill-1/package-upload/complete`, { method: "POST", headers: { ...headers, ...other }, body: JSON.stringify(body) })

test("Complete new path is a default-closed strict candidate, never old Capability", async () => {
  await withServer(null, async (base) => {
    const response = await post(base)
    assert.equal(response.status, 503)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.ok(response.headers.get("x-request-id"))
    assert.equal((await response.json()).error.code, "skill_dependency_unavailable")
  })
})

test("Complete projector matches all eleven owner v4 command projection vectors", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../contract/vendor/kokoro-platform/32666c1c18360e707048a1104efe6b50e375002f/execution-operations-v5/manifest.json", import.meta.url),
      "utf8",
    ),
  )
  assert.equal(manifest.baseArtifact.aggregateSha256, "902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79")
})
test("Complete generated Connect request carries exact typed command and Product context fields", async () => {
  const { create, toBinary, fromBinary } = await import("@bufbuild/protobuf")
  const { CompleteSkillPackageUploadRequestSchema, CompleteSkillPackageUploadResponseSchema, SkillCatalogService } =
    await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  assert.equal(SkillCatalogService.method.completeSkillPackageUpload.name, "CompleteSkillPackageUpload")
  assert.deepEqual(
    CompleteSkillPackageUploadRequestSchema.fields.map((field) => [field.name, field.number]),
    [
      ["request_id", 1],
      ["command", 2],
      ["skill_id", 3],
      ["product_context", 4],
      ["attempt_id", 5],
      ["upload_id", 6],
      ["content_sha256", 7],
      ["size_bytes", 8],
      ["source_version_id", 9],
      ["expected_state_version", 10],
    ],
  )
  assert.deepEqual(
    CompleteSkillPackageUploadResponseSchema.fields.map((field) => [field.name, field.number]),
    [
      ["skill_id", 1],
      ["attempt_id", 2],
      ["attempt_epoch", 3],
      ["upload_id", 4],
      ["asset_id", 5],
      ["phase", 6],
      ["replayed", 7],
      ["content_sha256", 8],
      ["scan_state", 9],
      ["state_version", 10],
    ],
  )
  const request = create(CompleteSkillPackageUploadRequestSchema, {
    requestId: "request-1",
    command: { commandId: "command-1", requestDigest: "a".repeat(64) },
    skillId: { value: "skill-1" },
    productContext: { subjectId: "user", ownerScope: { kind: "user", id: "user" } },
    attemptId: "attempt-1",
    uploadId: "upload-1",
    contentSha256: "b".repeat(64),
    sizeBytes: 143n,
  })
  assert.deepEqual(fromBinary(CompleteSkillPackageUploadRequestSchema, toBinary(CompleteSkillPackageUploadRequestSchema, request)), request)
})

test("Complete returns strict uploaded data for clean, pending and unknown scans but never exposes asset", async () => {
  for (const [scanState, publicScan] of [
    [2, "clean"],
    [1, "pending"],
    [4, "unknown"],
  ]) {
    const calls = []
    await withServer(
      {
        completePackageUpload: async (command) => {
          calls.push(command)
          return { ...result(), scanState }
        },
      },
      async (base) => {
        const response = await post(base)
        assert.equal(response.status, 200)
        assert.equal(response.headers.get("cache-control"), "no-store")
        assert.ok(response.headers.get("x-request-id"))
        const body = await response.json()
        assert.deepEqual(Object.keys(body), ["data"])
        assert.deepEqual(body.data, {
          state_version: "1",
          skill_id: "skill-1",
          attempt_id: "attempt-1",
          attempt_epoch: "1",
          upload_id: "upload-1",
          phase: "uploaded",
          replayed: false,
          content_sha256: "a".repeat(64),
          scan_state: publicScan,
        })
        assert.equal(JSON.stringify(body).includes("asset-1"), false)
      },
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0].tenant, "tenant")
    assert.equal(calls[0].user, "user")
    assert.equal(calls[0].skillId, "skill-1")
    assert.match(calls[0].digest, /^[a-f0-9]{64}$/u)
  }
})

test("Complete rejects untrusted body, malformed key, aliases and extra fields before Platform", async () => {
  let calls = 0
  await withServer(
    {
      completePackageUpload: async () => {
        calls++
        return result()
      },
    },
    async (base) => {
      for (const body of [
        { ...input, attempt_id: "" },
        { ...input, upload_id: " " },
        { ...input, content_sha256: "A".repeat(64) },
        { ...input, size_bytes: 0 },
        { ...input, size_bytes: 33_554_433 },
        { ...input, size_bytes: 1.5 },
        { ...input, asset_id: "asset-1" },
        { ...input, scan_state: "clean" },
        { ...input, tenant: "foreign" },
        { ...input, url: "http://example.test" },
      ])
        assert.equal((await post(base, body)).status, 400, JSON.stringify(body))
      assert.equal((await post(base, input, { "idempotency-key": "" })).status, 400)
      assert.equal((await post(base, input, { "content-type": "text/plain" })).status, 400)
      for (const path of [
        "/v1/skills/skill-1/package-upload/complete?x=1",
        "/v1/skills/bad%20id/package-upload/complete",
        "/v1/skills/%73kill-1/package-upload/complete",
      ])
        assert.equal((await fetch(base + path, { method: "POST", headers, body: JSON.stringify(input) })).status, 400)
      const duplicate = await fetch(`${base}/v1/skills/skill-1/package-upload/complete`, {
        method: "POST",
        headers,
        body: `{"attempt_id":"attempt-1","attempt_id":"other","upload_id":"upload-1","content_sha256":"${"a".repeat(64)}","size_bytes":143}`,
      })
      assert.equal(duplicate.status, 400)
      const oversized = await fetch(`${base}/v1/skills/skill-1/package-upload/complete`, {
        method: "POST",
        headers,
        body: `{"padding":"${"x".repeat(70_000)}"}`,
      })
      assert.equal(oversized.status, 413)
      assert.equal((await oversized.json()).error.code, "request_body_too_large")
    },
  )
  assert.equal(calls, 0)
})

test("Complete rejects duplicate idempotency headers and keeps request ID bounded", async () => {
  const { request: httpRequest } = await import("node:http")
  let calls = 0
  await withServer(
    {
      completePackageUpload: async () => {
        calls++
        return result()
      },
    },
    async (base) => {
      const received = await new Promise((resolve, reject) => {
        const req = httpRequest(
          `${base}/v1/skills/skill-1/package-upload/complete`,
          { method: "POST", headers: { ...headers, "idempotency-key": ["complete-1", "complete-2"] } },
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
      assert.ok(longId.headers.get("x-request-id"))
      assert.notEqual(longId.headers.get("x-request-id"), "r".repeat(129))
      assert.ok(longId.headers.get("x-request-id").length <= 128)
    },
  )
  assert.equal(calls, 1)
})

test("Complete re-admits each replay and revoked session has zero new owner calls", async () => {
  let calls = 0
  let admits = 0
  const admission = {
    verify: async () => (++admits <= 2 ? { ok: true, identity: { namespace: "tenant", userId: "user" } } : { ok: false, status: 401, code: "session_invalid" }),
  }
  await withServer(
    { completePackageUpload: async () => ({ ...result(), replayed: calls++ > 0 }) },
    async (base) => {
      assert.equal((await post(base)).status, 200)
      const replay = await post(base)
      assert.equal(replay.status, 200)
      assert.equal((await replay.json()).data.replayed, true)
      const revoked = await post(base)
      assert.equal(revoked.status, 401)
      assert.equal((await revoked.json()).error.code, "session_invalid")
    },
    admission,
  )
  assert.equal(calls, 2)
  assert.equal(admits, 3)
})

test("Complete command identity scopes trusted tenant, user, skill and key while digest binds body", async () => {
  const calls = []
  await withServer(
    {
      completePackageUpload: async (command) => {
        calls.push(command)
        return result()
      },
    },
    async (base) => {
      assert.equal((await post(base)).status, 200)
      assert.equal((await post(base)).status, 200)
      assert.equal((await post(base, { ...input, content_sha256: "b".repeat(64) })).status, 502)
      assert.equal((await post(base, input, { "idempotency-key": "complete-2" })).status, 200)
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
      completePackageUpload: async (command) => {
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
  assert.notEqual(calls[0].commandId, calls[4].commandId)
})

test("Complete owner receipt enforces same-key different-body conflict while distinct commands may share one Asset", async () => {
  const receipts = new Map()
  const assetIds = []
  await withServer(
    {
      completePackageUpload: async (command) => {
        const previous = receipts.get(command.commandId)
        if (previous !== undefined && previous !== command.digest) throw new ConnectError("private digest conflict", Code.AlreadyExists)
        receipts.set(command.commandId, command.digest)
        assetIds.push("asset-1")
        return { ...result(), replayed: previous !== undefined, contentSha256: command.contentSha256 }
      },
    },
    async (base) => {
      assert.equal((await post(base)).status, 200)
      const replay = await post(base)
      assert.equal(replay.status, 200)
      assert.equal((await replay.json()).data.replayed, true)
      const conflict = await post(base, { ...input, content_sha256: "b".repeat(64) })
      assert.equal(conflict.status, 409)
      assert.equal((await conflict.json()).error.code, "skill_idempotency_conflict")
      assert.equal((await post(base, input, { "idempotency-key": "complete-2" })).status, 200)
    },
  )
  assert.deepEqual(assetIds, ["asset-1", "asset-1", "asset-1"])
  assert.equal(receipts.size, 2)
})

test("Complete unknown ACK retries the same stable command after a new current admission", async () => {
  const commands = []
  let admits = 0
  await withServer(
    {
      completePackageUpload: async (command) => {
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

test("Complete rejects a foreign Product tenant before Platform", async () => {
  let calls = 0
  await withServer(
    {
      completePackageUpload: async () => {
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

test("Complete client disconnect aborts the in-flight owner stage", async () => {
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
      completePackageUpload: async (_command, signal) => {
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
      const url = new URL("/v1/skills/skill-1/package-upload/complete", base)
      const req = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers })
      req.on("error", () => {})
      req.end(JSON.stringify(input))
      await reached
      req.destroy()
      await aborted
    },
  )
})

test("Complete maps owner conflict, stale or infected attempt, foreign visibility and unknown ACK without message inference", async () => {
  for (const [code, expectedStatus, expectedCode] of [
    [Code.AlreadyExists, 409, "skill_idempotency_conflict"],
    [Code.Aborted, 409, "skill_command_in_progress"],
    [Code.FailedPrecondition, 412, "skill_precondition_failed"],
    [Code.PermissionDenied, 404, "skill_not_found"],
    [Code.NotFound, 404, "skill_not_found"],
    [Code.DeadlineExceeded, 503, "skill_dependency_unavailable"],
  ])
    await withServer(
      {
        completePackageUpload: async () => {
          throw new ConnectError("private infected asset or stale attempt", code)
        },
      },
      async (base) => {
        const response = await post(base)
        assert.equal(response.status, expectedStatus)
        const body = await response.json()
        assert.equal(body.error.code, expectedCode)
        assert.equal(JSON.stringify(body).includes("private"), false)
      },
    )
})

test("Complete rejects malformed owner completion and never emits partial public success", async () => {
  for (const invalid of [
    { skillId: { value: "other" } },
    { attemptId: "other" },
    { uploadId: "other" },
    { assetId: "" },
    { assetId: 123 },
    { attemptEpoch: 0n },
    { attemptEpoch: 18_446_744_073_709_551_616n },
    { phase: 5 },
    { contentSha256: "b".repeat(64) },
    { scanState: 3 },
    { scanState: 0 },
    { replayed: "true" },
  ])
    await withServer({ completePackageUpload: async () => ({ ...result(), ...invalid }) }, async (base) => {
      const response = await post(base)
      assert.equal(
        response.status,
        502,
        JSON.stringify(invalid, (_, value) => (typeof value === "bigint" ? value.toString() : value)),
      )
      assert.equal((await response.json()).error.code, "skill_response_invalid")
    })
})

test("Complete rate limit forwards only bounded Retry-After", async () => {
  for (const retry of ["3", "0", "999999", "junk", null]) {
    await withServer(
      {
        completePackageUpload: async () => {
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
  }
})

test("Public13 package-complete missing CAS rejects before owner", async () => {
  let calls = 0
  await withServer(
    {
      completePackageUpload: async () => {
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

test("Public13 package-complete rejects invalid CAS before owner and preserves the signed64 string boundary", async () => {
  let calls = 0
  await withServer(
    {
      completePackageUpload: async (command) => {
        calls++
        assert.equal(command.expectedStateVersion, "9223372036854775807")
        return result()
      },
    },
    async (base) => {
      for (const version of [null, 7, "0", "01", "-1", "1.0", " 7", "9223372036854775808", "18446744073709551615"])
        assert.equal((await post(base, { ...input, expected_state_version: version })).status, 400)
      const duplicate = await fetch(`${base}/v1/skills/skill-1/package-upload/complete`, {
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
test("Public13 package-complete actual generated wire binds CAS and same-key recovery without guessing a new version", async () => {
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
          completeSkillPackageUpload(request, context) {
            calls++
            context.responseHeader.set("x-kokoro-request-id", request.requestId)
            context.responseHeader.set("cache-control", "no-store")
            assert.equal(context.requestHeader.get("authorization"), "Bearer public13-catalog-fixture")
            assert.equal(context.requestHeader.get("x-tenant-ref"), "tenant")
            assert.equal(request.productContext?.subjectId, "user")
            const wire = toJson(SkillCatalogService.method.completeSkillPackageUpload.input, request, { useProtoFieldName: true })
            delete wire.request_id
            delete wire.command
            const digest = projectSkillProductCommand(
              JSON.stringify({
                command_digest_version: "3.0.0",
                fq_method: "kokoro.platform.v1.SkillCatalogService/CompleteSkillPackageUpload",
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
