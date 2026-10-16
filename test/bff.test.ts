import { createServer, type Server } from "node:http"
import { existsSync, readFileSync } from "node:fs"
import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { fileURLToPath } from "node:url"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import type { BffConfig } from "../src/config/runtime.ts"
import { createLiveTestBffServer, createTestBffServer } from "./doubles/server.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const servers: Server[] = []

async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

function config(overrides: Partial<BffConfig> = {}): BffConfig {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "ns_test",
    iamBaseUrl: null,
    sharedSecret: "test-secret",
    upstreamSecret: "bff-upstream-secret",
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {
      system: null,
      platform: null,
      storage: null,
      scheduler: null,
      agents: null,
      billing: null,
      music: null,
    },
    ...overrides,
  }
}

function testServer(configValue: BffConfig, options: { moriAutoProgress?: boolean } = {}): Server {
  return createTestBffServer(configValue, options).server
}

function liveServer(configValue: BffConfig, options: Parameters<typeof createLiveTestBffServer>[1] = {}): Server {
  return createLiveTestBffServer(configValue, options)
}

function authHeaders(): Record<string, string> {
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    authorization: "Bearer test-session",
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe("kokoro-bff v1 mock contract", () => {
  it("exposes unauthenticated health and rejects browser calls to business routes", async () => {
    const base = await listen(testServer(config()))
    const health = await fetch(`${base}/healthz`)
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: "ok", service: "kokoro-bff", mode: "live" })

    const response = await fetch(`${base}/v1/projects`, { headers: { "x-domain": "evil.example" } })
    assert.equal(response.status, 403)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "service_auth_failed")
  })

  it("returns a versioned project projection and replays idempotent creation", async () => {
    const base = await listen(testServer(config()))
    const headers = { ...authHeaders(), "x-kokoro-request-id": "request-projects" }
    const list = await fetch(`${base}/v1/projects`, { headers })
    const listBody = (await list.json()) as { data: { projects: Array<{ id: string }> }; meta: { request_id: string } }
    assert.equal(list.status, 200)
    assert.equal(listBody.data.projects[0]?.id, "project_kokoro")
    assert.equal(listBody.meta.request_id, "request-projects")

    const createInit = {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "project-create-1" },
      body: JSON.stringify({ name: "Design system", description: "Shared business UI" }),
    }
    const first = await fetch(`${base}/v1/projects`, createInit)
    const second = await fetch(`${base}/v1/projects`, createInit)
    assert.equal(first.status, 200)
    assert.deepEqual(await first.json(), await second.json())

    const conflict = await fetch(`${base}/v1/projects`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "project-create-1" },
      body: JSON.stringify({ name: "Design system", description: "Different payload" }),
    })
    assert.equal(conflict.status, 409)
    assert.equal(((await conflict.json()) as { error: { code: string } }).error.code, "idempotency_conflict")
  })

  it("closes the project instruction read, update, and revision history flow", async () => {
    const base = await listen(testServer(config()))
    const projectId = "project_kokoro"
    const read = await fetch(`${base}/v1/projects/${projectId}`, { headers: authHeaders() })
    const readBody = (await read.json()) as {
      data: { project: { id: string; instruction: string } }
      meta: { request_id: string }
    }
    assert.equal(read.status, 200)
    assert.equal(readBody.data.project.id, projectId)
    assert.equal(typeof readBody.data.project.instruction, "string")

    const nextInstruction = "Keep all implementation notes scoped to this project."
    const missingKey = await fetch(`${base}/v1/projects/${projectId}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ instruction: nextInstruction }),
    })
    assert.equal(missingKey.status, 400)
    assert.equal(((await missingKey.json()) as { error: { code: string } }).error.code, "idempotency_key_required")

    const init = {
      method: "PATCH",
      headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "project-instruction-flow" },
      body: JSON.stringify({ instruction: nextInstruction }),
    }
    const updated = await fetch(`${base}/v1/projects/${projectId}`, init)
    const replayed = await fetch(`${base}/v1/projects/${projectId}`, init)
    assert.equal(updated.status, 200)
    assert.deepEqual(await updated.json(), await replayed.json())

    const afterUpdate = await fetch(`${base}/v1/projects/${projectId}`, { headers: authHeaders() })
    const afterUpdateBody = (await afterUpdate.json()) as { data: { project: { instruction: string } } }
    assert.equal(afterUpdateBody.data.project.instruction, nextInstruction)

    const revisions = await fetch(`${base}/v1/projects/${projectId}/instruction-revisions`, { headers: authHeaders() })
    const revisionsBody = (await revisions.json()) as {
      data: { items: Array<{ id: string; instruction: string; updated_at: string; actor_name: string; current: boolean }> }
      meta: { request_id: string }
    }
    assert.equal(revisions.status, 200)
    assert.ok(revisionsBody.data.items.length >= 2)
    assert.equal(revisionsBody.data.items[0]?.instruction, nextInstruction)
    assert.equal(revisionsBody.data.items[0]?.current, true)
    assert.ok(revisionsBody.data.items[0]?.id)
    assert.equal(typeof revisionsBody.data.items[0]?.updated_at, "string")
    assert.equal(typeof revisionsBody.data.items[0]?.actor_name, "string")
    assert.match(revisionsBody.data.items[0]?.updated_at ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
    assert.deepEqual(Object.keys(revisionsBody.data.items[0] ?? {}).sort(), ["actor_name", "current", "id", "instruction", "updated_at"])
    assert.ok(revisionsBody.meta.request_id.length > 0)
  })

  it("accepts project resource multipart mocks and replays the canonical success", async () => {
    const base = await listen(testServer(config()))
    const path = "/v1/projects/project_kokoro/resources"
    const missingKeyBody = new FormData()
    missingKeyBody.append("files", new Blob(["fixture bytes"], { type: "text/plain" }), "fixture.txt")
    const missingKey = await fetch(`${base}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: missingKeyBody,
    })
    assert.equal(missingKey.status, 400)
    assert.equal(((await missingKey.json()) as { error: { code: string } }).error.code, "idempotency_key_required")

    const makeBody = () => {
      const form = new FormData()
      form.append("files", new Blob(["fixture bytes"], { type: "text/plain" }), "fixture.txt")
      return form
    }
    const init = { method: "POST", headers: { ...authHeaders(), "idempotency-key": "project-resource-flow" }, body: makeBody() }
    const first = await fetch(`${base}${path}`, init)
    const second = await fetch(`${base}${path}`, init)
    const firstBody = (await first.json()) as { data: { ok: boolean } }
    const secondBody = (await second.json()) as { data: { ok: boolean } }
    assert.equal(first.status, 200)
    assert.deepEqual(firstBody, secondBody)
    assert.deepEqual(firstBody.data, { ok: true })
  })

  it("persists project skill state and creates scheduled tasks from snake_case Web input", async () => {
    const { createBffServer } = await import("../dist/bootstrap/server.js")
    const { MockBffStore } = await import("./doubles/bff-store.ts")
    const { MoriMockBffStore } = await import("./doubles/mori-store.ts")
    const { mockBusiness } = await import("./doubles/mock-route.ts")
    const { SessionAdmissionDouble } = await import("./doubles/session-admission.ts")
    const store = new MockBffStore(),
      mori = new MoriMockBffStore(true)
    const base = await listen(
      createBffServer(config(), {
        sessionAdmission: new SessionAdmissionDouble({ "test-session": { namespace: "ns_test", userId: "user_test" } }),
        businessStore: null,
        skillProductClient: {
          inspect: async (input: { sourceRef: string; tenant: string; subject: string }) => {
            assert.equal(input.tenant, "ns_test")
            assert.equal(input.subject, "user_test")
            assert.equal(input.sourceRef, "skill:skill-builder")
            return { sourceRef: { value: input.sourceRef }, revision: 1n, files: [] }
          },
        } as never,
        routeHandler: async ({ request, response, businessPath, context, json, mutation, idempotency }) =>
          mockBusiness(request, response, businessPath, context, store, mori, idempotency, mutation, json),
      }),
    )
    const projectId = "project_kokoro"
    const skillPath = `${base}/v1/projects/${projectId}/skills/skill-builder`
    const missingSkillKey = await fetch(skillPath, {
      method: "PATCH",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })
    assert.equal(missingSkillKey.status, 400)
    assert.equal(((await missingSkillKey.json()) as { error: { code: string } }).error.code, "idempotency_key_required")

    const disabled = await fetch(skillPath, {
      method: "PATCH",
      headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "project-skill-disable" },
      body: JSON.stringify({ enabled: false }),
    })
    const disabledBody = (await disabled.json()) as { data: { skill: { project_id: string; name: string; enabled: boolean } } }
    assert.equal(disabled.status, 200)
    assert.deepEqual(disabledBody.data.skill, { project_id: projectId, name: "skill-builder", enabled: false })

    const scheduled = await fetch(`${base}/v1/projects/${projectId}/scheduled-tasks`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "project-scheduled-flow" },
      body: JSON.stringify({
        title: "Daily briefing",
        prompt: "Summarize the project updates.",
        frequency: "daily",
        time: "08:00",
        timezone: "UTC",
        expires_at: "2026-02-01T00:00:00.000Z",
        auto_approve: true,
      }),
    })
    const scheduledBody = (await scheduled.json()) as {
      data: { task: { project_id: string; title: string; expires_at?: string; auto_approve: boolean } }
    }
    assert.equal(scheduled.status, 200)
    assert.equal(scheduledBody.data.task.project_id, projectId)
    assert.equal(scheduledBody.data.task.title, "Daily briefing")
    assert.equal(scheduledBody.data.task.expires_at, "2026-02-01T00:00:00.000Z")
    assert.equal(scheduledBody.data.task.auto_approve, true)
  })

  it("keeps Agent setup and Chat as BFF-owned projections", async () => {
    const base = await listen(testServer(config()))
    const response = await fetch(`${base}/v1/agents/connections/setup?platform=telegram`, { headers: authHeaders() })
    assert.equal(response.status, 200)
    const agentBody = (await response.json()) as { data: { platform: string; status: string }; meta: { request_id: string } }
    assert.equal(agentBody.data.platform, "telegram")
    assert.equal(agentBody.data.status, "disconnected")
    assert.ok(agentBody.meta.request_id.length > 0)

    const invalid = await fetch(`${base}/v1/agents/connections/setup?platform=irc`, { headers: authHeaders() })
    assert.equal(invalid.status, 400)
  })

  it("supports scheduled task mutations through the same business contract", async () => {
    const base = await listen(testServer(config()))
    const headers = { ...authHeaders(), "content-type": "application/json", "idempotency-key": "schedule-create-1" }
    const created = await fetch(`${base}/v1/scheduled-tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Daily review", prompt: "Review", frequency: "daily", time: "10:00", timezone: "UTC", auto_approve: false }),
    })
    assert.equal(created.status, 200)
    const createdBody = (await created.json()) as { data: { task: { id: string } } }
    const listed = await fetch(`${base}/v1/scheduled-tasks`, { headers: authHeaders() })
    assert.ok(((await listed.json()) as { data: { tasks: unknown[] } }).data.tasks.length >= 2)
    assert.match(createdBody.data.task.id, /^scheduled_/)
  })

  it("reports readyz from the actual mode and upstream configuration", async () => {
    const mockBase = await listen(testServer(config()))
    const mockReady = await fetch(`${mockBase}/readyz`)
    assert.equal(mockReady.status, 200)
    assert.deepEqual(await mockReady.json(), { status: "ok", service: "kokoro-bff", mode: "live" })

    const upstream = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { ok: true }, meta: { request_id: "readyz-live" } }))
    })
    const upstreamBase = await listen(upstream)
    const liveReadyBase = await listen(
      liveServer(
        config({
          mode: "live",
          upstreams: {
            system: upstreamBase,
            model: upstreamBase,
            capability: upstreamBase,
            storage: upstreamBase,
            scheduler: upstreamBase,
            agents: null,
            billing: upstreamBase,
          },
        }),
        {
          readiness: async (): Promise<void> => {
            throw new Error("database unavailable")
          },
        },
      ),
    )
    const liveReady = await fetch(`${liveReadyBase}/readyz`)
    assert.equal(liveReady.status, 503)
    assert.deepEqual(await liveReady.json(), { status: "ok", service: "kokoro-bff", mode: "live" })

    const liveAgentRoute = await fetch(`${liveReadyBase}/v1/sessions`, { headers: authHeaders() })
    assert.equal(liveAgentRoute.status, 503)
    assert.equal(((await liveAgentRoute.json()) as { error: { code: string } }).error.code, "business_store_not_configured")

    const livePartialBase = await listen(
      liveServer(
        config({
          mode: "live",
          upstreams: { ...config().upstreams, system: upstreamBase },
        }),
        {
          readiness: async (): Promise<void> => {
            throw new Error("database unavailable")
          },
        },
      ),
    )
    const livePartial = await fetch(`${livePartialBase}/readyz`)
    assert.equal(livePartial.status, 503)
  })

  it("previews a GitHub skill without requiring Idempotency-Key", async () => {
    const base = await listen(testServer(config())),
      originalFetch = globalThis.fetch
    const commit = "a".repeat(40),
      calls: string[] = [],
      zip = Buffer.from(
        "504b0304140000000000daa6485d153af49252000000520000000d000000726f6f742f534b494c4c2e6d642d2d2d0a6e616d653a205265616c20736b696c6c0a6465736372697074696f6e3a2041637475616c207061636b616765206d657461646174610a2d2d2d0a232041637475616c20536b696c6c20626f64790a504b01021403140000000000daa6485d153af49252000000520000000d0000000000000000000000800100000000726f6f742f534b494c4c2e6d64504b050600000000010001003b0000007d0000000000",
        "hex",
      )
    globalThis.fetch = async (url, init) => {
      const target = String(url)
      if (target.startsWith("http://127.0.0.1:")) return originalFetch(url, init)
      calls.push(target)
      if (target.endsWith("/commits/main")) return Response.json({ sha: commit })
      if (target.startsWith("https://codeload.github.com/")) return new Response(zip, { headers: { "content-type": "application/zip" } })
      assert.equal(target, "https://api.github.com/repos/acme/skill-pack")
      return Response.json({
        id: 1,
        private: false,
        full_name: "acme/skill-pack",
        html_url: "https://github.com/acme/skill-pack",
        owner: { login: "acme", html_url: "https://github.com/acme" },
        stargazers_count: 0,
        forks_count: 0,
        default_branch: "main",
      })
    }
    try {
      const response = await fetch(`${base}/v1/skills/github/preview`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ repository_url: "https://github.com/acme/skill-pack" }),
      })
      assert.equal(response.status, 200)
      const body = (await response.json()) as { data: { selector: unknown; metadata: unknown; selection_required: boolean } }
      assert.equal(body.data.selection_required, false)
      assert.deepEqual(body.data.selector, { owner: "acme", repository: "skill-pack", commit, path: "" })
      assert.deepEqual(body.data.metadata, { display_name: "Real skill", summary: "Actual package metadata", tags: [] })
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.ok(response.headers.get("x-request-id"))
      assert.deepEqual(calls, [
        "https://api.github.com/repos/acme/skill-pack",
        "https://api.github.com/repos/acme/skill-pack/commits/main",
        `https://codeload.github.com/acme/skill-pack/zip/${commit}`,
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("requires Idempotency-Key for GitHub skill import and replays the result", async () => {
    const { skillGithubImportRoute } = await import("../dist/http/routes/skill-github-import.js")
    const commit = "a".repeat(40),
      selector = { owner: "acme", repository: "skill-pack", commit, path: "" },
      zip = Buffer.from(
        "504b0304140000000000daa6485d153af49252000000520000000d000000726f6f742f534b494c4c2e6d642d2d2d0a6e616d653a205265616c20736b696c6c0a6465736372697074696f6e3a2041637475616c207061636b616765206d657461646174610a2d2d2d0a232041637475616c20536b696c6c20626f64790a504b01021403140000000000daa6485d153af49252000000520000000d0000000000000000000000800100000000726f6f742f534b494c4c2e6d64504b050600000000010001003b0000007d0000000000",
        "hex",
      )
    const originalFetch = globalThis.fetch
    let row: any = null,
      puts = 0,
      digest = "",
      providerCalls = 0
    const commands: string[] = [],
      creates: unknown[] = []
    const receipts = {
      getReceipt: async () => row,
      claimReceipt: async (_scope: string, fingerprint: string) => {
        row = { fingerprint, status: 102, body: {} }
        return { claimed: true, receipt: null }
      },
      compareAndSetReceipt: async (_scope: string, _fingerprint: string, expected: unknown, replacement: unknown) => {
        assert.deepEqual(row, expected)
        row = replacement
        return { updated: true, receipt: row }
      },
    }
    const client = {
      getPackageUpload: async () => ({ skillId: { value: "imported" }, attemptId: "attempt", uploadId: "upload", attemptEpoch: 1n }),
      command: async (operation: string, _identity: unknown, members: any) => {
        commands.push(operation)
        if (operation === "createSkillDraft") {
          creates.push(members)
          assert.equal(members.metadata.display_name, "Real skill")
          assert.equal(members.creation_provenance.github.asset_ref, undefined)
          return { skillId: { value: "imported" }, status: 1, revision: 1n, stateVersion: 7n }
        }
        if (operation === "beginSkillPackageUpload") {
          assert.equal(members.expected_state_version, "7")
          digest = members.content_sha256
          return {
            skillId: { value: "imported" },
            attemptId: "attempt",
            uploadId: "upload",
            attemptEpoch: 1n,
            stateVersion: 8n,
            transferReference: {
              url: "http://object.test/put",
              method: "PUT",
              requiredHeaders: { "content-type": "application/zip" },
              expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60), nanos: 0 },
            },
          }
        }
        if (operation === "completeSkillPackageUpload") {
          assert.equal(row.body.stage, "selected")
          assert.equal(members.source_version_id, "OPAQUE+/=")
          return { skillId: { value: "imported" }, scanState: 2, contentSha256: digest, stateVersion: 9n }
        }
        assert.equal(operation, "validateSkillDraft")
        return { skillId: { value: "imported" }, valid: true, contentDigest: digest, manifestIdentity: `zip-v2:sha256:${digest}`, stateVersion: 10n }
      },
    }
    globalThis.fetch = async (url, init) => {
      const target = String(url)
      if (target.startsWith("http://127.0.0.1:")) return originalFetch(url, init)
      if (target === "http://object.test/put") {
        puts++
        return new Response(null, { status: 200, headers: { "x-amz-version-id": "OPAQUE+/=" } })
      }
      providerCalls++
      if (target.endsWith(`/commits/${commit}`)) return Response.json({ sha: commit })
      if (target.startsWith("https://codeload.github.com/")) return new Response(zip, { headers: { "content-type": "application/zip" } })
      assert.equal(target, "https://api.github.com/repos/acme/skill-pack")
      return Response.json({
        id: 1,
        private: false,
        full_name: "acme/skill-pack",
        html_url: "https://github.com/acme/skill-pack",
        owner: { login: "acme", html_url: "https://github.com/acme" },
        stargazers_count: providerCalls,
        forks_count: 0,
      })
    }
    const base = await listen(
      createServer((request, response) => {
        void skillGithubImportRoute(
          request,
          response,
          { requestId: "import-id", identity: { namespace: "ns_test", userId: "user_test" } },
          config({ storage: { objectOrigin: "http://object.test" } as never }),
          receipts as never,
          client as never,
          async () => {},
        )
      }),
    )
    try {
      const missingKey = await fetch(`${base}/v1/skills/github/import`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify(selector),
      })
      assert.equal(missingKey.status, 400)
      assert.equal(providerCalls, 0)
      const forged = await fetch(`${base}/v1/skills/github/import`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "k" },
        body: JSON.stringify({ ...selector, metadata: { display_name: "Fake" } }),
      })
      assert.equal(forged.status, 400)
      assert.equal(providerCalls, 0)
      const init = { method: "POST", headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "k" }, body: JSON.stringify(selector) }
      const first = await fetch(`${base}/v1/skills/github/import`, init),
        firstBody = await first.json()
      assert.equal(first.status, 201)
      const second = await fetch(`${base}/v1/skills/github/import`, init)
      assert.equal(second.status, 201)
      assert.deepEqual(await second.json(), firstBody)
      assert.equal(puts, 1)
      assert.equal(commands.filter((x) => x === "completeSkillPackageUpload").length, 1)
      assert.equal(commands.filter((x) => x === "validateSkillDraft").length, 1)
      assert.equal(creates.length, 1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("rejects non-GitHub URLs for GitHub skill preview and import", async () => {
    const base = await listen(liveServer(config(), { skillAuthorization: { check: async () => ({ ok: true }) } }))
    for (const path of ["preview", "import"]) {
      const response = await fetch(`${base}/v1/skills/github/${path}`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json", ...(path === "import" ? { "idempotency-key": "github-import-invalid" } : {}) },
        body: JSON.stringify({ repository_url: "https://example.com/acme/skill-pack" }),
      })
      assert.equal(response.status, 400)
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, "invalid_skill_request")
    }
  })

  it("completes the skill quota, revision, and toggle mock flow", async () => {
    const base = await listen(testServer(config()))
    const quotaResponse = await fetch(`${base}/v1/skills/quota`, {
      headers: { ...authHeaders(), "x-kokoro-request-id": "skills-quota-request" },
    })
    const quotaBody = (await quotaResponse.json()) as {
      data: {
        namespace: string
        package_count: number
        package_bytes: number
        max_packages: number
        max_bytes: number
      }
      meta: { request_id: string }
    }
    assert.equal(quotaResponse.status, 200)
    assert.equal(quotaBody.data.namespace, "ns_test")
    assert.ok(Number.isInteger(quotaBody.data.package_count))
    assert.ok(Number.isInteger(quotaBody.data.package_bytes))
    assert.ok(Number.isInteger(quotaBody.data.max_packages))
    assert.ok(Number.isInteger(quotaBody.data.max_bytes))
    assert.equal(quotaBody.meta.request_id, "skills-quota-request")

    const revisionsResponse = await fetch(`${base}/v1/skills/contract-review/revisions?scope=official`, {
      headers: authHeaders(),
    })
    const revisionsBody = (await revisionsResponse.json()) as {
      data: { revisions: Array<Record<string, unknown>> }
      meta: { request_id: string }
    }
    assert.equal(revisionsResponse.status, 200)
    assert.equal(revisionsBody.data.revisions.length, 1)
    assert.deepEqual(revisionsBody.data.revisions[0], {
      scope: "official",
      name: "contract-review",
      revision: 1,
      content_hash: "sha256:fixture-contract-review",
      package_size: 122880,
      source: "mock",
      created_at: 1767225600,
    })
    assert.ok(revisionsBody.meta.request_id.length > 0)

    const toggleHeaders = {
      ...authHeaders(),
      "idempotency-key": "skills-toggle-contract-review-disable",
    }
    const disabled = await fetch(`${base}/v1/skills/contract-review/disable?scope=official`, {
      method: "POST",
      headers: toggleHeaders,
    })
    assert.equal(disabled.status, 404)

    const enabled = await fetch(`${base}/v1/skills/contract-review/enable?scope=official`, {
      method: "POST",
      headers: { ...authHeaders(), "idempotency-key": "skills-toggle-contract-review-enable" },
    })
    assert.equal(enabled.status, 404)
  })

  it("requires explicit Library kind after admission and does not mistake an HTTP upstream for the Storage Connect adapter", async () => {
    let connections = 0
    let requests = 0
    const upstream = createServer((_request, response) => {
      requests += 1
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { items: [] } }))
    })
    upstream.on("connection", () => {
      connections += 1
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(liveServer(config({ mode: "live", upstreams: { ...config().upstreams, storage: upstreamBase } })))

    const unauthenticated = await fetch(`${base}/v1/library`, { headers: { "x-kokoro-request-id": "library-unauthenticated" } })
    assert.equal(unauthenticated.status, 403)
    assert.equal(((await unauthenticated.json()) as { error: { code: string } }).error.code, "service_auth_failed")

    const response = await fetch(`${base}/v1/library`, { headers: { ...authHeaders(), "x-domain": "evil.example", "x-kokoro-request-id": "library-live" } })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      error: {
        code: "invalid_library_kind",
        message: "Personal library files could not be read",
      },
      meta: { request_id: "library-live" },
    })
    assert.equal(response.headers.get("x-request-id"), "library-live")

    const validButUnconfigured = await fetch(`${base}/v1/library?kind=file`, {
      headers: { ...authHeaders(), "x-kokoro-request-id": "library-unconfigured" },
    })
    assert.equal(validButUnconfigured.status, 503)
    assert.deepEqual(await validButUnconfigured.json(), {
      error: {
        code: "storage_unavailable",
        message: "Personal library files could not be read",
      },
      meta: { request_id: "library-unconfigured" },
    })

    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(connections, 0)
    assert.equal(requests, 0)
  })

  it("projects the canonical runtime manifest through System using configured tenant context", async () => {
    let received: {
      url: string | undefined
      service: string | undefined
      secret: string | undefined
      forwarded: string | undefined
      tenant: string | undefined
      subject: string | undefined
      actor: string | undefined
      authorization: string | undefined
    } = {
      url: undefined,
      service: undefined,
      secret: undefined,
      forwarded: undefined,
      tenant: undefined,
      subject: undefined,
      actor: undefined,
      authorization: undefined,
    }
    const upstream = createServer((request, response) => {
      received = {
        url: request.url,
        service: request.headers["x-kokoro-service"]?.toString(),
        secret: request.headers["x-kokoro-internal-secret"]?.toString(),
        forwarded: request.headers.forwarded?.toString(),
        tenant: request.headers["x-kokoro-tenant-id"]?.toString(),
        subject: request.headers["x-kokoro-subject"]?.toString(),
        actor: request.headers["x-kokoro-actor-id"]?.toString(),
        authorization: request.headers.authorization?.toString(),
      }
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          data: {
            tenant_id: "tenant_manifest",
            product_id: "kokoro",
            locale: "en-US",
            navigation: [],
            locale_namespaces: [],
            theme: {},
            feature_flags: [],
            references: [],
            config_version: "1",
            release_id: null,
            digest: "sha256:manifest",
          },
        }),
      )
    })
    const upstreamBase = await listen(upstream)
    const runtimeConfig = config({ mode: "live", upstreams: { ...config().upstreams, system: upstreamBase } }) as BffConfig & { tenantId: string }
    runtimeConfig.tenantId = "tenant_manifest"
    const base = await listen(liveServer(runtimeConfig))

    const response = await fetch(`${base}/v1/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=user-web`, {
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "test-secret",
        "x-kokoro-request-id": "manifest-live",
        authorization: "Bearer irrelevant-user-session",
      },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(received, {
      url: "/v1/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=user-web",
      service: "web-bff",
      secret: "bff-upstream-secret",
      forwarded: "host=dev.kokoro.localhost",
      tenant: "tenant_manifest",
      subject: undefined,
      actor: undefined,
      authorization: "Bearer bff-upstream-secret",
    })
    assert.deepEqual(await response.json(), {
      data: {
        tenant_id: "tenant_manifest",
        product_id: "kokoro",
        locale: "en-US",
        navigation: [],
        locale_namespaces: [],
        theme: {},
        feature_flags: [],
        references: [],
        config_version: "1",
        release_id: null,
        digest: "sha256:manifest",
      },
      meta: { request_id: "manifest-live" },
    })
  })

  it("projects the Model catalog through its owner contract", async () => {
    const received: {
      url: string | undefined
      service: string | undefined
      tenant: string | undefined
      subject: string | undefined
      requestId: string | undefined
      permissions: string | undefined
    } = {
      url: undefined,
      service: undefined,
      tenant: undefined,
      subject: undefined,
      requestId: undefined,
      permissions: undefined,
    }
    const upstream = createServer((request, response) => {
      received.url = request.url
      received.service = request.headers["x-kokoro-service"]?.toString()
      received.tenant = request.headers["x-kokoro-tenant-id"]?.toString()
      received.subject = request.headers["x-kokoro-subject"]?.toString()
      received.requestId = request.headers["x-request-id"]?.toString()
      received.permissions = request.headers["x-kokoro-iam-permissions"]?.toString()
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          data: {
            items: [{ key: "claude-sonnet", display_name: "Claude Sonnet", is_default: true }],
            next_cursor: "model-cursor-next",
          },
        }),
      )
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(
      liveServer(
        config({
          mode: "live",
          upstreams: { ...config().upstreams, system: upstreamBase },
        }),
      ),
    )

    const response = await fetch(`${base}/v1/models?feature_key=chat&limit=20&cursor=cursor-1`, {
      headers: { ...authHeaders(), "x-kokoro-request-id": "model-owner-request" },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      data: { models: [{ provider: "kokoro", name: "claude-sonnet", is_default: true, display_name: "Claude Sonnet" }], next_cursor: "model-cursor-next" },
      meta: { request_id: "model-owner-request" },
    })
    assert.deepEqual(received, {
      url: "/v1/system/model-catalog/catalog?feature_key=chat&limit=20&cursor=cursor-1",
      service: "web-bff",
      tenant: "ns_test",
      subject: "user_test",
      requestId: "model-owner-request",
      permissions: undefined,
    })
  })

  it("rejects model catalog items with a missing or non-boolean default marker", async () => {
    for (const ownerBody of [
      { data: { items: [{ key: "model-a", display_name: "Model A" }], next_cursor: null } },
      { data: { items: [{ key: "model-a", display_name: "Model A", is_default: "true" }], next_cursor: null } },
      { data: { items: [{ key: "model-a", display_name: "Model A", is_default: false }] } },
      { items: [{ key: "model-a", display_name: "Model A", is_default: false }], next_cursor: null },
      { data: { items: [{ key: "model-a", display_name: "Model A", is_default: false }], next_cursor: null }, meta: { request_id: "legacy" } },
    ]) {
      const upstream = createServer((_request, response) => {
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify(ownerBody))
      })
      const upstreamBase = await listen(upstream)
      const base = await listen(liveServer(config({ upstreams: { ...config().upstreams, system: upstreamBase } })))
      const response = await fetch(`${base}/v1/models?feature_key=chat`, { headers: { ...authHeaders(), "x-kokoro-request-id": "invalid-model-owner" } })
      assert.equal(response.status, 502)
      const responseBody = (await response.json()) as { error: { code: string }; meta: { request_id: string } }
      assert.equal(responseBody.error.code, "upstream_response_invalid")
      assert.equal(responseBody.meta.request_id, "invalid-model-owner")
      assert.equal("data" in responseBody, false)
    }
  })

  it("rejects malformed System errors and runtime manifests for another trusted tenant", async () => {
    for (const ownerResponse of [
      { status: 403, body: { error: { code: "forbidden", message: "denied" } } },
      { status: 403, body: { error: { code: "forbidden", message: "denied", retryable: "false" } } },
      {
        status: 201,
        body: {
          data: {
            tenant_id: "tenant_manifest",
            product_id: "kokoro",
            locale: "en-US",
            navigation: [],
            locale_namespaces: [],
            theme: {},
            feature_flags: [],
            references: [],
            config_version: "1",
            release_id: null,
            digest: "sha256:manifest",
          },
        },
      },
      {
        status: 302,
        body: {
          data: {
            tenant_id: "tenant_manifest",
            product_id: "kokoro",
            locale: "en-US",
            navigation: [],
            locale_namespaces: [],
            theme: {},
            feature_flags: [],
            references: [],
            config_version: "1",
            release_id: null,
            digest: "sha256:manifest",
          },
        },
      },
      {
        status: 200,
        body: {
          data: {
            tenant_id: "tenant_other",
            product_id: "kokoro",
            locale: "en-US",
            navigation: [],
            locale_namespaces: [],
            theme: {},
            feature_flags: [],
            references: [],
            config_version: "1",
            release_id: null,
            digest: "sha256:manifest",
          },
        },
      },
    ]) {
      const upstream = createServer((_request, response) => {
        response.statusCode = ownerResponse.status
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify(ownerResponse.body))
      })
      const upstreamBase = await listen(upstream)
      const runtimeConfig = config({ upstreams: { ...config().upstreams, system: upstreamBase } }) as BffConfig & { tenantId: string }
      runtimeConfig.tenantId = "tenant_manifest"
      const base = await listen(liveServer(runtimeConfig))
      const response = await fetch(`${base}/v1/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=user-web`, {
        headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret", "x-kokoro-request-id": "invalid-system-owner" },
      })
      assert.equal(response.status, 502)
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, "upstream_response_invalid")
    }
  })

  it("projects v2 Billing catalog while checkout remains unavailable", async () => {
    const received: Array<{ url: string | undefined; body: string; service: string | undefined }> = []
    const upstream = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      request.on("end", () => {
        received.push({ url: request.url, body: Buffer.concat(chunks).toString("utf8"), service: request.headers["x-kokoro-service"]?.toString() })
        response.setHeader("content-type", "application/json")
        if (request.url?.startsWith("/v2/commerce/catalog?")) {
          response.end(
            JSON.stringify({
              data: {
                items: [
                  {
                    offer_revision_id: "11111111-1111-4111-8111-111111111111",
                    offer_key: "pro",
                    name: "Pro",
                    currency_code: "USD",
                    amount_minor: "1999",
                    credit_micros: "1000000",
                    billing_interval: "month",
                  },
                ],
                page: { next_cursor: null },
              },
            }),
          )
          return
        }
        response.statusCode = 201
        response.end(
          JSON.stringify({ data: { checkout_id: "checkout-1", checkout_url: "https://pay.test/checkout-1" }, meta: { request_id: "billing-checkout" } }),
        )
      })
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(
      liveServer(
        config({
          mode: "live",
          billingServiceToken: "billing-service-token",
          upstreams: { ...config().upstreams, billing: upstreamBase },
        }),
      ),
    )

    const plans = await fetch(`${base}/v1/billing/plans`, { headers: { ...authHeaders(), "x-kokoro-request-id": "billing-catalog" } })
    assert.equal(plans.status, 200)
    assert.deepEqual(await plans.json(), {
      data: {
        plans: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            key: "pro",
            name: "Pro",
            currency: "USD",
            amount_minor: "1999",
            credit_micros: "1000000",
            billing_interval: "month",
          },
        ],
      },
      meta: { request_id: "billing-catalog" },
    })

    const checkout = await fetch(`${base}/v1/billing/checkout`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "billing-checkout-key", "x-kokoro-request-id": "billing-checkout" },
      body: JSON.stringify({ plan_id: "offer-revision-1" }),
    })
    assert.equal(checkout.status, 503)
    assert.deepEqual(await checkout.json(), {
      error: { code: "billing_unavailable", message: "Billing checkout is unavailable" },
      meta: { request_id: "billing-checkout" },
    })
    assert.equal(received[0]?.url, "/v2/commerce/catalog?limit=100")
    assert.equal(received[0]?.service, "web-bff")
    assert.equal(received.length, 1)
  })
  it("projects the admitted subject's fixed Credit account and ledger without a fake balance", async () => {
    const received: Array<{ url: string | undefined; authorization: string | undefined; tenant: string | undefined; subject: string | undefined }> = []
    const upstream = createServer((request, response) => {
      received.push({
        url: request.url,
        authorization: request.headers.authorization,
        tenant: request.headers["x-kokoro-tenant-id"]?.toString(),
        subject: request.headers["x-kokoro-subject"]?.toString(),
      })
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "billing-owner" })
      if (request.url === "/v2/billing/me/credit-account") {
        response.end(
          JSON.stringify({
            data: {
              credit_account_id: "11111111-1111-4111-8111-111111111111",
              status: "active",
              available_micros: "42000000",
              held_micros: "1500000",
            },
          }),
        )
        return
      }
      response.end(JSON.stringify({ data: { items: [], page: { next_cursor: null } } }))
    })
    const upstreamBase = await listen(upstream)
    const runtimeConfig = {
      ...config({ upstreams: { ...config().upstreams, billing: upstreamBase } }),
      upstreamSecret: "billing-internal-secret",
      billingServiceToken: "billing-service-token",
    } as BffConfig
    const base = await listen(liveServer(runtimeConfig))

    const summary = await fetch(`${base}/v1/billing/summary`, { headers: { ...authHeaders(), "x-kokoro-request-id": "billing-summary" } })
    assert.equal(summary.status, 200)
    assert.equal(summary.headers.get("cache-control"), "no-store")
    assert.deepEqual(await summary.json(), {
      data: {
        credit_account_id: "11111111-1111-4111-8111-111111111111",
        status: "active",
        available_micros: "42000000",
        held_micros: "1500000",
      },
      meta: { request_id: "billing-summary" },
    })
    const ledger = await fetch(`${base}/v1/billing/ledger?limit=50`, { headers: { ...authHeaders(), "x-kokoro-request-id": "billing-ledger" } })
    assert.equal(ledger.status, 200)
    assert.deepEqual(await ledger.json(), { data: { items: [], page: { next_cursor: null } }, meta: { request_id: "billing-ledger" } })
    assert.deepEqual(received, [
      { url: "/v2/billing/me/credit-account", authorization: "Bearer billing-service-token", tenant: "u1.bnNfdGVzdA", subject: "u1.dXNlcl90ZXN0" },
      { url: "/v2/billing/me/credit-ledger?limit=50", authorization: "Bearer billing-service-token", tenant: "u1.bnNfdGVzdA", subject: "u1.dXNlcl90ZXN0" },
    ])
  })

  it("does not misroute BFF-owned projects or scheduled definitions to an owner", async () => {
    const upstream = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { items: [] }, meta: { request_id: "should-not-be-called" } }))
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(
      liveServer(
        config({
          mode: "live",
          upstreams: { ...config().upstreams, system: upstreamBase, scheduler: upstreamBase },
        }),
      ),
    )

    for (const path of ["/v1/projects", "/v1/scheduled-tasks"]) {
      const response = await fetch(`${base}${path}`, { headers: authHeaders() })
      assert.equal(response.status, 503)
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, "business_store_not_configured")
    }
  })

  it("covers auth failures, idempotency conflicts, live normalization, and docs coverage", async () => {
    const unauthBase = await listen(liveServer(config()))
    const missingService = await fetch(`${unauthBase}/v1/projects`)
    assert.equal(missingService.status, 403)
    assert.equal(((await missingService.json()) as { error: { code: string } }).error.code, "service_auth_failed")

    const secretlessBase = await listen(liveServer(config({ sharedSecret: null })))
    const missingServiceOnSecretless = await fetch(`${secretlessBase}/v1/projects`, {
      headers: {
        authorization: "Bearer test-session",
      },
    })
    assert.equal(missingServiceOnSecretless.status, 403)

    const wrongSecret = await fetch(`${unauthBase}/v1/projects`, {
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "wrong",
        authorization: "Bearer test-session",
      },
    })
    assert.equal(wrongSecret.status, 403)

    const missingBearer = await fetch(`${unauthBase}/v1/projects`, {
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "test-secret",
      },
    })
    assert.equal(missingBearer.status, 401)

    const baseDir = fileURLToPath(new URL("../docs/api/v1/", import.meta.url))
    for (const file of ["README.md", "projects.md", "system.md", "models.md", "skills.md", "mcp.md", "scheduled.md", "agents.md", "library.md", "billing.md"]) {
      assert.equal(existsSync(`${baseDir}/${file}`), true, file)
    }

    const openapi = readFileSync(fileURLToPath(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url)), "utf8")
    assert.ok(!openapi.includes("/v1/skills/quota"))
    assert.ok(!openapi.includes("/v1/skills/{name}/revisions"))
    for (const path of [
      "/v1/projects",
      "/v1/projects/{projectId}",
      "/v1/projects/{projectId}/tasks",
      "/v1/projects/{projectId}/instruction-revisions",
      "/v1/projects/{projectId}/resources",
      "/v1/projects/{projectId}/skills/{skill}",
      "/v1/projects/{projectId}/scheduled-tasks",
      "/v1/skill.list",
      "/v1/skill-installations",
      "/v1/skill-installations/{installation_id}",
      "/v1/skill-installations/{installation_id}/enabled",
      "/v1/skills/github/preview",
      "/v1/skills/github/import",
      "/v1/mcp/servers",
      "/v1/scheduled-tasks",
      "/v1/scheduled-tasks/{id}",
      "/v1/scheduled-tasks/{id}/retry",
      "/v1/agents/connections/setup",
      "/v1/sessions",
      "/v1/models",
      "/v1/system/runtime-manifest",
      "/v1/sessions/{id}",
      "/v1/sessions/{id}/messages",
      "/v1/sessions/{id}/events",
      "/v1/sessions/{id}/runs/{runId}/control",
      "/v1/sessions/{id}/title",
      "/v1/sessions/{id}",
      "/v1/sessions/{id}/share",
      "/v1/shared/{shareId}",
      "/v1/library",
      "/v1/billing/plans",
      "/v1/billing/summary",
      "/v1/billing/checkout",
    ]) {
      assert.ok(openapi.includes(path), path)
    }
  })

  it("serves the chat session mock contract across list, detail, messages, events, control, title, delete, and share", async () => {
    const base = await listen(testServer(config()))
    const headers = authHeaders()

    const list = await fetch(`${base}/v1/sessions`, { headers })
    assert.equal(list.status, 200)
    const listBody = (await list.json()) as {
      data: { sessions: Array<{ session_id: string; title: string; updated_at: string }>; next_cursor: string | null }
      meta: { request_id: string }
    }
    assert.ok(listBody.data.sessions.length >= 1)
    assert.equal(listBody.data.next_cursor, null)

    const sessionId = listBody.data.sessions[0]?.session_id
    assert.ok(sessionId)

    const isolated = await fetch(`${base}/v1/sessions?scope=other-scope&project_ref=project_kokoro`, { headers })
    assert.equal(isolated.status, 400)
    assert.equal(((await isolated.json()) as { error: { code: string } }).error.code, "invalid_session_scope")

    const detail = await fetch(`${base}/v1/sessions/${sessionId}`, { headers })
    assert.equal(detail.status, 200)
    const detailBody = (await detail.json()) as {
      data: {
        session: { session_id: string; title: string; owner_id: string; created_at: string; updated_at: string }
        messages?: Array<{ message_id: string; role: string; content: string; status: string; created_at: string; run_id?: string }>
        active_run?: { run_id: string; status: string }
        pending_pauses: unknown[]
        files: unknown[]
        deliveries: unknown[]
        deliveries_has_more: boolean
        event_watermark: string | null
      }
      meta: { request_id: string }
    }
    assert.equal(detailBody.data.session.session_id, sessionId)
    assert.equal(detailBody.data.session.owner_id, "ns_test")
    assert.match(detailBody.data.event_watermark ?? "", /^agui_[0-9a-f]{32}$/u)
    assert.equal(detailBody.data.pending_pauses.length, 0)
    assert.equal(detailBody.data.files.length, 0)
    assert.equal(detailBody.data.deliveries.length, 0)
    assert.equal(detailBody.data.deliveries_has_more, false)

    const message = await fetch(`${base}/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "chat-message-1" },
      body: JSON.stringify({ content: "Hello from mock chat" }),
    })
    assert.equal(message.status, 202)
    const messageBody = (await message.json()) as {
      data: { run_id: string; user_message_id: string; assistant_message_id: string }
      meta: { request_id: string }
    }
    assert.ok(messageBody.data.run_id.length > 0)
    assert.ok(messageBody.data.user_message_id.length > 0)
    assert.ok(messageBody.data.assistant_message_id.length > 0)

    await new Promise((resolve) => setTimeout(resolve, 30))
    const messagePage = await fetch(`${base}/v1/sessions/${sessionId}/messages?limit=1`, { headers })
    assert.equal(messagePage.status, 200)
    const messagePageBody = (await messagePage.json()) as { data: { messages: Array<{ role: string }>; next_cursor: string | null } }
    assert.equal(messagePageBody.data.messages.length, 1)
    assert.equal(messagePageBody.data.messages[0]?.role, "user")
    assert.ok(messagePageBody.data.next_cursor)

    const events = await fetch(`${base}/v1/sessions/${sessionId}/events`, { headers })
    assert.equal(events.status, 200)
    assert.ok((events.headers.get("content-type") || "").startsWith("text/event-stream"))
    const eventsText = await events.text()
    const frames = eventsText.trim().split(/\n\n/u).filter(Boolean)
    assert.ok(frames.length >= 2)
    assert.match(frames[0] || "", /"type":"CUSTOM"/u)
    const firstFrameData =
      frames[0]
        ?.split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length) || ""
    const firstEvent = JSON.parse(firstFrameData) as { name: string; value: { owner_id: string } }
    assert.equal(firstEvent.name, "kokoro.session.created")
    assert.equal(firstEvent.value.owner_id, "ns_test")
    const firstFrameId = frames[0]
      ?.split("\n")
      .find((line) => line.startsWith("id: "))
      ?.slice("id: ".length)
    assert.match(firstFrameId ?? "", /^agui_[0-9a-f]{32}$/u)
    const resumedEvents = await fetch(`${base}/v1/sessions/${sessionId}/events`, {
      headers: { ...headers, "last-event-id": firstFrameId ?? "" },
    })
    assert.equal(resumedEvents.status, 200)
    const resumedFrames = (await resumedEvents.text()).trim().split(/\n\n/u).filter(Boolean)
    assert.deepEqual(resumedFrames, frames.slice(1))
    const invalidEventCursor = await fetch(`${base}/v1/sessions/${sessionId}/events`, {
      headers: { ...headers, "last-event-id": "4" },
    })
    assert.equal(invalidEventCursor.status, 400)
    assert.equal(((await invalidEventCursor.json()) as { error: { code: string } }).error.code, "invalid_event_cursor")

    const control = await fetch(`${base}/v1/sessions/${sessionId}/runs/${messageBody.data.run_id}/control`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "chat-control-1" },
      body: JSON.stringify({ kind: "run.cancel" }),
    })
    assert.equal(control.status, 202)
    const controlBody = (await control.json()) as {
      data: { run_id: string; command_id: string; request_digest: string; status: string; replayed: boolean }
      meta: { request_id: string }
    }
    assert.equal(controlBody.data.run_id, messageBody.data.run_id)
    assert.equal(controlBody.data.command_id, "chat-control-1")
    assert.match(controlBody.data.request_digest, /^sha256:/u)
    assert.equal(controlBody.data.status, "succeeded")
    assert.equal(controlBody.data.replayed, false)

    const renamed = await fetch(`${base}/v1/sessions/${sessionId}/title`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "chat-title-1" },
      body: JSON.stringify({ title: "Mock chat title" }),
    })
    assert.equal(renamed.status, 200)
    const renamedBody = (await renamed.json()) as { data: { ok: true }; meta: { request_id: string } }
    assert.equal(renamedBody.data.ok, true)

    const shared = await fetch(`${base}/v1/sessions/${sessionId}/share`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "chat-share-1" },
      body: JSON.stringify({}),
    })
    assert.equal(shared.status, 200)
    const sharedBody = (await shared.json()) as { data: { share_id: string } }
    assert.ok(sharedBody.data.share_id.length > 0)

    const publicShare = await fetch(`${base}/v1/shared/${sharedBody.data.share_id}`, {
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "test-secret",
      },
    })
    assert.equal(publicShare.status, 200)
    const publicShareBody = (await publicShare.json()) as {
      data: {
        session: { session_id: string; title: string; owner_id: string }
        pending_pauses: unknown[]
        files: unknown[]
        deliveries: unknown[]
        deliveries_has_more: boolean
        event_watermark: string | null
      }
      meta: { request_id: string }
    }
    assert.equal(publicShareBody.data.session.session_id, sessionId)
    assert.equal(publicShareBody.data.session.owner_id, "ns_test")
    assert.deepEqual(publicShareBody.data.deliveries, [])
    assert.equal(publicShareBody.data.deliveries_has_more, false)
    assert.match(publicShareBody.data.event_watermark ?? "", /^agui_[0-9a-f]{32}$/u)

    const revoked = await fetch(`${base}/v1/sessions/${sessionId}/share`, {
      method: "DELETE",
      headers: { ...headers, "idempotency-key": "chat-share-delete-1" },
    })
    assert.equal(revoked.status, 200)
    const revokedBody = (await revoked.json()) as { data: { share_id: string }; meta: { request_id: string } }
    assert.equal(revokedBody.data.share_id, sharedBody.data.share_id)

    const deleted = await fetch(`${base}/v1/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { ...headers, "idempotency-key": "chat-delete-1" },
    })
    assert.equal(deleted.status, 200)
    const deletedBody = (await deleted.json()) as { data: { status: string }; meta: { request_id: string } }
    assert.equal(deletedBody.data.status, "deleted")

    const missing = await fetch(`${base}/v1/sessions/${sessionId}`, { headers })
    assert.equal(missing.status, 404)
    assert.equal(((await missing.json()) as { error: { code: string } }).error.code, "session_not_found")
  })

  it("requires the durable BFF Chat store and never falls back to Agent-owned history or launch", async () => {
    let received = 0
    const agent = createServer((_request, response) => {
      received += 1
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { ok: true }, meta: { request_id: "agent" } }))
    })
    const agentBase = await listen(agent)
    const base = await listen(
      liveServer(
        config({
          mode: "live",
          agentEnabled: true,
          upstreams: { ...config().upstreams, agents: agentBase },
        }),
      ),
    )
    const requests: Array<{ path: string; init?: RequestInit }> = [
      { path: "/v1/sessions" },
      { path: "/v1/sessions/session-live" },
      { path: "/v1/sessions/session-live/messages" },
      { path: "/v1/sessions/session-live/events" },
      {
        path: "/v1/sessions/session-live/messages",
        init: {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "live-chat-no-store" },
          body: JSON.stringify({ content: "hello" }),
        },
      },
      {
        path: "/v1/sessions/session-live/runs/run-live/control",
        init: {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "live-control-no-store" },
          body: JSON.stringify({ kind: "run.cancel" }),
        },
      },
    ]

    for (const item of requests) {
      const response = await fetch(`${base}${item.path}`, {
        ...item.init,
        headers: { ...authHeaders(), ...item.init?.headers },
      })
      assert.equal(response.status, 503, item.path)
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, "business_store_not_configured", item.path)
    }
    assert.equal(received, 0)
  })

  it("does not expose deprecated capability compatibility paths", async () => {
    let ownerCalls = 0
    const receipts = new Map()
    const capability = createServer((_request, response) => {
      ownerCalls += 1
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { servers: [] }, meta: { request_id: "capability" } }))
    })
    const capabilityBase = await listen(capability)
    const base = await listen(
      liveServer(
        config({
          mode: "live",
          upstreams: { ...config().upstreams, capability: capabilityBase },
        }),
        {
          idempotency: receipts,
          sessionAdmission: new SessionAdmissionDouble({ "test-session": { namespace: "ns_test", userId: "user_test" } }),
          mcpAuthorization: { check: async () => ({ ok: true }) },
          skillAuthorization: { check: async () => ({ ok: true }) },
        },
      ),
    )

    for (const path of ["/v1/connectors", "/v1/preferences", "/v1/cloud-computers", "/v1/integrations"]) {
      const response = await fetch(`${base}${path}`, { headers: authHeaders() })
      assert.equal(response.status, 404, path)
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, "bff_route_not_found")
    }
    for (const { path, init } of [
      { path: "/v1/mcp/servers", init: { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "mcp-register" }, body: "{}" } },
      {
        path: "/v1/mcp/servers/legacy/enable",
        init: { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "mcp-enable" }, body: "{}" },
      },
      {
        path: "/v1/mcp/servers/legacy/disable",
        init: { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "mcp-disable" }, body: "{}" },
      },
      {
        path: "/v1/mcp/servers/legacy",
        init: { method: "DELETE", headers: { "content-type": "application/json", "idempotency-key": "mcp-delete" }, body: "{}" },
      },
    ]) {
      const response = await fetch(`${base}${path}`, { ...init, headers: { ...authHeaders(), ...init.headers } })
      assert.equal(response.status, 404, path)
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, "bff_route_not_found", path)
    }
    const guardedSkill = await fetch(`${base}/v1/skills/quota`, { headers: authHeaders() })
    assert.equal(guardedSkill.status, 503)
    assert.equal(((await guardedSkill.json()) as { error: { code: string } }).error.code, "platform_operation_not_available")
    assert.equal(ownerCalls, 0)
    assert.equal(receipts.size, 0)
  })
})
