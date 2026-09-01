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
