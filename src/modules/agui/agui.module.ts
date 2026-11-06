import { BeforeApplicationShutdown, Inject, Injectable, Module, OnModuleInit } from "@nestjs/common"
import {
  AGUI_PROJECTION,
  AGUI_PROJECTION_CONSUMERS,
  AGUI_PROJECTOR,
  AGUI_RUN_CONTROL_READER,
  AGUI_RUN_PROCESS_READER,
  AGUI_RUNTIME,
  AGUI_SOURCE_PROJECTION_ACTIVE,
  BFF_CONFIG,
  BFF_DATABASE,
  BFF_POOL,
} from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { DatabaseModule } from "../../common/database/database.module.js"
import { RedisModule } from "../../common/redis/redis.module.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresAgUiProjectionRepository } from "../../infrastructure/postgres/agui-projection-repository.js"
import { PostgresAgUiConsumerRepository } from "../../infrastructure/postgres/agui-consumer-repository.js"
import { AgUiProjectionService } from "../../application/agui/project-session-events.js"
import { AgUiSessionRuntime } from "../../application/agui/session-runtime.js"
import { AgUiProjectorRunner } from "../../application/agui/projector.js"
import { AgentAgUiSourceReader } from "../../infrastructure/clients/agent/projector-source.js"
import { createAgUiRunControlReader } from "../../infrastructure/postgres/agui-run-state-read.js"
import { createOwnedRunProcessReader } from "../../infrastructure/postgres/agui-process-page.js"
import { randomUUID } from "node:crypto"

@Injectable()
class AguiProjectorLifecycle implements OnModuleInit, BeforeApplicationShutdown {
  public constructor(@Inject(AGUI_PROJECTOR) private readonly projector: AgUiProjectorRunner | null) {}

  public onModuleInit(): void {
    this.projector?.start()
  }

  public async beforeApplicationShutdown(): Promise<void> {
    try {
      await this.projector?.stop()
    } catch {
      process.exitCode = 1
      throw new Error("bff_agui_projector_shutdown_failed")
    }
  }
}

@Module({
  imports: [RedisModule, DatabaseModule],
  providers: [
    { provide: AGUI_RUN_CONTROL_READER, inject: [BFF_POOL], useFactory: createAgUiRunControlReader },
    { provide: AGUI_RUN_PROCESS_READER, inject: [BFF_POOL], useFactory: createOwnedRunProcessReader },
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
    {
      provide: AGUI_PROJECTOR,
      inject: [BFF_CONFIG, AGUI_PROJECTION, AGUI_PROJECTION_CONSUMERS],
      useFactory: (config: BffConfig, projection: AgUiProjectionService, consumers: PostgresAgUiConsumerRepository): AgUiProjectorRunner | null => {
        const baseUrl = config.upstreams.agents ?? null
        if (!config.agentEnabled || baseUrl === null) return null
        return new AgUiProjectorRunner(
          projection,
          consumers,
          new AgentAgUiSourceReader(config, baseUrl, {
            maxAttempts: config.agUi.projectorSourceMaxAttempts,
            leaseSettlementReserveMs: config.agUi.projectorLeaseSettlementReserveMs,
          }),
          {
            workerId: `bff-agui-projector-${process.pid}-${randomUUID()}`,
            maxConsumersPerCycle: config.agUi.projectorMaxConsumersPerCycle,
            sourcePageSize: config.agUi.projectorSourcePageSize,
            maxPagesPerConsumer: config.agUi.projectorMaxPagesPerConsumer,
            leaseDurationMs: config.agUi.projectorLeaseDurationMs,
            pollIntervalMs: config.agUi.projectorPollIntervalMs,
            errorBackoffMs: config.agUi.projectorErrorBackoffMs,
            errorBackoffMaxMs: config.agUi.projectorErrorBackoffMaxMs,
            errorBackoffJitterPercent: config.agUi.projectorErrorBackoffJitterPercent,
            retentionMs: config.agUi.retentionMs,
            gcIntervalMs: config.agUi.gcIntervalMs,
            gcBatchSize: config.agUi.gcBatchSize,
            cursorTombstoneRetentionMs: config.agUi.cursorTombstoneRetentionMs,
          },
        )
      },
    },
    AguiProjectorLifecycle,
  ],
  exports: [
    AGUI_RUN_CONTROL_READER,
    AGUI_RUN_PROCESS_READER,
    AGUI_PROJECTION,
    AGUI_PROJECTION_CONSUMERS,
    AGUI_PROJECTOR,
    AGUI_RUNTIME,
    AGUI_SOURCE_PROJECTION_ACTIVE,
  ],
})
export class AguiModule {}
