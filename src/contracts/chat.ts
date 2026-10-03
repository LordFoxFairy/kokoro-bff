export type ChatSessionStatus = "active" | "deleted"
export type ChatRunStatus = "queued" | "running" | "waiting" | "stopped" | "completed" | "cancelled" | "error"
export type ChatMessageRole = "user" | "assistant"
export type ChatFailure = {
  source: "agent"
  code:
    | "token_budget_exceeded"
    | "recursion_limit_exceeded"
    | "assembly_failed"
    | "enqueue_failed"
    | "dispatch_exhausted"
    | "contract_incompatible"
    | "internal_error"
    | "model_unavailable"
    | "dependency_unavailable"
    | "model_access_denied"
  retryable: boolean
}

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
  failure?: ChatFailure
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
  conversation_id: string
  artifact_id: string
  asset_id: string
  artifact_kind: string
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
  execution_head?: { run_id: string; state: "queued" | "active" | "waiting" | "resuming"; pending_pauses: InteractionState[] }
  files: WorkspaceFile[]
  deliveries: Delivery[]
  deliveries_has_more: boolean
  event_watermark: string | null
  execution_process: {
    run_id: string
    todos: unknown[] | null
    activities: Array<Record<string, unknown>>
    next_cursor: string | null
  } | null
}

/** Public read projection of the published owner full state; no private decision values. */
export type InteractionState = {
  interaction_revision: number
  pause_revision: number
  pause_ref: string | null
  phase: "active" | "waiting" | "resuming" | "terminal"
  groups: Array<{
    group_id: string
    items: Array<{
      item_id: string
      request_id: string
      kind: "tool_approval" | "ask_user_question" | "result_review" | "input"
      allowed_decisions: Array<"approve" | "edit" | "reject" | "respond" | "submit">
      display: {
        name: string
        description: string
        editable: boolean
        input_schema: Record<string, unknown>
        result_preview?: string | null | undefined
        truncated?: boolean | null | undefined
        source?: string | null | undefined
      }
      validation?: { code: "json_schema_invalid"; instance_path: Array<string | number> } | null | undefined
    }>
  }>
  action_result: { command_id: string; pause_revision: number; kind: "accepted" | "native_consumed" | "validation_failed" | "unknown" | "cancelled" } | null
}
