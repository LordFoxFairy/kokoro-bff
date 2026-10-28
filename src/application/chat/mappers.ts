import type { ChatMessage, ChatMessageRead, ChatSessionSummary } from "../../contracts/index.js"
import type { PrivateMessageRead } from "../ports/chat-repository.js"
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
    ...(message.role === "user" ? { selected_skill_source_refs: message.selectedSkillSourceRefs } : {}),
    status: message.status,
    created_at: iso(message.createdAt),
    ...(message.runId === null ? {} : { run_id: message.runId }),
    ...(message.failure === null ? {} : { failure: message.failure }),
  }
}

export function privateChatMessage(message: PrivateMessageRead): ChatMessageRead {
  if (message.content !== null)
    return {
      ...chatMessage(message),
      ...(message.regeneratedFromMessageId === undefined ? {} : { regenerated_from_message_id: message.regeneratedFromMessageId }),
      ...(message.terminal_status === undefined ? {} : { terminal_status: message.terminal_status }),
    }
  return {
    message_id: message.messageId,
    role: "assistant",
    content: null,
    status: message.status,
    created_at: iso(message.createdAt),
    run_id: message.runId,
    rendering: message.rendering,
    ...(message.regeneratedFromMessageId === undefined ? {} : { regenerated_from_message_id: message.regeneratedFromMessageId }),
    ...(message.terminal_status === undefined ? {} : { terminal_status: message.terminal_status }),
    ...(message.failure === null ? {} : { failure: message.failure }),
  }
}
