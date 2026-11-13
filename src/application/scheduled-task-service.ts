import type { ScheduledTaskFact, ScheduledTaskMutationSnapshot } from "../domain/scheduled-task/task.js"
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskPatch,
  ScheduledTaskMutationLineage,
  ScheduledTaskUpdateLineage,
  ScheduledTaskOwnerScope,
} from "./scheduled/task-facts.js"

type ScheduledTaskMutationStore = {
  findScheduledTask(scope: ScheduledTaskOwnerScope, taskId: string): Promise<ScheduledTaskFact | null>
  /** Fact mutation and its Scheduler command are committed in one local transaction. */
  createScheduledTask(
    scope: ScheduledTaskOwnerScope,
    input: ScheduledTaskCreateInput,
    requestedTaskId: string | undefined,
    lineage: ScheduledTaskMutationLineage,
  ): Promise<ScheduledTaskMutationSnapshot>
  updateScheduledTask(
    scope: ScheduledTaskOwnerScope,
    taskId: string,
    input: ScheduledTaskPatch,
    lineage: ScheduledTaskUpdateLineage,
  ): Promise<ScheduledTaskMutationSnapshot | null>
  /** Read-only evidence of a committed delete in the same owner/key lineage. */
  hasCommittedDelete(scope: ScheduledTaskOwnerScope, taskId: string, key: string): Promise<boolean>
  deleteScheduledTask(scope: ScheduledTaskOwnerScope, taskId: string, lineage: ScheduledTaskMutationLineage): Promise<boolean>
}

/** Scheduled-task use cases. Fact and outbound command commit together; delivery is asynchronous. */
export class ScheduledTaskService {
  public constructor(private readonly repository: ScheduledTaskMutationStore) {}

  public find(scope: ScheduledTaskOwnerScope, taskId: string): Promise<ScheduledTaskFact | null> {
    return this.repository.findScheduledTask(scope, taskId)
  }
  public create(
    scope: ScheduledTaskOwnerScope,
    input: ScheduledTaskCreateInput,
    requestedTaskId: string | undefined,
    lineage: ScheduledTaskMutationLineage,
  ): Promise<ScheduledTaskMutationSnapshot> {
    return this.repository.createScheduledTask(scope, input, requestedTaskId, lineage)
  }
  public update(
    scope: ScheduledTaskOwnerScope,
    taskId: string,
    input: ScheduledTaskPatch,
    lineage: ScheduledTaskUpdateLineage,
  ): Promise<ScheduledTaskMutationSnapshot | null> {
    return this.repository.updateScheduledTask(scope, taskId, input, lineage)
  }
  public hasCommittedDelete(scope: ScheduledTaskOwnerScope, taskId: string, key: string): Promise<boolean> {
    return this.repository.hasCommittedDelete(scope, taskId, key)
  }
  public delete(scope: ScheduledTaskOwnerScope, taskId: string, lineage: ScheduledTaskMutationLineage): Promise<boolean> {
    return this.repository.deleteScheduledTask(scope, taskId, lineage)
  }
}
