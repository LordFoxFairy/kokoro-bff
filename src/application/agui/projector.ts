import {
  AgUiConsumerLeaseLostError,
  AgUiSourceContinuityError,
  AgUiSourceContractError,
  AgUiSourceIdentityConflictError,
  AgUiSourceReadError,
} from "./errors.js"
import type { AgUiProjectionService } from "./project-session-events.js"
import type {
  AgUiConsumerLease,
  AgUiGarbageCollectionResult,
  AgUiProjectionConsumerRepository,
} from "./ports/agui-projection-repository.js"
import type { AgUiSourcePage, AgUiSourceReader, AgUiSourceScope } from "./ports/agui-source-reader.js"

export type AgUiProjectorOptions = {
  workerId: string
  maxConsumersPerCycle: number
  sourcePageSize: number
  maxPagesPerConsumer: number
  leaseDurationMs: number
  pollIntervalMs: number
  errorBackoffMs: number
  errorBackoffMaxMs: number
  errorBackoffJitterPercent: number
  retentionMs: number
  gcIntervalMs: number
  gcBatchSize: number
  cursorTombstoneRetentionMs: number
  now?: () => Date
  monotonicNow?: () => number
  random?: () => number
}

export type AgUiProjectorCycleResult = {
  consumersClaimed: number
  consumersSucceeded: number
  consumersRetried: number
  consumersBlocked: number
  sourceEvents: number
  insertedFrames: number
  garbageCollection: AgUiGarbageCollectionResult | null
}

export type AgUiProjectorSnapshot = {
  running: boolean
  activeCycle: boolean
  activeLeases: number
  completedCycles: number
  failedCycles: number
  lastCompletedAt: string | null
  lastErrorCode: string | null
}

