import assert from "node:assert/strict"
import { once } from "node:events"
import { request as httpRequest } from "node:http"
import test from "node:test"
import { Code, ConnectError } from "@connectrpc/connect"

import { createLiveTestBffServer } from "./doubles/server.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"

const config = {
  host: "127.0.0.1",
  port: 4300,
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
const headers = { authorization: "Bearer session", "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "secret" }

async function withServer(client, run, admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "user" } })) {
  const server = createLiveTestBffServer(config, {
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

test("candidate Get projects current package state from trusted user and tenant", async () => {
  const calls = []
  await withServer(
    {
      getPackageUpload: async (input) => {
        calls.push(input)
        return { skillId: { value: "skill-1" }, attemptEpoch: 0n, phase: 1 }
      },
    },
    async (base) => {
      const response = await fetch(`${base}/v1/skills/skill-1/package-upload`, { headers })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { data: { skill_id: "skill-1", attempt_epoch: "0", phase: "none" } })
      assert.equal(response.headers.get("x-request-id")?.length > 0, true)
      assert.equal(response.headers.get("cache-control"), "no-store")
    },
  )
  assert.equal(calls.length, 1)
  assert.deepEqual({ ...calls[0], requestId: undefined }, { skillId: "skill-1", tenant: "tenant", user: "user", requestId: undefined })
})

test("candidate Get keeps the echoed request ID within the public 128-character header bound", async () => {
  const seen = []
  await withServer(
    {
      getPackageUpload: async ({ requestId }) => {
        seen.push(requestId)
        return { skillId: { value: "skill-1" }, attemptEpoch: 0n, phase: 1 }
      },
    },
    async (base) => {
      const valid = "v".repeat(128)
      const accepted = await fetch(`${base}/v1/skills/skill-1/package-upload`, { headers: { ...headers, "x-request-id": valid } })
      assert.equal(accepted.status, 200)
      assert.equal(accepted.headers.get("x-request-id"), valid)
      const oversized = await fetch(`${base}/v1/skills/skill-1/package-upload`, { headers: { ...headers, "x-request-id": "x".repeat(129) } })
      assert.equal(oversized.status, 200)
      const normalized = oversized.headers.get("x-request-id")
      assert.match(normalized, /^[0-9a-f-]{36}$/u)
      assert.notEqual(normalized, "x".repeat(129))
      assert.deepEqual(seen, [valid, normalized])
    },
  )
})

test("candidate Get does not echo duplicate or control-bearing request IDs", async () => {
  const seen = []
  await withServer(
    {
      getPackageUpload: async ({ requestId }) => {
        seen.push(requestId)
        return { skillId: { value: "skill-1" }, attemptEpoch: 0n, phase: 1 }
      },
    },
    async (base) => {
      for (const extra of [
        { "x-request-id": ["one", "two"] },
        { "x-kokoro-request-id": "internal", "x-request-id": "public" },
        { "x-request-id": "has\ttab" },
      ]) {
        const result = await new Promise((resolve, reject) => {
          const req = httpRequest(`${base}/v1/skills/skill-1/package-upload`, { headers: { ...headers, ...extra } }, (response) => {
            const chunks = []
            response.on("data", (chunk) => chunks.push(chunk))
            response.once("end", () =>
              resolve({ status: response.statusCode, requestId: response.headers["x-request-id"], body: Buffer.concat(chunks).toString() }),
            )
          })
          req.once("error", reject)
          req.end()
        })
        assert.equal(result.status, 200, `${JSON.stringify(extra)} ${result.body}`)
        assert.match(result.requestId, /^[0-9a-f-]{36}$/u)
        assert.equal(seen.at(-1), result.requestId)
      }
    },
  )
  assert.equal(seen.length, 3)
})

test("candidate Get stays closed after IAM admission when catalog client is absent", async () =>
  withServer(null, async (base) => {
    const response = await fetch(`${base}/v1/skills/skill-1/package-upload`, { headers })
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      error: { code: "skill_dependency_unavailable", message: "Skill package Get candidate is unavailable", retryable: true },
    })
    assert.ok(response.headers.get("x-request-id"))
    assert.equal(response.headers.get("cache-control"), "no-store")
  }))

