import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { describe, it } from "node:test"

import { loadConfig } from "../dist/config/runtime.js"

const runtimeEnv = {
  KOKORO_BFF_SHARED_SECRET: "test-secret",
  KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/kokoro_bff",
  KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
}

describe("kokoro-bff optional Agent configuration", () => {
  it("defaults Agent to optional and disabled", () => {
    const config = loadConfig({ ...runtimeEnv, KOKORO_DOMAIN: "dev.kokoro.localhost" })
    assert.equal(config.agentEnabled, false)
    assert.equal(config.tenantId, null)
    assert.equal(config.upstreamTimeoutMs, 5000)
    assert.equal(config.upstreamMaxResponseBytes, 1024 * 1024)
    assert.equal(config.upstreams.music, null)
    assert.deepEqual(config.agUi, {
      replayPageFrames: 128,
      replayPageBytes: 1024 * 1024,
      streamMaxFrames: 10_000,
      streamMaxBytes: 16 * 1024 * 1024,
      streamMaxDurationMs: 5 * 60 * 1000,
      maxConnectionsGlobal: 256,
      maxConnectionsPerTenant: 64,
      maxConnectionsPerSession: 8,
      pollBaseDelayMs: 1000,
      pollMaxDelayMs: 8000,
      pollJitterPercent: 20,
      replayCacheTtlMs: 25,
    })
  })

  it("enables Agent explicitly for live execution", () => {
    const config = loadConfig({
      ...runtimeEnv,
      KOKORO_BFF_MODE: "live",
      KOKORO_DOMAIN: "app.example.com",
      KOKORO_TENANT_ID: "tenant_prod",
      KOKORO_BFF_SHARED_SECRET: "bff-secret",
      KOKORO_BFF_POSTGRES_URL: "postgresql://kokoro-bff/db",
      KOKORO_BFF_REDIS_URL: "rediss://kokoro-redis:6380/8",
      KOKORO_AGENT_ENABLED: "1",
      KOKORO_AGENT_BASE_URL: "http://kokoro-agent:4401",
      KOKORO_MUSIC_BASE_URL: "http://kokoro-music:4410",
    })
    assert.equal(config.agentEnabled, true)
    assert.equal(config.tenantId, "tenant_prod")
    assert.equal(config.upstreams.agents, "http://kokoro-agent:4401")
    assert.equal(config.upstreams.music, "http://kokoro-music:4410")
  })

  it("loads owner transport limits from the environment", () => {
    const config = loadConfig({
      ...runtimeEnv,
      KOKORO_DOMAIN: "dev.kokoro.localhost",
      KOKORO_UPSTREAM_TIMEOUT_MS: "250",
      KOKORO_UPSTREAM_MAX_RESPONSE_BYTES: "4096",
    })
    assert.equal(config.upstreamTimeoutMs, 250)
    assert.equal(config.upstreamMaxResponseBytes, 4096)
  })

  it("loads AG-UI replay and stream budgets from the environment", () => {
    const config = loadConfig({
      ...runtimeEnv,
      KOKORO_DOMAIN: "dev.kokoro.localhost",
      KOKORO_AGUI_REPLAY_PAGE_FRAMES: "16",
      KOKORO_AGUI_REPLAY_PAGE_BYTES: "4096",
      KOKORO_AGUI_STREAM_MAX_FRAMES: "32",
      KOKORO_AGUI_STREAM_MAX_BYTES: "8192",
      KOKORO_AGUI_STREAM_MAX_DURATION_MS: "250",
      KOKORO_AGUI_MAX_CONNECTIONS_GLOBAL: "12",
      KOKORO_AGUI_MAX_CONNECTIONS_PER_TENANT: "6",
      KOKORO_AGUI_MAX_CONNECTIONS_PER_SESSION: "3",
      KOKORO_AGUI_POLL_BASE_DELAY_MS: "40",
      KOKORO_AGUI_POLL_MAX_DELAY_MS: "320",
      KOKORO_AGUI_POLL_JITTER_PERCENT: "10",
      KOKORO_AGUI_REPLAY_CACHE_TTL_MS: "15",
    })
    assert.deepEqual(config.agUi, {
      replayPageFrames: 16,
      replayPageBytes: 4096,
      streamMaxFrames: 32,
      streamMaxBytes: 8192,
      streamMaxDurationMs: 250,
      maxConnectionsGlobal: 12,
      maxConnectionsPerTenant: 6,
      maxConnectionsPerSession: 3,
      pollBaseDelayMs: 40,
      pollMaxDelayMs: 320,
      pollJitterPercent: 10,
      replayCacheTtlMs: 15,
    })
  })

  it("requires explicit live persistence and rejects the removed mode", () => {
    assert.throws(() => loadConfig({ KOKORO_DOMAIN: "dev.kokoro.localhost", KOKORO_BFF_SHARED_SECRET: "test-secret" }), /KOKORO_BFF_POSTGRES_URL/u)
    assert.throws(() => loadConfig({ ...runtimeEnv, KOKORO_BFF_MODE: "mock" }), /KOKORO_BFF_MODE must be live/u)
  })

  it("keeps the checked-in runtime example aligned with the live-only loader", async () => {
    const example = await readFile(new URL("../.env.example", import.meta.url), "utf8")
    assert.match(example, /^KOKORO_BFF_MODE=live$/mu)
    assert.doesNotMatch(example, /^KOKORO_BFF_MODE=mock$/mu)
  })
})
