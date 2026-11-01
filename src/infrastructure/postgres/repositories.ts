import { PostgresPersonalKnowledgeRepository } from "./personal-knowledge-repository.js"
import { readSkillUsage } from "./skill-usage-projection.js"
import { PostgresBffDatabase } from "./client.js"
import { PostgresIdempotencyRepository } from "./idempotency-repository.js"
import { PostgresProjectRepository } from "./project-repository.js"
import { PostgresScheduledTaskRepository } from "./scheduled-task-repository.js"
import { PostgresChatRepository } from "./chat-repository.js"
import { PostgresPublicShareRepository } from "./public-share-repository.js"
import { PostgresAgentDispatchOutboxRepository } from "./agent-dispatch-outbox-repository.js"
import { PostgresAgentCancellationOutboxRepository } from "./agent-cancellation-outbox-repository.js"
import {
  PENDING_RECEIPT_STATUS,
  type IdempotencyRepository,
  type PersistentReceipt,
  type ReceiptCasResult,
  type ReceiptClaim,
} from "../../application/ports/idempotency-repository.js"
import type { ProjectRepository } from "../../application/projects/project-repository.js"
import type { ScheduledTaskRepository } from "../../application/scheduled/scheduled-task-repository.js"
import type { ScheduledTaskOutboxRepository } from "../../application/scheduled/scheduled-task-outbox-repository.js"
import { ProjectService } from "../../application/project-service.js"
import { ScheduledTaskService } from "../../application/scheduled-task-service.js"
import { ChatApplicationService } from "../../application/chat-service.js"
import { ChatTurnApplicationService } from "../../application/chat-turn-service.js"
import { AgUiProjectionService } from "../../application/agui/project-session-events.js"
import { PostgresAgUiProjectionRepository } from "./agui-projection-repository.js"
import { PostgresAgUiConsumerRepository } from "./agui-consumer-repository.js"
import type { AgUiProjectionConsumerRepository } from "../../application/agui/ports/agui-projection-repository.js"
import type { AgentDispatchOutboxRepository } from "../../application/ports/agent-dispatch-outbox-repository.js"
import type { SubmittedAgentRunReader } from "../../application/agent-runs/submitted-agent-run-reader.js"
import type { ProjectExecutionBindingReader } from "../../application/agent-runs/project-execution-binding-reader.js"
import type { AgentCancellationOutboxRepository } from "../../application/ports/agent-cancellation-outbox-repository.js"
import { Sha256StableIdGenerator } from "../identifiers/scheduled-task-outbox-id.js"
import { PostgresSchedulerDispatchReceiptRepository } from "./scheduler-dispatch-receipt-repository.js"
import type { SchedulerDispatchReceiptRepository } from "../../application/ports/scheduler-dispatch-receipt-repository.js"
import type { ArtifactLibraryRepository } from "../../application/account/artifact-library-repository.js"
import { PostgresScheduledAgentDispatchRepository } from "./scheduled-agent-dispatch-repository.js"
import type { ScheduledAgentDispatchRepository } from "../../application/ports/scheduled-agent-dispatch-repository.js"
import { PostgresConversationArtifactLibrary } from "./conversation-artifact-library.js"
import { PostgresProjectScopeReleaseOutboxRepository } from "./project-scope-release-outbox-repository.js"
import type { ProjectScopeReleaseOutboxRepository } from "../../application/projects/project-scope-release-outbox.js"
import { PostgresSkillShareRepository } from "./skill-share-repository.js"
import type { SkillShareRepository } from "../../application/skills/skill-share-repository.js"
import { PublicShareApplicationService } from "../../application/public-share-service.js"
import type { PersonalKnowledgeRepository } from "../../application/account/personal-knowledge-repository.js"
import type { SkillUsageReader } from "../../application/agui/skill-usage.js"

export { PENDING_RECEIPT_STATUS }
export type { PersistentReceipt, ReceiptClaim } from "../../application/ports/idempotency-repository.js"
export type { ScheduledTaskRecord } from "../../application/scheduled/scheduled-task-repository.js"

