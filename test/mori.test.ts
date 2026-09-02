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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe("Mori music projection", () => {
  it("creates a project-bound generation, replays idempotency, and streams progress", async () => {
    const base = await listen(createBffServer(config()))
    const projectRef = "project_preview_first_light"
    const project = await fetch(`${base}/v1/mori/projects/${projectRef}`, { headers: authHeaders() })
    const projectBody = await project.json() as { data: { project_ref: string; candidate_count: number }; meta: { request_id: string } }
    assert.equal(project.status, 200)
    assert.equal(projectBody.data.project_ref, projectRef)
    assert.equal(projectBody.data.candidate_count, 2)
    assert.ok(projectBody.meta.request_id)

    const init = {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "mori-generation-1" },
      body: JSON.stringify({
        song_plan_ref: "song_plan_preview_first_light",
        mode: "smart",
        prompt: "A warm late-night track for the drive home.",
        lyrics: null,
        lyrics_mode: "instrumental",
        style: "dream pop intimate organic",
        reference_asset_refs: [],
        voice_ref: null,
        duration_seconds: 180,
      }),
    }
    const first = await fetch(`${base}/v1/mori/projects/${projectRef}/generations`, init)
    const replay = await fetch(`${base}/v1/mori/projects/${projectRef}/generations`, init)
    const firstBody = await first.json() as { data: { generation_ref: string; status: string }; meta: { request_id: string } }
    assert.equal(first.status, 202)
    assert.deepEqual(firstBody, await replay.json())
    assert.equal(firstBody.data.status, "queued")

    const events = await fetch(`${base}/v1/mori/generations/${firstBody.data.generation_ref}/events`, { headers: authHeaders() })
    const eventText = await events.text()
    assert.equal(events.status, 200)
    assert.match(events.headers.get("content-type") || "", /text\/event-stream/u)
    assert.match(eventText, new RegExp(`id: ${firstBody.data.generation_ref}:1`, "u"))

    await wait(125)
    const replayedEvents = await fetch(`${base}/v1/mori/generations/${firstBody.data.generation_ref}/events`, {
      headers: { ...authHeaders(), "last-event-id": `${firstBody.data.generation_ref}:1` },
    })
    const replayedEventText = await replayedEvents.text()
    assert.equal(replayedEvents.status, 200)
    assert.doesNotMatch(replayedEventText, new RegExp(`id: ${firstBody.data.generation_ref}:1`, "u"))
    assert.match(replayedEventText, new RegExp(`id: ${firstBody.data.generation_ref}:2`, "u"))
    const snapshot = await fetch(`${base}/v1/mori/generations/${firstBody.data.generation_ref}`, { headers: authHeaders() })
    const snapshotBody = await snapshot.json() as { data: { status: string; progress: number; candidate_refs: string[] } }
    assert.equal(snapshot.status, 200)
    assert.equal(snapshotBody.data.status, "succeeded")
    assert.equal(snapshotBody.data.progress, 100)
    assert.equal(snapshotBody.data.candidate_refs.length, 2)
  })

  it("requires a mutation key and leaves cancellation as an explicit terminal state", async () => {
    const base = await listen(createBffServer(config()))
    const path = `${base}/v1/mori/projects/project_preview_first_light/generations`
    const body = JSON.stringify({
      song_plan_ref: null,
      mode: "smart",
      prompt: "quiet morning",
      lyrics: null,
      lyrics_mode: "instrumental",
      style: null,
      reference_asset_refs: [],
      voice_ref: null,
      duration_seconds: null,
    })
    const missingKey = await fetch(path, { method: "POST", headers: { ...authHeaders(), "content-type": "application/json" }, body })
    assert.equal(missingKey.status, 400)
    assert.equal((await missingKey.json() as { error: { code: string } }).error.code, "idempotency_key_required")

    const created = await fetch(path, { method: "POST", headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "mori-generation-cancel" }, body })
    const createdBody = await created.json() as { data: { generation_ref: string } }
    const cancel = await fetch(`${base}/v1/mori/generations/${createdBody.data.generation_ref}/cancel`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "mori-cancel-1" },
      body: "{}",
    })
    const cancelBody = await cancel.json() as { data: { status: string } }
    assert.equal(cancel.status, 202)
    assert.equal(cancelBody.data.status, "cancelled")
  })

  it("does not silently use mock music facts in live mode", async () => {
    const base = await listen(createBffServer(config({ mode: "live" })))
    const response = await fetch(`${base}/v1/mori/projects/project_preview_first_light`, { headers: authHeaders() })
    const body = await response.json() as { error: { code: string } }
    assert.equal(response.status, 503)
    assert.equal(body.error.code, "mori_projection_not_configured")
  })
})
