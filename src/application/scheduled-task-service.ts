import type { ScheduledTask } from "../contracts/index.js"
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskPatch,
  ScheduledTaskRecord,
  ScheduledTaskRepository,
} from "../modules/scheduled/repository.js"

/** Scheduled-task use cases. Scheduler registration remains an explicit adapter boundary. */
export class ScheduledTaskService {
  public constructor(private readonly repository: ScheduledTaskRepository) {}

  public list(tenantId: string): Promise<ScheduledTask[]> { return this.repository.listScheduledTasks(tenantId) }
  public listRecords(): Promise<Array<ScheduledTaskRecord & { tenantId: string }>> { return this.repository.listScheduledTaskRecords() }
  public find(tenantId: string, taskId: string): Promise<ScheduledTask | null> { return this.repository.findScheduledTask(tenantId, taskId) }
  public findRecord(tenantId: string, taskId: string): Promise<ScheduledTaskRecord | null> {
    return this.repository.findScheduledTaskRecord(tenantId, taskId)
  }
  public create(tenantId: string, ownerId: string, input: ScheduledTaskCreateInput, requestedTaskId?: string): Promise<ScheduledTask> {
    return this.repository.createScheduledTask(tenantId, ownerId, input, requestedTaskId)
  }
  public update(tenantId: string, taskId: string, input: ScheduledTaskPatch): Promise<ScheduledTask | null> {
    return this.repository.updateScheduledTask(tenantId, taskId, input)
  }
  public delete(tenantId: string, taskId: string): Promise<boolean> { return this.repository.deleteScheduledTask(tenantId, taskId) }
}
