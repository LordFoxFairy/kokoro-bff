import type { AgentDispatchCommand } from "../../domain/chat/agent-dispatch.js"

export type AgentDispatchDeliveryResult =
  | { outcome: "admitted" }
  | { outcome: "unknown"; errorCode: string }
  | { outcome: "not_admitted"; errorCode: string }

export interface AgentDispatchDeliveryPort {
  deliver(command: AgentDispatchCommand, timeoutBudgetMs: number): Promise<AgentDispatchDeliveryResult>
}