test("candidate Get rejects query, invalid ID and Idempotency-Key before Platform", async () => {
  let calls = 0
  const client = {
    getPackageUpload: async () => {
      calls++
      throw new Error("unexpected Platform call")
    },
  }
  await withServer(client, async (base) => {
    for (const [path, extra] of [
      ["/v1/skills/skill-1/package-upload?x=1", {}],
      ["/v1/skills/bad%20id/package-upload", {}],
      ["/v1/skills/skill-1/package-upload", { "Idempotency-Key": "wrong" }],
    ]) {
      const response = await fetch(`${base}${path}`, { headers: { ...headers, ...extra } })
      assert.equal(response.status, 400)
      assert.equal((await response.json()).error.code, "invalid_skill_request")
    }
    const { request } = await import("node:http")
    const bodyStatus = await new Promise((resolve, reject) => {
      const req = request(`${base}/v1/skills/skill-1/package-upload`, { method: "GET", headers: { ...headers, "content-length": "1" } }, (response) => {
        response.resume()
        resolve(response.statusCode)
      })
      req.once("error", reject)
      req.end("x")
    })
    assert.equal(bodyStatus, 400)
  })
  assert.equal(calls, 0)
})

test("candidate Get projects all owner phases with uint64 epoch as a decimal string", async () => {
  const cases = [
    [
      { attemptEpoch: 0n, phase: 1 },
      { attempt_epoch: "0", phase: "none" },
    ],
    [
      { attemptEpoch: 1n, phase: 2, attemptId: "attempt-1" },
      { attempt_epoch: "1", phase: "intent", attempt_id: "attempt-1" },
    ],
    [
      { attemptEpoch: 2n, phase: 3, attemptId: "attempt-2", uploadId: "upload-2" },
      { attempt_epoch: "2", phase: "upload_pending", attempt_id: "attempt-2", upload_id: "upload-2" },
    ],
    [
      { attemptEpoch: 3n, phase: 4, attemptId: "attempt-3", uploadId: "upload-3" },
      { attempt_epoch: "3", phase: "uploaded", attempt_id: "attempt-3", upload_id: "upload-3" },
    ],
    [
      { attemptEpoch: 9007199254740993n, phase: 5, attemptId: "attempt-4", uploadId: "upload-4" },
      { attempt_epoch: "9007199254740993", phase: "validated", attempt_id: "attempt-4", upload_id: "upload-4" },
    ],
    [
      { attemptEpoch: 4n, phase: 6, attemptId: "attempt-5" },
      { attempt_epoch: "4", phase: "aborted", attempt_id: "attempt-5" },
    ],
    [
      { attemptEpoch: 5n, phase: 6, attemptId: "attempt-6", uploadId: "upload-6" },
      { attempt_epoch: "5", phase: "aborted", attempt_id: "attempt-6", upload_id: "upload-6" },
    ],
  ]
  for (const [state, expected] of cases)
    await withServer({ getPackageUpload: async () => ({ skillId: { value: "skill-1" }, ...state }) }, async (base) => {
      const response = await fetch(`${base}/v1/skills/skill-1/package-upload`, { headers })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { data: { skill_id: "skill-1", ...expected } })
    })
})

test("candidate Get fails closed on invalid owner package state and never projects a partial success", async () => {
  const cases = [
    { attemptEpoch: 0n, phase: 1, attemptId: "attempt-1" },
    { attemptEpoch: 0n, phase: 1, uploadId: "upload-1" },
    { attemptEpoch: 0n, phase: 2, attemptId: "attempt-1" },
    { attemptEpoch: 1n, phase: 2 },
    { attemptEpoch: 1n, phase: 2, attemptId: "attempt-1", uploadId: "upload-1" },
    { attemptEpoch: 1n, phase: 3, attemptId: "attempt-1" },
    { attemptEpoch: 1n, phase: 5, attemptId: "attempt-1", uploadId: " " },
    { attemptEpoch: 1n, phase: 6 },
    { attemptEpoch: 1n, phase: 0 },
    { attemptEpoch: 18_446_744_073_709_551_616n, phase: 2, attemptId: "attempt-1" },
  ]
  for (const state of cases)
    await withServer({ getPackageUpload: async () => ({ skillId: { value: "skill-1" }, ...state }) }, async (base) => {
      const response = await fetch(`${base}/v1/skills/skill-1/package-upload`, { headers })
      assert.equal(response.status, 502)
      assert.equal((await response.json()).error.code, "skill_response_invalid")
    })
  await withServer({ getPackageUpload: async () => ({ skillId: { value: "foreign-skill" }, attemptEpoch: 0n, phase: 1 }) }, async (base) => {
    const response = await fetch(`${base}/v1/skills/skill-1/package-upload`, { headers })
    assert.equal(response.status, 502)
  })
})

