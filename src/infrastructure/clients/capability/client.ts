import type { BffConfig } from "../../../config/runtime.js"
import type { RequestContext } from "../../../domain/request-context.js"
import { createClient } from "../../../generated/capability-http/client/client.gen.js"
import { listMcpServers, listVisibleSkillCatalog, listVisibleSkillPool, listVisibleSkills } from "../../../generated/capability-http/sdk.gen.js"
import {
  zErrorEnvelope,
  zListMcpServersQuery,
  zListMcpServersResponse,
  zListVisibleSkillCatalogQuery,
  zListVisibleSkillCatalogResponse,
  zListVisibleSkillPoolQuery,
  zListVisibleSkillPoolResponse,
  zListVisibleSkillsQuery,
  zListVisibleSkillsResponse,
} from "../../../generated/capability-http/zod.gen.js"
import { capabilityResponseInvalid, capabilityUnavailable, invalidCapabilityQuery } from "./errors.js"
import type { CapabilityMcpProjection, CapabilityOperation, CapabilityResult, CapabilitySkillsProjection } from "./types.js"

export const CAPABILITY_TIMEOUT_MS = 5000
export const CAPABILITY_MAX_RESPONSE_BYTES = 1024 * 1024

const skillsParameters = new Set(["query", "tags", "scope_kind", "limit", "cursor"])
const mcpParameters = new Set(["provider_key", "limit", "cursor"])

type CapabilityQuery = Record<string, string | number | string[]>

function codePointLength(value: string): number {
  return [...value].length
}

function queryStringLimit(key: string): number | null {
  if (key === "query") return 1024
  if (key === "tags") return 128
  if (key === "provider_key") return 191
  if (key === "cursor") return 2048
  return null
}

function parseQuery(operation: CapabilityOperation, incoming: URLSearchParams): CapabilityQuery | null {
  const allowed = operation === "mcpServers" ? mcpParameters : skillsParameters
  const query: CapabilityQuery = {}
  for (const key of new Set(incoming.keys())) {
    if (!allowed.has(key)) return null
    const values = incoming.getAll(key)
    if (key !== "tags" && values.length !== 1) return null
    const normalized = values.map((value) => value.trim())
    if (normalized.some((value) => value === "")) return null
    const stringLimit = queryStringLimit(key)
    if (stringLimit !== null && normalized.some((value) => codePointLength(value) > stringLimit)) return null
    if (key === "tags") {
      if (normalized.some((value) => value.includes(","))) return null
      query.tags = normalized
    } else {
      const value = normalized[0]
      if (value === undefined) return null
      if (key === "limit") {
        if (!/^[0-9]+$/u.test(value)) return null
        query.limit = Number(value)
      } else query[key] = value
    }
  }
  const schema =
    operation === "mcpServers"
      ? zListMcpServersQuery
      : operation === "skillPool"
        ? zListVisibleSkillPoolQuery
        : operation === "skillCatalog"
          ? zListVisibleSkillCatalogQuery
          : zListVisibleSkillsQuery
  const validationQuery = Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      key === "scope_kind" || typeof value === "number"
        ? value
        : Array.isArray(value)
          ? value.map((item) => "x".repeat(codePointLength(item)))
          : "x".repeat(codePointLength(value)),
    ]),
  )
  const result = schema.safeParse(validationQuery)
  return result.success ? query : null
}

export function isValidOwnerRequestId(value: string): boolean {
  const length = codePointLength(value.trim())
  return length >= 1 && length <= 255
}

async function boundedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CAPABILITY_TIMEOUT_MS)
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    const contentLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > CAPABILITY_MAX_RESPONSE_BYTES) {
      controller.abort()
      throw new Error("Capability response exceeds the hard cap")
    }
    if (response.body === null) return response
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      received += next.value.byteLength
      if (received > CAPABILITY_MAX_RESPONSE_BYTES) {
        await reader.cancel()
        controller.abort()
        throw new Error("Capability response exceeds the hard cap")
      }
      chunks.push(next.value)
    }
    const body = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  } finally {
    clearTimeout(timer)
  }
}

