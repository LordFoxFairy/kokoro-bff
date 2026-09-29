import assert from "node:assert/strict"
import { once } from "node:events"
import test from "node:test"
import { SkillStatus } from "../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
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
const headers = {
  authorization: "Bearer session",
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "secret",
  "content-type": "application/json",
  "idempotency-key": "draft-1",
}
async function withServer(client, run) {
  const server = createLiveTestBffServer(config, {
    sessionAdmission: new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "user" } }),
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

test("candidate stays closed after admission and exact route rejects query aliases", async () =>
  withServer(null, async (base) => {
    const closed = await fetch(`${base}/v1/skills/drafts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ display_name: "Tea", summary: "", tags: ["tea"] }),
    })
    assert.equal(closed.status, 503)
    assert.equal((await closed.json()).error.code, "skill_dependency_unavailable")
    const alias = await fetch(`${base}/v1/skills/drafts?x=1`, { method: "POST", headers, body: "{}" })
    assert.equal(alias.status, 404)
  }))

test("candidate emits exact 201 and forwards trusted owner identity", async () => {
  const calls = []
  await withServer(
    {
      create: async (input) => {
        calls.push(input)
        return { skillId: { value: "skill_1" }, seriesId: { value: "series_1" }, revision: 1n, status: SkillStatus.DRAFT, replayed: false }
      },
    },
    async (base) => {
      const response = await fetch(`${base}/v1/skills/drafts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ display_name: "Tea", summary: "", tags: ["tea"] }),
      })
      assert.equal(response.status, 201)
      assert.deepEqual(await response.json(), { data: { skill_id: "skill_1", series_id: "series_1", revision: 1, status: "draft", replayed: false } })
    },
  )
  assert.equal(calls[0].tenant, "tenant")
  assert.equal(calls[0].user, "user")
})

import { Code, ConnectError } from "@connectrpc/connect"

test("candidate maps every declared Connect failure without leaking machine auth", async () => {
  const cases = [
    [Code.AlreadyExists, 409, "skill_idempotency_conflict"],
    [Code.Aborted, 409, "skill_command_in_progress"],
    [Code.FailedPrecondition, 412, "skill_precondition_failed"],
    [Code.ResourceExhausted, 429, "skill_rate_limited"],
    [Code.Unauthenticated, 503, "skill_dependency_unavailable"],
    [Code.Unavailable, 503, "skill_dependency_unavailable"],
    [Code.DeadlineExceeded, 503, "skill_dependency_unavailable"],
    [Code.InvalidArgument, 502, "skill_response_invalid"],
  ]
  for (const [code, status, expected] of cases) {
    const metadata = new Headers(code === Code.ResourceExhausted ? { "retry-after": "12" } : {})
    await withServer(
      {
        create: async () => {
          throw new ConnectError("owner", code, metadata)
        },
      },
      async (base) => {
        const response = await fetch(`${base}/v1/skills/drafts`, {
          method: "POST",
          headers,
          body: JSON.stringify({ display_name: "Tea", summary: "", tags: [] }),
        })
        assert.equal(response.status, status)
        assert.equal((await response.json()).error.code, expected)
        if (code === Code.ResourceExhausted) assert.equal(response.headers.get("retry-after"), "12")
      },
    )
  }
})

