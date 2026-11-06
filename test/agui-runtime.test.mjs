import assert from "node:assert/strict"
import { describe, it } from "node:test"

const runtimeModule = await import("../dist/application/agui/session-runtime.js").catch(() => null)

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

  it("coalesces concurrent ledger waits and resets backoff after observing frames", async () => {
    assert.notEqual(runtimeModule, null)
    const sleeps = []
    const coordinator = new runtimeModule.AgUiLedgerWaitCoordinator(
      {
        baseDelayMs: 100,
        maxDelayMs: 800,
        jitterRatio: 0.2,
      },
      {
        random: () => 0.75,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds)
          await new Promise((resolve) => setImmediate(resolve))
        },
      },
    )

    await Promise.all(Array.from({ length: 20 }, () => coordinator.wait("tenant_a", "session_1")))
    assert.deepEqual(sleeps, [110])
    assert.deepEqual(coordinator.snapshot(), { waits: 1, entries: 1 })

    await coordinator.wait("tenant_a", "session_1")
    assert.deepEqual(sleeps, [110, 220])

    coordinator.observedChange("tenant_a", "session_1")
    await coordinator.wait("tenant_a", "session_1")
    assert.deepEqual(sleeps, [110, 220, 110])
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
  it("retires only the cancelled waiter while another client retains their shared session wait", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const coordinator = new runtimeModule.AgUiLedgerWaitCoordinator({ baseDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 })
    const clientA = new AbortController()
    const clientB = new AbortController()
    let settledA = false
    let settledB = false
    const waitingA = coordinator.wait("tenant_a", "session_1", clientA.signal).finally(() => {
      settledA = true
    })
    const waitingB = coordinator.wait("tenant_a", "session_1", clientB.signal).finally(() => {
      settledB = true
    })
    const collected = Promise.allSettled([waitingA, waitingB])
    try {
      clientA.abort()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(settledA, true, "the cancelled client must leave without waiting for the shared delay")
      assert.equal(settledB, false, "one client must not retire another client on the same session")
      assert.deepEqual(coordinator.snapshot(), { waits: 1, entries: 1 })
      t.mock.timers.tick(99)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(settledB, false)
      t.mock.timers.tick(1)
      await collected
      assert.equal(settledB, true)
    } finally {
      clientB.abort()
      t.mock.timers.tick(100)
      await collected
      coordinator.clear("tenant_a", "session_1")
      assert.equal(coordinator.snapshot().entries, 0)
    }
  })

  it("clears its own timer when the last shared waiter retires", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const clearTimer = t.mock.method(globalThis, "clearTimeout")
    const coordinator = new runtimeModule.AgUiLedgerWaitCoordinator({ baseDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 })
    const client = new AbortController()
    let settled = false
    const waiting = coordinator.wait("tenant_a", "session_1", client.signal).finally(() => {
      settled = true
    })
    const collected = Promise.allSettled([waiting])
    try {
      client.abort()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(settled, true)
      assert.equal(coordinator.snapshot().entries, 0)
      assert.equal(clearTimer.mock.callCount(), 1, "the abandoned shared delay must release its owned timer")
    } finally {
      t.mock.timers.tick(100)
      await collected
      coordinator.clear("tenant_a", "session_1")
    }
  })
})
