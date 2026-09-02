export type RequestMeta = { request_id: string }

export type BffEnvelope<T> = {
  data: T
  meta: RequestMeta
}

export type BffErrorBody = {
  error: {
    code: string
    message: string
  }
  meta: RequestMeta
}

export type Project = {
  id: string
  name: string
  slug: string
  description: string
  instruction?: string
  created_at: string
  updated_at: string
}

export type ProjectInstructionRevision = {
  id: string
  instruction: string
  updatedAt: number
  actorName: string
  current: boolean
}

export type Task = {
  id: string
  project_id: string
  title: string
  status: "todo" | "in_progress" | "done"
  updated_at: string
}

export type Skill = {
  name: string
  description: string
  content_hash: string
  scope: string
  source_url?: string
  enabled?: boolean
  installed?: boolean
  categories?: string[]
  updated_at?: number
}

export type SkillQuota = {
  namespace: string
  package_count: number
  package_bytes: number
  max_packages: number
  max_bytes: number
}

export type SkillRevision = {
  scope: string
  name: string
  revision: number
  content_hash: string
  package_size: number
  source: string
  created_at: number
}

export type McpTransport = "http" | "streamable_http"

export type McpServer = {
  scope: string
  name: string
  revision: number
  transport: McpTransport
  url: string
  allowed_tools: string[]
  secret_ref: string | null
  enabled: boolean
}

export type ScheduledTask = {
  id: string
  project_id?: string
  title: string
  prompt: string
  frequency: "daily" | "weekly"
  time: string
  timezone: string
  next_run_at: string
  expires_at?: string
  auto_approve: boolean
  enabled: boolean
  status: "active" | "paused" | "failed"
}

export type AgentConnectionSetup = {
  platform: "telegram" | "line" | "slack"
  status: "disconnected" | "pending" | "connected" | "expired"
  qr_value: string
  continue_url: string
  expires_at: string
}

export type LibraryItem = {
  id: string
  title: string
  type: "document" | "spreadsheet" | "presentation" | "image" | "other"
  created_at: string
  url: string
}

export type BillingSummary = {
  balance: number
  currency: string
  period: string
  usage: number
}

export type BillingPlan = {
  id: string
  key: string
  name: string
  currency: string
  amount_minor: string
  credit_micros: string
  billing_interval: "once" | "month" | "year"
}

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
  messages?: Array<{
    message_id: string
    role: ChatMessageRole
    content: string
    status: "pending" | "streaming" | "completed" | "failed"
    created_at: string
    run_id?: string
  }>
  active_run?: ChatRun
  pending_pauses: Array<Record<string, unknown>>
  files: WorkspaceFile[]
  deliveries: Delivery[]
  event_watermark: number
}

export function ok<T>(data: T, requestId: string): BffEnvelope<T> {
  return { data, meta: { request_id: requestId } }
}

export function failure(code: string, message: string, requestId: string): BffErrorBody {
  return { error: { code, message }, meta: { request_id: requestId } }
}
