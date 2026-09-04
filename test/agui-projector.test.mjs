import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { EventSchemas, EventType } from "@ag-ui/core"

import { AgUiConsumerLeaseLostError, AgUiSourceContinuityError, AgUiSourceReadError } from "../dist/application/agui/errors.js"
import { AgUiProjectorRunner } from "../dist/application/agui/projector.js"
import { createAgUiProjectionState, projectChatEvent } from "../dist/application/agui/project-chat-event.js"

const base = {
  event_id: "evt_terminal",
  seq: 3,
  session_id: "session_1",
  run_id: "run_1",
  timestamp: "2026-09-02T12:00:00.000Z",
}

function lease(overrides = {}) {
  return {
    tenantId: "tenant_1",
    sessionId: "session_1",
    subjectId: "user_1",
    leaseOwner: "worker_1",
    leaseToken: "lease_1",
    fence: 1,
    leaseUntil: "2026-09-02T12:01:00.000Z",
    leaseRemainingMs: 60_000,
    sourceHighWatermark: 0,
    failureCount: 0,
    ...overrides,
  }
}

function source(sequence) {
  return {
    sourceEventId: `source_${sequence}`,
    sourceSequence: sequence,
    sourceOccurredAt: new Date(sequence * 1000).toISOString(),
    sourcePayload: { sequence },
    event: null,
  }
}

describe("AG-UI terminal and tool semantics", () => {
  it("preserves tool errors and emits canonical cancellation and failure terminals", () => {
    const tool = projectChatEvent({
      ...base,
      kind: "tool.returned",
      payload: { segment_id: "message_1", tool_id: "tool_1", result: "denied", is_error: true },
    }, createAgUiProjectionState())
    const result = tool.find((event) => event.type === EventType.TOOL_CALL_RESULT)
    assert.equal(result?.isError, true)
    for (const event of tool) assert.doesNotThrow(() => EventSchemas.parse(event))

    const cancelled = projectChatEvent({
      ...base,
      kind: "run.completed",
      payload: { status: "cancelled" },
    }, createAgUiProjectionState())
    assert.equal(cancelled[0]?.type, EventType.RUN_FINISHED)
    assert.deepEqual(cancelled[0]?.outcome?.type, "interrupt")
    assert.doesNotThrow(() => EventSchemas.parse(cancelled[0]))

    const failed = projectChatEvent({
      ...base,
      kind: "run.failed",
      payload: { code: "internal_error", message: "failed" },
    }, createAgUiProjectionState())
    assert.equal(failed[0]?.type, EventType.RUN_ERROR)
    assert.equal(failed[0]?.threadId, "session_1")
    assert.equal(failed[0]?.runId, "run_1")
    assert.doesNotThrow(() => EventSchemas.parse(failed[0]))
  })
})

