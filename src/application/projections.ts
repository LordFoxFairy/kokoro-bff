import type { IncomingMessage } from "node:http"

import type { ChatMessage, ChatSessionSummary, LibraryItem, McpServer } from "../contracts/index.js"
import { mapAgentMessage, type AgentChatMessage } from "../adapters/agent.js"
import { isRecord, queryOf, type Context } from "../http/request.js"

export function ownerIdentityHeaders(context: Context): Record<string, string> {
  return {
    "x-kokoro-tenant-id": context.identity.namespace,
    "x-kokoro-subject": context.identity.userId,
    "x-kokoro-actor-id": context.identity.userId,
  }
}

export function stringField(value: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    if (typeof value[name] === "string" && value[name].trim() !== "") return value[name].trim()
  }
  return null
}

export function modelCatalogData(body: unknown): { models: Array<{
  provider: string
  name: string
  is_default: boolean
  display_name?: string
}>; next_cursor?: string | null } | null {
  const data = dataOf(body)
  if (data === null || !Array.isArray(data.items)) return null
  const items = data.items
  const models = []
  for (const item of items) {
    if (!isRecord(item)) return null
    const key = stringField(item, "key")
    if (key === null) return null
    const displayName = stringField(item, "display_name")
    if (displayName === null) return null
    const provider = key.includes("/") ? (key.split("/", 1)[0] ?? "kokoro") : "kokoro"
    const name = key
    const isDefault = false
    models.push({
      provider,
      name,
      is_default: isDefault,
      ...(displayName === null ? {} : { display_name: displayName }),
    })
  }
  const nextCursor = data.next_cursor
  if (nextCursor !== undefined && nextCursor !== null && typeof nextCursor !== "string") return null
  return { models, ...(nextCursor === undefined ? {} : { next_cursor: nextCursor }) }
}

