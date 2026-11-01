import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { AGENT_CONTROL_IDEMPOTENCY, AGENT_DISPATCH_OUTBOX, AGENT_RUNS_READER, BFF_POOL, CHAT_SERVICE, RUN_DISPLAY_PROVIDER } from "../../common/tokens.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { AgentRunsMiddleware } from "./agent-runs.middleware.js"
import type { SubmittedAgentRunReader } from "../../application/ports/submitted-agent-run-reader.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import { AccountModule } from "../account/account.module.js"
import { ChatModule } from "../chat/chat.module.js"
import { AgentDispatchModule } from "../agent-dispatch/agent-dispatch.module.js"
import { ProjectAccessModule } from "../projects/project-access.module.js"
import { AguiModule } from "../agui/agui.module.js"
import { DatabaseModule } from "../../common/database/database.module.js"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import type { Pool } from "pg"

@Module({
  imports: [IamRelayModule, AccountModule, ChatModule, AgentDispatchModule, ProjectAccessModule, AguiModule, DatabaseModule],
  providers: [
    AgentRunsMiddleware,
    {
      provide: AGENT_CONTROL_IDEMPOTENCY,
      inject: [BFF_POOL],
      useFactory: (pool: Pool) => new PostgresIdempotencyRepository(pool),
    },
    { provide: AGENT_RUNS_READER, useExisting: AGENT_DISPATCH_OUTBOX },
    {
      provide: RUN_DISPLAY_PROVIDER,
      inject: [AGENT_RUNS_READER, CHAT_SERVICE],
      useFactory: (reader: SubmittedAgentRunReader, chat: ChatApplicationService) => ({ submittedAgentRuns: reader, chat }),
    },
  ],
  exports: [IamRelayModule, AGENT_RUNS_READER, RUN_DISPLAY_PROVIDER],
})
export class AgentRunsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AgentRunsMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
