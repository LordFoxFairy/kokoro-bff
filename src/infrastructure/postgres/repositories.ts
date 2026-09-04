import { PostgresBffDatabase } from "./client.js"
import { PostgresIdempotencyRepository } from "./idempotency-repository.js"
import { PostgresProjectRepository } from "./project-repository.js"
import { PostgresScheduledTaskRepository } from "./scheduled-task-repository.js"
import { PostgresChatRepository } from "./chat-repository.js"
import { PENDING_RECEIPT_STATUS, type PersistentReceipt, type ReceiptClaim } from "../../application/ports/idempotency-repository.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import type { ProjectRepository } from "../../application/ports/project-repository.js"
import type { ScheduledTaskRepository } from "../../application/ports/scheduled-task-repository.js"
import type { ScheduledTaskOutboxRepository } from "../../application/ports/scheduled-task-outbox-repository.js"
import { BffApplicationServices } from "../../application/services.js"
import { AgUiProjectionService } from "../../application/agui/project-session-events.js"
import { PostgresAgUiProjectionRepository } from "./agui-projection-repository.js"
import { PostgresAgUiConsumerRepository } from "./agui-consumer-repository.js"
import type { AgUiProjectionConsumerRepository } from "../../application/agui/ports/agui-projection-repository.js"

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
  public readonly agUiConsumers: AgUiProjectionConsumerRepository
  public readonly scheduledTaskOutbox: ScheduledTaskOutboxRepository

  public constructor(postgresUrl: string, redisUrl: string) {
    this.database = new PostgresBffDatabase(postgresUrl, redisUrl)
    this.idempotency = new PostgresIdempotencyRepository(this.database.pool)
    this.projects = new PostgresProjectRepository(this.database)
    const scheduled = new PostgresScheduledTaskRepository(this.database)
    const chat = new PostgresChatRepository(this.database)
    this.scheduled = scheduled
    this.scheduledTaskOutbox = scheduled
    this.services = new BffApplicationServices(this.projects, this.scheduled, chat)
    this.agUi = new AgUiProjectionService(new PostgresAgUiProjectionRepository(this.database))
    this.agUiConsumers = new PostgresAgUiConsumerRepository(this.database)
  }

  public ready(): Promise<void> { return this.database.ready() }
  public close(): Promise<void> { return this.database.close() }

  public getReceipt(scope: string): Promise<PersistentReceipt | null> { return this.idempotency.getReceipt(scope) }
  public claimReceipt(scope: string, fingerprint: string): Promise<ReceiptClaim> { return this.idempotency.claimReceipt(scope, fingerprint) }
  public putReceipt(scope: string, receipt: PersistentReceipt): Promise<void> { return this.idempotency.putReceipt(scope, receipt) }
  public releaseReceipt(scope: string, fingerprint: string): Promise<void> { return this.idempotency.releaseReceipt(scope, fingerprint) }

}
