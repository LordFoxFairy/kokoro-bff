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
import type { ScheduledTaskOutboxRepository } from "../../application/scheduled/scheduled-task-outbox-repository.js"
import type { ProjectRepository } from "../../application/projects/project-repository.js"
import type { ScheduledTaskRepository } from "../../application/scheduled/scheduled-task-repository.js"
import { ProjectService } from "../../application/project-service.js"
import { ScheduledTaskService } from "../../application/scheduled-task-service.js"
import { ChatApplicationService } from "../../application/chat-service.js"
import { ChatTurnApplicationService } from "../../application/chat-turn-service.js"
import { AgUiProjectionService } from "../../application/agui/project-session-events.js"
import { PostgresAgUiProjectionRepository } from "./agui-projection-repository.js"
import { PostgresAgUiConsumerRepository } from "./agui-consumer-repository.js"
import type { AgUiProjectionConsumerRepository } from "../../application/agui/ports/agui-projection-repository.js"
import type { AgentDispatchOutboxRepository } from "../../application/agent-dispatch/agent-dispatch-outbox-repository.js"
import type { SubmittedAgentRunReader } from "../../application/agent-runs/submitted-agent-run-reader.js"
import type { ProjectExecutionBindingReader } from "../../application/agent-runs/project-execution-binding-reader.js"
import type { AgentCancellationOutboxRepository } from "../../application/agent-dispatch/agent-cancellation-outbox-repository.js"
import { Sha256StableIdGenerator } from "../identifiers/scheduled-task-outbox-id.js"
import { PostgresSchedulerDispatchReceiptRepository } from "./scheduler-dispatch-receipt-repository.js"
import type { SchedulerDispatchReceiptRepository } from "../../application/scheduled/scheduler-dispatch-receipt-repository.js"
import type { ArtifactLibraryRepository } from "../../application/account/artifact-library-repository.js"
import { PostgresScheduledAgentDispatchRepository } from "./scheduled-agent-dispatch-repository.js"
import type { ScheduledAgentDispatchRepository } from "../../application/scheduled/scheduled-agent-dispatch-repository.js"
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

/**
 * Named resources owned by the BFF PostgreSQL boundary.
 *
 * Bootstrap consumes these resources by owner name instead of depending on a
 * repository aggregate. The database and idempotency handles remain here only
 * as infrastructure/test seams; application modules receive their own named
 * ports below.
 */
export type PostgresBffOwnerResources = {
  readonly database: PostgresBffDatabase
  readonly idempotency: IdempotencyRepository
  readonly projectService: ProjectService
  readonly scheduledTaskService: ScheduledTaskService
  readonly chatService: ChatApplicationService
  readonly chatTurnService: ChatTurnApplicationService
  readonly agUi: AgUiProjectionService
  readonly agUiConsumers: AgUiProjectionConsumerRepository
  readonly scheduledTaskOutbox: ScheduledTaskOutboxRepository
  readonly agentDispatchOutbox: AgentDispatchOutboxRepository
  readonly submittedAgentRuns: SubmittedAgentRunReader
  readonly projectExecutionBindings: ProjectExecutionBindingReader
  readonly agentCancellationOutbox: AgentCancellationOutboxRepository
  readonly schedulerDispatchReceipts: SchedulerDispatchReceiptRepository
  readonly scheduledAgentDispatch: ScheduledAgentDispatchRepository
  readonly artifactLibrary: ArtifactLibraryRepository
  readonly projectScopeReleaseOutbox: ProjectScopeReleaseOutboxRepository
  readonly skillShares: SkillShareRepository
  readonly publicShareService: PublicShareApplicationService
  readonly personalKnowledge: PersonalKnowledgeRepository
  readonly skillUsage: SkillUsageReader
  readonly skillAiAssociation: (
    tenant: string,
    subject: string,
    conversation: string,
    artifact: string,
  ) => Promise<import("../../application/skill-ai-handoff.js").SkillAiAssociation | null>
  ready(): Promise<void>
  close(): Promise<void>
  getReceipt(scope: string): Promise<PersistentReceipt | null>
  claimReceipt(scope: string, fingerprint: string): Promise<ReceiptClaim>
  putReceipt(scope: string, receipt: PersistentReceipt): Promise<void>
  compareAndSetReceipt(
    scope: string,
    fingerprint: string,
    expected: PersistentReceipt,
    replacement: PersistentReceipt,
  ): Promise<ReceiptCasResult>
  releaseReceipt(scope: string, fingerprint: string): Promise<void>
}

