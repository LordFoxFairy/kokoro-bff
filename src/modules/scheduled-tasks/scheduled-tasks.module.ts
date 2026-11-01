import { Inject, Injectable, Module, MiddlewareConsumer, NestModule, OnApplicationShutdown, OnModuleInit, RequestMethod } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import {
  BFF_CONFIG,
  BFF_DATABASE,
  BFF_POOL,
  SCHEDULER_DISPATCH_RECEIPTS,
  SCHEDULED_TASK_IDEMPOTENCY,
  SCHEDULED_AGENT_DISPATCHER,
  SCHEDULED_AGENT_DISPATCH_REPOSITORY,
  SCHEDULED_AGENT_TERMINAL_CONSUMER,
  SCHEDULED_TASK_DISPATCHER,
  SCHEDULED_TASK_OUTBOX,
  SCHEDULED_TASK_REPOSITORY,
  SCHEDULED_TASK_READ_SERVICE,
  SCHEDULED_TASK_SERVICE,
} from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresScheduledTaskRepository } from "../../infrastructure/postgres/scheduled-task-repository.js"
import { SchedulerControlClient } from "../../infrastructure/clients/scheduler/control-client.js"
import { SchedulerTaskStateReader } from "../../infrastructure/clients/scheduler/task-state-reader.js"
import { ScheduledTaskReadService } from "../../application/scheduled-task-read-service.js"
import { ScheduledTaskOutboxDispatcher } from "../../application/scheduled-task-outbox-dispatcher.js"
import { SchedulerOutboxDelivery } from "../../infrastructure/clients/scheduler/outbox-delivery.js"
import type { ScheduledTaskOutboxRepository } from "../../application/ports/scheduled-task-outbox-repository.js"
import type { ScheduledAgentDispatchRepository } from "../../application/ports/scheduled-agent-dispatch-repository.js"
import { PostgresScheduledAgentDispatchRepository } from "../../infrastructure/postgres/scheduled-agent-dispatch-repository.js"
import { ScheduledAgentDispatcher } from "../../application/scheduled-agent-dispatcher.js"
import { ScheduledAgentTerminalConsumer } from "../../application/scheduled-agent-terminal-consumer.js"
import { ScheduledAgentDispatchDelivery } from "../../infrastructure/clients/agent/scheduled-dispatch-delivery.js"
import { ScheduledAgentTerminalSource } from "../../infrastructure/clients/agent/scheduled-terminal-source.js"
import { AgentRunsModule } from "../agent-runs/agent-runs.module.js"
import { AccountModule } from "../account/account.module.js"
import { ProjectsModule } from "../projects/projects.module.js"
import { ScheduledTaskReadMiddleware } from "./scheduled-task-read.middleware.js"
import { SchedulerDispatchMiddleware } from "./scheduler-dispatch.middleware.js"
import { ScheduledTaskMutationMiddleware } from "./scheduled-task-mutation.middleware.js"
import { ScheduledTaskService } from "../../application/scheduled-task-service.js"
import { PostgresSchedulerDispatchReceiptRepository } from "../../infrastructure/postgres/scheduler-dispatch-receipt-repository.js"
import type { SchedulerDispatchReceiptRepository } from "../../application/ports/scheduler-dispatch-receipt-repository.js"
import type { Pool } from "pg"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { randomUUID } from "node:crypto"

function scheduledWorkerLog(event: { operation: string; result: "error"; errorCode: string; attempt: number; backoffMs: number }): void {
  process.stderr.write(`${JSON.stringify({ service: "kokoro-bff", ...event })}\n`)
}

@Injectable()
class ScheduledTaskWorkerLifecycle implements OnModuleInit, OnApplicationShutdown {
  public constructor(
    @Inject(SCHEDULED_TASK_DISPATCHER) private readonly dispatcher: ScheduledTaskOutboxDispatcher | null,
    @Inject(SCHEDULED_AGENT_DISPATCHER) private readonly agentDispatcher: ScheduledAgentDispatcher | null,
    @Inject(SCHEDULED_AGENT_TERMINAL_CONSUMER) private readonly terminalConsumer: ScheduledAgentTerminalConsumer | null,
  ) {}

