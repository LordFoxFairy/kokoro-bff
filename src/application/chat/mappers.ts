import type { ChatMessage, ChatSessionSummary } from "../../contracts/index.js"
import type { Conversation } from "../../domain/chat/conversation.js"
import type { Message } from "../../domain/chat/message.js"

function iso(value: Date): string {
  return value.toISOString()
}

export function conversationSummary(conversation: Conversation): ChatSessionSummary {
  return {
    session_id: conversation.conversationId,
    title: conversation.title,
    updated_at: iso(conversation.updatedAt),
  }
}

export function chatMessage(message: Message): ChatMessage {
  return {
    message_id: message.messageId,
    role: message.role,
    content: message.content,
    status: message.status,
    created_at: iso(message.createdAt),
    ...(message.runId === null ? {} : { run_id: message.runId }),
  }
}