function skillProjection(
  data: {
    data: {
      skills: Array<{
        name: string
        description: string
        content_hash: string
        scope: string
        enabled: boolean
        installed?: boolean | undefined
        categories: string[]
      }>
      next_cursor?: string | null | undefined
    }
  },
  catalog: boolean,
): CapabilitySkillsProjection {
  return {
    skills: data.data.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      content_hash: skill.content_hash,
      scope: skill.scope,
      enabled: skill.enabled,
      ...(catalog && skill.installed !== undefined ? { installed: skill.installed } : {}),
      categories: skill.categories,
    })),
    ...(catalog ? { next_cursor: data.data.next_cursor ?? null } : data.data.next_cursor === undefined ? {} : { next_cursor: data.data.next_cursor }),
  }
}

function mcpProjection(
  data: {
    data: {
      servers: Array<{
        server_identity: string
        transport: "stdio" | "streamable_http" | "sse_compat" | "unknown"
        status: "registered" | "disabled" | "unknown"
      }>
      next_cursor?: string | undefined
    }
  },
  tenantId: string,
): CapabilityMcpProjection | null {
  if (data.data.servers.some((server) => server.transport === "unknown")) return null
  return {
    servers: data.data.servers.map((server) => ({
      scope: tenantId,
      name: server.server_identity,
      revision: 1,
      transport: server.transport === "stdio" ? "http" : "streamable_http",
      url: server.server_identity,
      allowed_tools: [],
      secret_ref: null,
      enabled: server.status === "registered",
    })),
    ...(data.data.next_cursor === undefined ? {} : { next_cursor: data.data.next_cursor }),
  }
}

export async function requestCapability(
  config: BffConfig,
  context: RequestContext,
  operation: CapabilityOperation,
  incoming: URLSearchParams,
): Promise<CapabilityResult> {
  const query = parseQuery(operation, incoming)
  if (query === null) return invalidCapabilityQuery()
  const baseUrl = config.upstreams.capability
  if (typeof baseUrl !== "string" || config.upstreamSecret === null) return capabilityUnavailable()
  const client = createClient({ baseUrl, fetch: boundedFetch, redirect: "error" })
  const headers = {
    "x-kokoro-service": "web-bff" as const,
    "x-kokoro-internal-secret": config.upstreamSecret,
    "x-kokoro-tenant-id": context.identity.namespace,
    "x-kokoro-subject": context.identity.userId,
    "x-kokoro-request-id": context.requestId,
  }
  try {
    const result =
      operation === "skills"
        ? await listVisibleSkills({ client, headers, query })
        : operation === "skillPool"
          ? await listVisibleSkillPool({ client, headers, query })
          : operation === "skillCatalog"
            ? await listVisibleSkillCatalog({ client, headers, query })
            : await listMcpServers({ client, headers, query })
    const status = result.response?.status
    const ownerRequestId = result.response?.headers.get("x-kokoro-request-id")?.trim()
    if (status === undefined || ownerRequestId === undefined || !isValidOwnerRequestId(ownerRequestId)) return capabilityResponseInvalid()
    if (status === 200 && result.data !== undefined) {
      if (operation === "mcpServers") {
        const parsed = zListMcpServersResponse.safeParse(result.data)
        if (!parsed.success) return capabilityResponseInvalid()
        const projection = mcpProjection(parsed.data, context.identity.namespace)
        if (projection === null) return capabilityResponseInvalid()
        return { ok: true, status: 200, data: projection }
      }
      const schema =
        operation === "skillPool" ? zListVisibleSkillPoolResponse : operation === "skillCatalog" ? zListVisibleSkillCatalogResponse : zListVisibleSkillsResponse
      const parsed = schema.safeParse(result.data)
      if (!parsed.success) return capabilityResponseInvalid()
      return {
        ok: true,
        status: 200,
        data: skillProjection(parsed.data, operation === "skillCatalog"),
      }
    }
    if (!zErrorEnvelope.safeParse(result.error).success) return capabilityResponseInvalid()
    if (status === 400) return invalidCapabilityQuery()
    if (status === 401 || status === 503) return capabilityUnavailable()
    return capabilityResponseInvalid()
  } catch {
    return capabilityResponseInvalid()
  }
}
