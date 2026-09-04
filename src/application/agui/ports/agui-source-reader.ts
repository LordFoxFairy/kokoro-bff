import type { AgUiConsumerLease } from "./agui-projection-repository.js"
import type { AgentProjectionSource } from "../project-session-events.js"

export type AgUiSourceScope = {
  tenantId: string
  sessionId: string
  subjectId: string
}

export type AgUiSourcePage = {
  events: AgentProjectionSource[]
  nextSequence: number
  watermark: number
  exhausted: boolean
}

/**
 * Application port for the Agent source owner. The reader returns only a
 * contract-validated contiguous page; it never exposes an owner HTTP type to
 * the projector.
 */
export interface AgUiSourceReader {
  read(
    scope: AgUiSourceScope,
    afterSequence: number,
    limit: number,
    lease?: AgUiConsumerLease,
  ): Promise<AgUiSourcePage>
}