test("candidate rejects invalid response identifiers as 502", async () =>
  withServer(
    { create: async () => ({ skillId: { value: "bad id" }, seriesId: { value: "series" }, revision: 1n, status: SkillStatus.DRAFT, replayed: false }) },
    async (base) => {
      const response = await fetch(`${base}/v1/skills/drafts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ display_name: "Tea", summary: "", tags: [] }),
      })
      assert.equal(response.status, 502)
      assert.equal((await response.json()).error.code, "skill_response_invalid")
    },
  ))

test("candidate enforces JSON content type and the 65,536 byte streaming boundary", async () =>
  withServer(
    {
      create: async () => {
        throw new Error("must not call")
      },
    },
    async (base) => {
      const wrong = await fetch(`${base}/v1/skills/drafts`, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" })
      assert.equal(wrong.status, 400)
      const large = await fetch(`${base}/v1/skills/drafts`, { method: "POST", headers, body: "x".repeat(65_537) })
      assert.equal(large.status, 413)
    },
  ))

test("generated CatalogConnectClient rejects a unary response larger than one MiB", async () => {
  const { createServer } = await import("node:http2")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { CatalogConnectClient } = await import("../dist/infrastructure/clients/platform/catalog-connect.js")
  const { SkillCatalogService, SkillStatus } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const ownerSessions = []
  const owner = createServer(
    connectNodeAdapter({
      writeMaxBytes: 2 * 1024 * 1024,
      routes(router) {
        router.service(SkillCatalogService, {
          createSkillDraft() {
            return { skillId: { value: "s".repeat(1024 * 1024 + 1) }, seriesId: { value: "series" }, revision: 1n, status: SkillStatus.DRAFT, replayed: false }
          },
        })
      },
    }),
  )
  owner.on("session", (session) => ownerSessions.push(session))
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  try {
    const client = new CatalogConnectClient(`http://127.0.0.1:${owner.address().port}`, { get: async () => "machine" }, 1000)
    await assert.rejects(
      client.create({ requestId: "r", commandId: "c", digest: "d".repeat(64), tenant: "tenant", user: "user", displayName: "Tea", summary: "", tags: [] }),
      (error) => error instanceof ConnectError && error.code === Code.ResourceExhausted && /readMaxBytes|larger than.*1048576/iu.test(error.message),
    )
  } finally {
    for (const session of ownerSessions) session.destroy()
    owner.close()
    owner.closeAllConnections?.()
  }
})

test("real BFF socket disconnect aborts the in-flight catalog stage before owner creation", async () => {
  const { request } = await import("node:http")
  let ownerCreates = 0
  let reachedResolve
  const reached = new Promise((resolve) => {
    reachedResolve = resolve
  })
  let observedAbortResolve
  const observedAbort = new Promise((resolve) => {
    observedAbortResolve = resolve
  })
  const client = {
    create: async (_input, signal) => {
      reachedResolve()
      await new Promise((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            observedAbortResolve()
            resolve()
          },
          { once: true },
        ),
      )
      if (!signal.aborted) ownerCreates += 1
      throw signal.reason
    },
  }
  await withServer(client, async (base) => {
    const url = new URL("/v1/skills/drafts", base)
    const req = request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: { ...headers, "content-length": Buffer.byteLength('{"display_name":"Tea","summary":"","tags":[]}') },
    })
    req.on("error", () => {})
    req.end('{"display_name":"Tea","summary":"","tags":[]}')
    await reached
    req.destroy()
    await observedAbort
    assert.equal(ownerCreates, 0)
  })
})

test("same-key replay always re-admits IAM and revoked replay performs zero additional Platform I/O", async () => {
  let admissions = 0
  let platformCalls = 0
  const admission = {
    verify: async () => {
      admissions += 1
      return admissions < 3 ? { ok: true, identity: { namespace: "tenant", userId: "user" } } : { ok: false, status: 401, code: "session_invalid" }
    },
  }
  const client = {
    create: async () => {
      platformCalls += 1
      return { skillId: { value: "skill" }, seriesId: { value: "series" }, revision: 1n, status: SkillStatus.DRAFT, replayed: platformCalls > 1 }
    },
  }
  const server = createLiveTestBffServer(config, { sessionAdmission: admission, skillDraftClient: client })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const init = { method: "POST", headers, body: JSON.stringify({ display_name: "Tea", summary: "", tags: [] }) }
    assert.equal((await fetch(`${base}/v1/skills/drafts`, init)).status, 201)
    assert.equal((await fetch(`${base}/v1/skills/drafts`, init)).status, 201)
    assert.equal((await fetch(`${base}/v1/skills/drafts`, init)).status, 401)
    assert.equal(admissions, 3)
    assert.equal(platformCalls, 2)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