describe("AG-UI durable projector runner", () => {
  it("blocks a consumer after the source reader exhausts its continuity retry budget", async () => {
    let sourceReads = 0
    const retries = []
    const blocked = []
    const progress = []
    const ingested = []
    const consumer = {
      seedConsumers: async () => 0,
      claimConsumers: async () => [lease()],
      renewConsumerLease: async () => true,
      markConsumerProgress: async (...args) => { progress.push(args); return true },
      markConsumerRetryable: async (...args) => { retries.push(args); return true },
      markConsumerBlocked: async (...args) => { blocked.push(args); return true },
      releaseConsumer: async () => true,
      collectGarbage: async () => ({ streamsScanned: 0, framesDeleted: 0, tombstonesInserted: 0, tombstonesDeleted: 0 }),
    }
    const projection = {
      ingest: async (...args) => { ingested.push(args); return { insertedSources: 1, insertedFrames: 0, sourceHighWatermark: 1 } },
    }
    const sourceReader = {
      read: async () => {
        sourceReads += 1
        throw new AgUiSourceContinuityError()
      },
    }
    const runner = new AgUiProjectorRunner(projection, consumer, sourceReader, {
      workerId: "worker_1",
      now: () => new Date("2026-09-02T12:00:00.000Z"),
      maxConsumersPerCycle: 1,
      sourcePageSize: 10,
      leaseDurationMs: 30_000,
      pollIntervalMs: 60_000,
      errorBackoffMs: 1_000,
      errorBackoffMaxMs: 8_000,
      errorBackoffJitterPercent: 0,
      retentionMs: 86_400_000,
      gcIntervalMs: 60_000,
      gcBatchSize: 10,
      cursorTombstoneRetentionMs: 172_800_000,
    })

    await runner.runOnce()
    assert.equal(ingested.length, 0)
    assert.equal(retries.length, 0)
    assert.equal(blocked.length, 1)
    assert.equal(blocked[0][1], "source_gap")
    assert.equal(progress.length, 0)
    assert.equal(sourceReads, 1)
  })

  it("leaves a lost lease fenced instead of settling it as progress", async () => {
    let progressCalls = 0
    let retryCalls = 0
    const consumer = {
      seedConsumers: async () => 0,
      claimConsumers: async () => [lease()],
      renewConsumerLease: async () => false,
      markConsumerProgress: async () => { progressCalls += 1; return true },
      markConsumerRetryable: async () => { retryCalls += 1; return true },
      markConsumerBlocked: async () => true,
      releaseConsumer: async () => true,
      collectGarbage: async () => ({ streamsScanned: 0, framesDeleted: 0, tombstonesInserted: 0, tombstonesDeleted: 0 }),
    }
    const projection = {
      ingest: async () => { throw new AgUiConsumerLeaseLostError() },
    }
    const sourceReader = { read: async () => ({ events: [source(1)], nextSequence: 1, watermark: 1, exhausted: true }) }
    const runner = new AgUiProjectorRunner(projection, consumer, sourceReader, {
      workerId: "worker_1",
      now: () => new Date("2026-09-02T12:00:00.000Z"),
      maxConsumersPerCycle: 1,
      sourcePageSize: 10,
      leaseDurationMs: 30_000,
      pollIntervalMs: 60_000,
      errorBackoffMs: 1_000,
      errorBackoffMaxMs: 8_000,
      errorBackoffJitterPercent: 0,
      retentionMs: 86_400_000,
      gcIntervalMs: 60_000,
      gcBatchSize: 10,
      cursorTombstoneRetentionMs: 172_800_000,
    })

    await runner.runOnce()
    assert.equal(progressCalls, 0)
    assert.equal(retryCalls, 0)
  })

  it("uses persisted failure count for capped exponential backoff with jitter", async () => {
    const retries = []
    const consumer = {
      seedConsumers: async () => 0,
      claimConsumers: async () => [lease({ failureCount: 3 })],
      renewConsumerLease: async () => true,
      markConsumerProgress: async () => true,
      markConsumerRetryable: async (...args) => { retries.push(args); return true },
      markConsumerBlocked: async () => true,
      releaseConsumer: async () => true,
      collectGarbage: async () => ({ streamsScanned: 0, framesDeleted: 0, tombstonesInserted: 0, tombstonesDeleted: 0 }),
    }
    const sourceReader = {
      read: async () => { throw new AgUiSourceReadError("agent_source_unavailable", true) },
    }
    const runner = new AgUiProjectorRunner({ ingest: async () => assert.fail("ingest must not run") }, consumer, sourceReader, {
      workerId: "worker_1",
      now: () => new Date("2026-09-02T12:00:00.000Z"),
      random: () => 0.75,
      maxConsumersPerCycle: 1,
      sourcePageSize: 10,
      leaseDurationMs: 30_000,
      pollIntervalMs: 60_000,
      errorBackoffMs: 1_000,
      errorBackoffMaxMs: 8_000,
      errorBackoffJitterPercent: 20,
      retentionMs: 86_400_000,
      gcIntervalMs: 60_000,
      gcBatchSize: 10,
      cursorTombstoneRetentionMs: 172_800_000,
    })

    const result = await runner.runOnce()

    assert.equal(result.consumersRetried, 1)
    assert.equal(retries.length, 1)
    assert.equal(retries[0][1], "2026-09-02T12:00:08.000Z")
    assert.equal(retries[0][2], "agent_source_unavailable")
  })

  it("blocks permanent source failures without scheduling another retry", async () => {
    const blocked = []
    let retries = 0
    const consumer = {
      seedConsumers: async () => 0,
      claimConsumers: async () => [lease()],
      renewConsumerLease: async () => true,
      markConsumerProgress: async () => true,
      markConsumerRetryable: async () => { retries += 1; return true },
      markConsumerBlocked: async (...args) => { blocked.push(args); return true },
      releaseConsumer: async () => true,
      collectGarbage: async () => ({ streamsScanned: 0, framesDeleted: 0, tombstonesInserted: 0, tombstonesDeleted: 0 }),
    }
    const sourceReader = {
      read: async () => { throw new AgUiSourceReadError("agent_source_forbidden", false) },
    }
    const runner = new AgUiProjectorRunner({ ingest: async () => assert.fail("ingest must not run") }, consumer, sourceReader, {
      workerId: "worker_1",
      now: () => new Date("2026-09-02T12:00:00.000Z"),
      maxConsumersPerCycle: 1,
      sourcePageSize: 10,
      leaseDurationMs: 30_000,
      pollIntervalMs: 60_000,
      errorBackoffMs: 1_000,
      errorBackoffMaxMs: 8_000,
      errorBackoffJitterPercent: 20,
      retentionMs: 86_400_000,
      gcIntervalMs: 60_000,
      gcBatchSize: 10,
      cursorTombstoneRetentionMs: 172_800_000,
    })

    const result = await runner.runOnce()

    assert.equal(result.consumersBlocked, 1)
    assert.equal(retries, 0)
    assert.equal(blocked.length, 1)
    assert.equal(blocked[0][1], "agent_source_forbidden")
  })

  it("honors a bounded upstream Retry-After hint when it exceeds local backoff", async () => {
    const retries = []
    const consumer = {
      seedConsumers: async () => 0,
      claimConsumers: async () => [lease()],
      renewConsumerLease: async () => true,
      markConsumerProgress: async () => true,
      markConsumerRetryable: async (...args) => { retries.push(args); return true },
      markConsumerBlocked: async () => true,
      releaseConsumer: async () => true,
      collectGarbage: async () => ({ streamsScanned: 0, framesDeleted: 0, tombstonesInserted: 0, tombstonesDeleted: 0 }),
    }
    const sourceReader = {
      read: async () => { throw new AgUiSourceReadError("agent_source_rate_limited", true, 5_000) },
    }
    const runner = new AgUiProjectorRunner({ ingest: async () => assert.fail("ingest must not run") }, consumer, sourceReader, {
      workerId: "worker_1",
      now: () => new Date("2026-09-02T12:00:00.000Z"),
      random: () => 0,
      maxConsumersPerCycle: 1,
      sourcePageSize: 10,
      leaseDurationMs: 30_000,
      pollIntervalMs: 60_000,
      errorBackoffMs: 1_000,
      errorBackoffMaxMs: 8_000,
      errorBackoffJitterPercent: 100,
      retentionMs: 86_400_000,
      gcIntervalMs: 60_000,
      gcBatchSize: 10,
      cursorTombstoneRetentionMs: 172_800_000,
    })

    await runner.runOnce()

    assert.equal(retries[0][1], "2026-09-02T12:00:05.000Z")
  })

  it("retries garbage collection immediately after a failed collection", async () => {
    let collections = 0
    const consumer = {
      seedConsumers: async () => 0,
      claimConsumers: async () => [],
      renewConsumerLease: async () => true,
      markConsumerProgress: async () => true,
      markConsumerRetryable: async () => true,
      markConsumerBlocked: async () => true,
      releaseConsumer: async () => true,
      collectGarbage: async () => {
        collections += 1
        if (collections === 1) throw new Error("gc unavailable")
        return { streamsScanned: 0, framesDeleted: 0, tombstonesInserted: 0, tombstonesDeleted: 0 }
      },
    }
    const runner = new AgUiProjectorRunner(
      { ingest: async () => assert.fail("ingest must not run") },
      consumer,
      { read: async () => assert.fail("read must not run") },
      {
        workerId: "worker_1",
        now: () => new Date("2026-09-02T12:00:00.000Z"),
        maxConsumersPerCycle: 1,
        sourcePageSize: 10,
        leaseDurationMs: 30_000,
        pollIntervalMs: 60_000,
        errorBackoffMs: 1_000,
        errorBackoffMaxMs: 8_000,
        errorBackoffJitterPercent: 0,
        retentionMs: 86_400_000,
        gcIntervalMs: 60_000,
        gcBatchSize: 10,
        cursorTombstoneRetentionMs: 172_800_000,
      },
    )

    await assert.rejects(runner.runOnce(), /gc unavailable/u)
    await runner.runOnce()

    assert.equal(collections, 2)
  })
})
