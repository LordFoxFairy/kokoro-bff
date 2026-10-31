import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { BFF_DATABASE } from "../../common/tokens.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresPersonalizationRepository } from "../../infrastructure/postgres/personalization-repository.js"
import { PERSONALIZATION_PROVIDER } from "./personalization.provider.js"

@Module({
  imports: [IamRelayModule, DatabaseModule],
  providers: [
    {
      provide: PERSONALIZATION_PROVIDER,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): PostgresPersonalizationRepository => new PostgresPersonalizationRepository(database),
    },
  ],
  exports: [IamRelayModule, PERSONALIZATION_PROVIDER],
})
export class AccountModule {}
