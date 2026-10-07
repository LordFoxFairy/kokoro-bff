import type {
  ProjectScopeReleaseClient,
  ProjectScopeReleaseCommand,
  ProjectScopeReleaseLease,
  ProjectScopeReleaseOutboxRepository,
} from "./ports/project-scope-release-outbox.js"

export type ProjectScopeReleaseDispatcherOptions = Readonly<{
  workerId: string
  batchSize?: number
  leaseDurationMs?: number
  settlementReserveMs?: number
  pollIntervalMs?: number
  monotonicNow?: () => number
  random?: () => number
}>

const positive = (value: number | undefined, fallback: number): number => {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < 1) throw new Error("PROJECT_SCOPE_RELEASE_OPTION_INVALID")
  return selected
}

const leaseOf = (command: ProjectScopeReleaseCommand): ProjectScopeReleaseLease => ({
  commandId: command.commandId,
  tenantId: command.tenantId,
  projectId: command.projectId,
  leaseOwner: command.leaseOwner,
  fence: command.fence,
})

export class ProjectScopeReleaseOutboxDispatcher {
  private readonly workerId: string
  private readonly batchSize: number
  private readonly leaseDurationMs: number
  private readonly settlementReserveMs: number
  private readonly pollIntervalMs: number
  private readonly monotonicNow: () => number
  private readonly random: () => number
  private timer: ReturnType<typeof setInterval> | null = null
  private activeCycle: Promise<number> | null = null
  private activeAbort: AbortController | null = null
  private stopping = false

  public constructor(
    private readonly repository: ProjectScopeReleaseOutboxRepository,
    private readonly client: ProjectScopeReleaseClient,
    options: ProjectScopeReleaseDispatcherOptions,
  ) {
    if (options.workerId.trim() === "") throw new Error("PROJECT_SCOPE_RELEASE_WORKER_ID_REQUIRED")
    this.workerId = options.workerId
    this.batchSize = positive(options.batchSize, 10)
    this.leaseDurationMs = positive(options.leaseDurationMs, 30_000)
    this.settlementReserveMs = positive(options.settlementReserveMs, 500)
    this.pollIntervalMs = positive(options.pollIntervalMs, 250)
    this.monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.random = options.random ?? Math.random
    if (this.leaseDurationMs <= this.settlementReserveMs) throw new Error("PROJECT_SCOPE_RELEASE_LEASE_TOO_SHORT")
  }

  public start(): void {
    if (this.timer !== null || this.stopping) return
    this.timer = setInterval(() => void this.runOnce().catch(() => undefined), this.pollIntervalMs)
    this.timer.unref?.()
    void this.runOnce().catch(() => undefined)
  }

  public runOnce(): Promise<number> {
    if (this.stopping) return Promise.resolve(0)
    if (this.activeCycle !== null) return this.activeCycle
    const cycle = this.executeCycle()
    this.activeCycle = cycle
    void cycle
      .finally(() => {
        if (this.activeCycle === cycle) this.activeCycle = null
      })
      .catch(() => undefined)
    return cycle
  }

  public async stop(): Promise<void> {
    this.stopping = true
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.activeAbort?.abort(new Error("PROJECT_SCOPE_RELEASE_STOPPED"))
    await this.activeCycle?.catch(() => undefined)
  }

  private async executeCycle(): Promise<number> {
    const claimController = new AbortController()
    this.activeAbort = claimController
    let commands: readonly ProjectScopeReleaseCommand[]
    try {
      commands = await this.repository.claimProjectScopeReleases(
        {
          workerId: this.workerId,
          limit: this.batchSize,
          leaseDurationMs: this.leaseDurationMs,
          includeOneCredentialRecovery: true,
        },
        claimController.signal,
        10_000,
      )
    } finally {
      if (this.activeAbort === claimController) this.activeAbort = null
    }
    if (this.stopping) return 0
    let processed = 0
    for (const command of commands) {
      if (this.stopping) break
      await this.process(command, command.leaseObservedAtMs + command.leaseRemainingMs)
      processed += 1
    }
    return processed
  }

  private async process(command: ProjectScopeReleaseCommand, leaseDeadline: number): Promise<void> {
    const startedAt = this.monotonicNow()
    const timeoutMs = Math.min(10_000, Math.floor(leaseDeadline - startedAt - this.settlementReserveMs))
    const attemptDeadline = startedAt + timeoutMs
    const lease = leaseOf(command)
    if (timeoutMs < 1 || this.stopping) return
    const controller = new AbortController()
    this.activeAbort = controller
    const timer = setTimeout(() => controller.abort(new Error("PROJECT_SCOPE_RELEASE_DEADLINE")), timeoutMs)
    timer.unref?.()
    try {
      const result = await this.client.release(command, controller.signal, timeoutMs)
      if (
        this.stopping ||
        this.monotonicNow() >= attemptDeadline ||
        this.monotonicNow() >= leaseDeadline - this.settlementReserveMs ||
        controller.signal.aborted
      )
        return
      const settlementMs = Math.floor(Math.min(attemptDeadline, leaseDeadline - this.settlementReserveMs) - this.monotonicNow())
      if (settlementMs < 1) return
      if (result.outcome === "released") await this.repository.markProjectScopeReleased(lease, controller.signal, settlementMs).catch(() => false)
      else if (result.outcome === "blocked")
        await this.repository.markProjectScopeBlocked(lease, result.errorCode, controller.signal, settlementMs).catch(() => false)
      else
        await this.repository
          .markProjectScopeRetryable(lease, this.retryDelay(command.attemptCount), result.errorCode, controller.signal, settlementMs)
          .catch(() => false)
    } catch {
      if (
        this.stopping ||
        controller.signal.aborted ||
        this.monotonicNow() >= attemptDeadline ||
        this.monotonicNow() >= leaseDeadline - this.settlementReserveMs
      )
        return
      const settlementMs = Math.floor(Math.min(attemptDeadline, leaseDeadline - this.settlementReserveMs) - this.monotonicNow())
      if (settlementMs < 1) return
      await this.repository
        .markProjectScopeRetryable(lease, this.retryDelay(command.attemptCount), "storage_release_unknown", controller.signal, settlementMs)
        .catch(() => false)
    } finally {
      clearTimeout(timer)
      if (this.activeAbort === controller) this.activeAbort = null
    }
  }

  private retryDelay(attempt: number): number {
    const exponent = Math.min(Math.max(attempt - 1, 0), 8)
    return Math.max(250, Math.floor(Math.min(300_000, 1000 * 2 ** exponent) * (0.8 + this.random() * 0.4)))
  }
}
