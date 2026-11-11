import { BeforeApplicationShutdown, Inject, Injectable, Module, MiddlewareConsumer, NestModule, OnModuleInit, RequestMethod } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import {
  BFF_CONFIG,
  AGENT_DISPATCH_OUTBOX,
  BFF_DATABASE,
  BFF_POOL,
  SCHEDULER_DISPATCH_RECEIPTS,
  SCHEDULED_TASK_IDEMPOTENCY,
  SCHEDULED_AGENT_DISPATCHER,
  SCHEDULED_AGENT_DISPATCH_REPOSITORY,
  SCHEDULED_TASK_DISPATCHER,
  SCHEDULED_TASK_OUTBOX,
  SCHEDULED_TASK_READ_SERVICE,
  SCHEDULED_TASK_SERVICE,
} from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresScheduledTaskRepository } from "../../infrastructure/postgres/scheduled-task-repository.js"
import { PostgresScheduledTaskExecutionReader } from "../../infrastructure/postgres/scheduled-task-execution-reader.js"
import { SchedulerControlClient } from "../../infrastructure/clients/scheduler/control-client.js"
import { SchedulerTaskStateReader } from "../../infrastructure/clients/scheduler/task-state-reader.js"
import { ScheduledTaskReadService, type ScheduledTaskSnapshots } from "../../application/scheduled-task-read-service.js"
import { ScheduledTaskOutboxDispatcher } from "../../application/scheduled-task-outbox-dispatcher.js"
import { SchedulerOutboxDelivery } from "../../infrastructure/clients/scheduler/outbox-delivery.js"
import type { ScheduledTaskOutboxRepository } from "../../application/scheduled/scheduled-task-outbox-repository.js"
import type { ScheduledAgentDispatchRepository } from "../../application/scheduled/scheduled-agent-dispatch-repository.js"
import { PostgresScheduledAgentDispatchRepository } from "../../infrastructure/postgres/scheduled-agent-dispatch-repository.js"
import { ScheduledAgentDispatcher } from "../../application/scheduled-agent-dispatcher.js"
import { ScheduledChatSubmission } from "../../infrastructure/postgres/scheduled-chat-submission.js"
import { AgentDispatchModule } from "../agent-dispatch/agent-dispatch.module.js"
import type { AgentDispatchOutboxRepository } from "../../application/agent-dispatch/agent-dispatch-outbox-repository.js"
import { AgentRunsModule } from "../agent-runs/agent-runs.module.js"
import { AuthenticationModule } from "../authentication/authentication.module.js"
import { ProjectAccessModule } from "../projects/project-access.module.js"
import { ScheduledTaskReadMiddleware } from "./scheduled-task-read.middleware.js"
import { SchedulerDispatchMiddleware } from "./scheduler-dispatch.middleware.js"
import { ScheduledTaskMutationMiddleware } from "./scheduled-task-mutation.middleware.js"
import { ScheduledTaskService } from "../../application/scheduled-task-service.js"
import { PostgresSchedulerDispatchReceiptRepository } from "../../infrastructure/postgres/scheduler-dispatch-receipt-repository.js"
import type { SchedulerDispatchReceiptRepository } from "../../application/scheduled/scheduler-dispatch-receipt-repository.js"
import type { Pool } from "pg"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { randomUUID } from "node:crypto"
import { SCHEDULED_TASK_CALLBACK_LOOKUP, SCHEDULED_TASK_SNAPSHOTS, type ScheduledTaskCallbackLookup } from "./scheduled-task.providers.js"

function scheduledWorkerLog(event: { operation: string; result: "error"; errorCode: string; attempt: number; backoffMs: number }): void {
  process.stderr.write(`${JSON.stringify({ service: "kokoro-bff", ...event })}\n`)
}

@Injectable()
class ScheduledTaskWorkerLifecycle implements OnModuleInit, BeforeApplicationShutdown {
  public constructor(
    @Inject(SCHEDULED_TASK_DISPATCHER) private readonly dispatcher: ScheduledTaskOutboxDispatcher | null,
    @Inject(SCHEDULED_AGENT_DISPATCHER) private readonly agentDispatcher: ScheduledAgentDispatcher | null,
  ) {}

  public onModuleInit(): void {
    this.dispatcher?.start()
    this.agentDispatcher?.start()
  }

  public async beforeApplicationShutdown(): Promise<void> {
    let failed = false
    try {
      await this.agentDispatcher?.stop()
    } catch {
      failed = true
    }
    try {
      await this.dispatcher?.stop()
    } catch {
      failed = true
    }
    if (failed) {
      process.exitCode = 1
      throw new Error("bff_scheduled_task_shutdown_failed")
    }
  }
}

