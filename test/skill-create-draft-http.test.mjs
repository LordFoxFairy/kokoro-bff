import { projectSkillProductCommand } from "../dist/infrastructure/clients/platform/create-skill-draft-projector.js"
import assert from "node:assert/strict"
import { once } from "node:events"
import test from "node:test"
import { SkillStatus } from "../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { createLiveTestBffServer } from "./doubles/server.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"

function catalogDigest(method, input) {
  return projectSkillProductCommand(
    JSON.stringify({
      command_digest_version: "3.0.0",
      fq_method: `kokoro.platform.v1.SkillCatalogService/${method}`,
      tenant_ref: input.tenant,
      request: {
        owner_scope: { kind: "user", id: input.user },
        product_context: { subject_id: input.user, owner_scope: { kind: "user", id: input.user } },
        ...(method === "CreateSkillVersion" ? { base_skill_id: { value: input.baseSkillId } } : {}),
        metadata: {
          display_name: input.displayName,
          summary: input.summary,
          tags: input.tags,
          metadata_json: "e30",
          ...(input.examplePrompts === undefined ? {} : { example_prompts: { prompts: input.examplePrompts } }),
        },
      },
    }),
    true,
  ).sha256
}
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
    skillAuthorization: { check: async () => ({ ok: true }) },
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
        return { stateVersion: 1n, skillId: { value: "skill_1" }, seriesId: { value: "series_1" }, revision: 1n, status: SkillStatus.DRAFT, replayed: false }
      },
    },
    async (base) => {
      const response = await fetch(`${base}/v1/skills/drafts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ display_name: "Tea", summary: "", tags: ["tea"], example_prompts: ["  Brew tea  ", "same", "same"] }),
      })
      assert.equal(response.status, 201)
      assert.deepEqual(await response.json(), {
        data: { state_version: "1", skill_id: "skill_1", series_id: "series_1", revision: 1, status: "draft", replayed: false },
      })
    },
  )
  assert.equal(calls[0].tenant, "tenant")
  assert.equal(calls[0].user, "user")
  assert.deepEqual(calls[0].examplePrompts, ["  Brew tea  ", "same", "same"])
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
    {
      create: async () => ({
        stateVersion: 1n,
        skillId: { value: "bad id" },
        seriesId: { value: "series" },
        revision: 1n,
        status: SkillStatus.DRAFT,
        replayed: false,
      }),
    },
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
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { CatalogConnectClient } = await import("../dist/infrastructure/clients/platform/catalog-connect.js")
  const { SkillCatalogService, SkillStatus } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const owner = createServer(
    connectNodeAdapter({
      writeMaxBytes: 2 * 1024 * 1024,
      routes(router) {
        router.service(SkillCatalogService, {
          createSkillDraft() {
            return {
              stateVersion: 1n,
              skillId: { value: "s".repeat(1024 * 1024 + 1) },
              seriesId: { value: "series" },
              revision: 1n,
              status: SkillStatus.DRAFT,
              replayed: false,
            }
          },
        })
      },
    }),
  )
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  try {
    const client = new CatalogConnectClient(`http://127.0.0.1:${owner.address().port}`, { get: async () => "machine" }, 1000)
    await assert.rejects(
      client.create({
        requestId: "r",
        commandId: "c",
        digest: catalogDigest("CreateSkillDraft", { tenant: "tenant", user: "user", displayName: "Tea", summary: "", tags: [] }),
        tenant: "tenant",
        user: "user",
        displayName: "Tea",
        summary: "",
        tags: [],
      }),
      (error) => error instanceof ConnectError && error.code === Code.ResourceExhausted && /readMaxBytes|larger than.*1048576/iu.test(error.message),
    )
  } finally {
    await new Promise((resolve) => owner.close(resolve))
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
      return {
        stateVersion: 1n,
        skillId: { value: "skill" },
        seriesId: { value: "series" },
        revision: 1n,
        status: SkillStatus.DRAFT,
        replayed: platformCalls > 1,
      }
    },
  }
  const server = createLiveTestBffServer(config, {
    skillAuthorization: { check: async () => ({ ok: true }) },
    sessionAdmission: admission,
    skillDraftClient: client,
  })
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

test("two real binary Catalog requests preserve absent, empty and original ordered examples", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { CatalogConnectClient } = await import("../dist/infrastructure/clients/platform/catalog-connect.js")
  const { SkillCatalogService } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const seen = []
  const owner = createServer(
    connectNodeAdapter({
      routes(router) {
        const capture = (request, context) => {
          context.responseHeader.set("x-kokoro-request-id", request.requestId)
          context.responseHeader.set("cache-control", "no-store")
          seen.push(request)
          return { stateVersion: 1n, skillId: { value: "new" }, seriesId: { value: "series" }, revision: 1n, status: SkillStatus.DRAFT, replayed: false }
        }
        router.service(SkillCatalogService, { createSkillDraft: capture, createSkillVersion: capture })
      },
    }),
  )
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  try {
    const client = new CatalogConnectClient(`http://127.0.0.1:${owner.address().port}`, { get: async () => "token" }, 1000)
    for (const method of ["create", "createPersonalVersion"]) {
      for (const examplePrompts of [undefined, [], ["  line\n", "same", "same"], ["😀".repeat(1000)]]) {
        const input = {
          requestId: "r",
          commandId: "c",
          digest: "d".repeat(64),
          tenant: "tenant",
          user: "user",
          baseSkillId: "base",
          displayName: "Tea",
          summary: "",
          tags: [],
          ...(examplePrompts === undefined ? {} : { examplePrompts }),
        }
        input.digest = catalogDigest(method === "create" ? "CreateSkillDraft" : "CreateSkillVersion", input)
        await client[method](input, new AbortController().signal, performance.now() + 1000)
        const metadata = seen.at(-1).metadata
        assert.deepEqual(metadata.examplePrompts?.prompts, examplePrompts)
        assert.equal(Buffer.from(metadata.metadataJson).toString("utf8"), "{}")
      }
    }
    assert.equal(seen.length, 8)
  } finally {
    owner.closeAllConnections()
    await new Promise((resolve) => owner.close(resolve))
  }
})

test("draft HTTP rejects invalid examples without dispatch and binds presence/order to digest", async () => {
  const calls = []
  await withServer(
    {
      create: async (input) => {
        calls.push(input)
        return { stateVersion: 1n, skillId: { value: "s" }, seriesId: { value: "series" }, revision: 1n, status: SkillStatus.DRAFT, replayed: false }
      },
    },
    async (base) => {
      for (const prompts of [null, {}, ["tail\ud800"], ["\u0000"], [...Array.from({ length: 8 }, () => "é".repeat(1000)), "é".repeat(192) + "a"]]) {
        const response = await fetch(`${base}/v1/skills/drafts`, {
          method: "POST",
          headers,
          body: JSON.stringify({ display_name: "Tea", summary: "", tags: [], example_prompts: prompts }),
        })
        assert.equal(response.status, 400)
        assert.equal(calls.length, 0)
      }
      for (const prompts of [undefined, [], ["a", "b"], ["b", "a"]]) {
        const response = await fetch(`${base}/v1/skills/drafts`, {
          method: "POST",
          headers,
          body: JSON.stringify({ display_name: "Tea", summary: "", tags: [], ...(prompts === undefined ? {} : { example_prompts: prompts }) }),
        })
        assert.equal(response.status, 201)
      }
    },
  )
  assert.equal(new Set(calls.map((c) => c.digest)).size, 4)
  assert.equal(Object.hasOwn(calls[0], "examplePrompts"), false)
})
