import type { ProjectRepository } from "./ports/project-repository.js"
import type { ScheduledTaskRepository } from "./ports/scheduled-task-repository.js"
import type { ChatRepository } from "./ports/chat-repository.js"
import { ChatApplicationService } from "./chat-service.js"
import { ProjectService } from "./project-service.js"
import { ScheduledTaskService } from "./scheduled-task-service.js"

/** Application-service composition for the live BFF business surface. */
export class BffApplicationServices {
  public readonly projects: ProjectService
  public readonly scheduledTasks: ScheduledTaskService
  public readonly chat: ChatApplicationService

  public constructor(projects: ProjectRepository, scheduledTasks: ScheduledTaskRepository, chat: ChatRepository) {
    this.projects = new ProjectService(projects)
    this.scheduledTasks = new ScheduledTaskService(scheduledTasks)
    this.chat = new ChatApplicationService(chat)
  }
}
