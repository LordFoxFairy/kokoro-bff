import type { InteractionState } from "../../contracts/chat.js"
import type { Conversation } from "../../domain/chat/conversation.js"
import type { Message } from "../../domain/chat/message.js"
import type { Share } from "../../domain/chat/share.js"

export type ConversationPage = {
  conversations: Conversation[]
  next_cursor: string | null
}

export type ConversationCollectionFilter = Readonly<{ kind: "all" }> | Readonly<{ kind: "direct" }> | Readonly<{ kind: "project"; projectRef: string }>

export type MessagePage = {
  messages: Message[]
  next_cursor: string | null
}

export type ChatSnapshot = {
  conversation: Conversation
  messages: Message[]
  deliveries: ChatArtifactDelivery[]
  deliveriesHasMore: boolean
  eventWatermark: string | null
  executionProcess: RunExecutionProcess | null
  executionHead?: ChatExecutionHead
}

export type RunExecutionProcess = {
  run_id: string
  todos: unknown[] | null
  activities: Array<Record<string, unknown>>
  next_cursor: string | null
}

export type RunProcessPage = RunExecutionProcess & { event_watermark: string }

export type ChatExecutionHead = { runId: string; state: "queued" | "active" | "waiting" | "resuming"; pendingPauses: InteractionState[] }
export type ChatRunControlState = { executionHead?: ChatExecutionHead }

export type ChatArtifactDelivery = {
  conversationId: string
  artifactId: string
  assetId: string
  artifactKind: string
  title: string
  mime: string
  size: number
  runId: string
  deliveredAt: Date
}

export type MoveConversationReceipt = Readonly<{ data: Readonly<{ session_id: string; project_ref: string | null }> }>
export type MoveConversationResult = Readonly<{ kind: "moved"; receipt: MoveConversationReceipt }> | Readonly<{ kind: "not_found" | "conflict" }>
export type MoveConversationCommand = Readonly<{
  tenantId: string
  subjectId: string
  conversationId: string
  targetProjectId: string | null
  scope: string
  fingerprint: string
  signal: AbortSignal
}>

export type ChatRepository = {
  listConversations(tenantId: string, subjectId: string, filter: ConversationCollectionFilter, limit: number, cursor: string | null): Promise<ConversationPage>
  findConversation(tenantId: string, subjectId: string, conversationId: string, projectRef: string | undefined): Promise<Conversation | null>
  readSnapshot(tenantId: string, subjectId: string, conversationId: string, projectRef: string | undefined): Promise<ChatSnapshot | null>
  readRunProcessPage(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    runId: string,
    projectRef: string | undefined,
    watermark: string,
    cursor: string | null,
    limit: number,
  ): Promise<RunProcessPage | null>
  readRunControlState(tenantId: string, subjectId: string, conversationId: string, projectRef: string | undefined): Promise<ChatRunControlState | null>
  listMessages(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    limit: number,
    cursor: string | null,
    projectRef?: string,
  ): Promise<MessagePage | null>
  renameConversation(tenantId: string, subjectId: string, conversationId: string, title: string, projectRef?: string): Promise<Conversation | null>
  moveConversation(command: MoveConversationCommand): Promise<MoveConversationResult>
  deleteConversation(tenantId: string, subjectId: string, conversationId: string, requestId: string, projectRef?: string): Promise<boolean>
  createShare(tenantId: string, subjectId: string, conversationId: string, projectRef?: string): Promise<Share | null>
  revokeShare(tenantId: string, subjectId: string, conversationId: string, projectRef?: string): Promise<Share | null>
}
