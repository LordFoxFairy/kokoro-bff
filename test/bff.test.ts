import { createServer, type Server } from "node:http"
import { existsSync, readFileSync } from "node:fs"
import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { fileURLToPath } from "node:url"

import { createBffServer } from "../dist/main.js"
import type { BffConfig } from "../src/config.js"

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
    mode: "mock",
    domain: "dev.kokoro.localhost",
    sharedSecret: "test-secret",
    upstreamSecret: "bff-upstream-secret",
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1024 * 1024,
    iamServiceToken: null,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    upstreams: {
      iam: null,
      system: null,
      model: null,
      capability: null,
      storage: null,
      scheduler: null,
      agents: null,
      billing: null,
    },
    ...overrides,
  }
}

function authHeaders(): Record<string, string> {
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    "x-kokoro-namespace": "ns_test",
    "x-kokoro-principal-id": "user_test",
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe("kokoro-bff v1 mock contract", () => {
  it("exposes unauthenticated health and rejects browser calls to business routes", async () => {
    const base = await listen(createBffServer(config()))
    const health = await fetch(`${base}/healthz`)
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: "ok", service: "kokoro-bff", mode: "mock" })

    const response = await fetch(`${base}/v1/projects`, { headers: { "x-domain": "evil.example" } })
    assert.equal(response.status, 403)
    assert.equal((await response.json() as { error: { code: string } }).error.code, "service_auth_failed")
  })

  it("returns a versioned project projection and replays idempotent creation", async () => {
    const base = await listen(createBffServer(config()))
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
    const base = await listen(createBffServer(config()))
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
      data: { items: Array<{ id: string; instruction: string; updatedAt: number; actorName: string; current: boolean }> }
      meta: { request_id: string }
    }
    assert.equal(revisions.status, 200)
    assert.ok(revisionsBody.data.items.length >= 2)
    assert.equal(revisionsBody.data.items[0]?.instruction, nextInstruction)
    assert.equal(revisionsBody.data.items[0]?.current, true)
    assert.ok(revisionsBody.data.items[0]?.id)
    assert.equal(typeof revisionsBody.data.items[0]?.updatedAt, "number")
    assert.equal(typeof revisionsBody.data.items[0]?.actorName, "string")
    assert.ok(revisionsBody.meta.request_id.length > 0)
  })

  it("accepts project resource multipart mocks and replays the canonical success", async () => {
    const base = await listen(createBffServer(config()))
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
    const base = await listen(createBffServer(config()))
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
    const base = await listen(createBffServer(config()))
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
    const base = await listen(createBffServer(config()))
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
    const mockBase = await listen(createBffServer(config()))
    const mockReady = await fetch(`${mockBase}/readyz`)
    assert.equal(mockReady.status, 200)
    assert.deepEqual(await mockReady.json(), { status: "ok", service: "kokoro-bff", mode: "mock" })

    const upstream = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { ok: true }, meta: { request_id: "readyz-live" } }))
    })
    const upstreamBase = await listen(upstream)
    const liveReadyBase = await listen(createBffServer(config({
      mode: "live",
      upstreams: {
        iam: upstreamBase,
        system: upstreamBase,
        model: upstreamBase,
        capability: upstreamBase,
        storage: upstreamBase,
        scheduler: upstreamBase,
        agents: null,
        billing: upstreamBase,
      },
    })))
    const liveReady = await fetch(`${liveReadyBase}/readyz`)
    assert.equal(liveReady.status, 503)
    assert.deepEqual(await liveReady.json(), { status: "ok", service: "kokoro-bff", mode: "live" })

    const liveAgentRoute = await fetch(`${liveReadyBase}/v1/sessions`, { headers: authHeaders() })
    assert.equal(liveAgentRoute.status, 503)
    assert.equal((await liveAgentRoute.json() as { error: { code: string } }).error.code, "agent_not_configured")

    const livePartialBase = await listen(createBffServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, system: upstreamBase },
    })))
    const livePartial = await fetch(`${livePartialBase}/readyz`)
    assert.equal(livePartial.status, 503)
  })

  it("previews a GitHub skill without requiring Idempotency-Key", async () => {
    const base = await listen(createBffServer(config()))
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
    const base = await listen(createBffServer(config()))
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
    const base = await listen(createBffServer(config()))
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
    const base = await listen(createBffServer(config()))
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
    const base = await listen(createBffServer(config()))
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
          next_cursor: null,
        },
        meta: { request_id: "skills-live" },
      }))
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(createBffServer(config({
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
        next_cursor: null,
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
        requestIdAlias: request.headers["x-request-id"]?.toString(),
        xDomain: request.headers["x-domain"]?.toString(),
      }
      response.setHeader("content-type", "application/json")
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
        meta: { request_id: "live-request" },
      }))
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(createBffServer(config({ mode: "live", upstreams: { ...config().upstreams, capability: upstreamBase } })))
    const response = await fetch(`${base}/v1/skills`, { headers: { ...authHeaders(), authorization: "Bearer user-jwt", "x-domain": "evil.example", "x-kokoro-request-id": "live-request" } })
    assert.equal(response.status, 200)
    assert.deepEqual(received, {
      forwarded: "host=dev.kokoro.localhost",
      service: "web-bff",
      secret: "bff-upstream-secret",
      authorization: "Bearer bff-upstream-secret",
      requestIdAlias: "live-request",
      xDomain: undefined,
    })
    assert.equal((await response.json() as { meta: { request_id: string } }).meta.request_id, "live-request")
  })

  it("routes Skills and MCP through the single Capability owner projection", async () => {
    const received: string[] = []
    const hubUpstream = createServer((request, response) => {
      received.push(`capability:${request.url}`)
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { skills: [], servers: [] }, meta: { request_id: "upstream" } }))
    })
    const capabilityBase = await listen(hubUpstream)
    const base = await listen(createBffServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: capabilityBase },
    })))

    const skills = await fetch(`${base}/v1/skills`, { headers: authHeaders() })
    const mcp = await fetch(`${base}/v1/mcp/servers`, { headers: authHeaders() })
    assert.equal(skills.status, 200)
    assert.equal(mcp.status, 200)
    assert.deepEqual(received, ["capability:/bff/skills", "capability:/bff/mcp/servers"])
  })

  it("forwards allowlisted Capability queries and preserves owner cursors", async () => {
    const received: string[] = []
    const upstream = createServer((request, response) => {
      received.push(request.url ?? "")
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { skills: [], servers: [], next_cursor: "capability-cursor-next" }, meta: { request_id: "capability-query" } }))
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(createBffServer(config({ mode: "live", upstreams: { ...config().upstreams, capability: upstreamBase } })))

    const skills = await fetch(`${base}/v1/skills/catalog?q=contract%20review&tags=review&tags=security&scope_kind=personal&limit=10&cursor=cursor-1`, { headers: { ...authHeaders(), "x-kokoro-request-id": "capability-query" } })
    assert.equal(skills.status, 200)
    assert.deepEqual(await skills.json(), {
      data: { skills: [], next_cursor: "capability-cursor-next" },
      meta: { request_id: "capability-query" },
    })
    assert.equal(received[0], "/bff/skills/catalog?q=contract+review&tags=review&tags=security&scope_kind=personal&limit=10&cursor=cursor-1")

    const mcp = await fetch(`${base}/v1/mcp/servers?provider_key=github&limit=5&cursor=mcp-1`, { headers: authHeaders() })
    assert.equal(mcp.status, 200)
    assert.equal(received[1], "/bff/mcp/servers?provider_key=github&limit=5&cursor=mcp-1")
  })

  it("projects live Library through the explicit Storage owner projection", async () => {
    let received: { url: string | undefined; service: string | undefined; secret: string | undefined; tenant: string | undefined; subject: string | undefined; xDomain: string | undefined } = {
      url: undefined,
      service: undefined,
      secret: undefined,
      tenant: undefined,
      subject: undefined,
      xDomain: undefined,
    }
    const upstream = createServer((request, response) => {
      received = {
        url: request.url,
        service: request.headers["x-kokoro-service"]?.toString(),
        secret: request.headers["x-kokoro-internal-secret"]?.toString(),
        tenant: request.headers["x-kokoro-tenant-id"]?.toString(),
        subject: request.headers["x-kokoro-subject"]?.toString(),
        xDomain: request.headers["x-domain"]?.toString(),
      }
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        data: {
          items: [{
            artifact_id: "artifact_1",
            asset_id: "asset_1",
            namespace: "ns_test",
            owner_id: "user_test",
            filename: "brief.pdf",
            mime_type: "application/pdf",
            content_sha256: "a".repeat(64),
            size_bytes: 42,
            upload_purpose: "artifact",
            scan_state: "clean",
            visibility: "private",
            artifact_state: "final",
            created_at: "2026-09-01T12:00:00.000Z",
            finalized_at: "2026-09-01T12:01:00.000Z",
          }],
        },
        meta: { request_id: "storage-live" },
      }))
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(createBffServer(config({ mode: "live", upstreams: { ...config().upstreams, storage: upstreamBase } })))

    const response = await fetch(`${base}/v1/library`, { headers: { ...authHeaders(), "x-domain": "evil.example", "x-kokoro-request-id": "library-live" } })
    assert.equal(response.status, 200)
    assert.deepEqual(received, {
      url: "/internal/bff/library",
      service: "web-bff",
      secret: "bff-upstream-secret",
      tenant: "ns_test",
      subject: "user_test",
      xDomain: undefined,
    })
    assert.deepEqual(await response.json(), {
      data: {
        items: [{
          id: "artifact_1",
          title: "brief.pdf",
          type: "document",
          created_at: "2026-09-01T12:00:00.000Z",
          url: "",
        }],
      },
      meta: { request_id: "library-live" },
    })
  })

  it("projects the canonical runtime manifest through System without requiring browser tenant headers", async () => {
    let received: { url: string | undefined; service: string | undefined; secret: string | undefined; forwarded: string | undefined } = {
      url: undefined,
      service: undefined,
      secret: undefined,
      forwarded: undefined,
    }
    const iam = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { host: "dev.kokoro.localhost", tenant_id: "tenant_manifest", status: "active", binding_revision: "test" }, meta: { request_id: "iam" } }))
    })
    const iamBase = await listen(iam)
    const upstream = createServer((request, response) => {
      received = {
        url: request.url,
        service: request.headers["x-kokoro-service"]?.toString(),
        secret: request.headers["x-kokoro-internal-secret"]?.toString(),
        forwarded: request.headers.forwarded?.toString(),
      }
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        data: {
          tenantId: "tenant_manifest",
          productId: "kokoro",
          locale: "en-US",
          navigation: [],
          localeNamespaces: [],
          theme: {},
          featureFlags: [],
          references: [],
          configVersion: "1",
          releaseId: null,
          digest: "sha256:manifest",
        },
        meta: { request_id: "manifest-owner" },
      }))
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(createBffServer(config({ mode: "live", upstreams: { ...config().upstreams, iam: iamBase, system: upstreamBase }, iamServiceToken: "iam-token" })))

    const response = await fetch(`${base}/v1/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=user-web`, {
      headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret", "x-kokoro-request-id": "manifest-live" },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(received, {
      url: "/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=user-web",
      service: "web-bff",
      secret: "bff-upstream-secret",
      forwarded: "host=dev.kokoro.localhost",
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
    const received: { url: string | undefined; service: string | undefined; tenant: string | undefined; subject: string | undefined } = {
      url: undefined,
      service: undefined,
      tenant: undefined,
      subject: undefined,
    }
    const upstream = createServer((request, response) => {
      received.url = request.url
      received.service = request.headers["x-kokoro-service"]?.toString()
      received.tenant = request.headers["x-kokoro-tenant-id"]?.toString()
      received.subject = request.headers["x-kokoro-subject"]?.toString()
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        data: {
          items: [{ key: "claude-sonnet", displayName: "Claude Sonnet", featureKey: "chat", availability: "active" }],
          page: { nextCursor: "model-cursor-next" },
        },
        requestId: "model-owner-request",
      }))
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(createBffServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, model: upstreamBase },
    })))

    const response = await fetch(`${base}/v1/models?feature_key=chat&limit=20&cursor=cursor-1`, { headers: { ...authHeaders(), "x-kokoro-request-id": "model-owner-request" } })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      data: { models: [{ provider: "kokoro", name: "claude-sonnet", is_default: false, display_name: "Claude Sonnet" }], next_cursor: "model-cursor-next" },
      meta: { request_id: "model-owner-request" },
    })
    assert.deepEqual(received, {
      url: "/bff/model-catalog?featureKey=chat&limit=20&cursor=cursor-1",
      service: "web-bff",
      tenant: "ns_test",
      subject: "user_test",
    })
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
          response.end(JSON.stringify({ data: { offers: [{ id: "offer-revision-1", key: "pro", name: "Pro", currency: "USD", amountMinor: "1999", creditMicros: "1000000", billingInterval: "month" }] }, requestId: "billing-catalog" }))
          return
        }
        response.statusCode = 201
        response.end(JSON.stringify({ data: { checkoutId: "checkout-1", checkoutUrl: "https://pay.test/checkout-1" }, requestId: "billing-checkout" }))
      })
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(createBffServer(config({
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
    const base = await listen(createBffServer(config({
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
    const unauthBase = await listen(createBffServer(config()))
    const missingService = await fetch(`${unauthBase}/v1/projects`)
    assert.equal(missingService.status, 403)
    assert.equal((await missingService.json() as { error: { code: string } }).error.code, "service_auth_failed")

    const secretlessBase = await listen(createBffServer(config({ sharedSecret: null })))
    const missingServiceOnSecretless = await fetch(`${secretlessBase}/v1/projects`, {
      headers: {
        "x-kokoro-namespace": "ns_test",
        "x-kokoro-principal-id": "user_test",
      },
    })
    assert.equal(missingServiceOnSecretless.status, 401)

    const wrongSecret = await fetch(`${unauthBase}/v1/projects`, {
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "wrong",
        "x-kokoro-namespace": "ns_test",
        "x-kokoro-principal-id": "user_test",
      },
    })
    assert.equal(wrongSecret.status, 403)

    const missingNamespace = await fetch(`${unauthBase}/v1/projects`, {
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "test-secret",
        "x-kokoro-principal-id": "user_test",
      },
    })
    assert.equal(missingNamespace.status, 403)

    const missingUpstreamBase = await listen(createBffServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: null },
    })))
    const missingUpstream = await fetch(`${missingUpstreamBase}/v1/skills`, { headers: authHeaders() })
    assert.equal(missingUpstream.status, 503)
    assert.equal((await missingUpstream.json() as { error: { code: string } }).error.code, "upstream_not_configured")

    const unreachableBase = await listen(createBffServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: "http://127.0.0.1:1" },
    })))
    const unreachable = await fetch(`${unreachableBase}/v1/skills/pool`, { headers: authHeaders() })
    assert.equal(unreachable.status, 502)
    assert.equal((await unreachable.json() as { error: { code: string } }).error.code, "upstream_unreachable")

    const malformedUpstream = createServer((_request, response) => {
      response.statusCode = 200
      response.setHeader("content-type", "text/plain")
      response.end("not json")
    })
    const malformedBase = await listen(malformedUpstream)
    const malformedBff = await listen(createBffServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: malformedBase },
    })))
    const malformed = await fetch(`${malformedBff}/v1/skills/pool`, { headers: authHeaders() })
    assert.equal(malformed.status, 502)
    assert.equal((await malformed.json() as { error: { code: string } }).error.code, "upstream_response_invalid")

    const emptyUpstream = createServer((_request, response) => {
      response.statusCode = 200
      response.setHeader("content-type", "application/json")
      response.end("")
    })
    const emptyBase = await listen(emptyUpstream)
    const emptyBff = await listen(createBffServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: emptyBase },
    })))
    const empty = await fetch(`${emptyBff}/v1/skills/pool`, { headers: authHeaders() })
    assert.equal(empty.status, 502)
    assert.equal((await empty.json() as { error: { code: string } }).error.code, "upstream_response_invalid")

    const errorEnvelopeUpstream = createServer((_request, response) => {
      response.statusCode = 503
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        error: { code: "skills_unavailable", message: "Skills are down" },
        meta: { request_id: "skills-upstream-503" },
      }))
    })
    const errorEnvelopeBase = await listen(errorEnvelopeUpstream)
    const errorEnvelopeBff = await listen(createBffServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: errorEnvelopeBase },
    })))
    const errorEnvelope = await fetch(`${errorEnvelopeBff}/v1/skills/pool`, { headers: authHeaders() })
    assert.equal(errorEnvelope.status, 503)
    assert.deepEqual(await errorEnvelope.json(), {
      error: { code: "skills_unavailable", message: "Skills are down" },
      meta: { request_id: "skills-upstream-503" },
    })

    const httpErrorUpstream = createServer((_request, response) => {
      response.statusCode = 500
      response.setHeader("content-type", "text/plain")
      response.end("boom")
    })
    const httpErrorBase = await listen(httpErrorUpstream)
    const httpErrorBff = await listen(createBffServer(config({
      mode: "live",
      upstreams: { ...config().upstreams, capability: httpErrorBase },
    })))
    const httpError = await fetch(`${httpErrorBff}/v1/skills/pool`, { headers: authHeaders() })
    assert.equal(httpError.status, 500)
    assert.equal((await httpError.json() as { error: { code: string } }).error.code, "upstream_http_error")

    const baseDir = fileURLToPath(new URL("../docs/api/v1/", import.meta.url))
    for (const file of ["README.md", "projects.md", "system.md", "models.md", "skills.md", "mcp.md", "scheduled.md", "agents.md", "library.md", "billing.md", "openapi.yaml"]) {
      assert.equal(existsSync(`${baseDir}/${file}`), true, file)
    }

    const openapi = readFileSync(`${baseDir}/openapi.yaml`, "utf8")
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
    const base = await listen(createBffServer(config()))
    const headers = authHeaders()

    const list = await fetch(`${base}/v1/sessions`, { headers })
    assert.equal(list.status, 200)
    const listBody = await list.json() as { data: { sessions: Array<{ session_id: string; title: string; updated_at: string }>; next_cursor?: string }; meta: { request_id: string } }
    assert.ok(listBody.data.sessions.length >= 1)

    const sessionId = listBody.data.sessions[0]?.session_id
    assert.ok(sessionId)

    const isolated = await fetch(`${base}/v1/sessions?scope=other-scope&project_ref=project_kokoro`, { headers })
    const isolatedBody = await isolated.json() as { data: { sessions: Array<{ session_id: string }> } }
    assert.equal(isolatedBody.data.sessions.length, 0)

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
        event_watermark: number
      }
      meta: { request_id: string }
    }
    assert.equal(detailBody.data.session.session_id, sessionId)
    assert.equal(detailBody.data.session.owner_id, "ns_test")
    assert.equal(detailBody.data.event_watermark, 2)
    assert.equal(detailBody.data.pending_pauses.length, 0)
    assert.equal(detailBody.data.files.length, 0)
    assert.equal(detailBody.data.deliveries.length, 0)

    const message = await fetch(`${base}/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "chat-message-1" },
      body: JSON.stringify({ content: "Hello from mock chat" }),
    })
    assert.equal(message.status, 200)
    const messageBody = await message.json() as {
      data: { run_id: string; user_message_id: string; assistant_message_id: string }
      meta: { request_id: string }
    }
    assert.ok(messageBody.data.run_id.length > 0)
    assert.ok(messageBody.data.user_message_id.length > 0)
    assert.ok(messageBody.data.assistant_message_id.length > 0)

    const events = await fetch(`${base}/v1/sessions/${sessionId}/events`, { headers })
    assert.equal(events.status, 200)
    assert.ok((events.headers.get("content-type") || "").startsWith("text/event-stream"))
    const eventsText = await events.text()
    const frames = eventsText.trim().split(/\n\n/u).filter(Boolean)
    assert.ok(frames.length >= 2)
    const firstFrameData = frames[0]?.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length) || ""
    const firstEvent = JSON.parse(firstFrameData) as { kind: string; payload: { owner_id: string } }
    assert.equal(firstEvent.kind, "session.created")
    assert.equal(firstEvent.payload.owner_id, "ns_test")

    const control = await fetch(`${base}/v1/sessions/${sessionId}/runs/${messageBody.data.run_id}/control`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "chat-control-1" },
      body: JSON.stringify({ action: "cancel" }),
    })
    assert.equal(control.status, 200)
    const controlBody = await control.json() as { data: { ok: true }; meta: { request_id: string } }
    assert.equal(controlBody.data.ok, true)

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
      data: { session: { session_id: string; title: string; owner_id: string }; pending_pauses: unknown[]; files: unknown[]; deliveries: unknown[]; event_watermark: number }
      meta: { request_id: string }
    }
    assert.equal(publicShareBody.data.session.session_id, sessionId)
    assert.equal(publicShareBody.data.session.owner_id, "ns_test")
    assert.equal(publicShareBody.data.event_watermark >= 2, true)

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

  it("adapts live Chat launch, replay, detail, and control to the Agent ingress", async () => {
    const received: Array<{ method: string; url: string; headers: Record<string, string | undefined>; body: Record<string, unknown> }> = []
    const agent = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
      const headers = {
        xDomain: request.headers["x-domain"]?.toString(),
        service: request.headers["x-kokoro-service"]?.toString(),
        contentLength: request.headers["content-length"]?.toString(),
        tenant: request.headers["x-kokoro-tenant-ref"]?.toString(),
        subject: request.headers["x-kokoro-subject-ref"]?.toString(),
        actor: request.headers["x-kokoro-actor-ref"]?.toString(),
        assertion: request.headers["x-kokoro-identity-assertion-ref"]?.toString(),
      }
      received.push({ method: request.method || "", url: request.url || "", headers, body })
      const runId = typeof body.run_id === "string" ? body.run_id : "run_bff_test"
      const sessionId = typeof body.session_id === "string" ? body.session_id : "session-live"
      const events = [
        { chat_event_id: "cev-start", session_id: sessionId, run_id: runId, event_type: "run.started", payload_json: '{"status":"running"}', seq: 1, created_at: 1 },
        { chat_event_id: "cev-delta", session_id: sessionId, run_id: runId, chat_message_id: "msg-final", event_type: "assistant.delta", payload_json: '{"delta":"hello"}', seq: 2, created_at: 2 },
        { chat_event_id: "cev-complete", session_id: sessionId, run_id: runId, chat_message_id: "msg-final", event_type: "assistant.completed", payload_json: '{"content":"hello"}', seq: 3, created_at: 3 },
        { chat_event_id: "cev-terminal", session_id: sessionId, run_id: runId, event_type: "run.completed", payload_json: '{"status":"completed","token_usage":null}', seq: 4, created_at: 4 },
      ]
      response.setHeader("content-type", "application/json")
      if (request.url === "/v1/runs" && request.method === "POST") {
        response.statusCode = 202
        response.end(JSON.stringify({ data: { run_id: runId, session_id: sessionId, replayed: false }, meta: { request_id: "agent" } }))
      } else if (request.url?.startsWith("/v1/runs/") && request.url.endsWith("/control") && request.method === "POST") {
        response.statusCode = 202
        response.end(JSON.stringify({ data: { run_id: runId, accepted: true }, meta: { request_id: "agent" } }))
      } else if (request.url?.includes("/messages") && request.method === "GET") {
        response.end(JSON.stringify({ data: { messages: [{ chat_message_id: "user-msg", session_id: sessionId, run_id: runId, role: "user", content: "hello", status: "completed", seq: 1, created_at: 1, updated_at: 1 }], next_seq: 1 }, meta: { request_id: "agent" } }))
      } else if (request.url?.includes("/events") && request.method === "GET") {
        response.end(JSON.stringify({ data: { events, next_seq: 4, watermark: 4 }, meta: { request_id: "agent" } }))
      } else {
        response.statusCode = 404
        response.end(JSON.stringify({ error: { code: "route_not_found", message: "not found" }, meta: { request_id: "agent" } }))
      }
    })
    const agentBase = await listen(agent)
    const base = await listen(createBffServer(config({
      mode: "live",
      agentEnabled: true,
      upstreams: { ...config().upstreams, agents: agentBase },
    })))
    const headers = { ...authHeaders(), "content-type": "application/json", "idempotency-key": "live-chat-1", "x-domain": "spoofed.example" }
    const first = await fetch(`${base}/v1/sessions/session-live/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "hello", model: "default", project_ref: "project_kokoro" }),
    })
    assert.equal(first.status, 202)
    const firstEnvelope = await first.json() as { data: { run_id: string; user_message_id: string; assistant_message_id: string }; meta: { request_id: string } }
    assert.ok(firstEnvelope.data.run_id.startsWith("run_bff_"))
    assert.ok(firstEnvelope.data.assistant_message_id.endsWith("_assistant"))
    assert.equal(received[0]?.headers.xDomain, undefined)
    assert.equal(received[0]?.headers.service, "kokoro-bff")
    assert.equal(Number(received[0]?.headers.contentLength), Buffer.byteLength(JSON.stringify(received[0]?.body)))
    assert.equal(received[0]?.headers.tenant, "ns_test")
    assert.equal(received[0]?.headers.subject, "user_test")
    assert.equal(received[0]?.headers.actor, "user_test")
    assert.equal((received[0]?.body.execution_identity as { tenant_ref: string }).tenant_ref, "ns_test")
    assert.equal((received[0]?.body as { trace: { project_ref: string } }).trace.project_ref, "project_kokoro")

    const replay = await fetch(`${base}/v1/sessions/session-live/messages`, { method: "POST", headers, body: JSON.stringify({ content: "hello", model: "default", project_ref: "project_kokoro" }) })
    assert.equal(replay.status, 202)
    assert.deepEqual(await replay.json(), firstEnvelope)
    assert.equal(received.filter((item) => item.url === "/v1/runs").length, 1)

    const events = await fetch(`${base}/v1/sessions/session-live/events`, { headers: authHeaders() })
    assert.equal(events.status, 200)
    const eventFrames = (await events.text()).trim().split("\n\n").filter(Boolean)
    assert.equal(eventFrames.length, 4)
    assert.match(eventFrames[0] || "", /"kind":"run.created"/u)
    assert.match(eventFrames[1] || "", /"kind":"message.delta"/u)

    const detail = await fetch(`${base}/v1/sessions/session-live`, { headers: authHeaders() })
    assert.equal(detail.status, 200)
    const detailBody = await detail.json() as { data: { session: { owner_id: string }; messages: unknown[]; event_watermark: number } }
    assert.equal(detailBody.data.session.owner_id, "ns_test")
    assert.equal(detailBody.data.messages.length, 1)
    assert.equal(detailBody.data.event_watermark, 4)

    const control = await fetch(`${base}/v1/sessions/session-live/runs/${firstEnvelope.data.run_id}/control`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "live-control-1" },
      body: JSON.stringify({ kind: "run.cancel", decision_id: "decision-1" }),
    })
    assert.equal(control.status, 200)
    assert.deepEqual((await control.json() as { data: { ok: boolean } }).data, { ok: true })
    const controlRequest = received.find((item) => item.url?.endsWith("/control"))
    assert.deepEqual(controlRequest?.body, { kind: "run.cancel", session_id: "session-live", decision_id: "decision-1" })
  })

  it("keeps unsupported live Chat mutations explicit instead of falling back to mock state", async () => {
    const agent = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { events: [], messages: [], watermark: 0 }, meta: { request_id: "agent" } }))
    })
    const agentBase = await listen(agent)
    const base = await listen(createBffServer(config({ mode: "live", agentEnabled: true, upstreams: { ...config().upstreams, agents: agentBase } })))
    const response = await fetch(`${base}/v1/sessions/session-live/title`, {
      method: "PATCH",
      headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "unsupported-title" },
      body: JSON.stringify({ title: "Should not be silently local" }),
    })
    assert.equal(response.status, 503)
    assert.equal((await response.json() as { error: { code: string } }).error.code, "chat_projection_not_configured")
  })
})