test("candidate Get maps owner rejection without exposing tenant, credential or internal reason", async () => {
  const cases = [
    [Code.NotFound, 404, "skill_not_found"],
    [Code.PermissionDenied, 404, "skill_not_found"],
    [Code.FailedPrecondition, 412, "skill_precondition_failed"],
    [Code.ResourceExhausted, 429, "skill_rate_limited"],
    [Code.Unavailable, 503, "skill_dependency_unavailable"],
    [Code.Unauthenticated, 503, "skill_dependency_unavailable"],
    [Code.InvalidArgument, 502, "skill_response_invalid"],
  ]
  for (const [code, status, expected] of cases)
    await withServer(
      {
        getPackageUpload: async () => {
          throw new ConnectError("private-owner-reason", code)
        },
      },
      async (base) => {
        const response = await fetch(`${base}/v1/skills/skill-1/package-upload`, { headers })
        assert.equal(response.status, status)
        const body = await response.json()
        assert.deepEqual(Object.keys(body), ["error"])
        assert.equal(body.error.code, expected)
        assert.equal(JSON.stringify(body).includes("private-owner-reason"), false)
        assert.equal(response.headers.get("cache-control"), "no-store")
        assert.ok(response.headers.get("x-request-id"))
      },
    )
})

test("candidate Get re-admits each read and revoked session creates no new Platform I/O", async () => {
  let admissions = 0
  let platformCalls = 0
  const admission = {
    verify: async () => {
      admissions++
      return admissions === 1 ? { ok: true, identity: { namespace: "tenant", userId: "user" } } : { ok: false, status: 401, code: "session_invalid" }
    },
  }
  const client = {
    getPackageUpload: async () => {
      platformCalls++
      return { skillId: { value: "skill-1" }, attemptEpoch: 0n, phase: 1 }
    },
  }
  await withServer(
    client,
    async (base) => {
      assert.equal((await fetch(`${base}/v1/skills/skill-1/package-upload`, { headers })).status, 200)
      const revoked = await fetch(`${base}/v1/skills/skill-1/package-upload`, { headers })
      assert.equal(revoked.status, 401)
      assert.deepEqual(await revoked.json(), { error: { code: "session_invalid", message: "BFF user admission failed", retryable: false } })
      assert.equal(revoked.headers.get("cache-control"), "no-store")
    },
    admission,
  )
  assert.equal(admissions, 2)
  assert.equal(platformCalls, 1)
})

test("candidate Get denies a mismatched fixed Product tenant before Platform", async () => {
  let calls = 0
  await withServer(
    {
      getPackageUpload: async () => {
        calls++
        throw new Error("unexpected")
      },
    },
    async (base) => {
      const response = await fetch(`${base}/v1/skills/skill-1/package-upload`, { headers })
      assert.equal(response.status, 403)
      assert.equal((await response.json()).error.code, "product_tenant_forbidden")
    },
    new SessionAdmissionDouble({ session: { namespace: "foreign", userId: "user" } }),
  )
  assert.equal(calls, 0)
})

test("generated Get Connect client sends only catalog workload token and trusted user owner", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { CatalogConnectClient } = await import("../dist/infrastructure/clients/platform/catalog-connect.js")
  const { SkillCatalogService, SkillPackagePhase } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  let calls = 0
  const owner = createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(SkillCatalogService, {
          getSkillPackageUpload(request, context) {
            calls++
            assert.equal(context.requestHeader.get("authorization"), "Bearer catalog-machine")
            assert.equal(context.requestHeader.get("x-tenant-ref"), "tenant")
            assert.equal(request.requestId, "request-1")
            assert.equal(request.skillId?.value, "skill-1")
            assert.equal(request.productContext?.subjectId, "user")
            assert.equal(request.productContext?.ownerScope?.kind, "user")
            assert.equal(request.productContext?.ownerScope?.id, "user")
            return { skillId: { value: "skill-1" }, phase: SkillPackagePhase.NONE, attemptEpoch: 0n }
          },
        })
      },
    }),
  )
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  try {
    const client = new CatalogConnectClient(
      `http://127.0.0.1:${owner.address().port}`,
      {
        get: async (tenant) => {
          assert.equal(tenant, "tenant")
          return "catalog-machine"
        },
      },
      1000,
    )
    const result = await client.getPackageUpload({ requestId: "request-1", skillId: "skill-1", tenant: "tenant", user: "user" })
    assert.equal(result.phase, SkillPackagePhase.NONE)
    assert.equal(calls, 1)
  } finally {
    await new Promise((resolve) => owner.close(resolve))
  }
})
