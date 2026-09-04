import {
  agentCancellationRetryDelayMs,
  type AgentCancellationCommand,
  type AgentCancellationLease,
} from "../domain/chat/agent-cancellation.js"
import type { AgentCancellationDeliveryPort } from "./ports/agent-cancellation-delivery.js"
import type { AgentCancellationOutboxRepository } from "./ports/agent-cancellation-outbox-repository.js"

export type AgentCancellationOutboxDispatcherOptions = {
  workerId: string
  maxCommandsPerCycle?: number
  leaseDurationMs?: number
  leaseSettlementReserveMs?: number
  maxAttempts?: number
  pollIntervalMs?: number
  monotonicNow?: () => number
  random?: () => number
}

const DEFAULT_MAX_COMMANDS_PER_CYCLE = 16
const DEFAULT_LEASE_DURATION_MS = 30_000
const DEFAULT_LEASE_SETTLEMENT_RESERVE_MS = 500
const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_POLL_INTERVAL_MS = 250

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("AGENT_CANCELLATION_OPTION_INVALID")
  return value
}

function leaseOf(command: AgentCancellationCommand): AgentCancellationLease {
  return {
    tenantId: command.tenantId,
    cancellationId: command.cancellationId,
    leaseOwner: command.leaseOwner,
    leaseToken: command.leaseToken,
    fence: command.fence,
  }
}

export class AgentCancellationOutboxDispatcher {
  private readonly workerId: string
  private readonly maxCommandsPerCycle: number
  private readonly leaseDurationMs: number
  private readonly leaseSettlementReserveMs: number
  private readonly maxAttempts: number
  private readonly pollIntervalMs: number
  private readonly monotonicNow: () => number
  private readonly random: () => number
  private timer: ReturnType<typeof setInterval> | null = null
  private activeCycle: Promise<number> | null = null

  public constructor(
    private readonly repository: AgentCancellationOutboxRepository,
    private readonly delivery: AgentCancellationDeliveryPort,
    options: AgentCancellationOutboxDispatcherOptions,
  ) {
    if (options.workerId.trim() === "") throw new Error("AGENT_CANCELLATION_WORKER_ID_REQUIRED")
    this.workerId = options.workerId
    this.maxCommandsPerCycle = positiveInteger(options.maxCommandsPerCycle, DEFAULT_MAX_COMMANDS_PER_CYCLE)
    this.leaseDurationMs = positiveInteger(options.leaseDurationMs, DEFAULT_LEASE_DURATION_MS)
    this.leaseSettlementReserveMs = positiveInteger(
      options.leaseSettlementReserveMs,
      DEFAULT_LEASE_SETTLEMENT_RESERVE_MS,
    )
    this.maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS)
    this.pollIntervalMs = positiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS)
    this.monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.random = options.random ?? Math.random
    if (this.leaseDurationMs <= this.leaseSettlementReserveMs) {
      throw new Error("AGENT_CANCELLATION_LEASE_MUST_EXCEED_SETTLEMENT_RESERVE")
    }
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
    let processed = 0
    while (processed < this.maxCommandsPerCycle) {
      const commands = await this.repository.claimAgentCancellationOutbox({
        workerId: this.workerId,
        limit: 1,
        leaseDurationMs: this.leaseDurationMs,
        maxAttempts: this.maxAttempts,
      })
      const command = commands[0]
      if (command === undefined) break
      if (commands.length !== 1) throw new Error("AGENT_CANCELLATION_SINGLE_CLAIM_REQUIRED")
      await this.process(command)
      processed += 1
    }
    return processed
  }

  private async process(command: AgentCancellationCommand): Promise<void> {
    let result
    try {
      const leaseDeadline = this.monotonicTimestamp() + command.leaseRemainingMs
      result = await this.delivery.deliver(command, this.remainingLeaseBudget(leaseDeadline))
    } catch {
      result = { outcome: "retryable" as const, errorCode: "agent_cancellation_delivery_error" }
    }
    const lease = leaseOf(command)
    if (result.outcome === "succeeded") {
      await this.repository.markAgentCancellationSucceeded(lease).catch(() => false)
      return
    }
    if (result.outcome === "failed" || command.attemptCount >= this.maxAttempts) {
      await this.repository.markAgentCancellationFailed(lease, result.errorCode).catch(() => false)
      return
    }
    await this.repository.markAgentCancellationRetryable(
      lease,
      agentCancellationRetryDelayMs(command.attemptCount, this.random()),
      result.errorCode,
    ).catch(() => false)
  }

  private monotonicTimestamp(): number {
    const value = this.monotonicNow()
    if (!Number.isFinite(value) || value < 0) throw new Error("AGENT_CANCELLATION_MONOTONIC_CLOCK_INVALID")
    return value
  }

  private remainingLeaseBudget(leaseDeadline: number): number {
    const remaining = Math.floor(leaseDeadline - this.monotonicTimestamp() - this.leaseSettlementReserveMs)
    if (remaining < 1) throw new Error("AGENT_CANCELLATION_LEASE_BUDGET_EXHAUSTED")
    return remaining
  }
}