/** Construct the production BFF owner-resource graph. */
export function createPostgresBffOwnerResources(postgresUrl: string, redisUrl: string): PostgresBffOwnerResources {
  const database = new PostgresBffDatabase(postgresUrl, redisUrl)
  const idempotency = new PostgresIdempotencyRepository(database.pool)
  const projects: ProjectRepository = new PostgresProjectRepository(database)
  const scheduled: ScheduledTaskRepository & ScheduledTaskOutboxRepository = new PostgresScheduledTaskRepository(database)
  const chat = new PostgresChatRepository(database)
  const publicShares = new PostgresPublicShareRepository(database)
  const agentDispatchOutbox = new PostgresAgentDispatchOutboxRepository(database)
  const agentCancellationOutbox = new PostgresAgentCancellationOutboxRepository(database)
  const schedulerDispatchReceipts = new PostgresSchedulerDispatchReceiptRepository(database.pool)
  const scheduledAgentDispatch = new PostgresScheduledAgentDispatchRepository(database)
  const artifactLibrary = new PostgresConversationArtifactLibrary(database)
  const projectScopeReleaseOutbox = new PostgresProjectScopeReleaseOutboxRepository(database)
  const skillShares = new PostgresSkillShareRepository(database)
  const publicShareService = new PublicShareApplicationService(publicShares)
  const personalKnowledge = new PostgresPersonalKnowledgeRepository(database)
  const skillUsage: SkillUsageReader = async (tenant, refs) => {
    const client = await database.pool.connect()
    try {
      return await readSkillUsage(client, tenant, refs)
    } finally {
      client.release()
    }
  }
  const skillAiAssociation = (tenant: string, subject: string, conversation: string, artifact: string) =>
    artifactLibrary.findSkillHandoff(tenant, subject, conversation, artifact)
  const projectService = new ProjectService(projects)
  const scheduledTaskService = new ScheduledTaskService(scheduled)
  const chatService = new ChatApplicationService(chat)
  const chatTurnService = new ChatTurnApplicationService(agentDispatchOutbox, new Sha256StableIdGenerator())
  const agUi = new AgUiProjectionService(new PostgresAgUiProjectionRepository(database))
  const agUiConsumers = new PostgresAgUiConsumerRepository(database)

  return {
    database,
    idempotency,
    projectService,
    scheduledTaskService,
    chatService,
    chatTurnService,
    agUi,
    agUiConsumers,
    scheduledTaskOutbox: scheduled,
    agentDispatchOutbox,
    submittedAgentRuns: agentDispatchOutbox,
    projectExecutionBindings: agentDispatchOutbox,
    agentCancellationOutbox,
    schedulerDispatchReceipts,
    scheduledAgentDispatch,
    artifactLibrary,
    projectScopeReleaseOutbox,
    skillShares,
    publicShareService,
    personalKnowledge,
    skillUsage,
    skillAiAssociation,
    ready: () => database.ready(),
    close: () => database.close(),
    getReceipt: (scope) => idempotency.getReceipt(scope),
    claimReceipt: (scope, fingerprint) => idempotency.claimReceipt(scope, fingerprint),
    putReceipt: (scope, receipt) => idempotency.putReceipt(scope, receipt),
    compareAndSetReceipt: (scope, fingerprint, expected, replacement) => idempotency.compareAndSetReceipt(scope, fingerprint, expected, replacement),
    releaseReceipt: (scope, fingerprint) => idempotency.releaseReceipt(scope, fingerprint),
  }
}

/**
 * Raw/integration compatibility wrapper for tests that still need the historic
 * aggregate shape. Production bootstrap uses createPostgresBffOwnerResources.
 */
export class PostgresBffRepositories {
  private readonly database: PostgresBffDatabase
  private readonly idempotency: IdempotencyRepository
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
  public readonly skillAiAssociation: (
    tenant: string,
    subject: string,
    conversation: string,
    artifact: string,
  ) => Promise<import("../../application/skill-ai-handoff.js").SkillAiAssociation | null>

  public constructor(postgresUrl: string, redisUrl: string) {
    const resources = createPostgresBffOwnerResources(postgresUrl, redisUrl)
    this.database = resources.database
    this.idempotency = resources.idempotency
    this.projectService = resources.projectService
    this.scheduledTaskService = resources.scheduledTaskService
    this.chatService = resources.chatService
    this.chatTurnService = resources.chatTurnService
    this.agUi = resources.agUi
    this.agUiConsumers = resources.agUiConsumers
    this.scheduledTaskOutbox = resources.scheduledTaskOutbox
    this.agentDispatchOutbox = resources.agentDispatchOutbox
    this.submittedAgentRuns = resources.submittedAgentRuns
    this.projectExecutionBindings = resources.projectExecutionBindings
    this.agentCancellationOutbox = resources.agentCancellationOutbox
    this.schedulerDispatchReceipts = resources.schedulerDispatchReceipts
    this.scheduledAgentDispatch = resources.scheduledAgentDispatch
    this.artifactLibrary = resources.artifactLibrary
    this.projectScopeReleaseOutbox = resources.projectScopeReleaseOutbox
    this.skillShares = resources.skillShares
    this.publicShareService = resources.publicShareService
    this.personalKnowledge = resources.personalKnowledge
    this.skillUsage = resources.skillUsage
    this.skillAiAssociation = resources.skillAiAssociation
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
