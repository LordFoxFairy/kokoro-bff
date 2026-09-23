import type { ScheduledTaskFact } from "../domain/scheduled-task/task.js"
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskPatch,
  ScheduledTaskMutationLineage,
  ScheduledTaskOwnerScope,
  ScheduledTaskRecord,
  ScheduledTaskRepository,
} from "./ports/scheduled-task-repository.js"

/** Scheduled-task use cases. Fact and outbound command commit together; delivery is asynchronous. */
export class ScheduledTaskService {
  public constructor(private readonly repository: ScheduledTaskRepository) {}

  public list(scope: ScheduledTaskOwnerScope): Promise<ScheduledTaskFact[]> { return this.repository.listScheduledTasks(scope) }
  public find(scope: ScheduledTaskOwnerScope, taskId: string): Promise<ScheduledTaskFact | null> {
    return this.repository.findScheduledTask(scope, taskId)
  }
  public findRecord(tenantId: string, taskId: string): Promise<ScheduledTaskRecord | null> {
    return this.repository.findScheduledTaskRecord(tenantId, taskId)
  }
  public create(scope: ScheduledTaskOwnerScope, input: ScheduledTaskCreateInput, requestedTaskId: string | undefined, lineage: ScheduledTaskMutationLineage): Promise<ScheduledTaskFact> {
    return this.repository.createScheduledTask(scope, input, requestedTaskId, lineage)
  }
  public update(scope: ScheduledTaskOwnerScope, taskId: string, input: ScheduledTaskPatch, lineage: ScheduledTaskMutationLineage): Promise<ScheduledTaskFact | null> {
    return this.repository.updateScheduledTask(scope, taskId, input, lineage)
  }
  public delete(scope: ScheduledTaskOwnerScope, taskId: string, lineage: ScheduledTaskMutationLineage): Promise<boolean> {
    return this.repository.deleteScheduledTask(scope, taskId, lineage)
  }
}
