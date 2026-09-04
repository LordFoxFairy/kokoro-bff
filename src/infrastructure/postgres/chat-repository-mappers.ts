import type { Conversation } from "../../domain/chat/conversation.js"
import type { Message, MessageRole, MessageStatus } from "../../domain/chat/message.js"
import type { Share } from "../../domain/chat/share.js"

export type ConversationRow = {
  conversation_id: string
  tenant_id: string
  owner_id: string
  project_ref: string | null
  title: string
  status: "active" | "deleted"
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
}

export type MessageRow = {
  message_id: string
  tenant_id: string
  conversation_id: string
  run_id: string | null
  role: MessageRole
  content: string
  status: MessageStatus
  message_seq: string | number
  created_at: Date | string
  updated_at: Date | string
}

export type ShareRow = {
  share_id: string
  tenant_id: string
  conversation_id: string
  url: string
  created_at: Date | string
  expires_at: Date | string | null
  revoked_at: Date | string | null
}

export type SharedRow = {
  share_id: string
  share_tenant_id: string
  share_conversation_id: string
  url: string
  share_created_at: Date | string
  expires_at: Date | string | null
  revoked_at: Date | string | null
  conversation_id: string
  tenant_id: string
  owner_id: string
  project_ref: string | null
  title: string
  status: "active" | "deleted"
  conversation_created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
}

export type CursorPosition = { timestamp: string; id: string } | { sequence: string; id: string }

export function instant(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error("CHAT_TIMESTAMP_INVALID")
  return date
}

export function encodeCursor(position: CursorPosition, prefix: "conv" | "msg"): string {
  return `${prefix}_${Buffer.from(JSON.stringify(position), "utf8").toString("base64url")}`
}

export function decodeCursor(value: string | null, prefix: "conv" | "msg"): CursorPosition | null {
  if (value === null) return null
  if (!value.startsWith(`${prefix}_`)) throw new Error("CHAT_CURSOR_INVALID")
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value.slice(prefix.length + 1), "base64url").toString("utf8"))
    if (typeof parsed !== "object" || parsed === null || !("id" in parsed)) throw new Error("invalid")
    const id = parsed.id
    if (typeof id !== "string" || id === "") throw new Error("invalid")
    if (prefix === "conv") {
      if (!("timestamp" in parsed) || typeof parsed.timestamp !== "string" || !Number.isFinite(Date.parse(parsed.timestamp))) {
        throw new Error("invalid")
      }
      return { timestamp: new Date(parsed.timestamp).toISOString(), id }
    }
    if (!("sequence" in parsed) || typeof parsed.sequence !== "string" || !/^[1-9][0-9]*$/u.test(parsed.sequence)) {
      throw new Error("invalid")
    }
    return { sequence: parsed.sequence, id }
  } catch {
    throw new Error("CHAT_CURSOR_INVALID")
  }
}

export function conversationFromRow(row: ConversationRow): Conversation {
  return {
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    ownerId: row.owner_id,
    projectRef: row.project_ref,
    title: row.title,
    status: row.status,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
    deletedAt: row.deleted_at === null ? null : instant(row.deleted_at),
  }
}

export function messageFromRow(row: MessageRow): Message {
  const sequence = String(row.message_seq)
  if (!/^[1-9][0-9]*$/u.test(sequence)) throw new Error("CHAT_MESSAGE_SEQUENCE_INVALID")
  return {
    messageId: row.message_id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    role: row.role,
    content: row.content,
    status: row.status,
    messageSeq: sequence,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
  }
}

export function shareFromRow(row: ShareRow): Share {
  return {
    shareId: row.share_id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    url: row.url,
    createdAt: instant(row.created_at),
    expiresAt: row.expires_at === null ? null : instant(row.expires_at),
    revokedAt: row.revoked_at === null ? null : instant(row.revoked_at),
  }
}

export const conversationColumns = "conversation_id, tenant_id, owner_id, project_ref, title, status, created_at, updated_at, deleted_at"
export const messageColumns = "message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq, created_at, updated_at"
export const shareColumns = "share_id, tenant_id, conversation_id, url, created_at, expires_at, revoked_at"
