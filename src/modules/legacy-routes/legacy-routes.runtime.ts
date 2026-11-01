import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import { BFF_CONFIG, PERSONAL_KNOWLEDGE_REPOSITORY, SESSION_ADMISSION, SKILL_USAGE_READER } from "../../common/tokens.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { createBffComposition, type BffServerComposition } from "../../bootstrap/runtime.js"
import { handleBffRequest } from "../../bootstrap/server.js"
import { PERSONALIZATION_PROVIDER, type PersonalizationProvider } from "../account/personalization.provider.js"
import type { PersonalKnowledgeRepository } from "../../application/ports/personal-knowledge-repository.js"
import type { SkillUsageReader } from "../../application/agui/skill-usage.js"

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
  ) {
    this.composition = createBffComposition(config, {
      sessionAdmission,
      personalizationProvider,
      personalKnowledgeRepository,
      skillUsageReader,
    })
  }

  public onModuleInit(): void {
    this.composition.agUiProjector?.start()
    this.composition.scheduledTaskDispatcher?.start()
    this.composition.agentDispatchDispatcher?.start()
    this.composition.scheduledAgentDispatcher?.start()
    this.composition.scheduledAgentTerminalConsumer?.start()
    this.composition.agentCancellationDispatcher?.start()
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
