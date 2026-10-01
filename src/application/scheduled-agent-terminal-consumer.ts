import type {
  ScheduledAgentConsumerLease,
  ScheduledAgentDispatchRepository,
} from "./ports/scheduled-agent-dispatch-repository.js";
import type { ScheduledAgentSourceEvent } from "../domain/scheduled-task/agent-dispatch.js";
export type ScheduledAgentSourcePage = {
  events: readonly ScheduledAgentSourceEvent[];
  nextSequence: number;
  exhausted: boolean;
};
export interface ScheduledAgentSourceReader {
  read(
    lease: ScheduledAgentConsumerLease,
    limit: number,
  ): Promise<ScheduledAgentSourcePage>;
}
export class ScheduledAgentTerminalConsumer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private active: Promise<number> | null = null;
  private failureCount = 0;
  private nextAttemptAt = 0;
  public constructor(
    private readonly repository: ScheduledAgentDispatchRepository,
    private readonly source: ScheduledAgentSourceReader,
    private readonly options: {
      workerId: string;
      pollIntervalMs?: number;
      leaseDurationMs?: number;
      pageSize?: number;
      retryBaseMs?: number;
      retryMaxMs?: number;
      retryJitterPercent?: number;
      random?: () => number;
      settlementReserveMs?: number;
      concurrency?: number;
      onError?: (event: {
        operation: string;
        result: "error";
        errorCode: string;
        attempt: number;
        backoffMs: number;
      }) => void;
    },
  ) {
    const base = options.retryBaseMs ?? 1000;
    const maximum = options.retryMaxMs ?? 30000;
    const jitter = options.retryJitterPercent ?? 20;
    const reserve = options.settlementReserveMs ?? 500;
    const concurrency = options.concurrency ?? 4;
    const poll = options.pollIntervalMs ?? 250;
    const lease = options.leaseDurationMs ?? 30000;
    if (
      options.workerId.trim() === "" ||
      options.workerId.length > 128 ||
      !Number.isSafeInteger(poll) ||
      poll < 1 ||
      poll > 60000 ||
      !Number.isSafeInteger(lease) ||
      lease < 2 ||
      lease > 600000
    )
      throw new Error("SCHEDULED_AGENT_WORKER_OPTIONS_INVALID");
    if (
      !Number.isSafeInteger(reserve) ||
      reserve < 0 ||
      reserve >= (options.leaseDurationMs ?? 30000) ||
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 32 ||
      !Number.isSafeInteger(options.pageSize ?? 100) ||
      (options.pageSize ?? 100) < 1 ||
      (options.pageSize ?? 100) > 1000
    )
      throw new Error("SCHEDULED_AGENT_WORKER_OPTIONS_INVALID");
    if (
      !Number.isSafeInteger(base) ||
      base < 1 ||
      base > 600000 ||
      !Number.isSafeInteger(maximum) ||
      maximum < base ||
      maximum > 600000 ||
      !Number.isSafeInteger(jitter) ||
      jitter < 0 ||
      jitter > 100
    )
      throw new Error("SCHEDULED_AGENT_RETRY_OPTIONS_INVALID");
  }
  public start() {
    if (this.timer) return;
    this.timer = setInterval(
      () =>
        void this.runOnce().catch((error: unknown) =>
          this.observeFailure(error),
        ),
      this.options.pollIntervalMs ?? 250,
    );
    this.timer.unref?.();
    void this.runOnce().catch((error: unknown) => this.observeFailure(error));
  }
  public async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.active?.catch(() => undefined);
  }
  public runOnce(): Promise<number> {
    if (this.active) return this.active;
    const p = this.execute();
    this.active = p;
    void p
      .finally(() => {
        if (this.active === p) this.active = null;
      })
      .catch(() => undefined);
    return p;
  }
  private async execute() {
    if (Date.now() < this.nextAttemptAt) return 0;
    const results = await Promise.allSettled(
      Array.from({ length: this.options.concurrency ?? 4 }, () =>
        this.executeOne(),
      ),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("SCHEDULED_AGENT_TERMINAL_CYCLE_FAILED");
    this.failureCount = 0;
    this.nextAttemptAt = 0;
    return results.reduce<number>(
      (sum, result) => sum + (result.status === "fulfilled" ? result.value : 0),
      0,
    );
  }
  private async executeOne() {
    const lease = await this.repository.claimConsumer({
      workerId: this.options.workerId,
      leaseDurationMs: this.options.leaseDurationMs ?? 30000,
      settlementReserveMs: this.options.settlementReserveMs ?? 500,
    });
    if (!lease) return 0;
    const sourceBudget =
      lease.leaseRemainingMs -
      Math.ceil(performance.now() - lease.leaseObservedAt) -
      (this.options.settlementReserveMs ?? 500);
    if (sourceBudget <= 0) {
      await this.repository.releaseConsumer(
        lease,
        this.retryDelay(lease.failureCount),
      );
      return 0;
    }
    try {
      const page = await this.source.read(
        {
          ...lease,
          leaseRemainingMs: sourceBudget,
          leaseObservedAt: performance.now(),
        },
        this.options.pageSize ?? 100,
      );
      if (
        !(await this.repository.commitSourcePage(
          lease,
          page.events,
          page.nextSequence,
          page.exhausted,
        ))
      )
        return 0;
      return page.events.length;
    } catch {
      try {
        await this.repository.releaseConsumer(
          lease,
          this.retryDelay(lease.failureCount),
        );
      } catch {
        throw new Error("SCHEDULED_AGENT_CONSUMER_RELEASE_FAILED");
      }
      throw new Error("SCHEDULED_AGENT_SOURCE_CYCLE_FAILED");
    }
  }
  private observeFailure(_error: unknown): void {
    this.failureCount += 1;
    const backoffMs = this.retryDelay(this.failureCount);
    this.nextAttemptAt = Date.now() + backoffMs;
    this.options.onError?.({
      operation: "scheduled_agent_terminal_cycle",
      result: "error",
      errorCode: "scheduled_agent_terminal_cycle_failed",
      attempt: this.failureCount,
      backoffMs,
    });
  }
  private retryDelay(failureCount: number): number {
    const base = this.options.retryBaseMs ?? 1000;
    const maximum = this.options.retryMaxMs ?? 30000;
    const jitter = (this.options.retryJitterPercent ?? 20) / 100;
    const random = (this.options.random ?? Math.random)();
    if (!Number.isFinite(random) || random < 0 || random > 1)
      throw new Error("SCHEDULED_AGENT_RETRY_RANDOM_INVALID");
    const capped = Math.min(maximum, base * 2 ** Math.max(0, failureCount));
    return Math.min(
      maximum,
      Math.max(1, Math.floor(capped * (1 - jitter + 2 * jitter * random))),
    );
  }
}
