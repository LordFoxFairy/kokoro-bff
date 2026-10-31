import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { AGENT_DISPATCH_OUTBOX, BFF_DATABASE, CHAT_TURN_SERVICE } from "../../common/tokens.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresAgentDispatchOutboxRepository } from "../../infrastructure/postgres/agent-dispatch-outbox-repository.js"
import { ChatTurnApplicationService } from "../../application/chat-turn-service.js"
import { Sha256StableIdGenerator } from "../../infrastructure/identifiers/scheduled-task-outbox-id.js"

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: AGENT_DISPATCH_OUTBOX,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): PostgresAgentDispatchOutboxRepository => new PostgresAgentDispatchOutboxRepository(database),
    },
    {
      provide: CHAT_TURN_SERVICE,
      inject: [AGENT_DISPATCH_OUTBOX],
      useFactory: (outbox: PostgresAgentDispatchOutboxRepository): ChatTurnApplicationService =>
        new ChatTurnApplicationService(outbox, new Sha256StableIdGenerator()),
    },
  ],
  exports: [AGENT_DISPATCH_OUTBOX, CHAT_TURN_SERVICE],
})
export class AgentDispatchModule {}
