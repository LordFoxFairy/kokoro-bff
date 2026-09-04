import type { ScheduledTaskFact } from "../domain/scheduled-task/task.js"
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskPatch,
  ScheduledTaskMutationLineage,
  ScheduledTaskRecord,
  ScheduledTaskRepository,
} from "./ports/scheduled-task-repository.js"

/** Scheduled-task use cases. Fact and outbound command commit together; delivery is asynchronous. */
export class ScheduledTaskService {
  public constructor(private readonly repository: ScheduledTaskRepository) {}

  public list(tenantId: string): Promise<ScheduledTaskFact[]> { return this.repository.listScheduledTasks(tenantId) }
  public find(tenantId: string, taskId: string): Promise<ScheduledTaskFact | null> { return this.repository.findScheduledTask(tenantId, taskId) }
  public findRecord(tenantId: string, taskId: string): Promise<ScheduledTaskRecord | null> {
    return this.repository.findScheduledTaskRecord(tenantId, taskId)
  }
  public create(tenantId: string, ownerId: string, input: ScheduledTaskCreateInput, requestedTaskId: string | undefined, lineage: ScheduledTaskMutationLineage): Promise<ScheduledTaskFact> {
    return this.repository.createScheduledTask(tenantId, ownerId, input, requestedTaskId, lineage)
  }
  public update(tenantId: string, taskId: string, input: ScheduledTaskPatch, lineage: ScheduledTaskMutationLineage): Promise<ScheduledTaskFact | null> {
    return this.repository.updateScheduledTask(tenantId, taskId, input, lineage)
  }
  public delete(tenantId: string, taskId: string, lineage: ScheduledTaskMutationLineage): Promise<boolean> {
    return this.repository.deleteScheduledTask(tenantId, taskId, lineage)
  }
}
