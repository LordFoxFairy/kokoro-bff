export type ChatSessionStatus = "active" | "deleted"
export type ChatRunStatus = "queued" | "running" | "waiting" | "stopped" | "completed" | "cancelled" | "error"
export type ChatMessageRole = "user" | "assistant" | "system"

export type ChatSessionSummary = {
  session_id: string
  title: string
  updated_at: string
}

export type ChatMessage = {
  message_id: string
  role: ChatMessageRole
  content: string
  status: "pending" | "streaming" | "completed" | "failed"
  created_at: string
  run_id?: string
}

export type ChatEvent = {
  event_id: string
  seq: number
  session_id: string
  run_id: string | null
  kind: string
  timestamp: string
  payload: Record<string, unknown>
}

export type ChatRun = {
  run_id: string
  status: string
}

export type ChatShare = {
  share_id: string
  url: string
  created_at: string
  revoked_at: string | null
}

export type WorkspaceFile = {
  path: string
  mime: string
  bytes: number
}

export type Delivery = {
  content_hash: string
  path: string
  title: string
  mime: string
  size: number
  run_id: string
  created_at: string
}

export type ChatSessionDetail = {
  session: {
    session_id: string
    title: string
    owner_id: string
    created_at: string
    updated_at: string
  }
  messages?: ChatMessage[]
  active_run?: ChatRun
  pending_pauses: Array<Record<string, unknown>>
  files: WorkspaceFile[]
  deliveries: Delivery[]
  event_watermark: number
}
