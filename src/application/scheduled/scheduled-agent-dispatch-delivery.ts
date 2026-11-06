import type { ScheduledAgentDispatchCommand } from "../../domain/scheduled-task/agent-dispatch.js"

export type ScheduledAgentDeliveryResult = { outcome: "admitted" } | { outcome: "not_admitted"; errorCode: string } | { outcome: "unknown"; errorCode: string }

export interface ScheduledAgentDispatchDeliveryPort {
  deliver(command: ScheduledAgentDispatchCommand, timeoutMs: number): Promise<ScheduledAgentDeliveryResult>
}
