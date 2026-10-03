import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { EventSchemas, EventType } from "@ag-ui/core"

import { AgUiConsumerLeaseLostError, AgUiSourceContinuityError, AgUiSourceReadError } from "../dist/application/agui/errors.js"
import { AgUiProjectorRunner } from "../dist/application/agui/projector.js"
import { createAgUiProjectionState, projectChatEvent } from "../dist/application/agui/project-chat-event.js"
import { mapAgentEvent } from "../dist/infrastructure/clients/agent/projection.js"

const base = {
  event_id: "evt_terminal",
  seq: 3,
  session_id: "session_1",
  run_id: "run_1",
  timestamp: "2026-09-02T12:00:00.000Z",
}

function lease(overrides = {}) {
  return {
    sourceRunId: null,
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

describe("AG-UI terminal and safe activity semantics", () => {
  it("serializes one verified Agent failure into the exact safe RUN_ERROR shape", () => {
    const mapped = mapAgentEvent({
      chat_event_id: "evt_safe_failure",
      session_id: "session_1",
      run_id: "run_1",
      source_index: 2,
      event_type: "run.failed",
      payload_json: JSON.stringify({ status: "failed", code: "model_unavailable", retryable: true }),
      seq: 3,
      created_at: Date.parse("2026-09-02T12:00:00.000Z"),
    })
    assert.notEqual(mapped, null)
    assert.deepEqual(mapped?.payload, {
      failure: { source: "agent", code: "model_unavailable", retryable: true },
      message: "Agent run failed",
    })

    const [projected] = projectChatEvent(mapped, createAgUiProjectionState())
    const serialized = JSON.parse(JSON.stringify(projected))
    assert.deepEqual(
      {
        type: serialized.type,
        code: serialized.code,
        message: serialized.message,
        failure: serialized.metadata?.kokoro?.failure,
      },
      {
        type: EventType.RUN_ERROR,
        code: "model_unavailable",
        message: "Agent run failed",
        failure: { source: "agent", code: "model_unavailable", retryable: true },
      },
    )
    assert.equal(Object.hasOwn(serialized, "retryable"), false)
    assert.deepEqual(Object.keys(serialized.metadata.kokoro.failure).sort(), ["code", "retryable", "source"])
    assert.equal(serialized.metadata.kokoro.failure.code, serialized.code)
    assert.equal(Object.hasOwn(serialized.metadata.kokoro.failure, "status"), false)
    assert.doesNotThrow(() => EventSchemas.parse(serialized))
  })

  it("preserves safe failed activity status and emits canonical cancellation and failure terminals", () => {
    const safeActivity = {
      activity: "tool",
      activity_id: `act_${"a".repeat(64)}`,
      segment_id: `seg_${"b".repeat(64)}`,
      status: "failed",
      display_code: "tool.execution",
    }
    const activity = projectChatEvent({ ...base, kind: "activity.updated", payload: safeActivity }, createAgUiProjectionState())
    assert.deepEqual(
      activity.map(({ type }) => type),
      [EventType.CUSTOM],
    )
    assert.deepEqual(activity[0]?.value, safeActivity)
    assert.equal(Object.hasOwn(activity[0]?.value, "error"), false)
    for (const event of activity) assert.doesNotThrow(() => EventSchemas.parse(event))

    const cancelled = projectChatEvent(
      {
        ...base,
        kind: "run.completed",
        payload: { status: "cancelled" },
      },
      createAgUiProjectionState(),
    )
    assert.equal(cancelled[0]?.type, EventType.RUN_FINISHED)
    assert.deepEqual(cancelled[0]?.outcome?.type, "interrupt")
    assert.doesNotThrow(() => EventSchemas.parse(cancelled[0]))

    const failed = projectChatEvent(
      {
        ...base,
        kind: "run.failed",
        payload: { failure: { source: "agent", code: "internal_error", retryable: false }, message: "Agent run failed" },
      },
      createAgUiProjectionState(),
    )
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
      markConsumerProgress: async (...args) => {
        progress.push(args)
        return true
      },
      markConsumerRetryable: async (...args) => {
        retries.push(args)
        return true
      },
      markConsumerBlocked: async (...args) => {
        blocked.push(args)
        return true
      },
      releaseConsumer: async () => true,
      collectGarbage: async () => ({ streamsScanned: 0, framesDeleted: 0, tombstonesInserted: 0, tombstonesDeleted: 0 }),
    }
    const projection = {
      ingest: async (...args) => {
        ingested.push(args)
        return { insertedSources: 1, insertedFrames: 0, sourceHighWatermark: 1 }
      },
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
      markConsumerProgress: async () => {
        progressCalls += 1
        return true
      },
      markConsumerRetryable: async () => {
        retryCalls += 1
        return true
      },
      markConsumerBlocked: async () => true,
      releaseConsumer: async () => true,
      collectGarbage: async () => ({ streamsScanned: 0, framesDeleted: 0, tombstonesInserted: 0, tombstonesDeleted: 0 }),
    }
    const projection = {
      ingest: async () => {
        throw new AgUiConsumerLeaseLostError()
      },
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
      markConsumerRetryable: async (...args) => {
        retries.push(args)
        return true
      },
      markConsumerBlocked: async () => true,
      releaseConsumer: async () => true,
      collectGarbage: async () => ({ streamsScanned: 0, framesDeleted: 0, tombstonesInserted: 0, tombstonesDeleted: 0 }),
    }
    const sourceReader = {
      read: async () => {
        throw new AgUiSourceReadError("agent_source_unavailable", true)
      },
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
      markConsumerRetryable: async () => {
        retries += 1
        return true
      },
      markConsumerBlocked: async (...args) => {
        blocked.push(args)
        return true
      },
      releaseConsumer: async () => true,
      collectGarbage: async () => ({ streamsScanned: 0, framesDeleted: 0, tombstonesInserted: 0, tombstonesDeleted: 0 }),
    }
    const sourceReader = {
      read: async () => {
        throw new AgUiSourceReadError("agent_source_forbidden", false)
      },
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
      markConsumerRetryable: async (...args) => {
        retries.push(args)
        return true
      },
      markConsumerBlocked: async () => true,
      releaseConsumer: async () => true,
      collectGarbage: async () => ({ streamsScanned: 0, framesDeleted: 0, tombstonesInserted: 0, tombstonesDeleted: 0 }),
    }
    const sourceReader = {
      read: async () => {
        throw new AgUiSourceReadError("agent_source_rate_limited", true, 5_000)
      },
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

it("a new START identity after a full interaction is rejected before committing any source prefix", async () => {
  const { AgUiProjectionService } = await import("../dist/application/agui/project-session-events.js")
  const state = { interaction_revision: 1, pause_revision: 0, pause_ref: null, phase: "active", groups: [], action_result: null }
  let commits = 0
  const service = new AgUiProjectionService({
    readStream: async () => ({
      version: 2,
      sourceHighWatermark: 2,
      projectionState: { textMessageIds: [] },
      expectedRunId: "run_1",
      latestRunId: "run_1",
      terminalRunId: null,
      interaction: { runId: "run_1", state },
    }),
    assertPersistedSources: async () => {},
    commitProjection: async () => {
      commits++
      return "committed"
    },
  })
  const timestamp = new Date(3000).toISOString()
  await assert.rejects(
    service.ingest("tenant_1", "session_1", [
      {
        sourceRunId: "run_1",
        sourceEventId: "new_start_identity",
        sourceSequence: 3,
        sourceOccurredAt: timestamp,
        sourcePayload: { kind: "run.started" },
        event: {
          event_id: "new_start_identity",
          seq: 3,
          timestamp,
          session_id: "session_1",
          run_id: "run_1",
          kind: "run.created",
          payload: { run_id: "run_1" },
        },
      },
    ]),
    /source identity conflict/u,
  )
  assert.equal(commits, 0)
})

for (const [activity, displayCode] of [
  ["tool", "tool.execution"],
  ["subagent", "subagent.execution"],
]) {
  for (const status of ["running", "completed", "failed"]) {
    it(`R123 maps ${activity}/${status} through the actual mapper and projector as one safe activity CUSTOM`, () => {
      const payload = {
        activity,
        activity_id: `act_${activity === "tool" ? "a".repeat(64) : "b".repeat(64)}`,
        segment_id: `seg_${activity === "tool" ? "c".repeat(64) : "d".repeat(64)}`,
        status,
        display_code: displayCode,
      }
      const mapped = mapAgentEvent({
        chat_event_id: `r123_${activity}_${status}`,
        session_id: "session_1",
        run_id: "run_1",
        source_index: 4,
        chat_message_id: "assistant_identity_canary",
        event_type: "activity",
        payload_json: JSON.stringify(payload),
        seq: 5,
        created_at: Date.parse("2026-09-02T12:00:00.000Z"),
      })
      assert.notEqual(mapped, null)
      const [frame] = projectChatEvent(mapped, createAgUiProjectionState())
      assert.deepEqual(frame, {
        type: EventType.CUSTOM,
        timestamp: Date.parse("2026-09-02T12:00:00.000Z"),
        name: "kokoro.activity.updated",
        value: payload,
        metadata: {
          kokoro: { event_id: `r123_${activity}_${status}`, seq: 5, session_id: "session_1", run_id: "run_1", timestamp: "2026-09-02T12:00:00.000Z" },
        },
      })
      assert.equal(JSON.stringify(frame).includes("assistant_identity_canary"), false)
      assert.doesNotThrow(() => EventSchemas.parse(frame))
    })
  }
}

const r123TodoAndSkillProjectionCases = [
  ["Todo", "todo.updated", { todos: [{ content: "plan", status: "pending" }] }, "todo.updated", "kokoro.todo.updated"],
  [
    "Skill",
    "activity",
    {
      activity: "skill",
      activity_id: `act_${"e".repeat(64)}`,
      preflight_id: `spf_${"f".repeat(64)}`,
      source_refs: ["skill:alpha"],
      phase: "failed",
      error_code: "skill_resolve_failed",
    },
    "activity.updated",
    "kokoro.activity.updated",
  ],
]
for (const [label, eventType, payload, kind, name] of r123TodoAndSkillProjectionCases) {
  it(`R123 maps safe ${label} through the actual mapper/projector without raw fields`, () => {
    const mapped = mapAgentEvent({
      chat_event_id: `r123_${eventType}`,
      session_id: "session_1",
      run_id: "run_1",
      source_index: 1,
      event_type: eventType,
      payload_json: JSON.stringify(payload),
      seq: 2,
      created_at: 2_000,
    })
    assert.equal(mapped?.kind, kind)
    const [frame] = projectChatEvent(mapped, createAgUiProjectionState())
    assert.equal(frame?.type, EventType.CUSTOM)
    assert.equal(frame?.name, name)
    assert.deepEqual(frame?.value, payload)
    assert.deepEqual(Object.keys(frame?.value ?? {}).sort(), Object.keys(payload).sort())
  })
}
