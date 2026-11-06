import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { ACCOUNT_IDEMPOTENCY, BFF_DATABASE, BFF_POOL, LIBRARY_ARTIFACT_REPOSITORY, PERSONAL_KNOWLEDGE_REPOSITORY } from "../../common/tokens.js"
import { AuthenticationModule } from "../authentication/authentication.module.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresPersonalizationRepository } from "../../infrastructure/postgres/personalization-repository.js"
import { PERSONALIZATION_PROVIDER } from "./personalization.provider.js"
import { AccountMiddleware } from "./account.middleware.js"
import { PostgresPersonalKnowledgeRepository } from "../../infrastructure/postgres/personal-knowledge-repository.js"
import { PostgresConversationArtifactLibrary } from "../../infrastructure/postgres/conversation-artifact-library.js"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import type { ArtifactLibraryRepository } from "../../application/account/artifact-library-repository.js"
import { LibraryMiddleware } from "./library.middleware.js"
import type { Pool } from "pg"

@Module({
  imports: [AuthenticationModule, IamRelayModule, DatabaseModule],
  providers: [
    AccountMiddleware,
    LibraryMiddleware,
    {
      provide: PERSONALIZATION_PROVIDER,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): PostgresPersonalizationRepository => new PostgresPersonalizationRepository(database),
    },
    {
      provide: PERSONAL_KNOWLEDGE_REPOSITORY,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): PostgresPersonalKnowledgeRepository => new PostgresPersonalKnowledgeRepository(database),
    },
    {
      provide: ACCOUNT_IDEMPOTENCY,
      inject: [BFF_POOL],
      useFactory: (pool: Pool): IdempotencyRepository => new PostgresIdempotencyRepository(pool),
    },
    {
      provide: LIBRARY_ARTIFACT_REPOSITORY,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): ArtifactLibraryRepository => new PostgresConversationArtifactLibrary(database),
    },
  ],
  exports: [IamRelayModule, PERSONAL_KNOWLEDGE_REPOSITORY, PERSONALIZATION_PROVIDER],
})
export class AccountModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LibraryMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(AccountMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