export class PostgresBffRepositories {
  private readonly database: PostgresBffDatabase
  private readonly idempotency: IdempotencyRepository
  private readonly projects: ProjectRepository
  private readonly scheduled: ScheduledTaskRepository
  /** Feature-owned application services exposed as named seams for bootstrap. */
  public readonly projectService: ProjectService
  public readonly scheduledTaskService: ScheduledTaskService
  public readonly chatService: ChatApplicationService
  public readonly chatTurnService: ChatTurnApplicationService
  public readonly agUi: AgUiProjectionService
  public readonly agUiConsumers: AgUiProjectionConsumerRepository
  public readonly scheduledTaskOutbox: ScheduledTaskOutboxRepository
  public readonly agentDispatchOutbox: AgentDispatchOutboxRepository
  public readonly submittedAgentRuns: SubmittedAgentRunReader
  public readonly projectExecutionBindings: ProjectExecutionBindingReader
  public readonly agentCancellationOutbox: AgentCancellationOutboxRepository
  public readonly schedulerDispatchReceipts: SchedulerDispatchReceiptRepository
  public readonly scheduledAgentDispatch: ScheduledAgentDispatchRepository
  public readonly artifactLibrary: ArtifactLibraryRepository
  public readonly projectScopeReleaseOutbox: ProjectScopeReleaseOutboxRepository
  public readonly skillShares: SkillShareRepository
  public readonly publicShareService: PublicShareApplicationService
  public readonly personalKnowledge: PersonalKnowledgeRepository
  public readonly skillUsage: SkillUsageReader
  public readonly skillAiAssociation: (tenant: string, subject: string, conversation: string, artifact: string) => Promise<import("../../application/skill-ai-handoff.js").SkillAiAssociation | null>

  public constructor(postgresUrl: string, redisUrl: string) {
    this.database = new PostgresBffDatabase(postgresUrl, redisUrl)
    this.idempotency = new PostgresIdempotencyRepository(this.database.pool)
    this.projects = new PostgresProjectRepository(this.database)
    const scheduled = new PostgresScheduledTaskRepository(this.database)
    const chat = new PostgresChatRepository(this.database)
    const publicShares = new PostgresPublicShareRepository(this.database)
    const agentDispatchOutbox = new PostgresAgentDispatchOutboxRepository(this.database)
    const agentCancellationOutbox = new PostgresAgentCancellationOutboxRepository(this.database)
    this.scheduled = scheduled
    this.scheduledTaskOutbox = scheduled
    this.agentDispatchOutbox = agentDispatchOutbox
    this.submittedAgentRuns = agentDispatchOutbox
    this.projectExecutionBindings = agentDispatchOutbox
    this.agentCancellationOutbox = agentCancellationOutbox
    this.schedulerDispatchReceipts = new PostgresSchedulerDispatchReceiptRepository(this.database.pool)
    this.scheduledAgentDispatch = new PostgresScheduledAgentDispatchRepository(this.database)
    const artifactLibrary = new PostgresConversationArtifactLibrary(this.database)
    this.artifactLibrary = artifactLibrary
    this.projectScopeReleaseOutbox = new PostgresProjectScopeReleaseOutboxRepository(this.database)
    this.skillShares = new PostgresSkillShareRepository(this.database)
    this.publicShareService = new PublicShareApplicationService(publicShares)
    this.personalKnowledge = new PostgresPersonalKnowledgeRepository(this.database)
    this.skillUsage = async (tenant, refs) => {
      const client = await this.database.pool.connect()
      try {
        return await readSkillUsage(client, tenant, refs)
      } finally {
        client.release()
      }
    }
    this.skillAiAssociation = (tenant, subject, conversation, artifact) => artifactLibrary.findSkillHandoff(tenant, subject, conversation, artifact)
    this.projectService = new ProjectService(this.projects)
    this.scheduledTaskService = new ScheduledTaskService(this.scheduled)
    this.chatService = new ChatApplicationService(chat)
    this.chatTurnService = new ChatTurnApplicationService(agentDispatchOutbox, new Sha256StableIdGenerator())
    this.agUi = new AgUiProjectionService(new PostgresAgUiProjectionRepository(this.database))
    this.agUiConsumers = new PostgresAgUiConsumerRepository(this.database)
  }

  public ready(): Promise<void> {
    return this.database.ready()
  }
  public close(): Promise<void> {
    return this.database.close()
  }

  public getReceipt(scope: string): Promise<PersistentReceipt | null> {
    return this.idempotency.getReceipt(scope)
  }
  public claimReceipt(scope: string, fingerprint: string): Promise<ReceiptClaim> {
    return this.idempotency.claimReceipt(scope, fingerprint)
  }
  public putReceipt(scope: string, receipt: PersistentReceipt): Promise<void> {
    return this.idempotency.putReceipt(scope, receipt)
  }
  public compareAndSetReceipt(scope: string, fingerprint: string, expected: PersistentReceipt, replacement: PersistentReceipt): Promise<ReceiptCasResult> {
    return this.idempotency.compareAndSetReceipt(scope, fingerprint, expected, replacement)
  }
  public releaseReceipt(scope: string, fingerprint: string): Promise<void> {
    return this.idempotency.releaseReceipt(scope, fingerprint)
  }
}
