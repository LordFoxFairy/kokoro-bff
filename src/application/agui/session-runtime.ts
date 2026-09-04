import type { AgUiInvalidCursor, AgUiReplayPage } from "./ports/agui-projection-repository.js"

export type AgUiConnectionLimits = {
  global: number
  perTenant: number
  perSession: number
}

export type AgUiConnectionLease = {
  release(): void
}

function positiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`)
}

export class AgUiConnectionLimiter {
  private globalCount = 0
  private readonly tenantCounts = new Map<string, number>()
  private readonly sessionCounts = new Map<string, Map<string, number>>()

  public constructor(private readonly limits: AgUiConnectionLimits) {
    positiveSafeInteger(limits.global, "AG-UI global connection limit")
    positiveSafeInteger(limits.perTenant, "AG-UI tenant connection limit")
    positiveSafeInteger(limits.perSession, "AG-UI session connection limit")
  }

  public acquire(tenantId: string, sessionId: string): AgUiConnectionLease | null {
    const tenantCount = this.tenantCounts.get(tenantId) ?? 0
    const tenantSessions = this.sessionCounts.get(tenantId)
    const sessionCount = tenantSessions?.get(sessionId) ?? 0
    if (
      this.globalCount >= this.limits.global
      || tenantCount >= this.limits.perTenant
      || sessionCount >= this.limits.perSession
    ) return null

    this.globalCount += 1
    this.tenantCounts.set(tenantId, tenantCount + 1)
    const sessions = tenantSessions ?? new Map<string, number>()
    sessions.set(sessionId, sessionCount + 1)
    this.sessionCounts.set(tenantId, sessions)
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        this.globalCount -= 1
        const currentTenantCount = this.tenantCounts.get(tenantId) ?? 0
        if (currentTenantCount <= 1) this.tenantCounts.delete(tenantId)
        else this.tenantCounts.set(tenantId, currentTenantCount - 1)
        const currentSessions = this.sessionCounts.get(tenantId)
        const currentSessionCount = currentSessions?.get(sessionId) ?? 0
        if (currentSessionCount <= 1) currentSessions?.delete(sessionId)
        else currentSessions?.set(sessionId, currentSessionCount - 1)
        if (currentSessions?.size === 0) this.sessionCounts.delete(tenantId)
      },
    }
  }

  public snapshot(): { global: number; tenants: Record<string, number>; sessions: Record<string, number> } {
    const tenants: Record<string, number> = {}
    const sessions: Record<string, number> = {}
    for (const [tenantId, count] of this.tenantCounts) tenants[tenantId] = count
    for (const [tenantId, tenantSessions] of this.sessionCounts) {
      for (const [sessionId, count] of tenantSessions) sessions[`${tenantId}/${sessionId}`] = count
    }
    return { global: this.globalCount, tenants, sessions }
  }

  public sessionCount(tenantId: string, sessionId: string): number {
    return this.sessionCounts.get(tenantId)?.get(sessionId) ?? 0
  }
}

export type AgUiSourcePollResult = {
  fetchedEvents: number
  insertedFrames: number
  sourceHighWatermark: number
  snapshotWatermark: number
}

export type AgUiSourcePollConfig = {
  baseDelayMs: number
  maxDelayMs: number
  jitterRatio: number
}

type PollDependencies = {
  now?: () => number
  random?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

type PollEntry = {
  inFlight: Promise<AgUiSourcePollResult> | null
  nextPollAt: number
  nextIdleDelayMs: number
}

function sessionKey(tenantId: string, sessionId: string): string {
  return JSON.stringify([tenantId, sessionId])
}

export class AgUiSourcePollCoordinator {
  private readonly entries = new Map<string, PollEntry>()
  private readonly now: () => number
  private readonly random: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>
  private executions = 0

  public constructor(private readonly config: AgUiSourcePollConfig, dependencies: PollDependencies = {}) {
    positiveSafeInteger(config.baseDelayMs, "AG-UI poll base delay")
    positiveSafeInteger(config.maxDelayMs, "AG-UI poll maximum delay")
    if (config.maxDelayMs < config.baseDelayMs) throw new Error("AG-UI poll maximum delay must not be below its base delay")
    if (!Number.isFinite(config.jitterRatio) || config.jitterRatio < 0 || config.jitterRatio > 1) {
      throw new Error("AG-UI poll jitter ratio must be between zero and one")
    }
    this.now = dependencies.now ?? Date.now
    this.random = dependencies.random ?? Math.random
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  }

  private jitter(delayMs: number): number {
    const offset = (this.random() * 2 - 1) * this.config.jitterRatio
    return Math.max(1, Math.round(delayMs * (1 + offset)))
  }

  private async execute(entry: PollEntry, task: () => Promise<AgUiSourcePollResult>): Promise<AgUiSourcePollResult> {
    const waitMs = Math.max(0, entry.nextPollAt - this.now())
    if (waitMs > 0) await this.sleep(waitMs)
    this.executions += 1
    try {
      const result = await task()
      const nextDelay = result.fetchedEvents > 0 ? this.config.baseDelayMs : entry.nextIdleDelayMs
      entry.nextPollAt = this.now() + this.jitter(nextDelay)
      entry.nextIdleDelayMs = result.fetchedEvents > 0
        ? this.config.baseDelayMs
        : Math.min(this.config.maxDelayMs, entry.nextIdleDelayMs * 2)
      return result
    } catch (error) {
      entry.nextPollAt = this.now() + this.jitter(this.config.baseDelayMs)
      entry.nextIdleDelayMs = this.config.baseDelayMs
      throw error
    }
  }

  public poll(
    tenantId: string,
    sessionId: string,
    task: () => Promise<AgUiSourcePollResult>,
  ): Promise<AgUiSourcePollResult> {
    const key = sessionKey(tenantId, sessionId)
    const entry = this.entries.get(key) ?? {
      inFlight: null,
      nextPollAt: this.now(),
      nextIdleDelayMs: this.config.baseDelayMs,
    }
    this.entries.set(key, entry)
    if (entry.inFlight !== null) return entry.inFlight
    const pending = this.execute(entry, task)
    entry.inFlight = pending
    pending.then(
      () => { if (entry.inFlight === pending) entry.inFlight = null },
      () => { if (entry.inFlight === pending) entry.inFlight = null },
    )
    return pending
  }

  public clear(tenantId: string, sessionId: string): void {
    const key = sessionKey(tenantId, sessionId)
    const entry = this.entries.get(key)
    if (entry?.inFlight === null) this.entries.delete(key)
  }

  public snapshot(): { executions: number; entries: number } {
    return { executions: this.executions, entries: this.entries.size }
  }
}

export type AgUiReplayResult = AgUiReplayPage | AgUiInvalidCursor

type ReplayEntry = {
  scopeKey: string
  expiresAt: number
  promise: Promise<AgUiReplayResult>
}

export class AgUiReplayCoordinator {
  private readonly entries = new Map<string, ReplayEntry>()
  private readonly now: () => number
  private loads = 0

  public constructor(
    private readonly config: { cacheTtlMs: number },
    dependencies: { now?: () => number } = {},
  ) {
    positiveSafeInteger(config.cacheTtlMs, "AG-UI replay cache TTL")
    this.now = dependencies.now ?? Date.now
  }

  public replay(
    tenantId: string,
    sessionId: string,
    cursor: string | null,
    maxFrames: number,
    maxBytes: number,
    load: () => Promise<AgUiReplayResult>,
  ): Promise<AgUiReplayResult> {
    const scopeKey = sessionKey(tenantId, sessionId)
    const key = JSON.stringify([tenantId, sessionId, cursor, maxFrames, maxBytes])
    const existing = this.entries.get(key)
    if (existing !== undefined && existing.expiresAt >= this.now()) return existing.promise
    this.entries.delete(key)

    this.loads += 1
    const entry: ReplayEntry = {
      scopeKey,
      expiresAt: Number.POSITIVE_INFINITY,
      promise: Promise.resolve({ kind: "invalid_cursor" }),
    }
    const pending = load()
    entry.promise = pending
    this.entries.set(key, entry)
    pending.then(
      () => { if (this.entries.get(key) === entry) entry.expiresAt = this.now() + this.config.cacheTtlMs },
      () => { if (this.entries.get(key) === entry) this.entries.delete(key) },
    )
    return pending
  }

  public invalidate(tenantId: string, sessionId: string): void {
    const scopeKey = sessionKey(tenantId, sessionId)
    for (const [key, entry] of this.entries) {
      if (entry.scopeKey === scopeKey) this.entries.delete(key)
    }
  }

  public snapshot(): { loads: number; entries: number } {
    return { loads: this.loads, entries: this.entries.size }
  }
}

export type AgUiSessionRuntimeOptions = {
  connections: AgUiConnectionLimits
  poll: AgUiSourcePollConfig
  replayCacheTtlMs: number
}

export class AgUiSessionRuntime {
  public readonly connections: AgUiConnectionLimiter
  public readonly sourcePolls: AgUiSourcePollCoordinator
  public readonly replays: AgUiReplayCoordinator

  public constructor(options: AgUiSessionRuntimeOptions) {
    this.connections = new AgUiConnectionLimiter(options.connections)
    this.sourcePolls = new AgUiSourcePollCoordinator(options.poll)
    this.replays = new AgUiReplayCoordinator({ cacheTtlMs: options.replayCacheTtlMs })
  }

  public snapshot(): {
    connections: ReturnType<AgUiConnectionLimiter["snapshot"]>
    sourcePolls: ReturnType<AgUiSourcePollCoordinator["snapshot"]>
    replays: ReturnType<AgUiReplayCoordinator["snapshot"]>
  } {
    return {
      connections: this.connections.snapshot(),
      sourcePolls: this.sourcePolls.snapshot(),
      replays: this.replays.snapshot(),
    }
  }
}
