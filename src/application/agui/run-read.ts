import type { InteractionState } from "../../contracts/chat.js"

export type RunExecutionProcess = {
  run_id: string
  todos: unknown[] | null
  activities: Array<Record<string, unknown>>
  next_cursor: string | null
}

export type RunProcessPage = RunExecutionProcess & { event_watermark: string }

export type ChatExecutionHead = { canControl?: boolean; runId: string; state: "queued" | "active" | "waiting" | "resuming"; pendingPauses: InteractionState[] }
export type ChatRunControlState = { executionHead?: ChatExecutionHead }
