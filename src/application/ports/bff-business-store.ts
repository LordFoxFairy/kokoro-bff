import type { AgUiProjectionService } from "../agui/project-session-events.js"
import type { AgUiProjectionConsumerRepository } from "../agui/ports/agui-projection-repository.js"
import type { IdempotencyRepository } from "./idempotency-repository.js"
import type { BffApplicationServices } from "../services.js"
import type { ScheduledTaskOutboxRepository } from "./scheduled-task-outbox-repository.js"
import type { AgentDispatchOutboxRepository } from "./agent-dispatch-outbox-repository.js"
import type { AgentCancellationOutboxRepository } from "./agent-cancellation-outbox-repository.js"
import type { SchedulerDispatchReceiptRepository } from "./scheduler-dispatch-receipt-repository.js"
import type { ScheduledAgentDispatchRepository } from "./scheduled-agent-dispatch-repository.js"
import type { ProjectScopeReleaseOutboxRepository } from "./project-scope-release-outbox.js"
import type { PersonalizationProvider } from "../../modules/account/personalization.provider.js"
import type { PersonalKnowledgeRepository } from "./personal-knowledge-repository.js"
import type { SkillUsageReader } from "../agui/skill-usage.js"
import type { SkillAiAssociation } from "../skill-ai-handoff.js"
import type { SkillShareRepository } from "./skill-share-repository.js"
import type { PublicShareApplicationService } from "../public-share-service.js"
import type { ScheduledTaskService } from "../scheduled-task-service.js"
import type { ProjectService } from "../project-service.js"
import type { ChatApplicationService } from "../chat-service.js"
import type { ChatTurnApplicationService } from "../chat-turn-service.js"

export type ArtifactAssociation = Readonly<{
  conversationId: string
  artifactId: string
  runId: string
  sourceAssetId: string
  sourceArtifactKind: "document" | "code" | "image" | "audio" | "video" | "data" | "archive" | "other"
  sourceContentSha256: string
  deliveredAt: string
}>

export type ArtifactPosition = Readonly<{ deliveredAt: string; conversationId: string; artifactId: string }>

export interface ArtifactLibraryRepository {
  listCandidates(tenantId: string, subjectId: string, position: ArtifactPosition | null, limit: number): Promise<readonly ArtifactAssociation[]>
  findCandidate(tenantId: string, subjectId: string, conversationId: string, artifactId: string): Promise<ArtifactAssociation | null>
}

/** Runtime port consumed by BFF routes; PostgreSQL is one infrastructure implementation. */
export interface BffBusinessStore extends IdempotencyRepository {
  /** Account-owned provider retained only as the raw-server composition seam during C-3 migration. */
  readonly personalizationProvider?: PersonalizationProvider
  /** Account-owned Knowledge repository retained only as the raw-server composition seam during C-3 migration. */
  readonly personalKnowledge?: PersonalKnowledgeRepository
  /** Skills usage projection retained only as the raw-server composition seam during C-3 migration. */
  readonly skillUsage?: SkillUsageReader
  /** Skills AI artifact association retained only as the raw-server composition seam during C-3 migration. */
  readonly skillAiAssociation?: (tenant: string, subject: string, conversation: string, artifact: string) => Promise<SkillAiAssociation | null>
  readonly skillShares?: SkillShareRepository
  /** Chat-owned public share service retained only as the raw-server composition seam during C-3 migration. */
  readonly publicShareService?: PublicShareApplicationService
  /** ScheduledTask service retained only as the raw-server composition seam during C-3 migration. */
  readonly scheduledTaskService?: ScheduledTaskService
  /** Projects owner service retained as a named C-3 seam while legacy consumers drain. */
  readonly projectService?: ProjectService
  /** Chat owner service retained as a named C-3 seam while legacy consumers drain. */
  readonly chatService?: ChatApplicationService
  /** Chat turn mutation service retained as a named C-3 seam while legacy consumers drain. */
  readonly chatTurnService?: ChatTurnApplicationService
  readonly submittedAgentRuns?: import("./submitted-agent-run-reader.js").SubmittedAgentRunReader
  readonly projectExecutionBindings?: import("./project-execution-binding-reader.js").ProjectExecutionBindingReader
  readonly artifactLibrary?: ArtifactLibraryRepository
  readonly services: BffApplicationServices
  readonly agUi: AgUiProjectionService
  /** Durable source-consumer control plane exposed by the live store. */
  readonly agUiConsumers?: AgUiProjectionConsumerRepository
  /** Present on the live PostgreSQL composition; test route seams may omit it. */
  readonly scheduledTaskOutbox?: ScheduledTaskOutboxRepository
  /** Durable Chat -> Agent command queue owned by the live BFF store. */
  readonly agentDispatchOutbox?: AgentDispatchOutboxRepository
  /** Durable compensation queue for Agent runs whose owning conversation was deleted. */
  readonly agentCancellationOutbox?: AgentCancellationOutboxRepository
  /** Scheduler event-protocol receipt state; separate from public mutation receipts. */
  readonly schedulerDispatchReceipts?: SchedulerDispatchReceiptRepository
  /** ScheduledTask-owned terminal-gated Agent queue. */
  readonly scheduledAgentDispatch?: ScheduledAgentDispatchRepository
  /** Durable Project deletion scope-release queue. */
  readonly projectScopeReleaseOutbox?: ProjectScopeReleaseOutboxRepository
  ready(): Promise<void>
  close(): Promise<void>
}
