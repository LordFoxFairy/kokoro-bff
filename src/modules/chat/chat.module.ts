import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { BFF_DATABASE, BFF_POOL, CHAT_IDEMPOTENCY, CHAT_SERVICE, CHAT_TURN_SERVICE, PUBLIC_SHARE_SERVICE, SKILL_AI_ASSOCIATION } from "../../common/tokens.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresChatRepository } from "../../infrastructure/postgres/chat-repository.js"
import { PostgresPublicShareRepository } from "../../infrastructure/postgres/public-share-repository.js"
import { ChatApplicationService } from "../../application/chat-service.js"
import { PublicShareApplicationService } from "../../application/public-share-service.js"
import { AccountModule } from "../account/account.module.js"
import { ChatMiddleware } from "./chat.middleware.js"
import { PostgresConversationArtifactLibrary } from "../../infrastructure/postgres/conversation-artifact-library.js"
import type { SkillAiAssociation } from "../../application/skill-ai-handoff.js"
import { AgentDispatchModule } from "../agent-dispatch/agent-dispatch.module.js"
import { AguiModule } from "../agui/agui.module.js"
import { ProjectAccessModule } from "../projects/project-access.module.js"
import { SkillInstallationAccessModule } from "../skills/skill-installation-access.module.js"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import type { Pool } from "pg"

@Module({
  imports: [AccountModule, DatabaseModule, AgentDispatchModule, AguiModule, ProjectAccessModule, SkillInstallationAccessModule],
  providers: [
    ChatMiddleware,
    {
      provide: CHAT_IDEMPOTENCY,
      inject: [BFF_POOL],
      useFactory: (pool: Pool) => new PostgresIdempotencyRepository(pool),
    },
    {
      provide: CHAT_SERVICE,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): ChatApplicationService => new ChatApplicationService(new PostgresChatRepository(database)),
    },
    {
      provide: PUBLIC_SHARE_SERVICE,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): PublicShareApplicationService =>
        new PublicShareApplicationService(new PostgresPublicShareRepository(database)),
    },
    {
      provide: SKILL_AI_ASSOCIATION,
      inject: [BFF_DATABASE],
      useFactory: (
        database: PostgresBffDatabase,
      ): ((tenant: string, subject: string, conversation: string, artifact: string) => Promise<SkillAiAssociation | null>) => {
        const library = new PostgresConversationArtifactLibrary(database)
        return library.findSkillHandoff.bind(library)
      },
    },
  ],
  exports: [CHAT_SERVICE, CHAT_TURN_SERVICE, PUBLIC_SHARE_SERVICE, SKILL_AI_ASSOCIATION],
})
export class ChatModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ChatMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
