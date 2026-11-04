import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { AGENT_CONTROL_IDEMPOTENCY, AGENT_RUNS_READER, BFF_DATABASE, BFF_POOL, CHAT_SERVICE, RUN_DISPLAY_PROVIDER } from "../../common/tokens.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { AgentRunsMiddleware } from "./agent-runs.middleware.js"
import { createAgentRunsReader, type AgentRunsReader } from "../../infrastructure/postgres/project-execution-binding.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import { AuthenticationModule } from "../authentication/authentication.module.js"
import { ChatModule } from "../chat/chat.module.js"
import { ProjectAccessModule } from "../projects/project-access.module.js"
import { AguiModule } from "../agui/agui.module.js"
import { DatabaseModule } from "../../common/database/database.module.js"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import type { Pool } from "pg"

@Module({
  imports: [IamRelayModule, AuthenticationModule, ChatModule, ProjectAccessModule, AguiModule, DatabaseModule],
  providers: [
    AgentRunsMiddleware,
    {
      provide: AGENT_CONTROL_IDEMPOTENCY,
      inject: [BFF_POOL],
      useFactory: (pool: Pool) => new PostgresIdempotencyRepository(pool),
    },
    { provide: AGENT_RUNS_READER, inject: [BFF_DATABASE], useFactory: createAgentRunsReader },
    {
      provide: RUN_DISPLAY_PROVIDER,
      inject: [AGENT_RUNS_READER, CHAT_SERVICE],
      useFactory: (reader: AgentRunsReader, chat: ChatApplicationService) => ({ submittedAgentRuns: reader, chat }),
    },
  ],
  exports: [IamRelayModule, AGENT_RUNS_READER, RUN_DISPLAY_PROVIDER],
})
export class AgentRunsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AgentRunsMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
