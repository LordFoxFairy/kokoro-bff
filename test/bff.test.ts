import { createServer, type Server } from "node:http"
import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"

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
    upstreams: {
      projects: null,
      hub: null,
      skills: null,
      scheduled: null,
      agents: null,
      library: null,
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
    "x-kokoro-user-id": "user_test",
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
  })

  it("keeps Agent setup as a BFF projection while Chat remains outside this service", async () => {
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
    assert.equal((await listed.json() as { data: { tasks: unknown[] } }).data.tasks.length, 2)
    assert.match(createdBody.data.task.id, /^scheduled_/)
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
    const registered = await fetch(`${base}/v1/mcp/servers`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        name,
        transport: "streamable_http",
        url: "https://mcp.example.test/stream",
        allowed_tools: ["search", "fetch"],
        secret_ref: "handle:srt_fixture",
      }),
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

  it("generates standard Forwarded context for live upstream calls", async () => {
    let received: Record<string, string | undefined> = {}
    const upstream = createServer((request, response) => {
      received = {
        forwarded: request.headers.forwarded,
        service: request.headers["x-kokoro-service"]?.toString(),
        secret: request.headers["x-kokoro-internal-secret"]?.toString(),
        xDomain: request.headers["x-domain"]?.toString(),
      }
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ project: { id: "project_live" } }))
    })
    const upstreamBase = await listen(upstream)
    const base = await listen(createBffServer(config({ mode: "live", upstreams: { ...config().upstreams, projects: upstreamBase } })))
    const response = await fetch(`${base}/v1/projects/project_live`, { headers: { ...authHeaders(), "x-domain": "evil.example", "x-kokoro-request-id": "live-request" } })
    assert.equal(response.status, 200)
    assert.deepEqual(received, { forwarded: "host=dev.kokoro.localhost", service: "kokoro-bff", secret: "bff-upstream-secret", xDomain: undefined })
    assert.equal((await response.json() as { meta: { request_id: string } }).meta.request_id, "live-request")
  })
})
