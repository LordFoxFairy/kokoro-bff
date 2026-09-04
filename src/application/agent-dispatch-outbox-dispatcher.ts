import { agentDispatchRetryDelayMs, type AgentDispatchCommand, type AgentDispatchLease } from "../domain/chat/agent-dispatch.js"
import type { AgentDispatchDeliveryPort } from "./ports/agent-dispatch-delivery.js"
import type { AgentDispatchOutboxRepository } from "./ports/agent-dispatch-outbox-repository.js"

export type AgentDispatchOutboxDispatcherOptions = {
  workerId: string
  batchSize?: number
  leaseDurationMs?: number
  maxAttempts?: number
  pollIntervalMs?: number
  random?: () => number
}

const DEFAULT_BATCH_SIZE = 16
const DEFAULT_LEASE_DURATION_MS = 30_000
const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_POLL_INTERVAL_MS = 250

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("AGENT_DISPATCH_OPTION_INVALID")
  return value
}

function leaseOf(command: AgentDispatchCommand): AgentDispatchLease {
  return {
    tenantId: command.tenantId,
    outboxId: command.outboxId,
    leaseOwner: command.leaseOwner,
    leaseToken: command.leaseToken,
    fence: command.fence,
  }
}

export class AgentDispatchOutboxDispatcher {
  private readonly workerId: string
  private readonly batchSize: number
  private readonly leaseDurationMs: number
  private readonly maxAttempts: number
  private readonly pollIntervalMs: number
  private readonly random: () => number
  private timer: ReturnType<typeof setInterval> | null = null
  private activeCycle: Promise<number> | null = null

  public constructor(
    private readonly repository: AgentDispatchOutboxRepository,
    private readonly delivery: AgentDispatchDeliveryPort,
    options: AgentDispatchOutboxDispatcherOptions,
  ) {
    if (options.workerId.trim() === "") throw new Error("AGENT_DISPATCH_WORKER_ID_REQUIRED")
    this.workerId = options.workerId
    this.batchSize = positiveInteger(options.batchSize, DEFAULT_BATCH_SIZE)
    this.leaseDurationMs = positiveInteger(options.leaseDurationMs, DEFAULT_LEASE_DURATION_MS)
    this.maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS)
    this.pollIntervalMs = positiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS)
    this.random = options.random ?? Math.random
  }

  public runOnce(): Promise<number> {
    if (this.activeCycle !== null) return this.activeCycle
    const cycle = this.executeCycle()
    this.activeCycle = cycle
    void cycle.then(
      () => { if (this.activeCycle === cycle) this.activeCycle = null },
      () => { if (this.activeCycle === cycle) this.activeCycle = null },
    )
    return cycle
  }

  public start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => { void this.runOnce().catch(() => undefined) }, this.pollIntervalMs)
    this.timer.unref?.()
    void this.runOnce().catch(() => undefined)
  }

  public async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.activeCycle?.catch(() => undefined)
  }

  private async executeCycle(): Promise<number> {
    const commands = await this.repository.claimAgentDispatchOutbox({
      workerId: this.workerId,
      limit: this.batchSize,
      leaseDurationMs: this.leaseDurationMs,
    })
    for (const command of commands) await this.process(command)
    return commands.length
  }

  private async process(command: AgentDispatchCommand): Promise<void> {
    let result
    try {
      result = await this.delivery.deliver(command)
    } catch {
      result = { outcome: "retryable" as const, errorCode: "agent_dispatch_delivery_error" }
    }
    const lease = leaseOf(command)
    if (result.outcome === "succeeded") {
      await this.repository.markAgentDispatchSucceeded(lease).catch(() => false)
      return
    }
    if (result.outcome === "failed" || command.attemptCount >= this.maxAttempts) {
      await this.repository.markAgentDispatchFailed(lease, result.errorCode).catch(() => false)
      return
    }
    await this.repository.markAgentDispatchRetryable(
      lease,
      agentDispatchRetryDelayMs(command.attemptCount, this.random()),
      result.errorCode,
    ).catch(() => false)
  }
}
