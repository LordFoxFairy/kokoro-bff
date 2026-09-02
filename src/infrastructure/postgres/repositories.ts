import { PostgresBffDatabase } from "./client.js"
import { PostgresIdempotencyRepository, PENDING_RECEIPT_STATUS, type PersistentReceipt, type ReceiptClaim } from "../../modules/idempotency/repository.js"
import { PostgresProjectRepository } from "../../modules/projects/repository.js"
import { PostgresScheduledTaskRepository, type ScheduledTaskRecord } from "../../modules/scheduled/repository.js"

export { PENDING_RECEIPT_STATUS }
export type { PersistentReceipt, ReceiptClaim } from "../../modules/idempotency/repository.js"
export type { ScheduledTaskRecord } from "../../modules/scheduled/repository.js"

export class PostgresBffRepositories {
  private readonly database: PostgresBffDatabase
  private readonly idempotency: PostgresIdempotencyRepository
  private readonly projects: PostgresProjectRepository
  private readonly scheduled: PostgresScheduledTaskRepository

  public constructor(postgresUrl: string, redisUrl: string) {
    this.database = new PostgresBffDatabase(postgresUrl, redisUrl)
    this.idempotency = new PostgresIdempotencyRepository(this.database.pool)
    this.projects = new PostgresProjectRepository(this.database)
    this.scheduled = new PostgresScheduledTaskRepository(this.database, this.projects)
  }

  public ready(): Promise<void> { return this.database.ready() }
  public close(): Promise<void> { return this.database.close() }

  public getReceipt(scope: string): Promise<PersistentReceipt | null> { return this.idempotency.getReceipt(scope) }
  public claimReceipt(scope: string, fingerprint: string): Promise<ReceiptClaim> { return this.idempotency.claimReceipt(scope, fingerprint) }
  public putReceipt(scope: string, receipt: PersistentReceipt): Promise<void> { return this.idempotency.putReceipt(scope, receipt) }
  public releaseReceipt(scope: string, fingerprint: string): Promise<void> { return this.idempotency.releaseReceipt(scope, fingerprint) }

  public listProjects(tenantId: string) { return this.projects.listProjects(tenantId) }
  public findProject(tenantId: string, idOrSlug: string) { return this.projects.findProject(tenantId, idOrSlug) }
  public createProject(tenantId: string, name: string, description: string) { return this.projects.createProject(tenantId, name, description) }
  public updateProjectInstruction(tenantId: string, idOrSlug: string, instruction: string, actorId: string) { return this.projects.updateProjectInstruction(tenantId, idOrSlug, instruction, actorId) }
  public instructionRevisions(tenantId: string, idOrSlug: string) { return this.projects.instructionRevisions(tenantId, idOrSlug) }
  public setProjectSkill(tenantId: string, projectId: string, skillName: string, enabled: boolean) { return this.projects.setProjectSkill(tenantId, projectId, skillName, enabled) }
  public listTasks(tenantId: string, projectId: string) { return this.projects.listTasks(tenantId, projectId) }

  public listScheduledTasks(tenantId: string) { return this.scheduled.listScheduledTasks(tenantId) }
  public listScheduledTaskRecords() { return this.scheduled.listScheduledTaskRecords() }
  public findScheduledTask(tenantId: string, taskId: string) { return this.scheduled.findScheduledTask(tenantId, taskId) }
  public findScheduledTaskRecord(tenantId: string, taskId: string) { return this.scheduled.findScheduledTaskRecord(tenantId, taskId) }
  public createScheduledTask(...args: Parameters<PostgresScheduledTaskRepository["createScheduledTask"]>) { return this.scheduled.createScheduledTask(...args) }
  public updateScheduledTask(...args: Parameters<PostgresScheduledTaskRepository["updateScheduledTask"]>) { return this.scheduled.updateScheduledTask(...args) }
  public deleteScheduledTask(...args: Parameters<PostgresScheduledTaskRepository["deleteScheduledTask"]>) { return this.scheduled.deleteScheduledTask(...args) }
}
