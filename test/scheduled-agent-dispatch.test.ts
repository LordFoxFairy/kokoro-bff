import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { scheduledOccurrenceOrderKey } from "../dist/domain/scheduled-task/agent-dispatch.js"
import { ScheduledAgentDispatcher } from "../dist/application/scheduled-agent-dispatcher.js"

describe("Scheduled Agent terminal-gated dispatch", () => {
  it("orders RFC3339Nano instants without truncating precision", () => {
    assert.equal(scheduledOccurrenceOrderKey("2026-09-01T12:00:00Z"), "2026-09-01T12:00:00.000000000Z")
    assert.ok(scheduledOccurrenceOrderKey("2026-09-01T12:00:00.000000001Z") < scheduledOccurrenceOrderKey("2026-09-01T12:00:00.000000010Z"))
  })
  it("settles one durable command after delivery and never owns callback I/O", async () => {
    const calls: string[] = []
    const command = {
      tenantId: "t",
      taskId: "task",
      dispatchId: "d",
      runId: "r",
      subjectId: "u",
      requestId: "q",
      idempotencyKey: "i",
      identityAssertionRef: "a",
      payload: {},
      leaseOwner: "w",
      leaseToken: "x",
      fence: 1,
      attemptCount: 1,
      admissionUnknownSeen: false,
      leaseRemainingMs: 5000,
      leaseObservedAt: performance.now(),
    }
    const repository = {
      claim: async () => command,
      reconcileActive: async () => {
        calls.push("observe")
        return true
      },
      markUnknown: async () => false,
      markNotAdmitted: async () => false,
    }
    const delivery = {
      deliver: async () => {
        calls.push("deliver")
        return { outcome: "submitted" as const }
      },
    }
    const runner = new ScheduledAgentDispatcher(repository as never, delivery, {
      workerId: "w",
      maxAttempts: 1,
      concurrency: 1,
    })
    assert.equal(await runner.runOnce(), 1)
    assert.deepEqual(calls, ["observe", "deliver"])
  })
  for (const [name, remaining, elapsed] of [
    ["performs no delivery after the observed lease budget is exhausted", 400, 10],
    ["performs no delivery when elapsed time exhausts a lease initially above its settlement reserve", 1100, 700],
  ] as const) {
    it(name, async () => {
      let deliveries = 0
      let releases = 0
      const repository = {
        claim: async () => ({
          tenantId: "t",
          taskId: "task",
          dispatchId: "d",
          runId: "r",
          subjectId: "u",
          requestId: "q",
          idempotencyKey: "i",
          identityAssertionRef: "a",
          payload: {},
          leaseOwner: "w",
          leaseToken: "x",
          fence: 1,
          attemptCount: 1,
          admissionUnknownSeen: false,
          leaseRemainingMs: remaining,
          leaseObservedAt: performance.now() - elapsed,
        }),
        reconcileActive: async () => true,
        releaseNeverSent: async () => {
          releases += 1
          return true
        },
      }
      const delivery = {
        deliver: async () => {
          deliveries += 1
          return { outcome: "submitted" as const }
        },
      }
      const runner = new ScheduledAgentDispatcher(repository as never, delivery, {
        workerId: "w",
        concurrency: 1,
      })
      assert.equal(await runner.runOnce(), 0)
      assert.equal(deliveries, 0)
      assert.equal(releases, 1)
    })
  }
  it("uses a bounded worker pool so an independent slow scope does not block another scope", async () => {
    let claims = 0
    let releaseSlow!: () => void
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    const delivered: string[] = []
    const command = (taskId: string) => ({
      tenantId: "t",
      taskId,
      dispatchId: `d-${taskId}`,
      runId: `r-${taskId}`,
      subjectId: "u",
      requestId: `q-${taskId}`,
      idempotencyKey: `i-${taskId}`,
      identityAssertionRef: "a",
      payload: {},
      leaseOwner: "w",
      leaseToken: `x-${taskId}`,
      fence: 1,
      attemptCount: 1,
      admissionUnknownSeen: false,
      leaseRemainingMs: 5000,
      leaseObservedAt: performance.now(),
    })
    const repository = {
      claim: async () => {
        claims += 1
        return claims === 1 ? command("slow") : claims === 2 ? command("fast") : null
      },
      reconcileActive: async () => true,
    }
    const runner = new ScheduledAgentDispatcher(
      repository as never,
      {
        deliver: async (value) => {
          if (value.taskId === "slow") await slow
          delivered.push(value.taskId)
          return { outcome: "submitted" as const }
        },
      },
      { workerId: "w", concurrency: 2 },
    )
    const cycle = runner.runOnce()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.deepEqual(delivered, ["fast"])
    releaseSlow()
    assert.equal(await cycle, 2)
    assert.deepEqual(delivered, ["fast", "slow"])
  })
  it("uses bounded exponential retry delays for unknown local submissions", async () => {
    let dispatchDelay = 0
    const command = {
      tenantId: "t",
      taskId: "task",
      dispatchId: "d",
      runId: "r",
      subjectId: "u",
      requestId: "q",
      idempotencyKey: "i",
      identityAssertionRef: "a",
      payload: {},
      leaseOwner: "w",
      leaseToken: "x",
      fence: 1,
      attemptCount: 4,
      admissionUnknownSeen: true,
      leaseRemainingMs: 5000,
      leaseObservedAt: performance.now(),
    }
    const dispatchRepository = {
      reconcileActive: async () => false,
      claim: async () => command,
      markUnknown: async (_lease: unknown, delay: number) => {
        dispatchDelay = delay
        return true
      },
    }
    const dispatcher = new ScheduledAgentDispatcher(
      dispatchRepository as never,
      { deliver: async () => ({ outcome: "unknown", errorCode: "timeout" }) },
      {
        workerId: "w",
        retryBaseMs: 1000,
        retryMaxMs: 5000,
        retryJitterPercent: 20,
        random: () => 1,
      },
    )
    await dispatcher.runOnce()
    assert.equal(dispatchDelay, 5000)

    assert.throws(
      () => new ScheduledAgentDispatcher(dispatchRepository as never, { deliver: async () => ({ outcome: "submitted" }) }, { workerId: "w", retryBaseMs: 0 }),
      /RETRY_OPTIONS_INVALID/,
    )
  })
  it("rejects non-finite and out-of-range worker options", () => {
    const repository = {} as never
    const delivery = {
      deliver: async () => ({ outcome: "submitted" as const }),
    }
    assert.throws(
      () =>
        new ScheduledAgentDispatcher(repository, delivery, {
          workerId: " ",
          concurrency: 1,
        }),
      /WORKER_OPTIONS_INVALID/,
    )
    assert.throws(
      () =>
        new ScheduledAgentDispatcher(repository, delivery, {
          workerId: "w",
          concurrency: 33,
        }),
      /WORKER_OPTIONS_INVALID/,
    )
    assert.throws(
      () =>
        new ScheduledAgentDispatcher(repository, delivery, {
          workerId: "w",
          leaseDurationMs: 500,
          settlementReserveMs: 500,
        }),
      /WORKER_OPTIONS_INVALID/,
    )
  })
  it("reports repository cycle failures with bounded backoff and drains on stop", async () => {
    let report!: (value: { operation: string; result: "error"; errorCode: string; attempt: number; backoffMs: number }) => void
    const reported = new Promise<{
      operation: string
      result: "error"
      errorCode: string
      attempt: number
      backoffMs: number
    }>((resolve) => {
      report = resolve
    })
    const runner = new ScheduledAgentDispatcher(
      {
        reconcileActive: async () => false,
        claim: async () => {
          throw new Error("repository_down")
        },
      } as never,
      { deliver: async () => ({ outcome: "submitted" as const }) },
      {
        workerId: "w",
        concurrency: 1,
        pollIntervalMs: 60000,
        retryBaseMs: 100,
        retryMaxMs: 100,
        retryJitterPercent: 0,
        onError: report,
      },
    )
    runner.start()
    assert.deepEqual(await reported, {
      operation: "scheduled_agent_dispatch_cycle",
      result: "error",
      errorCode: "scheduled_agent_dispatch_cycle_failed",
      attempt: 1,
      backoffMs: 100,
    })
    await runner.stop()
  })
  it("waits for every in-flight scope before a failed parallel cycle rejects or stops", async () => {
    let claimCount = 0
    let releaseSlow!: () => void
    let slowFinished = false
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    const command = {
      tenantId: "t",
      taskId: "slow",
      dispatchId: "d",
      runId: "r",
      subjectId: "u",
      requestId: "q",
      idempotencyKey: "i",
      identityAssertionRef: "a",
      payload: {},
      leaseOwner: "w",
      leaseToken: "x",
      fence: 1,
      attemptCount: 1,
      admissionUnknownSeen: false,
      leaseRemainingMs: 5000,
      leaseObservedAt: performance.now(),
    }
    const runner = new ScheduledAgentDispatcher(
      {
        reconcileActive: async () => false,
        claim: async () => {
          claimCount += 1
          if (claimCount === 1) throw new Error("repository_down")
          return command
        },
        reconcileActive: async () => true,
      } as never,
      {
        deliver: async () => {
          await slow
          slowFinished = true
          return { outcome: "submitted" as const }
        },
      },
      { workerId: "w", concurrency: 2 },
    )
    const cycle = runner.runOnce()
    const stopping = runner.stop()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(slowFinished, false)
    releaseSlow()
    await assert.rejects(cycle, /DISPATCH_CYCLE_FAILED/)
    await stopping
    assert.equal(slowFinished, true)
  })
})

