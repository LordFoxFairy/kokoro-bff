import { URL } from "node:url"

export type BffMode = "mock" | "live"

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

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  const raw = value?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`)
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
  const mode = env.KOKORO_BFF_MODE?.trim() || "mock"
  if (mode !== "mock" && mode !== "live") throw new Error("KOKORO_BFF_MODE must be mock or live")
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
  }
  const domain = requiredDomain(env.KOKORO_DOMAIN || "dev.kokoro.localhost")
  const sharedSecret = env.KOKORO_BFF_SHARED_SECRET?.trim() || null
  if (mode === "live" && sharedSecret === null) {
    throw new Error("KOKORO_BFF_SHARED_SECRET is required in live mode")
  }
  return {
    host: env.KOKORO_BFF_HOST?.trim() || "127.0.0.1",
    port,
    mode,
    domain,
    tenantId: env.KOKORO_TENANT_ID?.trim() || null,
    sharedSecret,
    upstreamSecret: env.KOKORO_INTERNAL_SECRET_BFF?.trim() || null,
    upstreamTimeoutMs: positiveInteger(env.KOKORO_UPSTREAM_TIMEOUT_MS, "KOKORO_UPSTREAM_TIMEOUT_MS", DEFAULT_UPSTREAM_TIMEOUT_MS),
    upstreamMaxResponseBytes: positiveInteger(env.KOKORO_UPSTREAM_MAX_RESPONSE_BYTES, "KOKORO_UPSTREAM_MAX_RESPONSE_BYTES", DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES),
    schedulerServiceToken: env.KOKORO_SCHEDULER_SERVICE_TOKEN?.trim() || null,
    schedulerTargetUrl: optionalUrl(env.KOKORO_SCHEDULER_TARGET_URL),
    agentEnabled: booleanFlag(env.KOKORO_AGENT_ENABLED, false),
    postgresUrl: env.KOKORO_BFF_POSTGRES_URL?.trim() || null,
    redisUrl: env.KOKORO_BFF_REDIS_URL?.trim() || null,
    upstreams,
  }
}
