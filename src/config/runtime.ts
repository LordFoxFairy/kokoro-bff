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
  pollBaseDelayMs: number
  pollMaxDelayMs: number
  pollJitterPercent: number
  replayCacheTtlMs: number
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
  pollBaseDelayMs: 1000,
  pollMaxDelayMs: 8000,
  pollJitterPercent: 20,
  replayCacheTtlMs: 25,
}

export type BffConfig = {
  host: string
  port: number
  mode: BffMode
  domain: string
  tenantId: string | null
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
    model: optionalUrl(env.KOKORO_MODEL_BASE_URL),
    capability: optionalUrl(env.KOKORO_CAPABILITY_BASE_URL),
    storage: optionalUrl(env.KOKORO_STORAGE_BASE_URL),
    scheduler: optionalUrl(env.KOKORO_SCHEDULER_BASE_URL),
    agents: optionalUrl(env.KOKORO_AGENT_BASE_URL),
    billing: optionalUrl(env.KOKORO_BILLING_BASE_URL),
    music: optionalUrl(env.KOKORO_MUSIC_BASE_URL),
  }
  const domain = requiredDomain(env.KOKORO_DOMAIN || "dev.kokoro.localhost")
  const sharedSecret = env.KOKORO_BFF_SHARED_SECRET?.trim() || null
  if (sharedSecret === null) throw new Error("KOKORO_BFF_SHARED_SECRET is required for the live BFF runtime")
  const agUi: AgUiConfig = {
    replayPageFrames: positiveInteger(env.KOKORO_AGUI_REPLAY_PAGE_FRAMES, "KOKORO_AGUI_REPLAY_PAGE_FRAMES", DEFAULT_AGUI_CONFIG.replayPageFrames),
    replayPageBytes: positiveInteger(env.KOKORO_AGUI_REPLAY_PAGE_BYTES, "KOKORO_AGUI_REPLAY_PAGE_BYTES", DEFAULT_AGUI_CONFIG.replayPageBytes),
    streamMaxFrames: positiveInteger(env.KOKORO_AGUI_STREAM_MAX_FRAMES, "KOKORO_AGUI_STREAM_MAX_FRAMES", DEFAULT_AGUI_CONFIG.streamMaxFrames),
    streamMaxBytes: positiveInteger(env.KOKORO_AGUI_STREAM_MAX_BYTES, "KOKORO_AGUI_STREAM_MAX_BYTES", DEFAULT_AGUI_CONFIG.streamMaxBytes),
    streamMaxDurationMs: positiveInteger(env.KOKORO_AGUI_STREAM_MAX_DURATION_MS, "KOKORO_AGUI_STREAM_MAX_DURATION_MS", DEFAULT_AGUI_CONFIG.streamMaxDurationMs),
    maxConnectionsGlobal: positiveInteger(env.KOKORO_AGUI_MAX_CONNECTIONS_GLOBAL, "KOKORO_AGUI_MAX_CONNECTIONS_GLOBAL", DEFAULT_AGUI_CONFIG.maxConnectionsGlobal),
    maxConnectionsPerTenant: positiveInteger(env.KOKORO_AGUI_MAX_CONNECTIONS_PER_TENANT, "KOKORO_AGUI_MAX_CONNECTIONS_PER_TENANT", DEFAULT_AGUI_CONFIG.maxConnectionsPerTenant),
    maxConnectionsPerSession: positiveInteger(env.KOKORO_AGUI_MAX_CONNECTIONS_PER_SESSION, "KOKORO_AGUI_MAX_CONNECTIONS_PER_SESSION", DEFAULT_AGUI_CONFIG.maxConnectionsPerSession),
    pollBaseDelayMs: positiveInteger(env.KOKORO_AGUI_POLL_BASE_DELAY_MS, "KOKORO_AGUI_POLL_BASE_DELAY_MS", DEFAULT_AGUI_CONFIG.pollBaseDelayMs),
    pollMaxDelayMs: positiveInteger(env.KOKORO_AGUI_POLL_MAX_DELAY_MS, "KOKORO_AGUI_POLL_MAX_DELAY_MS", DEFAULT_AGUI_CONFIG.pollMaxDelayMs),
    pollJitterPercent: percentage(env.KOKORO_AGUI_POLL_JITTER_PERCENT, "KOKORO_AGUI_POLL_JITTER_PERCENT", DEFAULT_AGUI_CONFIG.pollJitterPercent),
    replayCacheTtlMs: positiveInteger(env.KOKORO_AGUI_REPLAY_CACHE_TTL_MS, "KOKORO_AGUI_REPLAY_CACHE_TTL_MS", DEFAULT_AGUI_CONFIG.replayCacheTtlMs),
  }
  if (agUi.maxConnectionsPerTenant > agUi.maxConnectionsGlobal || agUi.maxConnectionsPerSession > agUi.maxConnectionsPerTenant) {
    throw new Error("AG-UI connection limits must satisfy session <= tenant <= global")
  }
  if (agUi.pollBaseDelayMs > agUi.pollMaxDelayMs) throw new Error("AG-UI poll base delay must not exceed its maximum delay")
  return {
    host: env.KOKORO_BFF_HOST?.trim() || "127.0.0.1",
    port,
    mode: "live",
    domain,
    tenantId: env.KOKORO_TENANT_ID?.trim() || null,
    sharedSecret,
    upstreamSecret: env.KOKORO_INTERNAL_SECRET_BFF?.trim() || null,
    upstreamTimeoutMs: positiveInteger(env.KOKORO_UPSTREAM_TIMEOUT_MS, "KOKORO_UPSTREAM_TIMEOUT_MS", DEFAULT_UPSTREAM_TIMEOUT_MS),
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