describe("Scheduled activation uses the ordinary Chat transaction", () => {
  it("derives a stable ordinary conversation per tenant/task without crossing tenant boundaries", async () => {
    const { scheduledConversationId } = await import("../dist/infrastructure/clients/agent/launch.js")
    const { isClientCreatedConversationId } = await import("../dist/domain/chat/conversation.js")
    const conversation = scheduledConversationId("tenant", "task")
    assert.equal(isClientCreatedConversationId(conversation), true)
    assert.equal(scheduledConversationId("tenant", "task"), conversation)
    assert.notEqual(scheduledConversationId("other", "task"), conversation)
    assert.notEqual(scheduledConversationId("tenant", "other-task"), conversation)
  })
  it("reports durable queue submission separately from Agent admission and forwards the activation fence", async () => {
    const { ScheduledChatSubmission } = await import("../dist/infrastructure/postgres/scheduled-chat-submission.js")
    const { buildScheduledAgentLaunch, scheduledConversationId } = await import("../dist/infrastructure/clients/agent/launch.js")
    const launch = buildScheduledAgentLaunch({
      identity: { namespace: "tenant", userId: "owner" },
      requestId: "request",
      sessionId: scheduledConversationId("tenant", "task"),
      occurrenceIdentity: "a".repeat(64),
      content: "go",
      projectRef: "project",
    })
    const command = {
      tenantId: "tenant",
      taskId: "task",
      conversationId: launch.body.session_id,
      runId: launch.receipt.run_id,
      userMessageId: launch.receipt.user_message_id,
      assistantMessageId: launch.receipt.assistant_message_id,
      subjectId: "owner",
      dispatchId: "dispatch",
      leaseOwner: "worker",
      leaseToken: "token",
      fence: 7,
      payload: launch.body,
      requestId: "request",
      idempotencyKey: "key",
      requestDigest: "b".repeat(64),
      identityAssertionRef: launch.identityAssertionRef,
    }
    const submission = new ScheduledChatSubmission({
      commitChatTurn: async (value) => {
        assert.equal(value.conversationId, command.conversationId)
        assert.equal(value.runId, command.runId)
        assert.equal(value.payload.schema_version, 3)
        assert.equal(value.payload.launch.project_ref, "project")
        assert.equal(value.payload.launch.trace.source, "kokoro-bff")
        assert.deepEqual(value.scheduledActivation, {
          tenantId: "tenant",
          taskId: "task",
          dispatchId: "dispatch",
          runId: command.runId,
          leaseOwner: "worker",
          leaseToken: "token",
          fence: 7,
        })
        return launch.receipt
      },
    })
    assert.deepEqual(await submission.deliver(command as never, 1000), { outcome: "submitted" })
    const unknown = new ScheduledChatSubmission({
      commitChatTurn: async () => {
        throw new Error("CHAT_TURN_COMMIT_UNKNOWN")
      },
    })
    assert.deepEqual(await unknown.deliver(command as never, 1000), { outcome: "unknown", errorCode: "scheduled_chat_submission_unknown" })
    const invalid = new ScheduledChatSubmission({
      commitChatTurn: async () => {
        assert.fail("invalid frozen payload must not enter Chat")
      },
    })
    assert.deepEqual(await invalid.deliver({ ...command, payload: { ...launch.body, personal_context: {} } } as never, 1000), {
      outcome: "not_admitted",
      errorCode: "scheduled_snapshot_invalid",
    })
  })
})