export function agentSessionListData(body: unknown): { sessions: ChatSessionSummary[]; next_cursor: string | null } | null {
  const data = dataOf(body)
  if (data === null || !Array.isArray(data.sessions)) return null
  const sessions: ChatSessionSummary[] = []
  for (const item of data.sessions) {
    if (!isRecord(item)) return null
    const sessionId = stringField(item, "session_id")
    const title = stringField(item, "title")
    const updatedAt = item.updated_at
    if (sessionId === null || title === null || typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null
    const date = new Date(updatedAt)
    if (!Number.isFinite(date.getTime())) return null
    sessions.push({ session_id: sessionId, title, updated_at: date.toISOString() })
  }
  const nextCursor = data.next_cursor
  if (nextCursor !== undefined && nextCursor !== null && typeof nextCursor !== "string") return null
  return { sessions, next_cursor: nextCursor ?? null }
}

export function agentMessageListData(body: unknown, limit: number): { messages: ChatMessage[]; next_cursor: string | null } | null {
  const data = dataOf(body)
  if (data === null || !Array.isArray(data.messages) || !data.messages.every(isRecord) || typeof data.next_seq !== "number" || !Number.isSafeInteger(data.next_seq) || data.next_seq < 0) return null
  const records = data.messages as AgentChatMessage[]
  const page = records.slice(0, limit).map(mapAgentMessage)
  const last = records[limit - 1]
  return {
    messages: page,
    next_cursor: records.length === limit && last !== undefined ? `msg_${last.seq}` : null,
  }
}

export function messageCursor(value: string | undefined): number | null {
  if (value === undefined || value === "") return 0
  const match = /^msg_(\d+)$/u.exec(value)
  if (match === null) return null
  const cursor = Number(match[1])
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null
}

export type BillingPlanProjection = {
  id: string
  key: string
  name: string
  currency: string
  amount_minor: string
  credit_micros: string
  billing_interval: "once" | "month" | "year"
}

export function billingPlansData(body: unknown): { plans: BillingPlanProjection[] } | null {
  const data = dataOf(body)
  const offers = data?.offers
  if (!Array.isArray(offers)) return null
  const plans: BillingPlanProjection[] = []
  for (const offer of offers) {
    if (!isRecord(offer)) return null
    const id = stringField(offer, "id")
    const key = stringField(offer, "key")
    const name = stringField(offer, "name")
    const currency = stringField(offer, "currency")
    const amountMinor = stringField(offer, "amount_minor")
    const creditMicros = stringField(offer, "credit_micros")
    const billingInterval = stringField(offer, "billing_interval")
    if (
      id === null || key === null || name === null || currency === null
      || amountMinor === null || creditMicros === null
      || (billingInterval !== "once" && billingInterval !== "month" && billingInterval !== "year")
    ) return null
    plans.push({ id, key, name, currency, amount_minor: amountMinor, credit_micros: creditMicros, billing_interval: billingInterval })
  }
  return { plans }
}

export function checkoutUrlData(body: unknown): { checkout_url: string } | null {
  const data = dataOf(body)
  const checkoutUrl = data === null ? null : stringField(data, "checkout_url")
  return checkoutUrl === null ? null : { checkout_url: checkoutUrl }
}

export type CapabilitySkillProjection = {
  name: string
  description: string
  content_hash: string
  scope: string
  enabled: boolean
  installed?: boolean
  categories?: string[]
}

export function capabilitySkillsData(body: unknown, catalog: boolean): { skills: CapabilitySkillProjection[]; next_cursor?: string | null } | null {
  const data = dataOf(body)
  if (data === null || !Array.isArray(data.skills)) return null
  const skills: CapabilitySkillProjection[] = []
  for (const item of data.skills) {
    if (!isRecord(item)) return null
    const name = stringField(item, "name")
    const description = stringField(item, "description")
    const contentHash = stringField(item, "content_hash", "contentHash")
    const scope = stringField(item, "scope")
    if (name === null || description === null || contentHash === null || scope === null) return null
    const enabled = typeof item.enabled === "boolean" ? item.enabled : true
    const categories = Array.isArray(item.categories)
      ? item.categories.filter((value): value is string => typeof value === "string")
      : undefined
    skills.push({
      name,
      description,
      content_hash: contentHash,
      scope,
      enabled,
      ...(catalog ? { installed: item.installed !== false } : {}),
      ...(categories === undefined ? {} : { categories }),
    })
  }
  const nextCursor = data.next_cursor
  if (nextCursor !== undefined && nextCursor !== null && typeof nextCursor !== "string") return null
  return { skills, ...(catalog ? { next_cursor: nextCursor ?? null } : nextCursor === undefined ? {} : { next_cursor: nextCursor }) }
}

export function capabilityMcpData(body: unknown, tenantId: string): { servers: McpServer[]; next_cursor?: string } | null {
  const data = dataOf(body)
  if (data === null || !Array.isArray(data.servers)) return null
  const servers: McpServer[] = []
  for (const item of data.servers) {
    if (!isRecord(item)) return null
    const name = stringField(item, "server_identity", "name")
    const transport = stringField(item, "transport")
    const serverId = stringField(item, "server_id", "serverId")
    const status = stringField(item, "status")
    if (name === null || transport === null || serverId === null || status === null) return null
    if (transport !== "stdio" && transport !== "streamable_http" && transport !== "sse_compat") return null
    servers.push({
      scope: tenantId,
      name,
      revision: 1,
      transport: transport === "stdio" ? "http" : "streamable_http",
      // Capability's server_identity is the public endpoint identity. Keep
      // that owner value instead of manufacturing a capability:// URL that
      // the Web client could mistake for a connectable endpoint.
      url: name,
      allowed_tools: [],
      secret_ref: null,
      enabled: status === "registered",
    })
  }
  const nextCursor = data.next_cursor
  if (nextCursor !== undefined && typeof nextCursor !== "string") return null
  return { servers, ...(nextCursor === undefined ? {} : { next_cursor: nextCursor }) }
}

export function mappedOwnerQuery(request: IncomingMessage, mapping: Readonly<Record<string, string>>): string {
  const incoming = queryOf(request)
  const owner = new URLSearchParams()
  for (const [incomingName, ownerName] of Object.entries(mapping)) {
    for (const value of incoming.getAll(incomingName)) {
      const trimmed = value.trim()
      if (trimmed !== "") owner.append(ownerName, trimmed)
    }
  }
  return owner.size === 0 ? "" : `?${owner.toString()}`
}

export function libraryItemType(mimeType: string): LibraryItem["type"] {
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv") return "spreadsheet"
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "presentation"
  if (mimeType.startsWith("text/") || mimeType.includes("pdf") || mimeType.includes("word") || mimeType.includes("document")) return "document"
  return "other"
}

export function libraryData(body: unknown): { items: LibraryItem[] } | null {
  const data = dataOf(body)
  if (data === null || !Array.isArray(data.items)) return null
  const items: LibraryItem[] = []
  for (const item of data.items) {
    if (!isRecord(item)) return null
    const id = stringField(item, "artifact_id", "asset_id")
    const title = stringField(item, "filename", "artifact_id", "asset_id")
    const mimeType = stringField(item, "mime_type", "mimeType")
    const createdAt = stringField(item, "created_at", "finalized_at")
    if (id === null || title === null || mimeType === null || createdAt === null || Number.isNaN(Date.parse(createdAt))) return null
    items.push({ id, title, type: libraryItemType(mimeType), created_at: new Date(createdAt).toISOString(), url: "" })
  }
  return { items }
}

export function systemManifestData(body: unknown): Record<string, unknown> | null {
  const data = dataOf(body)
  if (data === null) return null
  const stringFields = ["tenantId", "productId", "locale", "configVersion", "digest"]
  for (const field of stringFields) if (typeof data[field] !== "string" || data[field].trim() === "") return null
  for (const field of ["navigation", "localeNamespaces", "featureFlags", "references"]) if (!Array.isArray(data[field])) return null
  if (!isRecord(data.theme)) return null
  if (data.releaseId !== null && typeof data.releaseId !== "string") return null
  return {
    tenant_id: data.tenantId,
    product_id: data.productId,
    locale: data.locale,
    navigation: data.navigation,
    locale_namespaces: data.localeNamespaces,
    theme: data.theme,
    feature_flags: data.featureFlags,
    references: data.references,
    config_version: data.configVersion,
    release_id: data.releaseId,
    digest: data.digest,
  }
}

export function dataOf(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body) || !isRecord(body.data)) return null
  return body.data
}

export function agentSessionAssertion(context: Context, sessionId: string): string {
  return `bff:session:${context.identity.namespace}:${sessionId}`
}
