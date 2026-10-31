import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { AGENT_RUNS_READER, BFF_DATABASE } from "../../common/tokens.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresAgentDispatchOutboxRepository } from "../../infrastructure/postgres/agent-dispatch-outbox-repository.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { AgentRunsMiddleware } from "./agent-runs.middleware.js"

@Module({
  imports: [IamRelayModule, DatabaseModule],
  providers: [
    AgentRunsMiddleware,
    {
      provide: AGENT_RUNS_READER,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): PostgresAgentDispatchOutboxRepository => new PostgresAgentDispatchOutboxRepository(database),
    },
  ],
  exports: [IamRelayModule, AGENT_RUNS_READER],
})
export class AgentRunsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AgentRunsMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
