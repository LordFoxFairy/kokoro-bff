import type { ChatMessage, ChatSessionSummary } from "../contracts/index.js"
import { isRecord } from "../domain/json.js"
import type { RequestContext } from "../domain/request-context.js"

type AgentChatMessage = {
  chat_message_id: string
  session_id: string
  run_id: string
  role: "user" | "assistant"
  content: string
  status: "completed" | "failed"
  seq: number
  created_at: number
  updated_at: number
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Agent message field ${label} is invalid`)
  return value
}

function isoTime(value: number): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error("Agent message timestamp is invalid")
  return date.toISOString()
}

function mapAgentMessage(message: AgentChatMessage): ChatMessage {
  return {
    message_id: nonEmptyString(message.chat_message_id, "chat_message_id"),
    role: message.role,
    content: message.content,
    status: message.status,
    created_at: isoTime(message.created_at),
    run_id: message.run_id,
  }
}

export function stringField(value: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    if (typeof value[name] === "string" && value[name].trim() !== "") return value[name].trim()
  }
  return null
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



export function systemManifestData(body: unknown): Record<string, unknown> | null {
  const data = dataOf(body)
  if (data === null) return null
  const stringFields = ["tenant_id", "product_id", "locale", "config_version", "digest"]
  for (const field of stringFields) if (typeof data[field] !== "string" || data[field].trim() === "") return null
  for (const field of ["navigation", "locale_namespaces", "feature_flags", "references"]) if (!Array.isArray(data[field])) return null
  if (!isRecord(data.theme)) return null
  if (data.release_id !== null && typeof data.release_id !== "string") return null
  return {
    tenant_id: data.tenant_id,
    product_id: data.product_id,
    locale: data.locale,
    navigation: data.navigation,
    locale_namespaces: data.locale_namespaces,
    theme: data.theme,
    feature_flags: data.feature_flags,
    references: data.references,
    config_version: data.config_version,
    release_id: data.release_id,
    digest: data.digest,
  }
}

export function dataOf(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body) || !isRecord(body.data)) return null
  return body.data
}

export function agentSessionAssertion(context: RequestContext, sessionId: string): string {
  return `bff:session:${context.identity.namespace}:${sessionId}`
}
