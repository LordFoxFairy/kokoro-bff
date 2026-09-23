import { URL } from "node:url"

export type BffMode = "live"

export type AgUiConfig = {
  replayPageFrames: number
  replayPageBytes: number
  streamMaxFrames: number
  streamMaxBytes: number
  streamMaxDurationMs: number
  maxConnectionsGlobal: number
  maxConnectionsPerTenant: number
  maxConnectionsPerSession: number
  ledgerPollBaseDelayMs: number
  ledgerPollMaxDelayMs: number
  ledgerPollJitterPercent: number
  replayCacheTtlMs: number
  projectorMaxConsumersPerCycle: number
  projectorSourcePageSize: number
  projectorMaxPagesPerConsumer: number
  projectorSourceMaxAttempts: number
  projectorLeaseDurationMs: number
  projectorLeaseSettlementReserveMs: number
  projectorPollIntervalMs: number
  projectorErrorBackoffMs: number
  projectorErrorBackoffMaxMs: number
  projectorErrorBackoffJitterPercent: number
  retentionMs: number
  gcIntervalMs: number
  gcBatchSize: number
  cursorTombstoneRetentionMs: number
}

export const DEFAULT_AGUI_CONFIG: AgUiConfig = {
  replayPageFrames: 128,
  replayPageBytes: 1024 * 1024,
  streamMaxFrames: 10_000,
  streamMaxBytes: 16 * 1024 * 1024,
  streamMaxDurationMs: 5 * 60 * 1000,
  maxConnectionsGlobal: 256,
  maxConnectionsPerTenant: 64,
  maxConnectionsPerSession: 8,
  ledgerPollBaseDelayMs: 1000,
  ledgerPollMaxDelayMs: 8000,
  ledgerPollJitterPercent: 20,
  replayCacheTtlMs: 25,
  projectorMaxConsumersPerCycle: 32,
  projectorSourcePageSize: 256,
  projectorMaxPagesPerConsumer: 8,
  projectorSourceMaxAttempts: 3,
  projectorLeaseDurationMs: 15_000,
  projectorLeaseSettlementReserveMs: 500,
  projectorPollIntervalMs: 1000,
  projectorErrorBackoffMs: 5000,
  projectorErrorBackoffMaxMs: 5 * 60 * 1000,
  projectorErrorBackoffJitterPercent: 20,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  gcIntervalMs: 15 * 60 * 1000,
  gcBatchSize: 100,
  cursorTombstoneRetentionMs: 30 * 24 * 60 * 60 * 1000,
}

export type BffConfig = {
  host: string
  port: number
  mode: BffMode
  domain: string
  tenantId: string | null
  iamBaseUrl: string | null
  iamRelay?: Readonly<{
    publicIssuerUrl: string
    webOrigin: string
    callbackUri: string
    postLogoutUri: string
    secureCookies: boolean
  }>
  sharedSecret: string | null
  upstreamSecret: string | null
  upstreamTimeoutMs: number
  upstreamMaxResponseBytes: number
  schedulerServiceToken: string | null
  schedulerTargetUrl: string | null
  agentEnabled: boolean
  postgresUrl: string | null
  redisUrl: string | null
  agUi: AgUiConfig
  upstreams: Record<string, string | null>
}

export const DEFAULT_UPSTREAM_TIMEOUT_MS = 5000
export const DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES = 1024 * 1024

function booleanFlag(value: string | undefined, fallback: boolean): boolean {
  const raw = value?.trim().toLowerCase()
  if (!raw) return fallback
  if (["1", "true", "yes", "on"].includes(raw)) return true
  if (["0", "false", "no", "off"].includes(raw)) return false
  throw new Error("KOKORO_AGENT_ENABLED must be a boolean")
}

function optionalUrl(value: string | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("upstream URL must use http or https")
  }
  return raw.replace(/\/+$/u, "")
}

function optionalOrigin(value: string | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("KOKORO_IAM_BASE_URL must use http or https")
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || (url.pathname !== "" && url.pathname !== "/")) {
    throw new Error("KOKORO_IAM_BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment")
  }
  return url.origin
}

