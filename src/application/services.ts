import type { ProjectRepository } from "./ports/project-repository.js"
import type { ScheduledTaskRepository } from "./ports/scheduled-task-repository.js"
import type { ChatRepository } from "./ports/chat-repository.js"
import type { AgentDispatchOutboxRepository } from "./ports/agent-dispatch-outbox-repository.js"
import type { StableIdGenerator } from "./ports/stable-id-generator.js"
import { ChatApplicationService } from "./chat-service.js"
import { ChatTurnApplicationService } from "./chat-turn-service.js"
import { ProjectService } from "./project-service.js"
import { ScheduledTaskService } from "./scheduled-task-service.js"

/** Application-service composition for the live BFF business surface. */
export class BffApplicationServices {
  public readonly projects: ProjectService
  public readonly scheduledTasks: ScheduledTaskService
  public readonly chat: ChatApplicationService
  public readonly chatTurns: ChatTurnApplicationService

  public constructor(
    projects: ProjectRepository,
    scheduledTasks: ScheduledTaskRepository,
    chat: ChatRepository,
    agentDispatchOutbox: AgentDispatchOutboxRepository,
    stableIdGenerator: StableIdGenerator,
  ) {
    this.projects = new ProjectService(projects)
    this.scheduledTasks = new ScheduledTaskService(scheduledTasks)
    this.chat = new ChatApplicationService(chat)
    this.chatTurns = new ChatTurnApplicationService(agentDispatchOutbox, stableIdGenerator)
  }
}
