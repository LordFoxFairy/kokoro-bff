import { BeforeApplicationShutdown, Inject, Injectable, Module, OnModuleInit } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import {
  AGENT_CANCELLATION_DISPATCHER,
  AGENT_CANCELLATION_OUTBOX,
  AGENT_DISPATCH_DISPATCHER,
  AGENT_DISPATCH_OUTBOX,
  BFF_CONFIG,
  BFF_DATABASE,
  CHAT_TURN_SERVICE,
} from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresAgentDispatchOutboxRepository } from "../../infrastructure/postgres/agent-dispatch-outbox-repository.js"
import { PostgresAgentCancellationOutboxRepository } from "../../infrastructure/postgres/agent-cancellation-outbox-repository.js"
import { RunSteerDispatcher } from "../../infrastructure/postgres/run-steer-dispatch.js"
import { ChatTurnApplicationService } from "../../application/chat-turn-service.js"
import { AgentDispatchOutboxDispatcher } from "../../application/agent-dispatch-outbox-dispatcher.js"
import { AgentCancellationOutboxDispatcher } from "../../application/agent-cancellation-outbox-dispatcher.js"
import { AgentOutboxDelivery } from "../../infrastructure/clients/agent/outbox-delivery.js"
import { AgentCancellationDelivery } from "../../infrastructure/clients/agent/cancellation-delivery.js"
import { Sha256StableIdGenerator } from "../../infrastructure/identifiers/scheduled-task-outbox-id.js"
import { randomUUID } from "node:crypto"

@Injectable()
class AgentDispatchWorkerLifecycle implements OnModuleInit, BeforeApplicationShutdown {
  public constructor(
    @Inject(AGENT_DISPATCH_DISPATCHER) private readonly dispatch: AgentDispatchOutboxDispatcher | null,
    @Inject(AGENT_CANCELLATION_DISPATCHER) private readonly cancellation: AgentCancellationOutboxDispatcher | null,
    @Inject(RunSteerDispatcher) private readonly steer: RunSteerDispatcher | null,
  ) {}

  public onModuleInit(): void {
    this.dispatch?.start()
    this.cancellation?.start()
    this.steer?.start()
  }

  public async beforeApplicationShutdown(): Promise<void> {
    const stoppingSteer = this.steer?.stop()
    let failed = false
    try {
      await this.cancellation?.stop()
    } catch {
      failed = true
    }
    try {
      await this.dispatch?.stop()
    } catch {
      failed = true
    }
    await stoppingSteer
    if (failed) {
      process.exitCode = 1
      throw new Error("bff_agent_dispatch_shutdown_failed")
    }
  }
}

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: AGENT_DISPATCH_OUTBOX,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): PostgresAgentDispatchOutboxRepository => new PostgresAgentDispatchOutboxRepository(database),
    },
    {
      provide: AGENT_CANCELLATION_OUTBOX,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): PostgresAgentCancellationOutboxRepository => new PostgresAgentCancellationOutboxRepository(database),
    },
    {
      provide: AGENT_DISPATCH_DISPATCHER,
      inject: [AGENT_DISPATCH_OUTBOX, BFF_CONFIG],
      useFactory: (repository: PostgresAgentDispatchOutboxRepository, config: BffConfig): AgentDispatchOutboxDispatcher | null =>
        !config.agentEnabled || config.upstreams.agents === null
          ? null
          : new AgentDispatchOutboxDispatcher(repository, new AgentOutboxDelivery(config), {
              workerId: `bff-agent-outbox-${process.pid}-${randomUUID()}`,
            }),
    },
    {
      provide: AGENT_CANCELLATION_DISPATCHER,
      inject: [AGENT_CANCELLATION_OUTBOX, BFF_CONFIG],
      useFactory: (repository: PostgresAgentCancellationOutboxRepository, config: BffConfig): AgentCancellationOutboxDispatcher | null =>
        !config.agentEnabled || config.upstreams.agents === null
          ? null
          : new AgentCancellationOutboxDispatcher(repository, new AgentCancellationDelivery(config), {
              workerId: `bff-agent-cancellation-${process.pid}-${randomUUID()}`,
            }),
    },
    {
      provide: CHAT_TURN_SERVICE,
      inject: [AGENT_DISPATCH_OUTBOX],
      useFactory: (outbox: PostgresAgentDispatchOutboxRepository): ChatTurnApplicationService =>
        new ChatTurnApplicationService(outbox, new Sha256StableIdGenerator()),
    },
    {
      provide: RunSteerDispatcher,
      inject: [BFF_DATABASE, BFF_CONFIG],
      useFactory: (database: PostgresBffDatabase, config: BffConfig): RunSteerDispatcher | null =>
        !config.agentEnabled || (config.upstreams.agents ?? null) === null ? null : new RunSteerDispatcher(database, config),
    },
    AgentDispatchWorkerLifecycle,
  ],
  exports: [AGENT_DISPATCH_OUTBOX, AGENT_CANCELLATION_OUTBOX, AGENT_DISPATCH_DISPATCHER, AGENT_CANCELLATION_DISPATCHER, CHAT_TURN_SERVICE],
})
export class AgentDispatchModule {}