function iamRelayConfig(env: NodeJS.ProcessEnv): BffConfig["iamRelay"] {
  const values = [env.KOKORO_IAM_ISSUER_URL, env.KOKORO_IAM_WEB_ORIGIN, env.KOKORO_IAM_WEB_CALLBACK_URI, env.KOKORO_IAM_WEB_POST_LOGOUT_URI]
  if (values.every((value) => value === undefined || value.trim() === "")) return undefined
  if (values.some((value) => value === undefined || value.trim() === "")) throw new Error("IAM relay requires issuer, Web origin, callback URI and post-logout URI")
  const [issuerRaw, originRaw, callbackRaw, logoutRaw] = values as [string, string, string, string]
  const webOrigin = optionalOrigin(originRaw)
  if (webOrigin === null) throw new Error("KOKORO_IAM_WEB_ORIGIN must be an HTTP(S) origin")
  const issuer = new URL(issuerRaw)
  const callback = new URL(callbackRaw)
  const logout = new URL(logoutRaw)
  if (issuer.toString() !== `${webOrigin}/iam` || callback.origin !== webOrigin || callback.username !== "" || callback.password !== ""
    || !/^\/api\/auth\/callback\/[a-z0-9-]+$/u.test(callback.pathname)
    || callback.search !== "" || callback.hash !== "" || logout.origin !== webOrigin || logout.pathname !== "/auth/sign-in"
    || logout.username !== "" || logout.password !== "" || logout.search !== "" || logout.hash !== "") throw new Error("IAM relay URLs must bind the exact Web issuer, callback and post-logout paths")
  return { publicIssuerUrl: issuer.toString(), webOrigin, callbackUri: callback.toString(), postLogoutUri: logout.toString(), secureCookies: env.NODE_ENV === "production" }
}

function requiredConnectionUrl(value: string | undefined, name: string, protocols: readonly string[]): string {
  const raw = value?.trim()
  if (!raw) throw new Error(`${name} is required for the live BFF runtime`)
  const parsed = new URL(raw)
  if (!protocols.includes(parsed.protocol)) throw new Error(`${name} must use ${protocols.join(" or ")}`)
  return raw.replace(/\/+$/u, "")
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  const raw = value?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function percentage(value: string | undefined, name: string, fallback: number): number {
  const raw = value?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100) throw new Error(`${name} must be an integer between 0 and 100`)
  return parsed
}

