import type { AgentCancellationCommand } from "../../domain/chat/agent-cancellation.js"

export type AgentCancellationDeliveryResult =
  | { outcome: "succeeded" }
  | { outcome: "retryable"; errorCode: string }
  | { outcome: "failed"; errorCode: string }

export interface AgentCancellationDeliveryPort {
  deliver(command: AgentCancellationCommand, timeoutBudgetMs: number): Promise<AgentCancellationDeliveryResult>
}
