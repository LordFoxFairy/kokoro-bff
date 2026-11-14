import type { ProjectAccess } from "../../domain/project/access.js"
import type { ChatComposerSelection, OrderedMessageRendering } from "../../contracts/chat.js"
import type { ChatExecutionHead, RunExecutionProcess } from "../agui/run-read.js"
import type { Conversation } from "../../domain/chat/conversation.js"
import type { Message } from "../../domain/chat/message.js"

export type ConversationPage = {
  conversations: Conversation[]
  next_cursor: string | null
}

export type ConversationCollectionFilter = Readonly<{ kind: "all" }> | Readonly<{ kind: "direct" }> | Readonly<{ kind: "project"; projectRef: string }>

export type MessagePage = {
  messages: Message[]
  next_cursor: string | null
}

export type PrivateMessageRead = (
  | Message
  | (Omit<Message, "content" | "role" | "runId"> & {
      role: "assistant"
      runId: string
      content: null
      rendering: OrderedMessageRendering
    })
) & { terminal_status?: "cancelled"; regeneratedFromMessageId?: string; sharedProjectRead?: boolean; canRegenerate?: boolean }
export type PrivateMessagePage = { messages: PrivateMessageRead[]; next_cursor: string | null; projectAccess?: ProjectAccess }
export type MessageReadLifetime = Readonly<{
  signal: AbortSignal
  deadlineAt: number
  /** Same-RR projection authority for the original buffered response; never a transport credential. */
  onProjectRead?: (access: ProjectAccess | null) => void
}>
export type PrivateMessageReadContext = MessageReadLifetime & Readonly<{ scope: "all" | "direct" }>

export type ShareMetadataQuery = PrivateMessageReadContext &
  Readonly<{
    tenantId: string
    subjectId: string
    conversationId: string
    projectRef?: string | undefined
  }>
export type ShareMetadataRead = Readonly<{
  share: Readonly<{ share_id: string; created_at: string; expires_at: string | null }> | null
}>
export type MessagePartsQuery = MessageReadLifetime &
  Readonly<{
    tenantId: string
    subjectId: string
    conversationId: string
    messageId: string
    projectRef: string | undefined
    scope: "all" | "direct"
    cursor: string | null
    limit: number
  }>

export type ChatSnapshot = {
  projectAccess?: ProjectAccess
  composerSelection?: ChatComposerSelection
  conversation: Conversation
  messages: PrivateMessageRead[]
  deliveries: ChatArtifactDelivery[]
  deliveriesHasMore: boolean
  eventWatermark: string | null
  executionProcess: RunExecutionProcess | null
  executionHead?: ChatExecutionHead
}

export type ChatArtifactDelivery = {
  conversationId: string
  artifactId: string
  assetId?: string
  artifactKind: string
  title: string
  mime: string
  size: number
  runId: string
  deliveredAt: Date
  displayPath?: string
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

export type SharedTasksPosition = Readonly<{ sharedAt: string; sessionId: string }>
export type SharedTaskItem = Readonly<{ session_id: string; title: string; shared_at: string; expires_at: string | null }>
export type SharedTasksRead = Readonly<{ items: SharedTaskItem[]; nextPosition: SharedTasksPosition | null }>
export type SharedTasksPage = Readonly<{ items: SharedTaskItem[]; next_cursor: string | null }>

export type ArchiveIdentity = Readonly<{ tenantId: string; subjectId: string; signal: AbortSignal; deadlineAt: number }>
export type ArchivedTasksPosition = Readonly<{ archivedAt: string; sessionId: string }>
export type ArchivedTaskItem = Readonly<{ session_id: string; title: string; archived_at: string; project_ref: string | null }>
export type ArchivedTasksQuery = ArchiveIdentity & Readonly<{ limit: number; position: ArchivedTasksPosition | null }>
export type ArchivedTasksRead = Readonly<{ items: ArchivedTaskItem[]; nextPosition: ArchivedTasksPosition | null }>
export type ArchiveStateQuery = ArchiveIdentity & Readonly<{ conversationId: string }>
export type ArchiveState = Readonly<{ session_id: string; archived_at: string | null }>
export type ArchiveStateCommand = ArchiveStateQuery & Readonly<{ action: "archive" | "restore"; scope: string; fingerprint: string }>
export type ArchiveStateResult = Readonly<{ kind: "changed"; receipt: Readonly<{ data: ArchiveState }> }> | Readonly<{ kind: "not_found" | "conflict" }>
