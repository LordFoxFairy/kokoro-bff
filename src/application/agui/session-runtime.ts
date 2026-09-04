import type { AgUiExpiredCursor, AgUiInvalidCursor, AgUiReplayPage } from "./ports/agui-projection-repository.js"

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

export type AgUiLedgerWaitConfig = {
  baseDelayMs: number
  maxDelayMs: number
  jitterRatio: number
}

type WaitDependencies = {
  random?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

type WaitEntry = {
  inFlight: Promise<void> | null
  nextDelayMs: number
}

function sessionKey(tenantId: string, sessionId: string): string {
  return JSON.stringify([tenantId, sessionId])
}

export class AgUiLedgerWaitCoordinator {
  private readonly entries = new Map<string, WaitEntry>()
  private readonly random: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>
  private waits = 0

  public constructor(private readonly config: AgUiLedgerWaitConfig, dependencies: WaitDependencies = {}) {
    positiveSafeInteger(config.baseDelayMs, "AG-UI ledger wait base delay")
    positiveSafeInteger(config.maxDelayMs, "AG-UI ledger wait maximum delay")
    if (config.maxDelayMs < config.baseDelayMs) throw new Error("AG-UI ledger wait maximum delay must not be below its base delay")
    if (!Number.isFinite(config.jitterRatio) || config.jitterRatio < 0 || config.jitterRatio > 1) {
      throw new Error("AG-UI ledger wait jitter ratio must be between zero and one")
    }
    this.random = dependencies.random ?? Math.random
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  }

  private jitter(delayMs: number): number {
    const offset = (this.random() * 2 - 1) * this.config.jitterRatio
    return Math.max(1, Math.round(delayMs * (1 + offset)))
  }

  private async execute(entry: WaitEntry): Promise<void> {
    const delayMs = entry.nextDelayMs
    this.waits += 1
    await this.sleep(this.jitter(delayMs))
    entry.nextDelayMs = Math.min(this.config.maxDelayMs, delayMs * 2)
  }

  public wait(tenantId: string, sessionId: string): Promise<void> {
    const key = sessionKey(tenantId, sessionId)
    const entry = this.entries.get(key) ?? {
      inFlight: null,
      nextDelayMs: this.config.baseDelayMs,
    }
    this.entries.set(key, entry)
    if (entry.inFlight !== null) return entry.inFlight
    const pending = this.execute(entry)
    entry.inFlight = pending
    pending.then(
      () => { if (entry.inFlight === pending) entry.inFlight = null },
      () => { if (entry.inFlight === pending) entry.inFlight = null },
    )
    return pending
  }

  public observedChange(tenantId: string, sessionId: string): void {
    const entry = this.entries.get(sessionKey(tenantId, sessionId))
    if (entry !== undefined) entry.nextDelayMs = this.config.baseDelayMs
  }

  public clear(tenantId: string, sessionId: string): void {
    const key = sessionKey(tenantId, sessionId)
    const entry = this.entries.get(key)
    if (entry?.inFlight === null) this.entries.delete(key)
  }

  public snapshot(): { waits: number; entries: number } {
    return { waits: this.waits, entries: this.entries.size }
  }
}

export type AgUiReplayResult = AgUiReplayPage | AgUiInvalidCursor | AgUiExpiredCursor

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
  ledgerWait: AgUiLedgerWaitConfig
  replayCacheTtlMs: number
}

export class AgUiSessionRuntime {
  public readonly connections: AgUiConnectionLimiter
  public readonly ledgerWaits: AgUiLedgerWaitCoordinator
  public readonly replays: AgUiReplayCoordinator

  public constructor(options: AgUiSessionRuntimeOptions) {
    this.connections = new AgUiConnectionLimiter(options.connections)
    this.ledgerWaits = new AgUiLedgerWaitCoordinator(options.ledgerWait)
    this.replays = new AgUiReplayCoordinator({ cacheTtlMs: options.replayCacheTtlMs })
  }

  public snapshot(): {
    connections: ReturnType<AgUiConnectionLimiter["snapshot"]>
    ledgerWaits: ReturnType<AgUiLedgerWaitCoordinator["snapshot"]>
    replays: ReturnType<AgUiReplayCoordinator["snapshot"]>
  } {
    return {
      connections: this.connections.snapshot(),
      ledgerWaits: this.ledgerWaits.snapshot(),
      replays: this.replays.snapshot(),
    }
  }
}