function requiredDomain(value: string | undefined): string {
  const domain = value?.trim()
  if (!domain || !/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251})[A-Za-z0-9]$/u.test(domain)) {
    throw new Error("KOKORO_DOMAIN must be a hostname")
  }
  return domain
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BffConfig {
  const requestedMode = env.KOKORO_BFF_MODE?.trim()
  if (requestedMode !== undefined && requestedMode !== "" && requestedMode !== "live") {
    throw new Error("KOKORO_BFF_MODE must be live")
  }
  const port = Number.parseInt(env.KOKORO_BFF_PORT?.trim() || "4300", 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("KOKORO_BFF_PORT must be a valid port")

  const upstreams: Record<string, string | null> = {
    system: optionalUrl(env.KOKORO_SYSTEM_BASE_URL),
    capability: optionalUrl(env.KOKORO_CAPABILITY_BASE_URL),
    scheduler: optionalUrl(env.KOKORO_SCHEDULER_BASE_URL),
    agents: optionalUrl(env.KOKORO_AGENT_BASE_URL),
    billing: optionalUrl(env.KOKORO_BILLING_BASE_URL),
    music: optionalUrl(env.KOKORO_MUSIC_BASE_URL),
  }
  const domain = requiredDomain(env.KOKORO_DOMAIN || "dev.kokoro.localhost")
  const sharedSecret = env.KOKORO_BFF_SHARED_SECRET?.trim() || null
  if (sharedSecret === null) throw new Error("KOKORO_BFF_SHARED_SECRET is required for the live BFF runtime")
  const upstreamTimeoutMs = positiveInteger(env.KOKORO_UPSTREAM_TIMEOUT_MS, "KOKORO_UPSTREAM_TIMEOUT_MS", DEFAULT_UPSTREAM_TIMEOUT_MS)
  const agUi: AgUiConfig = {
    replayPageFrames: positiveInteger(env.KOKORO_AGUI_REPLAY_PAGE_FRAMES, "KOKORO_AGUI_REPLAY_PAGE_FRAMES", DEFAULT_AGUI_CONFIG.replayPageFrames),
    replayPageBytes: positiveInteger(env.KOKORO_AGUI_REPLAY_PAGE_BYTES, "KOKORO_AGUI_REPLAY_PAGE_BYTES", DEFAULT_AGUI_CONFIG.replayPageBytes),
    streamMaxFrames: positiveInteger(env.KOKORO_AGUI_STREAM_MAX_FRAMES, "KOKORO_AGUI_STREAM_MAX_FRAMES", DEFAULT_AGUI_CONFIG.streamMaxFrames),
    streamMaxBytes: positiveInteger(env.KOKORO_AGUI_STREAM_MAX_BYTES, "KOKORO_AGUI_STREAM_MAX_BYTES", DEFAULT_AGUI_CONFIG.streamMaxBytes),
    streamMaxDurationMs: positiveInteger(env.KOKORO_AGUI_STREAM_MAX_DURATION_MS, "KOKORO_AGUI_STREAM_MAX_DURATION_MS", DEFAULT_AGUI_CONFIG.streamMaxDurationMs),
    maxConnectionsGlobal: positiveInteger(env.KOKORO_AGUI_MAX_CONNECTIONS_GLOBAL, "KOKORO_AGUI_MAX_CONNECTIONS_GLOBAL", DEFAULT_AGUI_CONFIG.maxConnectionsGlobal),
    maxConnectionsPerTenant: positiveInteger(env.KOKORO_AGUI_MAX_CONNECTIONS_PER_TENANT, "KOKORO_AGUI_MAX_CONNECTIONS_PER_TENANT", DEFAULT_AGUI_CONFIG.maxConnectionsPerTenant),
    maxConnectionsPerSession: positiveInteger(env.KOKORO_AGUI_MAX_CONNECTIONS_PER_SESSION, "KOKORO_AGUI_MAX_CONNECTIONS_PER_SESSION", DEFAULT_AGUI_CONFIG.maxConnectionsPerSession),
    ledgerPollBaseDelayMs: positiveInteger(env.KOKORO_AGUI_LEDGER_POLL_BASE_DELAY_MS, "KOKORO_AGUI_LEDGER_POLL_BASE_DELAY_MS", DEFAULT_AGUI_CONFIG.ledgerPollBaseDelayMs),
    ledgerPollMaxDelayMs: positiveInteger(env.KOKORO_AGUI_LEDGER_POLL_MAX_DELAY_MS, "KOKORO_AGUI_LEDGER_POLL_MAX_DELAY_MS", DEFAULT_AGUI_CONFIG.ledgerPollMaxDelayMs),
    ledgerPollJitterPercent: percentage(env.KOKORO_AGUI_LEDGER_POLL_JITTER_PERCENT, "KOKORO_AGUI_LEDGER_POLL_JITTER_PERCENT", DEFAULT_AGUI_CONFIG.ledgerPollJitterPercent),
    replayCacheTtlMs: positiveInteger(env.KOKORO_AGUI_REPLAY_CACHE_TTL_MS, "KOKORO_AGUI_REPLAY_CACHE_TTL_MS", DEFAULT_AGUI_CONFIG.replayCacheTtlMs),
    projectorMaxConsumersPerCycle: positiveInteger(env.KOKORO_AGUI_PROJECTOR_MAX_CONSUMERS_PER_CYCLE, "KOKORO_AGUI_PROJECTOR_MAX_CONSUMERS_PER_CYCLE", DEFAULT_AGUI_CONFIG.projectorMaxConsumersPerCycle),
    projectorSourcePageSize: positiveInteger(env.KOKORO_AGUI_PROJECTOR_SOURCE_PAGE_SIZE, "KOKORO_AGUI_PROJECTOR_SOURCE_PAGE_SIZE", DEFAULT_AGUI_CONFIG.projectorSourcePageSize),
    projectorMaxPagesPerConsumer: positiveInteger(env.KOKORO_AGUI_PROJECTOR_MAX_PAGES_PER_CONSUMER, "KOKORO_AGUI_PROJECTOR_MAX_PAGES_PER_CONSUMER", DEFAULT_AGUI_CONFIG.projectorMaxPagesPerConsumer),
    projectorSourceMaxAttempts: positiveInteger(env.KOKORO_AGUI_PROJECTOR_SOURCE_MAX_ATTEMPTS, "KOKORO_AGUI_PROJECTOR_SOURCE_MAX_ATTEMPTS", DEFAULT_AGUI_CONFIG.projectorSourceMaxAttempts),
    projectorLeaseDurationMs: positiveInteger(env.KOKORO_AGUI_PROJECTOR_LEASE_DURATION_MS, "KOKORO_AGUI_PROJECTOR_LEASE_DURATION_MS", DEFAULT_AGUI_CONFIG.projectorLeaseDurationMs),
    projectorLeaseSettlementReserveMs: positiveInteger(env.KOKORO_AGUI_PROJECTOR_LEASE_SETTLEMENT_RESERVE_MS, "KOKORO_AGUI_PROJECTOR_LEASE_SETTLEMENT_RESERVE_MS", DEFAULT_AGUI_CONFIG.projectorLeaseSettlementReserveMs),
    projectorPollIntervalMs: positiveInteger(env.KOKORO_AGUI_PROJECTOR_POLL_INTERVAL_MS, "KOKORO_AGUI_PROJECTOR_POLL_INTERVAL_MS", DEFAULT_AGUI_CONFIG.projectorPollIntervalMs),
    projectorErrorBackoffMs: positiveInteger(env.KOKORO_AGUI_PROJECTOR_ERROR_BACKOFF_MS, "KOKORO_AGUI_PROJECTOR_ERROR_BACKOFF_MS", DEFAULT_AGUI_CONFIG.projectorErrorBackoffMs),
    projectorErrorBackoffMaxMs: positiveInteger(env.KOKORO_AGUI_PROJECTOR_ERROR_BACKOFF_MAX_MS, "KOKORO_AGUI_PROJECTOR_ERROR_BACKOFF_MAX_MS", DEFAULT_AGUI_CONFIG.projectorErrorBackoffMaxMs),
    projectorErrorBackoffJitterPercent: percentage(env.KOKORO_AGUI_PROJECTOR_ERROR_BACKOFF_JITTER_PERCENT, "KOKORO_AGUI_PROJECTOR_ERROR_BACKOFF_JITTER_PERCENT", DEFAULT_AGUI_CONFIG.projectorErrorBackoffJitterPercent),
    retentionMs: positiveInteger(env.KOKORO_AGUI_RETENTION_MS, "KOKORO_AGUI_RETENTION_MS", DEFAULT_AGUI_CONFIG.retentionMs),
    gcIntervalMs: positiveInteger(env.KOKORO_AGUI_GC_INTERVAL_MS, "KOKORO_AGUI_GC_INTERVAL_MS", DEFAULT_AGUI_CONFIG.gcIntervalMs),
    gcBatchSize: positiveInteger(env.KOKORO_AGUI_GC_BATCH_SIZE, "KOKORO_AGUI_GC_BATCH_SIZE", DEFAULT_AGUI_CONFIG.gcBatchSize),
    cursorTombstoneRetentionMs: positiveInteger(env.KOKORO_AGUI_CURSOR_TOMBSTONE_RETENTION_MS, "KOKORO_AGUI_CURSOR_TOMBSTONE_RETENTION_MS", DEFAULT_AGUI_CONFIG.cursorTombstoneRetentionMs),
  }
  if (agUi.maxConnectionsPerTenant > agUi.maxConnectionsGlobal || agUi.maxConnectionsPerSession > agUi.maxConnectionsPerTenant) {
    throw new Error("AG-UI connection limits must satisfy session <= tenant <= global")
  }
  if (agUi.ledgerPollBaseDelayMs > agUi.ledgerPollMaxDelayMs) throw new Error("AG-UI ledger poll base delay must not exceed its maximum delay")
  if (agUi.projectorSourcePageSize > 1000) throw new Error("AG-UI projector source page size must not exceed 1000")
  if (agUi.projectorLeaseDurationMs <= upstreamTimeoutMs) throw new Error("AG-UI projector lease duration must exceed the upstream timeout")
  if (agUi.projectorLeaseDurationMs <= upstreamTimeoutMs + agUi.projectorLeaseSettlementReserveMs) {
    throw new Error("AG-UI projector lease duration must exceed the upstream timeout plus settlement reserve")
  }
  if (agUi.projectorErrorBackoffMs > agUi.projectorErrorBackoffMaxMs) {
    throw new Error("AG-UI projector error backoff base must not exceed its maximum")
  }
  if (agUi.cursorTombstoneRetentionMs < agUi.retentionMs) throw new Error("AG-UI cursor tombstone retention must not be shorter than ledger retention")
  const relay = iamRelayConfig(env)
  return {
    host: env.KOKORO_BFF_HOST?.trim() || "127.0.0.1",
    port,
    mode: "live",
    domain,
    tenantId: env.KOKORO_TENANT_ID?.trim() || null,
    iamBaseUrl: optionalOrigin(env.KOKORO_IAM_BASE_URL),
    ...(relay === undefined ? {} : { iamRelay: relay }),
    sharedSecret,
    upstreamSecret: env.KOKORO_INTERNAL_SECRET_BFF?.trim() || null,
    upstreamTimeoutMs,
    upstreamMaxResponseBytes: positiveInteger(env.KOKORO_UPSTREAM_MAX_RESPONSE_BYTES, "KOKORO_UPSTREAM_MAX_RESPONSE_BYTES", DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES),
    schedulerServiceToken: env.KOKORO_SCHEDULER_SERVICE_TOKEN?.trim() || null,
    schedulerTargetUrl: optionalUrl(env.KOKORO_SCHEDULER_TARGET_URL),
    agentEnabled: booleanFlag(env.KOKORO_AGENT_ENABLED, false),
    postgresUrl: requiredConnectionUrl(env.KOKORO_BFF_POSTGRES_URL, "KOKORO_BFF_POSTGRES_URL", ["postgres:", "postgresql:"]),
    redisUrl: requiredConnectionUrl(env.KOKORO_BFF_REDIS_URL, "KOKORO_BFF_REDIS_URL", ["redis:", "rediss:"]),
    agUi,
    upstreams,
  }
}
