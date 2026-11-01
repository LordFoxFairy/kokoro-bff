import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import {
  AGENT_CANCELLATION_DISPATCHER,
  AGENT_DISPATCH_DISPATCHER,
  BFF_CONFIG,
  CHAT_SERVICE,
  CHAT_TURN_SERVICE,
  PERSONAL_KNOWLEDGE_REPOSITORY,
  PROJECT_MCP_RECOMMENDATIONS_PROVIDER,
  PROJECT_SERVICE,
  PROJECT_SKILL_SELECTION_PROVIDER,
  PUBLIC_SHARE_SERVICE,
  SCHEDULED_TASK_READ_SERVICE,
  SESSION_ADMISSION,
  SKILL_AI_ASSOCIATION,
  SKILL_EXACT_DOWNLOAD_SOURCE,
  SKILL_SHARE_REPOSITORY,
  SKILL_SPECIFICATION_SOURCE,
  SKILL_USAGE_READER,
} from "../../common/tokens.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { createBffComposition, type BffServerComposition } from "../../bootstrap/runtime.js"
import { handleBffRequest } from "../../bootstrap/server.js"
import { PERSONALIZATION_PROVIDER, type PersonalizationProvider } from "../account/personalization.provider.js"
import type { PersonalKnowledgeRepository } from "../../application/ports/personal-knowledge-repository.js"
import type { SkillUsageReader } from "../../application/agui/skill-usage.js"
import type { SkillAiAssociation } from "../../application/skill-ai-handoff.js"
import type { SkillShareRepository } from "../../application/ports/skill-share-repository.js"
import type { PublicShareApplicationService } from "../../application/public-share-service.js"
import type { ScheduledTaskReadService } from "../../application/scheduled-task-read-service.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import type { ChatTurnApplicationService } from "../../application/chat-turn-service.js"
import type { ProjectService } from "../../application/project-service.js"
import type { ProjectSkillSelectionProvider } from "../../http/routes/project-skill-selection.js"
import type { ProjectMcpRecommendationsProvider } from "../../http/routes/project-mcp-recommendations.js"
import type { ExactSkillDownloadSource } from "../../application/exact-skill-download.js"
import type { SkillSpecificationSource } from "../../application/skill-specification.types.js"
import type { AgentDispatchOutboxDispatcher } from "../../application/agent-dispatch-outbox-dispatcher.js"
import type { AgentCancellationOutboxDispatcher } from "../../application/agent-cancellation-outbox-dispatcher.js"

@Injectable()
export class LegacyRoutesRuntime implements OnModuleInit, OnApplicationShutdown {
  private readonly composition: BffServerComposition

  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) sessionAdmission: SessionAdmission,
    @Inject(PERSONALIZATION_PROVIDER)
    personalizationProvider: PersonalizationProvider,
    @Inject(PERSONAL_KNOWLEDGE_REPOSITORY)
    personalKnowledgeRepository: PersonalKnowledgeRepository,
    @Inject(SKILL_USAGE_READER)
    skillUsageReader: SkillUsageReader,
    @Inject(SKILL_AI_ASSOCIATION)
    skillAiAssociation: (tenant: string, subject: string, conversation: string, artifact: string) => Promise<SkillAiAssociation | null>,
    @Inject(SKILL_SHARE_REPOSITORY)
    skillShareRepository: SkillShareRepository,
    @Inject(PUBLIC_SHARE_SERVICE)
    publicShareService: PublicShareApplicationService,
    @Inject(SCHEDULED_TASK_READ_SERVICE)
    scheduledTaskReader: ScheduledTaskReadService,
    @Inject(CHAT_SERVICE)
    chatService: ChatApplicationService,
    @Inject(CHAT_TURN_SERVICE)
    chatTurnService: ChatTurnApplicationService,
    @Inject(PROJECT_SERVICE)
    projectService: ProjectService,
    @Inject(PROJECT_SKILL_SELECTION_PROVIDER)
    projectSkillSelectionProvider: ProjectSkillSelectionProvider,
    @Inject(PROJECT_MCP_RECOMMENDATIONS_PROVIDER)
    projectMcpRecommendationsProvider: ProjectMcpRecommendationsProvider,
    @Inject(SKILL_EXACT_DOWNLOAD_SOURCE)
    exactSkillDownloadSource: ExactSkillDownloadSource | null,
    @Inject(SKILL_SPECIFICATION_SOURCE)
    skillSpecificationSource: SkillSpecificationSource | null,
    @Inject(AGENT_DISPATCH_DISPATCHER)
    agentDispatchDispatcher: AgentDispatchOutboxDispatcher | null,
    @Inject(AGENT_CANCELLATION_DISPATCHER)
    agentCancellationDispatcher: AgentCancellationOutboxDispatcher | null,
  ) {
    this.composition = createBffComposition(config, {
      sessionAdmission,
      personalizationProvider,
      personalKnowledgeRepository,
      skillUsageReader,
      skillAiAssociation,
      skillShareRepository,
      publicShareService,
      scheduledTaskReader,
      chatService,
      chatTurnService,
      projectService,
      projectSkillSelectionProvider,
      projectMcpRecommendationsProvider,
      exactSkillDownloadSource,
      skillSpecificationSource,
      agentDispatchDispatcher,
      agentCancellationDispatcher,
    })
  }

  public onModuleInit(): void {
    this.composition.agUiProjector?.start()
    this.composition.scheduledTaskDispatcher?.start()
    this.composition.scheduledAgentDispatcher?.start()
    this.composition.scheduledAgentTerminalConsumer?.start()
    this.composition.projectScopeReleaseDispatcher?.start()
  }

  public async use(request: IncomingMessage, response: ServerResponse): Promise<void> {
    await handleBffRequest(request, response, this.config, this.composition)
  }

  public async close(): Promise<void> {
    await this.composition.stopWorkers()
    await this.composition.close()
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.close()
  }
}
