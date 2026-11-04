import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import {
  BFF_DATABASE,
  BFF_POOL,
  CHAT_CONVERSATION_LOOKUP,
  CHAT_IDEMPOTENCY,
  CHAT_SESSION_READS,
  CHAT_SESSION_MUTATIONS,
  CHAT_ARCHIVE,
  CHAT_SHARED_TASKS,
  CHAT_MESSAGE_FEEDBACK,
  CHAT_MOVE,
  PUBLIC_SHARE_SERVICE,
  SKILL_AI_ASSOCIATION,
} from "../../common/tokens.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { createChatConversationLookup } from "../../infrastructure/postgres/chat-conversation-lookup.js"
import { PostgresChatSessionStore, createChatSessionMutations } from "../../infrastructure/postgres/chat-session-store.js"
import { createChatArchive } from "../../infrastructure/postgres/archived-tasks.js"
import { createSharedTasksReader } from "../../infrastructure/postgres/shared-tasks.js"
import { createMessageFeedback } from "../../infrastructure/postgres/message-feedback.js"
import { moveConversation } from "../../infrastructure/postgres/conversation-move.js"
import { createChatMove } from "../../application/chat/move-conversation.js"
import { PostgresPublicShareRepository } from "../../infrastructure/postgres/public-share-repository.js"
import { createChatSessionReads } from "../../application/chat/session-reads.js"
import { PublicShareApplicationService } from "../../application/public-share-service.js"
import { AuthenticationModule } from "../authentication/authentication.module.js"
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
  imports: [AuthenticationModule, DatabaseModule, AgentDispatchModule, AguiModule, ProjectAccessModule, SkillInstallationAccessModule],
  providers: [
    ChatMiddleware,
    {
      provide: CHAT_IDEMPOTENCY,
      inject: [BFF_POOL],
      useFactory: (pool: Pool) => new PostgresIdempotencyRepository(pool),
    },
    { provide: CHAT_CONVERSATION_LOOKUP, inject: [BFF_POOL], useFactory: createChatConversationLookup },
    {
      provide: PostgresChatSessionStore,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase) => new PostgresChatSessionStore(database),
    },
    { provide: CHAT_SESSION_READS, inject: [PostgresChatSessionStore], useFactory: createChatSessionReads },
    { provide: CHAT_SESSION_MUTATIONS, inject: [PostgresChatSessionStore], useFactory: createChatSessionMutations },
    { provide: CHAT_ARCHIVE, inject: [BFF_POOL], useFactory: createChatArchive },
    { provide: CHAT_SHARED_TASKS, inject: [BFF_POOL], useFactory: createSharedTasksReader },
    { provide: CHAT_MESSAGE_FEEDBACK, inject: [BFF_DATABASE], useFactory: createMessageFeedback },
    {
      provide: CHAT_MOVE,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase) => createChatMove(moveConversation.bind(null, database)),
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
  exports: [CHAT_CONVERSATION_LOOKUP, PUBLIC_SHARE_SERVICE, SKILL_AI_ASSOCIATION],
})
export class ChatModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ChatMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
