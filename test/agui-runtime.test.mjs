import assert from "node:assert/strict"
import { describe, it } from "node:test"

const runtimeModule = await import("../dist/application/agui/session-runtime.js").catch(() => null)

const pollResult = (fetchedEvents) => ({
  fetchedEvents,
  insertedFrames: fetchedEvents,
  sourceHighWatermark: fetchedEvents,
  snapshotWatermark: fetchedEvents,
})

describe("AG-UI session runtime", () => {
  it("enforces global, tenant, and session connection limits with idempotent leases", () => {
    assert.notEqual(runtimeModule, null)
    const limiter = new runtimeModule.AgUiConnectionLimiter({
      global: 2,
      perTenant: 2,
      perSession: 1,
    })

    const first = limiter.acquire("tenant_a", "session_1")
    assert.notEqual(first, null)
    assert.equal(limiter.acquire("tenant_a", "session_1"), null)
    const second = limiter.acquire("tenant_a", "session_2")
    assert.notEqual(second, null)
    assert.equal(limiter.acquire("tenant_b", "session_3"), null)
    assert.deepEqual(limiter.snapshot(), {
      global: 2,
      tenants: { tenant_a: 2 },
      sessions: { "tenant_a/session_1": 1, "tenant_a/session_2": 1 },
    })

    first.release()
    first.release()
    const third = limiter.acquire("tenant_b", "session_3")
    assert.notEqual(third, null)
    second.release()
    third.release()
    assert.deepEqual(limiter.snapshot(), { global: 0, tenants: {}, sessions: {} })
  })

  it("coalesces concurrent source polls and backs empty sessions off with jitter", async () => {
    assert.notEqual(runtimeModule, null)
    let now = 1000
    let calls = 0
    const sleeps = []
    const coordinator = new runtimeModule.AgUiSourcePollCoordinator({
      baseDelayMs: 100,
      maxDelayMs: 800,
      jitterRatio: 0.2,
    }, {
      now: () => now,
      random: () => 0.75,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      },
    })
    const emptyPoll = async () => {
      calls += 1
      await new Promise((resolve) => setImmediate(resolve))
      return pollResult(0)
    }

    const firstWave = await Promise.all(Array.from({ length: 20 }, () => coordinator.poll("tenant_a", "session_1", emptyPoll)))
    assert.equal(calls, 1)
    assert.ok(firstWave.every((result) => result.fetchedEvents === 0))

    await Promise.all(Array.from({ length: 20 }, () => coordinator.poll("tenant_a", "session_1", emptyPoll)))
    assert.equal(calls, 2)
    assert.deepEqual(sleeps, [110])

    await coordinator.poll("tenant_a", "session_1", emptyPoll)
    assert.equal(calls, 3)
    assert.deepEqual(sleeps, [110, 220])

    await coordinator.poll("tenant_a", "session_1", async () => {
      calls += 1
      return pollResult(1)
    })
    await coordinator.poll("tenant_a", "session_1", emptyPoll)
    assert.deepEqual(sleeps, [110, 220, 440, 110])
  })

  it("coalesces identical replay reads and invalidates the short-lived page cache after ingest", async () => {
    assert.notEqual(runtimeModule, null)
    let now = 10
    let loads = 0
    const coordinator = new runtimeModule.AgUiReplayCoordinator({ cacheTtlMs: 25 }, { now: () => now })
    const load = async () => {
      loads += 1
      await new Promise((resolve) => setImmediate(resolve))
      return { kind: "page", frames: [], atHead: true, terminalRunId: null }
    }

    await Promise.all(Array.from({ length: 20 }, () => coordinator.replay("tenant_a", "session_1", null, 128, 4096, load)))
    assert.equal(loads, 1)
    await coordinator.replay("tenant_a", "session_1", null, 128, 4096, load)
    assert.equal(loads, 1)

    coordinator.invalidate("tenant_a", "session_1")
    await coordinator.replay("tenant_a", "session_1", null, 128, 4096, load)
    assert.equal(loads, 2)
    now += 26
    await coordinator.replay("tenant_a", "session_1", null, 128, 4096, load)
    assert.equal(loads, 3)
    assert.deepEqual(coordinator.snapshot(), { loads: 3, entries: 1 })
  })
})
