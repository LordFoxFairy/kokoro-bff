import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scheduledOccurrenceOrderKey } from "../dist/domain/scheduled-task/agent-dispatch.js";
import { ScheduledAgentDispatcher } from "../dist/application/scheduled-agent-dispatcher.js";
import { ScheduledAgentTerminalConsumer } from "../dist/application/scheduled-agent-terminal-consumer.js";

describe("Scheduled Agent terminal-gated dispatch", () => {
  it("orders RFC3339Nano instants without truncating precision", () => {
    assert.equal(
      scheduledOccurrenceOrderKey("2026-09-01T12:00:00Z"),
      "2026-09-01T12:00:00.000000000Z",
    );
    assert.ok(
      scheduledOccurrenceOrderKey("2026-09-01T12:00:00.000000001Z") <
        scheduledOccurrenceOrderKey("2026-09-01T12:00:00.000000010Z"),
    );
  });
  it("settles one durable command after delivery and never owns callback I/O", async () => {
    const calls: string[] = [];
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
    };
    const repository = {
      claim: async () => command,
      markAdmitted: async () => {
        calls.push("admitted");
        return true;
      },
      markUnknown: async () => false,
      markNotAdmitted: async () => false,
    };
    const delivery = {
      deliver: async () => {
        calls.push("deliver");
        return { outcome: "admitted" as const };
      },
    };
    const runner = new ScheduledAgentDispatcher(repository as never, delivery, {
      workerId: "w",
      maxAttempts: 1,
      concurrency: 1,
    });
    assert.equal(await runner.runOnce(), 1);
    assert.deepEqual(calls, ["deliver", "admitted"]);
  });
  it("performs no delivery after the observed lease budget is exhausted", async () => {
    let deliveries = 0;
    let releases = 0;
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
        leaseRemainingMs: 400,
        leaseObservedAt: performance.now() - 10,
      }),
      releaseNeverSent: async () => {
        releases += 1;
        return true;
      },
    };
    const delivery = {
      deliver: async () => {
        deliveries += 1;
        return { outcome: "admitted" as const };
      },
    };
    const runner = new ScheduledAgentDispatcher(repository as never, delivery, {
      workerId: "w",
      concurrency: 1,
    });
    assert.equal(await runner.runOnce(), 0);
    assert.equal(deliveries, 0);
    assert.equal(releases, 1);
  });
  it("uses a bounded worker pool so an independent slow scope does not block another scope", async () => {
    let claims = 0;
    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const delivered: string[] = [];
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
    });
    const repository = {
      claim: async () => {
        claims += 1;
        return claims === 1
          ? command("slow")
          : claims === 2
            ? command("fast")
            : null;
      },
      markAdmitted: async () => true,
    };
    const runner = new ScheduledAgentDispatcher(
      repository as never,
      {
        deliver: async (value) => {
          if (value.taskId === "slow") await slow;
          delivered.push(value.taskId);
          return { outcome: "admitted" as const };
        },
      },
      { workerId: "w", concurrency: 2 },
    );
    const cycle = runner.runOnce();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(delivered, ["fast"]);
    releaseSlow();
    assert.equal(await cycle, 2);
    assert.deepEqual(delivered, ["fast", "slow"]);
  });
  it("uses bounded exponential retry delays for dispatch and source failures", async () => {
    let dispatchDelay = 0;
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
    };
    const dispatchRepository = {
      claim: async () => command,
      markUnknown: async (_lease: unknown, delay: number) => {
        dispatchDelay = delay;
        return true;
      },
    };
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
    );
    await dispatcher.runOnce();
    assert.equal(dispatchDelay, 5000);

    let sourceDelay = 0;
    const lease = {
      tenantId: "t",
      taskId: "task",
      sessionId: "scheduled:task",
      subjectId: "u",
      leaseOwner: "w",
      leaseToken: "x",
      fence: 1,
      sourceHighWatermark: 0,
      failureCount: 3,
      leaseRemainingMs: 5000,
      leaseObservedAt: performance.now(),
    };
    const sourceRepository = {
      claimConsumer: async () => lease,
      releaseConsumer: async (_lease: unknown, delay: number) => {
        sourceDelay = delay;
        return true;
      },
    };
    const consumer = new ScheduledAgentTerminalConsumer(
      sourceRepository as never,
      {
        read: async () => {
          throw new Error("source");
        },
      },
      {
        workerId: "w",
        retryBaseMs: 1000,
        retryMaxMs: 5000,
        retryJitterPercent: 20,
        random: () => 1,
      },
    );
    await assert.rejects(consumer.runOnce(), /TERMINAL_CYCLE_FAILED/);
    assert.equal(sourceDelay, 5000);
    assert.throws(
      () =>
        new ScheduledAgentDispatcher(
          dispatchRepository as never,
          { deliver: async () => ({ outcome: "admitted" }) },
          { workerId: "w", retryBaseMs: 0 },
        ),
      /RETRY_OPTIONS_INVALID/,
    );
    assert.throws(
      () =>
        new ScheduledAgentTerminalConsumer(
          sourceRepository as never,
          {
            read: async () => ({
              events: [],
              nextSequence: 0,
              exhausted: true,
            }),
          },
          { workerId: "w", retryJitterPercent: Number.NaN },
        ),
      /RETRY_OPTIONS_INVALID/,
    );
  });
  it("performs no source network I/O when the consumer claim loses its locked revalidation", async () => {
    let reads = 0;
    const consumer = new ScheduledAgentTerminalConsumer(
      { claimConsumer: async () => null } as never,
      {
        read: async () => {
          reads += 1;
          return { events: [], nextSequence: 0, exhausted: true };
        },
      },
      { workerId: "w" },
    );
    assert.equal(await consumer.runOnce(), 0);
    assert.equal(reads, 0);
  });
  it("releases an exhausted committed consumer lease without source network I/O", async () => {
    let reads = 0;
    let releases = 0;
    const consumer = new ScheduledAgentTerminalConsumer(
      {
        claimConsumer: async () => ({
          tenantId: "t",
          taskId: "task",
          sessionId: "scheduled:task",
          subjectId: "u",
          leaseOwner: "w",
          leaseToken: "x",
          fence: 1,
          sourceHighWatermark: 0,
          failureCount: 0,
          leaseRemainingMs: 400,
          leaseObservedAt: performance.now(),
        }),
        releaseConsumer: async () => {
          releases += 1;
          return true;
        },
      } as never,
      {
        read: async () => {
          reads += 1;
          return { events: [], nextSequence: 0, exhausted: true };
        },
      },
      { workerId: "w", concurrency: 1, settlementReserveMs: 500 },
    );
    assert.equal(await consumer.runOnce(), 0);
    assert.equal(reads, 0);
    assert.equal(releases, 1);
  });
  it("rejects non-finite and out-of-range worker options", () => {
    const repository = {} as never;
    const delivery = {
      deliver: async () => ({ outcome: "admitted" as const }),
    };
    assert.throws(
      () =>
        new ScheduledAgentDispatcher(repository, delivery, {
          workerId: " ",
          concurrency: 1,
        }),
      /WORKER_OPTIONS_INVALID/,
    );
    assert.throws(
      () =>
        new ScheduledAgentDispatcher(repository, delivery, {
          workerId: "w",
          concurrency: 33,
        }),
      /WORKER_OPTIONS_INVALID/,
    );
    assert.throws(
      () =>
        new ScheduledAgentDispatcher(repository, delivery, {
          workerId: "w",
          leaseDurationMs: 500,
          settlementReserveMs: 500,
        }),
      /WORKER_OPTIONS_INVALID/,
    );
    assert.throws(
      () =>
        new ScheduledAgentTerminalConsumer(
          repository,
          {
            read: async () => ({
              events: [],
              nextSequence: 0,
              exhausted: true,
            }),
          },
          { workerId: "w", pageSize: 0 },
        ),
      /WORKER_OPTIONS_INVALID/,
    );
  });
  it("reports repository cycle failures with bounded backoff and drains on stop", async () => {
    let report!: (value: {
      operation: string;
      result: "error";
      errorCode: string;
      attempt: number;
      backoffMs: number;
    }) => void;
    const reported = new Promise<{
      operation: string;
      result: "error";
      errorCode: string;
      attempt: number;
      backoffMs: number;
    }>((resolve) => {
      report = resolve;
    });
    const runner = new ScheduledAgentDispatcher(
      {
        claim: async () => {
          throw new Error("repository_down");
        },
      } as never,
      { deliver: async () => ({ outcome: "admitted" as const }) },
      {
        workerId: "w",
        concurrency: 1,
        pollIntervalMs: 60000,
        retryBaseMs: 100,
        retryMaxMs: 100,
        retryJitterPercent: 0,
        onError: report,
      },
    );
    runner.start();
    assert.deepEqual(await reported, {
      operation: "scheduled_agent_dispatch_cycle",
      result: "error",
      errorCode: "scheduled_agent_dispatch_cycle_failed",
      attempt: 1,
      backoffMs: 100,
    });
    await runner.stop();
  });
  it("waits for every in-flight scope before a failed parallel cycle rejects or stops", async () => {
    let claimCount = 0;
    let releaseSlow!: () => void;
    let slowFinished = false;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
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
    };
    const runner = new ScheduledAgentDispatcher(
      {
        claim: async () => {
          claimCount += 1;
          if (claimCount === 1) throw new Error("repository_down");
          return command;
        },
        markAdmitted: async () => true,
      } as never,
      {
        deliver: async () => {
          await slow;
          slowFinished = true;
          return { outcome: "admitted" as const };
        },
      },
      { workerId: "w", concurrency: 2 },
    );
    const cycle = runner.runOnce();
    const stopping = runner.stop();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(slowFinished, false);
    releaseSlow();
    await assert.rejects(cycle, /DISPATCH_CYCLE_FAILED/);
    await stopping;
    assert.equal(slowFinished, true);
  });
  it("reports terminal repository failures using a stable safe code", async () => {
    let report!: (value: { errorCode: string }) => void;
    const reported = new Promise<{ errorCode: string }>((resolve) => {
      report = resolve;
    });
    const consumer = new ScheduledAgentTerminalConsumer(
      {
        claimConsumer: async () => {
          throw new Error("secret database detail");
        },
      } as never,
      { read: async () => ({ events: [], nextSequence: 0, exhausted: true }) },
      {
        workerId: "w",
        concurrency: 1,
        pollIntervalMs: 60000,
        onError: report as never,
      },
    );
    consumer.start();
    assert.equal(
      (await reported).errorCode,
      "scheduled_agent_terminal_cycle_failed",
    );
    await consumer.stop();
  });
  it("waits for every consumer scope when one parallel source or commit fails", async () => {
    let claims = 0;
    let releaseSlow!: () => void;
    let slowCommitted = false;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const lease = (taskId: string) => ({
      tenantId: "t",
      taskId,
      sessionId: `scheduled:${taskId}`,
      subjectId: "u",
      leaseOwner: "w",
      leaseToken: `token-${taskId}`,
      fence: 1,
      sourceHighWatermark: 0,
      failureCount: 0,
      leaseRemainingMs: 5000,
      leaseObservedAt: performance.now(),
    });
    const consumer = new ScheduledAgentTerminalConsumer(
      {
        claimConsumer: async () => {
          claims += 1;
          return claims === 1 ? lease("broken") : lease("slow");
        },
        commitSourcePage: async (value: { taskId: string }) => {
          if (value.taskId === "broken") throw new Error("commit detail");
          slowCommitted = true;
          return true;
        },
        releaseConsumer: async () => true,
      } as never,
      {
        read: async (value) => {
          if (value.taskId === "slow") await slow;
          return { events: [], nextSequence: 0, exhausted: true };
        },
      },
      { workerId: "w", concurrency: 2 },
    );
    const cycle = consumer.runOnce();
    const stopping = consumer.stop();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(slowCommitted, false);
    releaseSlow();
    await assert.rejects(cycle, /TERMINAL_CYCLE_FAILED/);
    await stopping;
    assert.equal(slowCommitted, true);
  });
  it("surfaces a consumer release repository failure to cycle observability", async () => {
    const consumer = new ScheduledAgentTerminalConsumer(
      {
        claimConsumer: async () => ({
          tenantId: "t",
          taskId: "task",
          sessionId: "scheduled:task",
          subjectId: "u",
          leaseOwner: "w",
          leaseToken: "token",
          fence: 1,
          sourceHighWatermark: 0,
          failureCount: 0,
          leaseRemainingMs: 5000,
          leaseObservedAt: performance.now(),
        }),
        releaseConsumer: async () => {
          throw new Error("release detail");
        },
      } as never,
      {
        read: async () => {
          throw new Error("source detail");
        },
      },
      { workerId: "w", concurrency: 1 },
    );
    await assert.rejects(consumer.runOnce(), /TERMINAL_CYCLE_FAILED/);
  });
});
