import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { BFF_CONFIG, BFF_DATABASE, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresPersonalizationRepository } from "../../infrastructure/postgres/personalization-repository.js"
import { PERSONALIZATION_PROVIDER } from "./personalization.provider.js"
import { SessionAdmissionClient } from "../../auth/session-admission.client.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"

@Module({
  imports: [IamRelayModule, DatabaseModule],
  providers: [
    {
      provide: PERSONALIZATION_PROVIDER,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): PostgresPersonalizationRepository => new PostgresPersonalizationRepository(database),
    },
    {
      provide: SESSION_ADMISSION,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): SessionAdmission =>
        new SessionAdmissionClient({
          baseUrl: config.iamBaseUrl,
          timeoutMs: config.upstreamTimeoutMs,
          maxResponseBytes: config.upstreamMaxResponseBytes,
        }),
    },
  ],
  exports: [IamRelayModule, PERSONALIZATION_PROVIDER, SESSION_ADMISSION],
})
export class AccountModule {}
