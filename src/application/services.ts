import type { PersonalKnowledgeRepository } from "./ports/personal-knowledge-repository.js"
import type { SkillAiAssociation } from "./skill-ai-handoff.js"
import type { SkillShareRepository } from "./ports/skill-share-repository.js"
import type { SkillUsageResult } from "./agui/skill-usage.js"
import type { PersonalizationRepository } from "./ports/personalization-repository.js"
import type { ProjectRepository } from "./ports/project-repository.js"
import type { ScheduledTaskRepository } from "./ports/scheduled-task-repository.js"
import type { ChatRepository } from "./ports/chat-repository.js"
import type { AgentDispatchOutboxRepository } from "./ports/agent-dispatch-outbox-repository.js"
import type { StableIdGenerator } from "./ports/stable-id-generator.js"
import type { PublicShareRepository } from "./ports/public-share-repository.js"
import { ChatApplicationService } from "./chat-service.js"
import { ChatTurnApplicationService } from "./chat-turn-service.js"
import { ProjectService } from "./project-service.js"
import { ScheduledTaskService } from "./scheduled-task-service.js"
import { PublicShareApplicationService } from "./public-share-service.js"

/** Application-service composition for the live BFF business surface. */
export class BffApplicationServices {
  public readonly projects: ProjectService
  public readonly scheduledTasks: ScheduledTaskService
  public readonly chat: ChatApplicationService
  public readonly chatTurns: ChatTurnApplicationService
  public readonly publicShares: PublicShareApplicationService

  public constructor(
    projects: ProjectRepository,
    scheduledTasks: ScheduledTaskRepository,
    chat: ChatRepository,
    publicShares: PublicShareRepository,
    agentDispatchOutbox: AgentDispatchOutboxRepository,
    stableIdGenerator: StableIdGenerator,
    public readonly personalization: PersonalizationRepository,
    public readonly skillShares?: SkillShareRepository,
    public readonly skillUsage?: (tenant: string, refs: readonly string[]) => Promise<Map<string, SkillUsageResult>>,
    public readonly skillAiAssociation?: (tenant: string, subject: string, conversation: string, artifact: string) => Promise<SkillAiAssociation | null>,
    public readonly personalKnowledge?: PersonalKnowledgeRepository,
  ) {
    this.projects = new ProjectService(projects)
    this.scheduledTasks = new ScheduledTaskService(scheduledTasks)
    this.chat = new ChatApplicationService(chat)
    this.publicShares = new PublicShareApplicationService(publicShares)
    this.chatTurns = new ChatTurnApplicationService(agentDispatchOutbox, stableIdGenerator)
  }
}
