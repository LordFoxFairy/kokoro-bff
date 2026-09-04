import type { AgentDispatchCommand } from "../../domain/chat/agent-dispatch.js"

export type AgentDispatchDeliveryResult =
  | { outcome: "succeeded" }
  | { outcome: "retryable"; errorCode: string }
  | { outcome: "failed"; errorCode: string }

export interface AgentDispatchDeliveryPort {
  deliver(command: AgentDispatchCommand, timeoutBudgetMs: number): Promise<AgentDispatchDeliveryResult>
}
