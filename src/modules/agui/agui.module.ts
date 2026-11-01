import { Module } from "@nestjs/common"
import { BFF_CONFIG, BFF_DATABASE, AGUI_PROJECTION, AGUI_PROJECTION_CONSUMERS, AGUI_RUNTIME, AGUI_SOURCE_PROJECTION_ACTIVE } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { DatabaseModule } from "../../common/database/database.module.js"
import { RedisModule } from "../../common/redis/redis.module.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresAgUiProjectionRepository } from "../../infrastructure/postgres/agui-projection-repository.js"
import { PostgresAgUiConsumerRepository } from "../../infrastructure/postgres/agui-consumer-repository.js"
import { AgUiProjectionService } from "../../application/agui/project-session-events.js"
import { AgUiSessionRuntime } from "../../application/agui/session-runtime.js"

@Module({
  imports: [RedisModule, DatabaseModule],
  providers: [
    {
      provide: AGUI_PROJECTION,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): AgUiProjectionService => new AgUiProjectionService(new PostgresAgUiProjectionRepository(database)),
    },
    {
      provide: AGUI_PROJECTION_CONSUMERS,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase) => new PostgresAgUiConsumerRepository(database),
    },
    {
      provide: AGUI_RUNTIME,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): AgUiSessionRuntime =>
        new AgUiSessionRuntime({
          connections: {
            global: config.agUi.maxConnectionsGlobal,
            perTenant: config.agUi.maxConnectionsPerTenant,
            perSession: config.agUi.maxConnectionsPerSession,
          },
          ledgerWait: {
            baseDelayMs: config.agUi.ledgerPollBaseDelayMs,
            maxDelayMs: config.agUi.ledgerPollMaxDelayMs,
            jitterRatio: config.agUi.ledgerPollJitterPercent / 100,
          },
          replayCacheTtlMs: config.agUi.replayCacheTtlMs,
        }),
    },
    {
      provide: AGUI_SOURCE_PROJECTION_ACTIVE,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): boolean => config.agentEnabled && config.upstreams.agents !== null,
    },
  ],
  exports: [AGUI_PROJECTION, AGUI_PROJECTION_CONSUMERS, AGUI_RUNTIME, AGUI_SOURCE_PROJECTION_ACTIVE],
})
export class AguiModule {}
