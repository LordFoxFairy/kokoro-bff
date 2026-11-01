/** Immutable Chat submission source, not current execution or consumption permission. */
export type SubmittedAgentRun = Readonly<{ tenantId: string; userId: string; runId: string; conversationId: string }>
export type SubmittedAgentRunInput = Readonly<{ tenantId: string; runId: string; signal?: AbortSignal }>
export interface SubmittedAgentRunReader {
  readSubmittedAgentRun(input: SubmittedAgentRunInput): Promise<SubmittedAgentRun | null>
}
