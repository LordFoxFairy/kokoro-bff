import { PostgresBffDatabase } from "./client.js"
import { PostgresIdempotencyRepository } from "./idempotency-repository.js"
import { PostgresProjectRepository } from "./project-repository.js"
import { PostgresScheduledTaskRepository } from "./scheduled-task-repository.js"
import { PENDING_RECEIPT_STATUS, type PersistentReceipt, type ReceiptClaim } from "../../application/ports/idempotency-repository.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import type { ProjectRepository } from "../../application/ports/project-repository.js"
import type { ScheduledTaskRecord, ScheduledTaskRepository } from "../../application/ports/scheduled-task-repository.js"
import { BffApplicationServices } from "../../application/services.js"
import { AgUiProjectionService } from "../../application/agui/project-session-events.js"
import { PostgresAgUiProjectionRepository } from "./agui-projection-repository.js"

export { PENDING_RECEIPT_STATUS }
export type { PersistentReceipt, ReceiptClaim } from "../../application/ports/idempotency-repository.js"
export type { ScheduledTaskRecord } from "../../application/ports/scheduled-task-repository.js"

export class PostgresBffRepositories {
  private readonly database: PostgresBffDatabase
  private readonly idempotency: IdempotencyRepository
  private readonly projects: ProjectRepository
  private readonly scheduled: ScheduledTaskRepository
  public readonly services: BffApplicationServices
  public readonly agUi: AgUiProjectionService

  public constructor(postgresUrl: string, redisUrl: string) {
    this.database = new PostgresBffDatabase(postgresUrl, redisUrl)
    this.idempotency = new PostgresIdempotencyRepository(this.database.pool)
    this.projects = new PostgresProjectRepository(this.database)
    this.scheduled = new PostgresScheduledTaskRepository(this.database, this.projects)
    this.services = new BffApplicationServices(this.projects, this.scheduled)
    this.agUi = new AgUiProjectionService(new PostgresAgUiProjectionRepository(this.database))
  }

  public ready(): Promise<void> { return this.database.ready() }
  public close(): Promise<void> { return this.database.close() }

  public getReceipt(scope: string): Promise<PersistentReceipt | null> { return this.idempotency.getReceipt(scope) }
  public claimReceipt(scope: string, fingerprint: string): Promise<ReceiptClaim> { return this.idempotency.claimReceipt(scope, fingerprint) }
  public putReceipt(scope: string, receipt: PersistentReceipt): Promise<void> { return this.idempotency.putReceipt(scope, receipt) }
  public releaseReceipt(scope: string, fingerprint: string): Promise<void> { return this.idempotency.releaseReceipt(scope, fingerprint) }

}
