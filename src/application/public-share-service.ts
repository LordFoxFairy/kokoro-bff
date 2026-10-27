import type { ChatMessage } from "../contracts/chat.js"
import { isRecord } from "../domain/json.js"
import { parseSkillSourceSelection } from "../domain/chat/skill-source-selection.js"
import { chatMessage } from "./chat/mappers.js"
import type { PublicShareRepository } from "./ports/public-share-repository.js"

export class PublicShareApplicationService {
  public constructor(private readonly repository: PublicShareRepository) {}

  public findActiveShare(shareId: string, tenantId?: string, projectRef?: string): ReturnType<PublicShareRepository["findActiveShare"]> {
    return this.repository.findActiveShare(shareId, tenantId, projectRef)
  }

  public async listMessages(
    shareId: string,
    tenantId: string,
    conversationId: string,
    limit: number,
  ): Promise<{ messages: ChatMessage[] } | null> {
    const page = await this.repository.listSharedMessages(shareId, tenantId, conversationId, limit)
    return page === null ? null : { messages: page.messages.map(chatMessage) }
  }
}

/** Share has its own public projection; neither a private snapshot nor its cursors are share authority. */
export function publicShareSnapshot(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !isRecord(value.session)) return null
  const session: Record<string, string> = {}
  for (const field of ["session_id", "title", "owner_id", "created_at", "updated_at"]) {
    const item = value.session[field]
    if (typeof item !== "string") return null
    session[field] = item
  }
  if (value.messages !== undefined && !Array.isArray(value.messages)) return null
  const messages: Array<Record<string, unknown>> = []
  for (const raw of value.messages ?? []) {
    if (!isRecord(raw)) return null
    const message: Record<string, unknown> = {}
    for (const field of ["message_id", "role", "content", "status", "created_at"]) {
      if (typeof raw[field] !== "string") return null
      message[field] = raw[field]
    }
    if (raw.run_id !== undefined) {
      if (typeof raw.run_id !== "string") return null
      message.run_id = raw.run_id
    }
    if (raw.role === "user" && raw.selected_skill_source_refs !== undefined) {
      const refs = parseSkillSourceSelection(raw.selected_skill_source_refs)
      if (refs === null) return null
      message.selected_skill_source_refs = refs
    }
    if (raw.failure !== undefined) {
      const failure = raw.failure
      if (!isRecord(failure) || failure.source !== "agent" || typeof failure.code !== "string" || typeof failure.retryable !== "boolean") return null
      message.failure = { source: failure.source, code: failure.code, retryable: failure.retryable }
    }
    messages.push(message)
  }
  return {
    session,
    ...(value.messages === undefined ? {} : { messages }),
    files: [],
    deliveries: [],
    deliveries_has_more: false,
    event_watermark: null,
    execution_process: null,
  }
}
