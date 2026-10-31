import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { BFF_DATABASE, CHAT_SERVICE } from "../../common/tokens.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresChatRepository } from "../../infrastructure/postgres/chat-repository.js"
import { ChatApplicationService } from "../../application/chat-service.js"
import { AccountModule } from "../account/account.module.js"
import { AgentRunsModule } from "../agent-runs/agent-runs.module.js"
import { ChatMiddleware } from "./chat.middleware.js"

@Module({
  imports: [AccountModule, DatabaseModule, AgentRunsModule],
  providers: [
    ChatMiddleware,
    {
      provide: CHAT_SERVICE,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): ChatApplicationService => new ChatApplicationService(new PostgresChatRepository(database)),
    },
  ],
  exports: [CHAT_SERVICE],
})
export class ChatModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ChatMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