  public onModuleInit(): void {
    this.dispatcher?.start()
    this.agentDispatcher?.start()
    this.terminalConsumer?.start()
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.terminalConsumer?.stop()
    await this.agentDispatcher?.stop()
    await this.dispatcher?.stop()
  }
}

@Module({
  imports: [AccountModule, ProjectsModule, AgentRunsModule, DatabaseModule],
  providers: [
    ScheduledTaskReadMiddleware,
    SchedulerDispatchMiddleware,
    ScheduledTaskMutationMiddleware,
    {
      provide: SCHEDULED_TASK_REPOSITORY,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): PostgresScheduledTaskRepository => new PostgresScheduledTaskRepository(database),
    },
    {
      provide: SCHEDULED_TASK_SERVICE,
      inject: [SCHEDULED_TASK_REPOSITORY],
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
      provide: SCHEDULED_TASK_READ_SERVICE,
      inject: [BFF_CONFIG, SCHEDULED_TASK_REPOSITORY],
      useFactory: (config: BffConfig, repository: PostgresScheduledTaskRepository): ScheduledTaskReadService => {
        const scheduler =
          typeof config.upstreams.scheduler === "string" && config.schedulerServiceToken !== null
            ? new SchedulerControlClient(config.upstreams.scheduler, config.schedulerServiceToken, config.upstreamTimeoutMs, config.upstreamMaxResponseBytes)
            : null
        return new ScheduledTaskReadService(
          { snapshots: (scope, signal, taskId) => repository.readScheduledTaskSnapshots(scope, signal, taskId) },
          new SchedulerTaskStateReader(scheduler, config.schedulerTargetUrl),
        )
      },
    },
    {
      provide: SCHEDULED_TASK_OUTBOX,
      inject: [SCHEDULED_TASK_REPOSITORY],
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
      inject: [SCHEDULED_AGENT_DISPATCH_REPOSITORY, BFF_CONFIG],
      useFactory: (repository: ScheduledAgentDispatchRepository, config: BffConfig): ScheduledAgentDispatcher | null => {
        const baseUrl = config.upstreams.agents ?? null
        if (!config.agentEnabled || baseUrl === null) return null
        return new ScheduledAgentDispatcher(repository, new ScheduledAgentDispatchDelivery(config), {
          workerId: `bff-scheduled-agent-${process.pid}-${randomUUID()}`,
          concurrency: 4,
          settlementReserveMs: 500,
          onError: scheduledWorkerLog,
        })
      },
    },
    {
      provide: SCHEDULED_AGENT_TERMINAL_CONSUMER,
      inject: [SCHEDULED_AGENT_DISPATCH_REPOSITORY, BFF_CONFIG],
      useFactory: (repository: ScheduledAgentDispatchRepository, config: BffConfig): ScheduledAgentTerminalConsumer | null => {
        const baseUrl = config.upstreams.agents ?? null
        if (!config.agentEnabled || baseUrl === null) return null
        return new ScheduledAgentTerminalConsumer(repository, new ScheduledAgentTerminalSource(config, baseUrl), {
          workerId: `bff-scheduled-terminal-${process.pid}-${randomUUID()}`,
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
    SCHEDULED_TASK_REPOSITORY,
    SCHEDULED_TASK_SERVICE,
    SCHEDULER_DISPATCH_RECEIPTS,
    SCHEDULED_TASK_OUTBOX,
    SCHEDULED_TASK_DISPATCHER,
    SCHEDULED_AGENT_DISPATCH_REPOSITORY,
    SCHEDULED_AGENT_DISPATCHER,
    SCHEDULED_AGENT_TERMINAL_CONSUMER,
  ],
})
export class ScheduledTasksModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ScheduledTaskMutationMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(SchedulerDispatchMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(ScheduledTaskReadMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
