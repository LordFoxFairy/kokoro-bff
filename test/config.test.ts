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
      ledgerPollBaseDelayMs: 1000,
      ledgerPollMaxDelayMs: 8000,
      ledgerPollJitterPercent: 20,
      replayCacheTtlMs: 25,
      projectorMaxConsumersPerCycle: 32,
      projectorSourcePageSize: 256,
      projectorMaxPagesPerConsumer: 8,
      projectorSourceMaxAttempts: 3,
      projectorLeaseDurationMs: 15_000,
      projectorLeaseSettlementReserveMs: 500,
      projectorPollIntervalMs: 1000,
      projectorErrorBackoffMs: 5000,
      projectorErrorBackoffMaxMs: 5 * 60 * 1000,
      projectorErrorBackoffJitterPercent: 20,
      retentionMs: 7 * 24 * 60 * 60 * 1000,
      gcIntervalMs: 15 * 60 * 1000,
      gcBatchSize: 100,
      cursorTombstoneRetentionMs: 30 * 24 * 60 * 60 * 1000,
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
      KOKORO_AGUI_LEDGER_POLL_BASE_DELAY_MS: "40",
      KOKORO_AGUI_LEDGER_POLL_MAX_DELAY_MS: "320",
      KOKORO_AGUI_LEDGER_POLL_JITTER_PERCENT: "10",
      KOKORO_AGUI_REPLAY_CACHE_TTL_MS: "15",
      KOKORO_AGUI_PROJECTOR_MAX_CONSUMERS_PER_CYCLE: "5",
      KOKORO_AGUI_PROJECTOR_SOURCE_PAGE_SIZE: "6",
      KOKORO_AGUI_PROJECTOR_MAX_PAGES_PER_CONSUMER: "7",
      KOKORO_AGUI_PROJECTOR_SOURCE_MAX_ATTEMPTS: "8",
      KOKORO_AGUI_PROJECTOR_LEASE_DURATION_MS: "9000",
      KOKORO_AGUI_PROJECTOR_LEASE_SETTLEMENT_RESERVE_MS: "500",
      KOKORO_AGUI_PROJECTOR_POLL_INTERVAL_MS: "11",
      KOKORO_AGUI_PROJECTOR_ERROR_BACKOFF_MS: "12",
      KOKORO_AGUI_PROJECTOR_ERROR_BACKOFF_MAX_MS: "120",
      KOKORO_AGUI_PROJECTOR_ERROR_BACKOFF_JITTER_PERCENT: "15",
      KOKORO_AGUI_RETENTION_MS: "13000",
      KOKORO_AGUI_GC_INTERVAL_MS: "14",
      KOKORO_AGUI_GC_BATCH_SIZE: "15",
      KOKORO_AGUI_CURSOR_TOMBSTONE_RETENTION_MS: "16000",
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
      ledgerPollBaseDelayMs: 40,
      ledgerPollMaxDelayMs: 320,
      ledgerPollJitterPercent: 10,
      replayCacheTtlMs: 15,
      projectorMaxConsumersPerCycle: 5,
      projectorSourcePageSize: 6,
      projectorMaxPagesPerConsumer: 7,
      projectorSourceMaxAttempts: 8,
      projectorLeaseDurationMs: 9000,
      projectorLeaseSettlementReserveMs: 500,
      projectorPollIntervalMs: 11,
      projectorErrorBackoffMs: 12,
      projectorErrorBackoffMaxMs: 120,
      projectorErrorBackoffJitterPercent: 15,
      retentionMs: 13000,
      gcIntervalMs: 14,
      gcBatchSize: 15,
      cursorTombstoneRetentionMs: 16000,
    })
  })

  it("requires the projector lease to exceed one upstream request timeout", () => {
    assert.throws(() => loadConfig({
      ...runtimeEnv,
      KOKORO_UPSTREAM_TIMEOUT_MS: "5000",
      KOKORO_AGUI_PROJECTOR_LEASE_DURATION_MS: "5000",
    }), /projector lease duration must exceed the upstream timeout/u)
  })

  it("requires room for source settlement and a monotonic projector backoff range", () => {
    assert.throws(() => loadConfig({
      ...runtimeEnv,
      KOKORO_UPSTREAM_TIMEOUT_MS: "5000",
      KOKORO_AGUI_PROJECTOR_LEASE_DURATION_MS: "5400",
      KOKORO_AGUI_PROJECTOR_LEASE_SETTLEMENT_RESERVE_MS: "500",
    }), /lease duration must exceed the upstream timeout plus settlement reserve/u)
    assert.throws(() => loadConfig({
      ...runtimeEnv,
      KOKORO_AGUI_PROJECTOR_ERROR_BACKOFF_MS: "1001",
      KOKORO_AGUI_PROJECTOR_ERROR_BACKOFF_MAX_MS: "1000",
    }), /error backoff base must not exceed its maximum/u)
  })

  it("rejects source pages above the Agent contract and tombstones shorter than ledger retention", () => {
    assert.throws(() => loadConfig({
      ...runtimeEnv,
      KOKORO_AGUI_PROJECTOR_SOURCE_PAGE_SIZE: "1001",
    }), /source page size must not exceed 1000/u)
    assert.throws(() => loadConfig({
      ...runtimeEnv,
      KOKORO_AGUI_RETENTION_MS: "1000",
      KOKORO_AGUI_CURSOR_TOMBSTONE_RETENTION_MS: "999",
    }), /cursor tombstone retention must not be shorter than ledger retention/u)
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
