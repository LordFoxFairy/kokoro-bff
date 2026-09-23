import { createServer, type Server } from "node:http"
import { existsSync, readFileSync } from "node:fs"
import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { fileURLToPath } from "node:url"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import type { BffConfig } from "../src/config/runtime.ts"
import { createLiveTestBffServer, createTestBffServer } from "./doubles/server.ts"

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
    tenantId: "tenant_test",
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
      capability: null,
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

function liveServer(configValue: BffConfig, options: { readiness?: () => Promise<void> } = {}): Server {
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
    assert.equal((await response.json() as { error: { code: string } }).error.code, "service_auth_failed")
  })

  it("returns a versioned project projection and replays idempotent creation", async () => {
    const base = await listen(testServer(config()))
    const headers = { ...authHeaders(), "x-kokoro-request-id": "request-projects" }
    const list = await fetch(`${base}/v1/projects`, { headers })
    const listBody = await list.json() as { data: { projects: Array<{ id: string }> }; meta: { request_id: string } }
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
    assert.equal((await conflict.json() as { error: { code: string } }).error.code, "idempotency_conflict")
  })

  it("closes the project instruction read, update, and revision history flow", async () => {
    const base = await listen(testServer(config()))
    const projectId = "project_kokoro"
    const read = await fetch(`${base}/v1/projects/${projectId}`, { headers: authHeaders() })
    const readBody = await read.json() as {
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
    assert.equal((await missingKey.json() as { error: { code: string } }).error.code, "idempotency_key_required")

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
    const afterUpdateBody = await afterUpdate.json() as { data: { project: { instruction: string } } }
    assert.equal(afterUpdateBody.data.project.instruction, nextInstruction)

    const revisions = await fetch(`${base}/v1/projects/${projectId}/instruction-revisions`, { headers: authHeaders() })
    const revisionsBody = await revisions.json() as {
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
    assert.equal((await missingKey.json() as { error: { code: string } }).error.code, "idempotency_key_required")

    const makeBody = () => {
      const form = new FormData()
      form.append("files", new Blob(["fixture bytes"], { type: "text/plain" }), "fixture.txt")
      return form
    }
    const init = { method: "POST", headers: { ...authHeaders(), "idempotency-key": "project-resource-flow" }, body: makeBody() }
    const first = await fetch(`${base}${path}`, init)
    const second = await fetch(`${base}${path}`, init)
    const firstBody = await first.json() as { data: { ok: boolean } }
    const secondBody = await second.json() as { data: { ok: boolean } }
    assert.equal(first.status, 200)
    assert.deepEqual(firstBody, secondBody)
    assert.deepEqual(firstBody.data, { ok: true })
  })

  it("persists project skill state and creates scheduled tasks from snake_case Web input", async () => {
    const base = await listen(testServer(config()))
    const projectId = "project_kokoro"
    const skillPath = `${base}/v1/projects/${projectId}/skills/skill-builder`
    const missingSkillKey = await fetch(skillPath, {
      method: "PATCH",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })
    assert.equal(missingSkillKey.status, 400)
    assert.equal((await missingSkillKey.json() as { error: { code: string } }).error.code, "idempotency_key_required")

    const disabled = await fetch(skillPath, {
      method: "PATCH",
      headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "project-skill-disable" },
      body: JSON.stringify({ enabled: false }),
    })
    const disabledBody = await disabled.json() as { data: { skill: { project_id: string; name: string; enabled: boolean } } }
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
    const scheduledBody = await scheduled.json() as {
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
    const agentBody = await response.json() as { data: { platform: string; status: string }; meta: { request_id: string } }
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
    const createdBody = await created.json() as { data: { task: { id: string } } }
    const listed = await fetch(`${base}/v1/scheduled-tasks`, { headers: authHeaders() })
    assert.ok((await listed.json() as { data: { tasks: unknown[] } }).data.tasks.length >= 2)
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
    const liveReadyBase = await listen(liveServer(config({
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
    }), { readiness: async (): Promise<void> => { throw new Error("database unavailable") } }))
    const liveReady = await fetch(`${liveReadyBase}/readyz`)
    assert.equal(liveReady.status, 503)
    assert.deepEqual(await liveReady.json(), { status: "ok", service: "kokoro-bff", mode: "live" })

    const liveAgentRoute = await fetch(`${liveReadyBase}/v1/sessions`, { headers: authHeaders() })
    assert.equal(liveAgentRoute.status, 503)
    assert.equal((await liveAgentRoute.json() as { error: { code: string } }).error.code, "business_store_not_configured")

    const livePartialBase = await listen(liveServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, system: upstreamBase },
    }), { readiness: async (): Promise<void> => { throw new Error("database unavailable") } }))
    const livePartial = await fetch(`${livePartialBase}/readyz`)
    assert.equal(livePartial.status, 503)
  })

  it("previews a GitHub skill without requiring Idempotency-Key", async () => {
    const base = await listen(testServer(config()))
    const repository = "https://github.com/acme/skill-pack"
    const response = await fetch(`${base}/v1/skills/github/preview`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ repository }),
    })
    const body = await response.json() as {
      data: { repository: string; default_branch: string; skill: { name: string; description: string } }
      meta: { request_id: string }
    }

    assert.equal(response.status, 200)
    assert.deepEqual(body.data, {
      repository,
      default_branch: "main",
      skill: {
        name: "skill-pack",
        description: "Mock GitHub skill from acme/skill-pack",
      },
    })
    assert.ok(body.meta.request_id.length > 0)
  })

  it("requires Idempotency-Key for GitHub skill import and replays the result", async () => {
    const base = await listen(testServer(config()))
    const repository = "https://github.com/acme/skill-pack"
    const missingKey = await fetch(`${base}/v1/skills/github/import`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ repository }),
    })
    assert.equal(missingKey.status, 400)
    assert.equal((await missingKey.json() as { error: { code: string } }).error.code, "idempotency_key_required")

    const init = {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "github-import-1" },
      body: JSON.stringify({ repository }),
    }
    const first = await fetch(`${base}/v1/skills/github/import`, init)
    const second = await fetch(`${base}/v1/skills/github/import`, init)
    const firstBody = await first.json() as {
      data: { repository: string; default_branch: string; skill: { name: string; description: string } }
      meta: { request_id: string }
    }

    assert.equal(first.status, 200)
    assert.deepEqual(firstBody, await second.json())
    assert.deepEqual(firstBody.data, {
      repository,
      default_branch: "main",
      skill: {
        name: "skill-pack",
        description: "Mock GitHub skill from acme/skill-pack",
      },
    })
    assert.ok(firstBody.meta.request_id.length > 0)
  })

  it("rejects non-GitHub URLs for GitHub skill preview and import", async () => {
    const base = await listen(testServer(config()))
    for (const path of ["preview", "import"]) {
      const response = await fetch(`${base}/v1/skills/github/${path}`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json", ...(path === "import" ? { "idempotency-key": "github-import-invalid" } : {}) },
        body: JSON.stringify({ repository: "https://example.com/acme/skill-pack" }),
      })
      assert.equal(response.status, 400)
      assert.equal((await response.json() as { error: { code: string } }).error.code, "invalid_github_url")
    }
  })

  it("completes the skill quota, revision, and toggle mock flow", async () => {
    const base = await listen(testServer(config()))
    const quotaResponse = await fetch(`${base}/v1/skills/quota`, {
      headers: { ...authHeaders(), "x-kokoro-request-id": "skills-quota-request" },
    })
    const quotaBody = await quotaResponse.json() as {
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
    const revisionsBody = await revisionsResponse.json() as {
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
    assert.equal(disabled.status, 200)
    assert.deepEqual((await disabled.json() as { data: { ok: boolean } }).data, { ok: true })

    const afterDisable = await fetch(`${base}/v1/skills`, { headers: authHeaders() })
    const disabledSkill = ((await afterDisable.json() as { data: { skills: Array<{ name: string; enabled?: boolean }> } }).data.skills)
      .find((skill) => skill.name === "contract-review")
    assert.equal(disabledSkill?.enabled, false)

    const enabled = await fetch(`${base}/v1/skills/contract-review/enable?scope=official`, {
      method: "POST",
      headers: { ...authHeaders(), "idempotency-key": "skills-toggle-contract-review-enable" },
    })
    assert.equal(enabled.status, 200)
    assert.deepEqual((await enabled.json() as { data: { ok: boolean } }).data, { ok: true })
  })

  it("completes the MCP server register, toggle, list, and delete mock flow", async () => {
    const base = await listen(testServer(config()))
    const name = "phase-one-mcp"
    const registration = {
      name,
      transport: "streamable_http",
      url: "https://mcp.example.test/stream",
      allowed_tools: ["search", "fetch"],
      secret_ref: "handle:srt_fixture",
    }
    const missingKey = await fetch(`${base}/v1/mcp/servers`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify(registration),
    })
    assert.equal(missingKey.status, 400)
    assert.equal((await missingKey.json() as { error: { code: string } }).error.code, "idempotency_key_required")

    const registered = await fetch(`${base}/v1/mcp/servers`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "mcp-register-phase-one" },
      body: JSON.stringify(registration),
    })
    const registeredBody = await registered.json() as {
      data: { server: Record<string, unknown> }
      meta: { request_id: string }
    }
    assert.equal(registered.status, 200)
    assert.deepEqual(registeredBody.data.server, {
      scope: "ns_test",
      name,
      revision: 1,
      transport: "streamable_http",
      url: "https://mcp.example.test/stream",
      allowed_tools: ["search", "fetch"],
      secret_ref: "handle:srt_fixture",
      enabled: true,
    })
    assert.ok(registeredBody.meta.request_id.length > 0)

    const listed = await fetch(`${base}/v1/mcp/servers`, { headers: authHeaders() })
    const listedBody = await listed.json() as {
      data: { servers: Array<{ name: string; enabled: boolean }> }
      meta: { request_id: string }
    }
    assert.equal(listed.status, 200)
    assert.equal(listedBody.data.servers.find((server) => server.name === name)?.enabled, true)
    assert.ok(listedBody.meta.request_id.length > 0)

    const disabled = await fetch(`${base}/v1/mcp/servers/${name}/disable`, {
      method: "POST",
      headers: { ...authHeaders(), "idempotency-key": "mcp-toggle-phase-one-disable" },
    })
    assert.equal(disabled.status, 200)
    assert.deepEqual((await disabled.json() as { data: { ok: boolean } }).data, { ok: true })

    const enabled = await fetch(`${base}/v1/mcp/servers/${name}/enable`, {
      method: "POST",
      headers: { ...authHeaders(), "idempotency-key": "mcp-toggle-phase-one-enable" },
    })
    assert.equal(enabled.status, 200)
    assert.deepEqual((await enabled.json() as { data: { ok: boolean } }).data, { ok: true })

    const deleted = await fetch(`${base}/v1/mcp/servers/${name}`, {
      method: "DELETE",
      headers: { ...authHeaders(), "idempotency-key": "mcp-delete-phase-one" },
    })
    assert.equal(deleted.status, 200)
    assert.deepEqual((await deleted.json() as { data: { ok: boolean } }).data, { ok: true })

    const afterDelete = await fetch(`${base}/v1/mcp/servers`, { headers: authHeaders() })
    assert.equal(((await afterDelete.json() as { data: { servers: Array<{ name: string }> } }).data.servers)
      .some((server) => server.name === name), false)
  })

  it("routes live Skills traffic to the explicit Capability projection", async () => {
    const upstream = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.setHeader("x-kokoro-request-id", "skills-live")
      response.end(JSON.stringify({
        data: {
          skills: [{
            source_selector: "skill:contract-review",
            name: "contract-review",
            description: "Review contracts",
            content_hash: "sha256:abc",
            scope: "personal",
            revision: "1",
            enabled: true,
            categories: ["review"],
          }],
          next_cursor: "pool-next",
        },
      }))
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(liveServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: upstreamBase },
    })))
    const response = await fetch(`${base}/v1/skills/pool`, { headers: { ...authHeaders(), "x-kokoro-request-id": "skills-live" } })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      data: {
        skills: [{
          name: "contract-review",
          description: "Review contracts",
          content_hash: "sha256:abc",
          scope: "personal",
          enabled: true,
          categories: ["review"],
        }],
        next_cursor: "pool-next",
      },
      meta: { request_id: "skills-live" },
    })
  })

  it("generates standard Forwarded context for live upstream calls", async () => {
    let received: Record<string, string | undefined> = {}
    const upstream = createServer((request, response) => {
      received = {
        forwarded: request.headers.forwarded,
        service: request.headers["x-kokoro-service"]?.toString(),
        secret: request.headers["x-kokoro-internal-secret"]?.toString(),
        authorization: request.headers.authorization?.toString(),
        xForwardedFor: request.headers["x-forwarded-for"]?.toString(),
        requestIdAlias: request.headers["x-request-id"]?.toString(),
        xDomain: request.headers["x-domain"]?.toString(),
      }
      response.setHeader("content-type", "application/json")
      response.setHeader("x-kokoro-request-id", "live-request")
      response.end(JSON.stringify({
        data: {
          skills: [{
            source_selector: "skill:project-live",
            name: "project-live",
            description: "Live project skill",
            content_hash: "sha256:live",
            scope: "personal",
            revision: "1",
            enabled: true,
            categories: [],
          }],
        },
      }))
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(liveServer(config({
      mode: "live",
      upstreamTimeoutMs: 10000,
      upstreams: { ...config().upstreams, capability: upstreamBase },
    })))
    const response = await fetch(`${base}/v1/skills`, { headers: { ...authHeaders(), forwarded: "for=198.51.100.7", "x-forwarded-for": "198.51.100.8", "x-domain": "evil.example", "x-kokoro-request-id": "live-request" } })
    assert.equal(response.status, 200)
    assert.deepEqual(received, {
      forwarded: undefined,
      service: "web-bff",
      secret: "bff-upstream-secret",
      authorization: undefined,
      xForwardedFor: undefined,
      requestIdAlias: undefined,
      xDomain: undefined,
    })
    assert.equal((await response.json() as { meta: { request_id: string } }).meta.request_id, "live-request")
  })

  it("routes Skills and MCP through the single Capability owner projection", async () => {
    const received: string[] = []
    const hubUpstream = createServer((request, response) => {
      received.push(`capability:${request.url}`)
      response.setHeader("content-type", "application/json")
      response.setHeader("x-kokoro-request-id", "upstream")
      response.end(request.url?.startsWith("/v1/mcp/servers")
        ? JSON.stringify({ data: { servers: [], next_cursor: "mcp-next" } })
        : JSON.stringify({ data: { skills: [], next_cursor: "skills-next" } }))
    })
    const capabilityBase = await listen(hubUpstream)
    const base = await listen(liveServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: capabilityBase },
    })))

    const skills = await fetch(`${base}/v1/skills`, { headers: authHeaders() })
    const mcp = await fetch(`${base}/v1/mcp/servers`, { headers: authHeaders() })
    assert.equal(skills.status, 200)
    assert.equal(mcp.status, 200)
    assert.deepEqual((await skills.json() as { data: unknown }).data, { skills: [], next_cursor: "skills-next" })
    assert.deepEqual((await mcp.json() as { data: unknown }).data, { servers: [], next_cursor: "mcp-next" })
    assert.deepEqual(received, ["capability:/v1/skills", "capability:/v1/mcp/servers"])
  })

  it("forwards allowlisted Capability queries and preserves owner cursors", async () => {
    const received: string[] = []
    const upstream = createServer((request, response) => {
      received.push(request.url ?? "")
      response.setHeader("content-type", "application/json")
      response.setHeader("x-kokoro-request-id", "capability-query")
      response.end(request.url?.startsWith("/v1/mcp/servers")
        ? JSON.stringify({ data: { servers: [], next_cursor: "capability-cursor-next" } })
        : JSON.stringify({ data: { skills: [], next_cursor: "capability-cursor-next" } }))
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(liveServer(config({ mode: "live", upstreams: { ...config().upstreams, capability: upstreamBase } })))

    const skills = await fetch(`${base}/v1/skills/catalog?query=contract%20review&tags=review&tags=security&scope_kind=personal&limit=10&cursor=cursor-1`, { headers: { ...authHeaders(), "x-kokoro-request-id": "capability-query" } })
    assert.equal(skills.status, 200)
    assert.deepEqual(await skills.json(), {
      data: { skills: [], next_cursor: "capability-cursor-next" },
      meta: { request_id: "capability-query" },
    })
    assert.equal(received[0], "/v1/skills/catalog?query=contract%20review&tags=review&tags=security&scope_kind=personal&limit=10&cursor=cursor-1")

    const mcp = await fetch(`${base}/v1/mcp/servers?provider_key=github&limit=5&cursor=mcp-1`, { headers: authHeaders() })
    assert.equal(mcp.status, 200)
    assert.equal(received[1], "/v1/mcp/servers?provider_key=github&limit=5&cursor=mcp-1")

    const aliasQuery = new URLSearchParams([["q", "legacy"]])
    const alias = await fetch(`${base}/v1/skills?${aliasQuery.toString()}`, { headers: authHeaders() })
    assert.equal(alias.status, 400)
    assert.equal((await alias.json() as { error: { code: string } }).error.code, "invalid_query_parameter")
    assert.equal(received.length, 2)
  })

  it("keeps Library unavailable after admission without opening a Storage connection", async () => {
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
    assert.equal((await unauthenticated.json() as { error: { code: string } }).error.code, "service_auth_failed")

    const response = await fetch(`${base}/v1/library`, { headers: { ...authHeaders(), "x-domain": "evil.example", "x-kokoro-request-id": "library-live" } })
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      error: {
        code: "storage_integration_unavailable",
        message: "Storage integration is unavailable",
      },
      meta: { request_id: "library-live" },
    })

    const explicitTestComposition = await listen(testServer(config()))
    const testResponse = await fetch(`${explicitTestComposition}/v1/library`, {
      headers: { ...authHeaders(), "x-kokoro-request-id": "library-test-composition" },
    })
    assert.equal(testResponse.status, 503)
    assert.deepEqual(await testResponse.json(), {
      error: {
        code: "storage_integration_unavailable",
        message: "Storage integration is unavailable",
      },
      meta: { request_id: "library-test-composition" },
    })

    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(connections, 0)
    assert.equal(requests, 0)
  })

  it("projects the canonical runtime manifest through System using configured tenant context", async () => {
    let received: { url: string | undefined; service: string | undefined; secret: string | undefined; forwarded: string | undefined; tenant: string | undefined; subject: string | undefined; actor: string | undefined; authorization: string | undefined } = {
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
      response.end(JSON.stringify({
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
      }))
    })
    const upstreamBase = await listen(upstream)
    const runtimeConfig = config({ mode: "live", upstreams: { ...config().upstreams, system: upstreamBase } }) as BffConfig & { tenantId: string }
    runtimeConfig.tenantId = "tenant_manifest"
    const base = await listen(liveServer(runtimeConfig))

    const response = await fetch(`${base}/v1/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=user-web`, {
      headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret", "x-kokoro-request-id": "manifest-live", authorization: "Bearer irrelevant-user-session" },
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
    const received: { url: string | undefined; service: string | undefined; tenant: string | undefined; subject: string | undefined; requestId: string | undefined; permissions: string | undefined } = {
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
      response.end(JSON.stringify({
        data: {
          items: [{ key: "claude-sonnet", display_name: "Claude Sonnet", is_default: true }],
          next_cursor: "model-cursor-next",
        },
      }))
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(liveServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, system: upstreamBase },
    })))

    const response = await fetch(`${base}/v1/models?feature_key=chat&limit=20&cursor=cursor-1`, { headers: { ...authHeaders(), "x-kokoro-request-id": "model-owner-request" } })
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
      const responseBody = await response.json() as { error: { code: string }; meta: { request_id: string } }
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
        body: { data: { tenant_id: "tenant_manifest", product_id: "kokoro", locale: "en-US", navigation: [], locale_namespaces: [], theme: {}, feature_flags: [], references: [], config_version: "1", release_id: null, digest: "sha256:manifest" } },
      },
      {
        status: 302,
        body: { data: { tenant_id: "tenant_manifest", product_id: "kokoro", locale: "en-US", navigation: [], locale_namespaces: [], theme: {}, feature_flags: [], references: [], config_version: "1", release_id: null, digest: "sha256:manifest" } },
      },
      {
        status: 200,
        body: { data: { tenant_id: "tenant_other", product_id: "kokoro", locale: "en-US", navigation: [], locale_namespaces: [], theme: {}, feature_flags: [], references: [], config_version: "1", release_id: null, digest: "sha256:manifest" } },
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
      assert.equal((await response.json() as { error: { code: string } }).error.code, "upstream_response_invalid")
    }
  })

  it("projects Billing catalog and checkout through the v1 owner contract", async () => {
    const received: Array<{ url: string | undefined; body: string; service: string | undefined }> = []
    const upstream = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      request.on("end", () => {
        received.push({ url: request.url, body: Buffer.concat(chunks).toString("utf8"), service: request.headers["x-kokoro-service"]?.toString() })
        response.setHeader("content-type", "application/json")
        if (request.url === "/v1/commerce/catalog") {
          response.end(JSON.stringify({ data: { offers: [{ id: "offer-revision-1", key: "pro", name: "Pro", currency: "USD", amount_minor: "1999", credit_micros: "1000000", billing_interval: "month" }] }, meta: { request_id: "billing-catalog" } }))
          return
        }
        response.statusCode = 201
        response.end(JSON.stringify({ data: { checkout_id: "checkout-1", checkout_url: "https://pay.test/checkout-1" }, meta: { request_id: "billing-checkout" } }))
      })
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(liveServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, billing: upstreamBase },
    })))

    const plans = await fetch(`${base}/v1/billing/plans`, { headers: { ...authHeaders(), "x-kokoro-request-id": "billing-catalog" } })
    assert.equal(plans.status, 200)
    assert.deepEqual(await plans.json(), {
      data: { plans: [{ id: "offer-revision-1", key: "pro", name: "Pro", currency: "USD", amount_minor: "1999", credit_micros: "1000000", billing_interval: "month" }] },
      meta: { request_id: "billing-catalog" },
    })

    const checkout = await fetch(`${base}/v1/billing/checkout`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "billing-checkout-key", "x-kokoro-request-id": "billing-checkout" },
      body: JSON.stringify({ plan_id: "offer-revision-1" }),
    })
    assert.equal(checkout.status, 201)
    assert.deepEqual(await checkout.json(), {
      data: { checkout_url: "https://pay.test/checkout-1" },
      meta: { request_id: "billing-checkout" },
    })
    assert.equal(received[0]?.url, "/v1/commerce/catalog")
    assert.equal(received[0]?.service, "web-bff")
    assert.deepEqual(JSON.parse(received[2]?.body ?? "{}"), {
      offer_revision_id: "offer-revision-1",
      amount_minor: "1999",
      currency: "USD",
      quote_snapshot: { key: "pro", credit_micros: "1000000", name: "Pro", plan_id: "offer-revision-1" },
    })
  })

  it("does not misroute BFF-owned projects or scheduled definitions to an owner", async () => {
    const upstream = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { items: [] }, meta: { request_id: "should-not-be-called" } }))
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(liveServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, system: upstreamBase, scheduler: upstreamBase },
    })))

    for (const path of ["/v1/projects", "/v1/scheduled-tasks"]) {
      const response = await fetch(`${base}${path}`, { headers: authHeaders() })
      assert.equal(response.status, 503)
      assert.equal((await response.json() as { error: { code: string } }).error.code, "business_store_not_configured")
    }
  })

  it("covers auth failures, idempotency conflicts, live normalization, and docs coverage", async () => {
    const unauthBase = await listen(liveServer(config()))
    const missingService = await fetch(`${unauthBase}/v1/projects`)
    assert.equal(missingService.status, 403)
    assert.equal((await missingService.json() as { error: { code: string } }).error.code, "service_auth_failed")

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

    const missingUpstreamBase = await listen(liveServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: null },
    })))
    const missingUpstream = await fetch(`${missingUpstreamBase}/v1/skills`, { headers: authHeaders() })
    assert.equal(missingUpstream.status, 503)
    assert.equal((await missingUpstream.json() as { error: { code: string } }).error.code, "capability_unavailable")

    const unreachableBase = await listen(liveServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: "http://127.0.0.1:1" },
    })))
    const unreachable = await fetch(`${unreachableBase}/v1/skills/pool`, { headers: authHeaders() })
    assert.equal(unreachable.status, 502)
    assert.equal((await unreachable.json() as { error: { code: string } }).error.code, "capability_response_invalid")

    const malformedUpstream = createServer((_request, response) => {
      response.statusCode = 200
      response.setHeader("content-type", "text/plain")
      response.setHeader("x-kokoro-request-id", "malformed")
      response.end("not json")
    })
    const malformedBase = await listen(malformedUpstream)
    const malformedBff = await listen(liveServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: malformedBase },
    })))
    const malformed = await fetch(`${malformedBff}/v1/skills/pool`, { headers: authHeaders() })
    assert.equal(malformed.status, 502)
    assert.equal((await malformed.json() as { error: { code: string } }).error.code, "capability_response_invalid")

    const emptyUpstream = createServer((_request, response) => {
      response.statusCode = 200
      response.setHeader("content-type", "application/json")
      response.setHeader("x-kokoro-request-id", "empty")
      response.end("")
    })
    const emptyBase = await listen(emptyUpstream)
    const emptyBff = await listen(liveServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: emptyBase },
    })))
    const empty = await fetch(`${emptyBff}/v1/skills/pool`, { headers: authHeaders() })
    assert.equal(empty.status, 502)
    assert.equal((await empty.json() as { error: { code: string } }).error.code, "capability_response_invalid")

    const errorEnvelopeUpstream = createServer((_request, response) => {
      response.statusCode = 503
      response.setHeader("content-type", "application/json")
      response.setHeader("x-kokoro-request-id", "skills-upstream-503")
      response.end(JSON.stringify({
        error: { code: "skills_unavailable", message: "Skills are down", retryable: true },
      }))
    })
    const errorEnvelopeBase = await listen(errorEnvelopeUpstream)
    const errorEnvelopeBff = await listen(liveServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: errorEnvelopeBase },
    })))
    const errorEnvelope = await fetch(`${errorEnvelopeBff}/v1/skills/pool`, { headers: { ...authHeaders(), "x-kokoro-request-id": "public-capability-503" } })
    assert.equal(errorEnvelope.status, 503)
    assert.deepEqual(await errorEnvelope.json(), {
      error: { code: "capability_unavailable", message: "Capability is temporarily unavailable" },
      meta: { request_id: "public-capability-503" },
    })

    const httpErrorUpstream = createServer((_request, response) => {
      response.statusCode = 500
      response.setHeader("content-type", "text/plain")
      response.setHeader("x-kokoro-request-id", "owner-500")
      response.end("boom")
    })
    const httpErrorBase = await listen(httpErrorUpstream)
    const httpErrorBff = await listen(liveServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: httpErrorBase },
    })))
    const httpError = await fetch(`${httpErrorBff}/v1/skills/pool`, { headers: authHeaders() })
    assert.equal(httpError.status, 502)
    assert.equal((await httpError.json() as { error: { code: string } }).error.code, "capability_response_invalid")

    const baseDir = fileURLToPath(new URL("../docs/api/v1/", import.meta.url))
    for (const file of ["README.md", "projects.md", "system.md", "models.md", "skills.md", "mcp.md", "scheduled.md", "agents.md", "library.md", "billing.md"]) {
      assert.equal(existsSync(`${baseDir}/${file}`), true, file)
    }

    const openapi = readFileSync(fileURLToPath(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url)), "utf8")
    for (const path of [
      "/v1/projects",
      "/v1/projects/{projectId}",
      "/v1/projects/{projectId}/tasks",
      "/v1/projects/{projectId}/instruction-revisions",
      "/v1/projects/{projectId}/resources",
      "/v1/projects/{projectId}/skills/{skill}",
      "/v1/projects/{projectId}/scheduled-tasks",
      "/v1/skills",
      "/v1/skills/pool",
      "/v1/skills/catalog",
      "/v1/skills/quota",
      "/v1/skills/{name}/revisions",
      "/v1/skills/{name}/enable",
      "/v1/skills/{name}/disable",
      "/v1/skills/github/preview",
      "/v1/skills/github/import",
      "/v1/mcp/servers",
      "/v1/mcp/servers/{name}/enable",
      "/v1/mcp/servers/{name}/disable",
      "/v1/mcp/servers/{name}",
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
    const listBody = await list.json() as { data: { sessions: Array<{ session_id: string; title: string; updated_at: string }>; next_cursor: string | null }; meta: { request_id: string } }
    assert.ok(listBody.data.sessions.length >= 1)
    assert.equal(listBody.data.next_cursor, null)

    const sessionId = listBody.data.sessions[0]?.session_id
    assert.ok(sessionId)

    const isolated = await fetch(`${base}/v1/sessions?scope=other-scope&project_ref=project_kokoro`, { headers })
    assert.equal(isolated.status, 400)
    assert.equal((await isolated.json() as { error: { code: string } }).error.code, "invalid_session_scope")

    const detail = await fetch(`${base}/v1/sessions/${sessionId}`, { headers })
    assert.equal(detail.status, 200)
    const detailBody = await detail.json() as {
      data: {
        session: { session_id: string; title: string; owner_id: string; created_at: string; updated_at: string }
        messages?: Array<{ message_id: string; role: string; content: string; status: string; created_at: string; run_id?: string }>
        active_run?: { run_id: string; status: string }
        pending_pauses: unknown[]
        files: unknown[]
        deliveries: unknown[]
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

    const message = await fetch(`${base}/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "chat-message-1" },
      body: JSON.stringify({ content: "Hello from mock chat" }),
    })
    assert.equal(message.status, 202)
    const messageBody = await message.json() as {
      data: { run_id: string; user_message_id: string; assistant_message_id: string }
      meta: { request_id: string }
    }
    assert.ok(messageBody.data.run_id.length > 0)
    assert.ok(messageBody.data.user_message_id.length > 0)
    assert.ok(messageBody.data.assistant_message_id.length > 0)

    await new Promise((resolve) => setTimeout(resolve, 30))
    const messagePage = await fetch(`${base}/v1/sessions/${sessionId}/messages?limit=1`, { headers })
    assert.equal(messagePage.status, 200)
    const messagePageBody = await messagePage.json() as { data: { messages: Array<{ role: string }>; next_cursor: string | null } }
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
    const firstFrameData = frames[0]?.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length) || ""
    const firstEvent = JSON.parse(firstFrameData) as { name: string; value: { owner_id: string } }
    assert.equal(firstEvent.name, "kokoro.session.created")
    assert.equal(firstEvent.value.owner_id, "ns_test")
    const firstFrameId = frames[0]?.split("\n").find((line) => line.startsWith("id: "))?.slice("id: ".length)
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
    assert.equal((await invalidEventCursor.json() as { error: { code: string } }).error.code, "invalid_event_cursor")

    const control = await fetch(`${base}/v1/sessions/${sessionId}/runs/${messageBody.data.run_id}/control`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "chat-control-1" },
      body: JSON.stringify({ kind: "run.cancel" }),
    })
    assert.equal(control.status, 202)
    const controlBody = await control.json() as { data: { run_id: string; command_id: string; request_digest: string; status: string; replayed: boolean }; meta: { request_id: string } }
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
    const renamedBody = await renamed.json() as { data: { ok: true }; meta: { request_id: string } }
    assert.equal(renamedBody.data.ok, true)

    const shared = await fetch(`${base}/v1/sessions/${sessionId}/share`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "chat-share-1" },
      body: JSON.stringify({}),
    })
    assert.equal(shared.status, 200)
    const sharedBody = await shared.json() as { data: { share_id: string } }
    assert.ok(sharedBody.data.share_id.length > 0)

    const publicShare = await fetch(`${base}/v1/shared/${sharedBody.data.share_id}`, {
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "test-secret",
      },
    })
    assert.equal(publicShare.status, 200)
    const publicShareBody = await publicShare.json() as {
      data: { session: { session_id: string; title: string; owner_id: string }; pending_pauses: unknown[]; files: unknown[]; deliveries: unknown[]; event_watermark: string | null }
      meta: { request_id: string }
    }
    assert.equal(publicShareBody.data.session.session_id, sessionId)
    assert.equal(publicShareBody.data.session.owner_id, "ns_test")
    assert.match(publicShareBody.data.event_watermark ?? "", /^agui_[0-9a-f]{32}$/u)

    const revoked = await fetch(`${base}/v1/sessions/${sessionId}/share`, {
      method: "DELETE",
      headers: { ...headers, "idempotency-key": "chat-share-delete-1" },
    })
    assert.equal(revoked.status, 200)
    const revokedBody = await revoked.json() as { data: { share_id: string }; meta: { request_id: string } }
    assert.equal(revokedBody.data.share_id, sharedBody.data.share_id)

    const deleted = await fetch(`${base}/v1/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { ...headers, "idempotency-key": "chat-delete-1" },
    })
    assert.equal(deleted.status, 200)
    const deletedBody = await deleted.json() as { data: { status: string }; meta: { request_id: string } }
    assert.equal(deletedBody.data.status, "deleted")

    const missing = await fetch(`${base}/v1/sessions/${sessionId}`, { headers })
    assert.equal(missing.status, 404)
    assert.equal((await missing.json() as { error: { code: string } }).error.code, "session_not_found")
  })

  it("requires the durable BFF Chat store and never falls back to Agent-owned history or launch", async () => {
    let received = 0
    const agent = createServer((_request, response) => {
      received += 1
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { ok: true }, meta: { request_id: "agent" } }))
    })
    const agentBase = await listen(agent)
    const base = await listen(liveServer(config({
      mode: "live",
      agentEnabled: true,
      upstreams: { ...config().upstreams, agents: agentBase },
    })))
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
      assert.equal((await response.json() as { error: { code: string } }).error.code, "business_store_not_configured", item.path)
    }
    assert.equal(received, 0)
  })

  it("does not expose deprecated capability compatibility paths", async () => {
    let ownerCalls = 0
    const capability = createServer((_request, response) => {
      ownerCalls += 1
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { servers: [] }, meta: { request_id: "capability" } }))
    })
    const capabilityBase = await listen(capability)
    const base = await listen(liveServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: capabilityBase },
    })))

    for (const path of ["/v1/connectors", "/v1/preferences", "/v1/cloud-computers", "/v1/integrations"]) {
      const response = await fetch(`${base}${path}`, { headers: authHeaders() })
      assert.equal(response.status, 404, path)
      assert.equal((await response.json() as { error: { code: string } }).error.code, "bff_route_not_found")
    }
    const guardedRequests: Array<{ path: string; init: RequestInit }> = [
      { path: "/v1/mcp/servers", init: { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "mcp-register" }, body: "{}" } },
      { path: "/v1/skills/quota", init: {} },
    ]
    for (const { path, init } of guardedRequests) {
      const response = await fetch(`${base}${path}`, { ...init, headers: { ...authHeaders(), ...init.headers } })
      assert.equal(response.status, 503, path)
      assert.equal((await response.json() as { error: { code: string } }).error.code, "capability_projection_not_configured", path)
    }
    assert.equal(ownerCalls, 0)
  })
})
