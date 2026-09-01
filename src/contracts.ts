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
  created_at: string
  updated_at: string
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
  enabled?: boolean
  installed?: boolean
  categories?: string[]
  updated_at?: number
}

export type ScheduledTask = {
  id: string
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

export function ok<T>(data: T, requestId: string): BffEnvelope<T> {
  return { data, meta: { request_id: requestId } }
}

export function failure(code: string, message: string, requestId: string): BffErrorBody {
  return { error: { code, message }, meta: { request_id: requestId } }
}
