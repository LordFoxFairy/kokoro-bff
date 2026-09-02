import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { afterEach, describe, it } from "node:test"

import { createBffServer } from "../dist/main.js"
import type { BffConfig } from "../src/config.js"
import { musicOwnerRoute, projectMoriResponse, projectMoriEventStream } from "../dist/adapters/music.js"

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
    sharedSecret: "test-secret",
    upstreamSecret: "bff-upstream-secret",
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    upstreams: {
      system: null,
      model: null,
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

describe("Mori Music owner adapter", () => {
  it("maps only documented Mori routes to the internal Music owner path", () => {
    const route = musicOwnerRoute(
      ["mori", "projects", "project_123", "candidates"],
      "GET",
      "/v1/mori/projects/project_123/candidates?limit=20&cursor=page_2&provider=secret",
    )

    assert.deepEqual(route, {
      path: "/internal/bff/mori/projects/project_123/candidates?limit=20&cursor=page_2",
      kind: "candidate_list",
      stream: false,
    })
  })

  it("rejects undocumented methods, malformed refs, and provider query parameters", () => {
    assert.equal(musicOwnerRoute(["mori", "projects", "project_123"], "POST", "/v1/mori/projects/project_123"), null)
    assert.equal(musicOwnerRoute(["mori", "projects", "project/with-slash"], "GET", "/v1/mori/projects/project%2Fwith-slash"), null)
    assert.equal(musicOwnerRoute(["mori", "generations", "generation_1", "events"], "GET", "/v1/mori/generations/generation_1/events?provider_task_id=secret")?.path, "/internal/bff/mori/generations/generation_1/events")
    assert.equal(musicOwnerRoute(["mori", "unknown"], "GET", "/v1/mori/unknown"), null)
  })

  it("projects a Music owner response to the public Mori fields", () => {
    const projected = projectMoriResponse("project", {
      data: {
        project_ref: "project_123",
        title: "First Light",
        description: "A warm sketch.",
        current_version_ref: null,
        candidate_count: 2,
        last_activity_at: "2026-09-02T12:00:00.000Z",
        provider_task_id: "provider-secret",
        provider_name: "private-provider",
      },
      meta: { request_id: "owner-request" },
    }, "bff-request")

    assert.deepEqual(projected, {
      data: {
        project_ref: "project_123",
        title: "First Light",
        description: "A warm sketch.",
        current_version_ref: null,
        candidate_count: 2,
        last_activity_at: "2026-09-02T12:00:00.000Z",
      },
      meta: { request_id: "bff-request" },
    })
    assert.equal(JSON.stringify(projected).includes("provider"), false)
  })

  it("projects SSE envelopes and preserves replay framing", () => {
    const projected = projectMoriEventStream(
      "generation_1",
      Buffer.from([
        ": keep-alive",
        "",
        "id: generation_1:3",
        "event: generation.progress",
        `data: ${JSON.stringify({
          data: {
            generation_ref: "generation_1",
            project_ref: "project_123",
            status: "generating",
            progress: 64,
            candidate_refs: [],
            provider_task_id: "provider-secret",
          },
          meta: { request_id: "owner-request" },
        })}`,
        "",
      ].join("\n")),
      "bff-request",
    )

    assert.equal(projected?.toString("utf8"), [
      ": keep-alive",
      "",
      "id: generation_1:3",
      "event: generation.progress",
      `data: ${JSON.stringify({
        data: {
          generation_ref: "generation_1",
          project_ref: "project_123",
          status: "generating",
          progress: 64,
          candidate_refs: [],
        },
        meta: { request_id: "bff-request" },
      })}`,
      "",
      "",
    ].join("\n"))
  })

  it("forwards a live Mori request through the Music owner boundary", async () => {
    let receivedPath = ""
    let receivedAuthorization = ""
    const owner = createServer((request, response) => {
      receivedPath = request.url || ""
      receivedAuthorization = typeof request.headers.authorization === "string" ? request.headers.authorization : ""
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        data: {
          project_ref: "project_123",
          title: "First Light",
          description: "A warm sketch.",
          current_version_ref: null,
          candidate_count: 2,
          last_activity_at: "2026-09-02T12:00:00.000Z",
          provider_task_id: "provider-secret",
        },
        meta: { request_id: "owner-request" },
      }))
    })
    const ownerBase = await listen(owner)
    const bff = await listen(createBffServer(config({ upstreams: { ...config().upstreams, music: ownerBase } })))

    const response = await fetch(`${bff}/v1/mori/projects/project_123?provider=secret`, {
      headers: { ...authHeaders(), authorization: "Bearer user-secret" },
    })
    const body = await response.json() as { data: { project_ref: string; candidate_count: number; provider_task_id?: string }; meta: { request_id: string } }

    assert.equal(response.status, 200)
    assert.equal(receivedPath, "/internal/bff/mori/projects/project_123")
    assert.equal(receivedAuthorization, "Bearer bff-upstream-secret")
    assert.deepEqual(body.data, {
      project_ref: "project_123",
      title: "First Light",
      description: "A warm sketch.",
      current_version_ref: null,
      candidate_count: 2,
      last_activity_at: "2026-09-02T12:00:00.000Z",
    })
    assert.equal(body.data.provider_task_id, undefined)
    assert.equal(body.meta.request_id.length > 0, true)
  })

  it("forwards and projects Music owner generation events with replay ids", async () => {
    const owner = createServer((request, response) => {
      assert.equal(request.url, "/internal/bff/mori/generations/generation_1/events")
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.end([
        "id: generation_1:3",
        "event: generation.progress",
        `data: ${JSON.stringify({ data: { generation_ref: "generation_1", project_ref: "project_123", status: "generating", progress: 64, candidate_refs: [], provider_task_id: "provider-secret" }, meta: { request_id: "owner-request" } })}`,
        "",
      ].join("\n"))
    })
    const ownerBase = await listen(owner)
    const bff = await listen(createBffServer(config({ upstreams: { ...config().upstreams, music: ownerBase } })))
    const response = await fetch(`${bff}/v1/mori/generations/generation_1/events`, { headers: authHeaders() })
    const text = await response.text()

    assert.equal(response.status, 200)
    assert.match(response.headers.get("content-type") || "", /text\/event-stream/u)
    assert.match(text, /id: generation_1:3/u)
    assert.match(text, /event: generation\.progress/u)
    assert.doesNotMatch(text, /provider/u)
    assert.match(text, /"request_id":"[^"]+"/u)
  })
})
