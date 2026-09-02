import type { ProjectRepository } from "../modules/projects/repository.js"
import type { ScheduledTaskRepository } from "../modules/scheduled/repository.js"
import { ProjectService } from "./project-service.js"
import { ScheduledTaskService } from "./scheduled-task-service.js"

/** Application-service composition for the live BFF business surface. */
export class BffApplicationServices {
  public readonly projects: ProjectService
  public readonly scheduledTasks: ScheduledTaskService

  public constructor(projects: ProjectRepository, scheduledTasks: ScheduledTaskRepository) {
    this.projects = new ProjectService(projects)
    this.scheduledTasks = new ScheduledTaskService(scheduledTasks)
  }
}