const DEFAULT_OPTIONS: Omit<AgUiProjectorOptions, "workerId"> = {
  maxConsumersPerCycle: 32,
  sourcePageSize: 256,
  maxPagesPerConsumer: 8,
  leaseDurationMs: 15_000,
  pollIntervalMs: 1_000,
  errorBackoffMs: 5_000,
  errorBackoffMaxMs: 5 * 60 * 1000,
  errorBackoffJitterPercent: 20,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  gcIntervalMs: 15 * 60 * 1000,
  gcBatchSize: 100,
  cursorTombstoneRetentionMs: 30 * 24 * 60 * 60 * 1000,
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`)
}

function percentage(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) throw new Error(`${label} must be an integer between 0 and 100`)
}

function nowIso(now: () => Date): string {
  const value = now()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("AG-UI projector clock returned an invalid date")
  return value.toISOString()
}

function scopeOf(lease: AgUiConsumerLease): AgUiSourceScope {
  return { tenantId: lease.tenantId, sessionId: lease.sessionId, subjectId: lease.subjectId }
}

function leaseKey(lease: AgUiConsumerLease): string {
  return JSON.stringify([lease.tenantId, lease.sessionId, lease.leaseOwner, lease.leaseToken, lease.fence])
}

function errorCode(error: unknown): string {
  if (error instanceof AgUiSourceContinuityError) return "source_gap"
  if (error instanceof AgUiSourceContractError) return "source_contract_invalid"
  if (error instanceof AgUiSourceIdentityConflictError) return "source_identity_conflict"
  if (error instanceof Error && "code" in error) {
    const code = error.code
    if (typeof code === "string" && code.trim() !== "") return code
  }
  return "projection_failed"
}

function blocksConsumer(error: unknown): boolean {
  return error instanceof AgUiSourceIdentityConflictError
    || error instanceof AgUiSourceContractError
    || error instanceof AgUiSourceContinuityError
    || (error instanceof AgUiSourceReadError && !error.retryable)
}

function validateSourcePage(page: AgUiSourcePage, afterSequence: number, pageSize: number): void {
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new AgUiSourceContractError()
  if (!Array.isArray(page.events) || page.events.length > pageSize) throw new AgUiSourceContractError()
  if (!Number.isSafeInteger(page.nextSequence) || page.nextSequence < afterSequence) throw new AgUiSourceContractError()
  if (!Number.isSafeInteger(page.watermark) || page.watermark < page.nextSequence) throw new AgUiSourceContractError()
  if (page.exhausted !== (page.nextSequence === page.watermark)) throw new AgUiSourceContractError()

  const ids = new Set<string>()
  let expected = afterSequence
  for (const source of page.events) {
    if (!Number.isSafeInteger(source.sourceSequence) || source.sourceSequence !== expected + 1) {
      throw new AgUiSourceContinuityError()
    }
    if (source.sourceEventId.trim() === "" || ids.has(source.sourceEventId)) throw new AgUiSourceContractError()
    ids.add(source.sourceEventId)
    expected = source.sourceSequence
  }
  if (expected !== page.nextSequence) throw new AgUiSourceContinuityError()
  if (page.events.length === 0 && !page.exhausted) throw new AgUiSourceContinuityError()
}

export class AgUiProjectorRunner {
  private readonly options: AgUiProjectorOptions
  private readonly now: () => Date
  private readonly monotonicNow: () => number
  private readonly random: () => number
  private activeCycle: Promise<AgUiProjectorCycleResult> | null = null
  private timer: NodeJS.Timeout | null = null
  private running = false
  private lastGcAt: number | null = null
  private readonly activeLeases = new Map<string, AgUiConsumerLease>()
  private completedCycles = 0
  private failedCycles = 0
  private lastCompletedAt: string | null = null
  private lastErrorCode: string | null = null

  public constructor(
    private readonly projection: Pick<AgUiProjectionService, "ingest">,
    private readonly consumers: AgUiProjectionConsumerRepository,
    private readonly sourceReader: AgUiSourceReader,
    options: Partial<AgUiProjectorOptions> & Pick<AgUiProjectorOptions, "workerId">,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.now = this.options.now ?? (() => new Date())
    this.monotonicNow = this.options.monotonicNow ?? (() => performance.now())
    this.random = this.options.random ?? Math.random
    if (this.options.workerId.trim() === "") throw new Error("AG-UI projector worker id is required")
    positiveInteger(this.options.maxConsumersPerCycle, "AG-UI projector consumer batch")
    positiveInteger(this.options.sourcePageSize, "AG-UI projector source page size")
    positiveInteger(this.options.maxPagesPerConsumer, "AG-UI projector page budget")
    positiveInteger(this.options.leaseDurationMs, "AG-UI projector lease duration")
    positiveInteger(this.options.pollIntervalMs, "AG-UI projector poll interval")
    positiveInteger(this.options.errorBackoffMs, "AG-UI projector error backoff")
    positiveInteger(this.options.errorBackoffMaxMs, "AG-UI projector maximum error backoff")
    if (this.options.errorBackoffMs > this.options.errorBackoffMaxMs) throw new Error("AG-UI projector error backoff must not exceed its maximum")
    percentage(this.options.errorBackoffJitterPercent, "AG-UI projector error backoff jitter")
    positiveInteger(this.options.retentionMs, "AG-UI projector retention")
    positiveInteger(this.options.gcIntervalMs, "AG-UI projector GC interval")
    positiveInteger(this.options.gcBatchSize, "AG-UI projector GC batch")
    positiveInteger(this.options.cursorTombstoneRetentionMs, "AG-UI projector cursor tombstone retention")
  }

  public start(): void {
    if (this.running) return
    this.running = true
    this.schedule(0)
  }

  public async stop(): Promise<void> {
    this.running = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.activeCycle
    const leases = [...this.activeLeases.values()]
    this.activeLeases.clear()
    const now = nowIso(this.now)
    await Promise.all(leases.map((lease) => this.consumers.releaseConsumer(lease, now).catch(() => false)))
  }

  public runOnce(): Promise<AgUiProjectorCycleResult> {
    if (this.activeCycle !== null) return this.activeCycle
    const cycle = this.executeCycle().then(
      (result) => {
        this.completedCycles += 1
        this.lastCompletedAt = nowIso(this.now)
        this.lastErrorCode = null
        return result
      },
      (error: unknown) => {
        this.failedCycles += 1
        this.lastCompletedAt = nowIso(this.now)
        this.lastErrorCode = errorCode(error)
        throw error
      },
    )
    this.activeCycle = cycle
    cycle.then(
      () => { if (this.activeCycle === cycle) this.activeCycle = null },
      () => { if (this.activeCycle === cycle) this.activeCycle = null },
    )
    return cycle
  }

  public snapshot(): AgUiProjectorSnapshot {
    return {
      running: this.running,
      activeCycle: this.activeCycle !== null,
      activeLeases: this.activeLeases.size,
      completedCycles: this.completedCycles,
      failedCycles: this.failedCycles,
      lastCompletedAt: this.lastCompletedAt,
      lastErrorCode: this.lastErrorCode,
    }
  }

  private schedule(delayMs: number): void {
    if (!this.running) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.runOnce().catch(() => undefined).finally(() => this.schedule(this.options.pollIntervalMs))
    }, delayMs)
    this.timer.unref?.()
  }

  private async executeCycle(): Promise<AgUiProjectorCycleResult> {
    const garbageCollection = await this.maybeCollectGarbage()
    await this.consumers.seedConsumers(this.options.maxConsumersPerCycle)
    const now = nowIso(this.now)
    const leaseUntil = new Date(Date.parse(now) + this.options.leaseDurationMs).toISOString()
    const leases = await this.consumers.claimConsumers({
      workerId: this.options.workerId,
      now,
      leaseUntil,
      limit: this.options.maxConsumersPerCycle,
    })
    const result: AgUiProjectorCycleResult = {
      consumersClaimed: leases.length,
      consumersSucceeded: 0,
      consumersRetried: 0,
      consumersBlocked: 0,
      sourceEvents: 0,
      insertedFrames: 0,
      garbageCollection,
    }
    const outcomes = await Promise.all(leases.map((lease) => this.processLease(lease)))
    for (const outcome of outcomes) {
      result.sourceEvents += outcome.sourceEvents
      result.insertedFrames += outcome.insertedFrames
      if (outcome.kind === "succeeded") result.consumersSucceeded += 1
      else if (outcome.kind === "blocked") result.consumersBlocked += 1
      else if (outcome.kind === "retryable") result.consumersRetried += 1
    }
    return result
  }

  private async maybeCollectGarbage(): Promise<AgUiGarbageCollectionResult | null> {
    const now = this.now()
    const nowMs = now.getTime()
    if (!Number.isFinite(nowMs)) throw new Error("AG-UI projector clock returned an invalid date")
    if (this.lastGcAt !== null && nowMs - this.lastGcAt < this.options.gcIntervalMs) return null
    const result = await this.consumers.collectGarbage({
      now: now.toISOString(),
      retentionMs: this.options.retentionMs,
      tombstoneRetentionMs: this.options.cursorTombstoneRetentionMs,
      batchSize: this.options.gcBatchSize,
    })
    this.lastGcAt = nowMs
    return result
  }

  private async processLease(initialLease: AgUiConsumerLease): Promise<{
    kind: "succeeded" | "retryable" | "blocked" | "lease_lost"
    sourceEvents: number
    insertedFrames: number
  }> {
    let lease = initialLease
    positiveInteger(lease.leaseRemainingMs, "AG-UI consumer lease remaining budget")
    let leaseDeadline = this.monotonicTimestamp() + lease.leaseRemainingMs
    const key = leaseKey(lease)
    this.activeLeases.set(key, lease)
    let afterSequence = lease.sourceHighWatermark
    let snapshotWatermark: number | null = null
    let sourceEvents = 0
    let insertedFrames = 0
    try {
      for (let pageNumber = 0; pageNumber < this.options.maxPagesPerConsumer; pageNumber += 1) {
        const renewed = await this.renewIfNeeded(lease, leaseDeadline)
        lease = renewed.lease
        leaseDeadline = renewed.deadline
        this.activeLeases.set(key, lease)
        const remainingLeaseMs = Math.floor(leaseDeadline - this.monotonicTimestamp())
        if (remainingLeaseMs < 1) throw new AgUiConsumerLeaseLostError()
        const page = await this.sourceReader.read(
          scopeOf(lease),
          afterSequence,
          this.options.sourcePageSize,
          { ...lease, leaseRemainingMs: remainingLeaseMs },
        )
        validateSourcePage(page, afterSequence, this.options.sourcePageSize)
        if (snapshotWatermark !== null && page.watermark < snapshotWatermark) throw new AgUiSourceContractError()
        snapshotWatermark = page.watermark
        if (page.events.length > 0) {
          const projected = await this.projection.ingest(lease.tenantId, lease.sessionId, page.events, lease)
          if (projected.sourceHighWatermark !== page.nextSequence) throw new AgUiSourceContinuityError()
          sourceEvents += page.events.length
          insertedFrames += projected.insertedFrames
          afterSequence = page.nextSequence
        }
        if (page.exhausted) {
          const settled = await this.consumers.markConsumerProgress(lease, this.nextPollAt(), nowIso(this.now))
          if (!settled) return { kind: "lease_lost", sourceEvents, insertedFrames }
          return { kind: "succeeded", sourceEvents, insertedFrames }
        }
        if (page.events.length === 0) throw new AgUiSourceContinuityError()
      }

      const settled = await this.consumers.markConsumerProgress(lease, nowIso(this.now), nowIso(this.now))
      return settled
        ? { kind: "succeeded", sourceEvents, insertedFrames }
        : { kind: "lease_lost", sourceEvents, insertedFrames }
    } catch (error) {
      if (error instanceof AgUiConsumerLeaseLostError) return { kind: "lease_lost", sourceEvents, insertedFrames }
      const code = errorCode(error)
      const now = nowIso(this.now)
      if (blocksConsumer(error)) {
        const blocked = await this.consumers.markConsumerBlocked(lease, code, now).catch(() => false)
        return blocked
          ? { kind: "blocked", sourceEvents, insertedFrames }
          : { kind: "lease_lost", sourceEvents, insertedFrames }
      }
      const localDelay = this.retryDelayMs(lease.failureCount)
      const retryAfter = error instanceof AgUiSourceReadError ? (error.retryAfterMs ?? 0) : 0
      const retryDelay = Math.min(this.options.errorBackoffMaxMs, Math.max(localDelay, retryAfter))
      const retryAt = new Date(Date.parse(now) + retryDelay).toISOString()
      const retryable = await this.consumers.markConsumerRetryable(lease, retryAt, code, now).catch(() => false)
      return retryable
        ? { kind: "retryable", sourceEvents, insertedFrames }
        : { kind: "lease_lost", sourceEvents, insertedFrames }
    } finally {
      this.activeLeases.delete(key)
    }
  }

  private nextPollAt(): string {
    return new Date(Date.parse(nowIso(this.now)) + this.options.pollIntervalMs).toISOString()
  }

  private retryDelayMs(failureCount: number): number {
    if (!Number.isSafeInteger(failureCount) || failureCount < 0) throw new Error("AG-UI consumer failure count is invalid")
    const random = this.random()
    if (!Number.isFinite(random) || random < 0 || random > 1) throw new Error("AG-UI projector random provider returned an invalid value")
    const capped = Math.min(this.options.errorBackoffMaxMs, this.options.errorBackoffMs * (2 ** Math.min(failureCount, 30)))
    const jitter = this.options.errorBackoffJitterPercent / 100
    return Math.max(1, Math.min(this.options.errorBackoffMaxMs, Math.floor(capped * (1 - jitter + 2 * jitter * random))))
  }

  private monotonicTimestamp(): number {
    const value = this.monotonicNow()
    if (!Number.isFinite(value) || value < 0) throw new Error("AG-UI projector monotonic clock returned an invalid value")
    return value
  }

  private async renewIfNeeded(
    lease: AgUiConsumerLease,
    deadline: number,
  ): Promise<{ lease: AgUiConsumerLease; deadline: number }> {
    const monotonicNow = this.monotonicTimestamp()
    const remaining = deadline - monotonicNow
    if (remaining <= 0) throw new AgUiConsumerLeaseLostError()
    if (remaining > Math.floor(this.options.leaseDurationMs / 3)) return { lease, deadline }
    const wallNow = nowIso(this.now)
    const nextUntil = new Date(Date.parse(wallNow) + this.options.leaseDurationMs).toISOString()
    if (!await this.consumers.renewConsumerLease(lease, wallNow, nextUntil)) {
      throw new AgUiConsumerLeaseLostError()
    }
    return {
      lease: { ...lease, leaseUntil: nextUntil, leaseRemainingMs: this.options.leaseDurationMs },
      deadline: monotonicNow + this.options.leaseDurationMs,
    }
  }
}