@Module({
  imports: [AuthenticationModule, ProjectAccessModule, AgentRunsModule, AgentDispatchModule, DatabaseModule],
  providers: [
    ScheduledTaskReadMiddleware,
    {
      provide: PostgresScheduledTaskExecutionReader,
      inject: [BFF_POOL],
      useFactory: (pool: Pool): PostgresScheduledTaskExecutionReader => new PostgresScheduledTaskExecutionReader(pool),
    },
    SchedulerDispatchMiddleware,
    ScheduledTaskMutationMiddleware,
    {
      provide: PostgresScheduledTaskRepository,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): PostgresScheduledTaskRepository => new PostgresScheduledTaskRepository(database),
    },
    {
      provide: SCHEDULED_TASK_SERVICE,
      inject: [PostgresScheduledTaskRepository],
      useFactory: (repository: PostgresScheduledTaskRepository): ScheduledTaskService => new ScheduledTaskService(repository),
    },
    {
      provide: SCHEDULER_DISPATCH_RECEIPTS,
      inject: [BFF_POOL],
      useFactory: (pool: Pool): SchedulerDispatchReceiptRepository => new PostgresSchedulerDispatchReceiptRepository(pool),
    },
    {
      provide: SCHEDULED_TASK_IDEMPOTENCY,
      inject: [BFF_POOL],
      useFactory: (pool: Pool): IdempotencyRepository => new PostgresIdempotencyRepository(pool),
    },
    {
      provide: SCHEDULED_TASK_SNAPSHOTS,
      inject: [PostgresScheduledTaskRepository],
      useFactory: (repository: PostgresScheduledTaskRepository): ScheduledTaskSnapshots => ({
        snapshots: (scope, signal, taskId) => repository.readScheduledTaskSnapshots(scope, signal, taskId),
      }),
    },
    {
      provide: SCHEDULED_TASK_CALLBACK_LOOKUP,
      inject: [PostgresScheduledTaskRepository],
      useFactory: (repository: PostgresScheduledTaskRepository): ScheduledTaskCallbackLookup => ({
        findRecord: (tenantId, taskId) => repository.findScheduledTaskRecord(tenantId, taskId),
      }),
    },
    {
      provide: SCHEDULED_TASK_READ_SERVICE,
      inject: [BFF_CONFIG, SCHEDULED_TASK_SNAPSHOTS],
      useFactory: (config: BffConfig, snapshots: ScheduledTaskSnapshots): ScheduledTaskReadService => {
        const scheduler =
          typeof config.upstreams.scheduler === "string" && config.schedulerServiceToken !== null
            ? new SchedulerControlClient(config.upstreams.scheduler, config.schedulerServiceToken, config.upstreamTimeoutMs, config.upstreamMaxResponseBytes)
            : null
        return new ScheduledTaskReadService(snapshots, new SchedulerTaskStateReader(scheduler, config.schedulerTargetUrl))
      },
    },
    {
      provide: SCHEDULED_TASK_OUTBOX,
      inject: [PostgresScheduledTaskRepository],
      useFactory: (repository: PostgresScheduledTaskRepository): ScheduledTaskOutboxRepository => repository,
    },
    {
      provide: SCHEDULED_TASK_DISPATCHER,
      inject: [SCHEDULED_TASK_OUTBOX, BFF_CONFIG],
      useFactory: (repository: ScheduledTaskOutboxRepository, config: BffConfig): ScheduledTaskOutboxDispatcher =>
        new ScheduledTaskOutboxDispatcher(repository, new SchedulerOutboxDelivery(config), {
          workerId: `bff-scheduled-outbox-${process.pid}-${randomUUID()}`,
        }),
    },
    {
      provide: SCHEDULED_AGENT_DISPATCH_REPOSITORY,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): ScheduledAgentDispatchRepository => new PostgresScheduledAgentDispatchRepository(database),
    },
    {
      provide: SCHEDULED_AGENT_DISPATCHER,
      inject: [SCHEDULED_AGENT_DISPATCH_REPOSITORY, BFF_CONFIG, AGENT_DISPATCH_OUTBOX],
      useFactory: (repository: ScheduledAgentDispatchRepository, config: BffConfig, chat: AgentDispatchOutboxRepository): ScheduledAgentDispatcher | null => {
        const baseUrl = config.upstreams.agents ?? null
        if (!config.agentEnabled || baseUrl === null) return null
        return new ScheduledAgentDispatcher(repository, new ScheduledChatSubmission(chat), {
          workerId: `bff-scheduled-agent-${process.pid}-${randomUUID()}`,
          concurrency: 4,
          settlementReserveMs: 500,
          onError: scheduledWorkerLog,
        })
      },
    },
    ScheduledTaskWorkerLifecycle,
  ],
  exports: [
    SCHEDULED_TASK_READ_SERVICE,
    SCHEDULED_TASK_SERVICE,
    SCHEDULER_DISPATCH_RECEIPTS,
    SCHEDULED_TASK_OUTBOX,
    SCHEDULED_TASK_DISPATCHER,
    SCHEDULED_AGENT_DISPATCH_REPOSITORY,
    SCHEDULED_AGENT_DISPATCHER,
  ],
})
export class ScheduledTasksModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ScheduledTaskMutationMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(SchedulerDispatchMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(ScheduledTaskReadMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
