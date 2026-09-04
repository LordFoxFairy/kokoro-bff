import type { ChatEvent, ChatMessage, ChatSessionDetail, ChatSessionSummary } from "../../../contracts/index.js"

export type BffIdentity = {
  namespace: string
  userId: string
}

export type AgentIdentityHeaders = {
  "x-kokoro-tenant-ref": string
  "x-kokoro-subject-ref": string
  "x-kokoro-actor-ref": string
  "x-kokoro-subject-kind": "user"
  "x-kokoro-actor-kind": "user"
  "x-kokoro-identity-assertion-ref": string
}

export type AgentLaunch = {
  body: Record<string, unknown>
  receipt: {
    run_id: string
    user_message_id: string
    assistant_message_id: string
  }
}

export type AgentControl = {
  kind: "run.cancel" | "run.resume" | "run.steer"
  session_id: string
  decisions?: unknown[]
  message_id?: string
  content?: string
}

export type AgentChatEvent = {
  chat_event_id: string
  session_id: string
  run_id: string
  chat_message_id?: string | null
  event_type: string
  payload_json: string
  seq: number
  created_at: number
}

export type AgentEventPage = {
  events: AgentChatEvent[]
  nextSequence: number
  watermark: number
  exhausted: boolean
}

export type AgentChatMessage = {
  chat_message_id: string
  session_id: string
  run_id: string
  role: "user" | "assistant"
  content: string
  status: "completed" | "failed"
  seq: number
  created_at: number
  updated_at: number
}

export type { ChatEvent, ChatMessage, ChatSessionDetail, ChatSessionSummary }
