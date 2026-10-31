import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { BFF_CONFIG, BFF_DATABASE, SCHEDULED_TASK_READ_SERVICE } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresScheduledTaskRepository } from "../../infrastructure/postgres/scheduled-task-repository.js"
import { SchedulerControlClient } from "../../infrastructure/clients/scheduler/control-client.js"
import { SchedulerTaskStateReader } from "../../infrastructure/clients/scheduler/task-state-reader.js"
import { ScheduledTaskReadService } from "../../application/scheduled-task-read-service.js"
import { AgentRunsModule } from "../agent-runs/agent-runs.module.js"
import { AccountModule } from "../account/account.module.js"
import { ProjectsModule } from "../projects/projects.module.js"
import { ScheduledTaskReadMiddleware } from "./scheduled-task-read.middleware.js"

@Module({
  imports: [AccountModule, ProjectsModule, AgentRunsModule, DatabaseModule],
  providers: [
    ScheduledTaskReadMiddleware,
    {
      provide: SCHEDULED_TASK_READ_SERVICE,
      inject: [BFF_CONFIG, BFF_DATABASE],
      useFactory: (config: BffConfig, database: PostgresBffDatabase): ScheduledTaskReadService => {
        const repository = new PostgresScheduledTaskRepository(database)
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
  ],
  exports: [SCHEDULED_TASK_READ_SERVICE],
})
export class ScheduledTasksModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ScheduledTaskReadMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
