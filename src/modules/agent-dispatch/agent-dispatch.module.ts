import { Inject, Injectable, Module, OnApplicationShutdown, OnModuleInit } from "@nestjs/common"
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
import { ChatTurnApplicationService } from "../../application/chat-turn-service.js"
import { AgentDispatchOutboxDispatcher } from "../../application/agent-dispatch-outbox-dispatcher.js"
import { AgentCancellationOutboxDispatcher } from "../../application/agent-cancellation-outbox-dispatcher.js"
import { AgentOutboxDelivery } from "../../infrastructure/clients/agent/outbox-delivery.js"
import { AgentCancellationDelivery } from "../../infrastructure/clients/agent/cancellation-delivery.js"
import { Sha256StableIdGenerator } from "../../infrastructure/identifiers/scheduled-task-outbox-id.js"
import { randomUUID } from "node:crypto"

@Injectable()
class AgentDispatchWorkerLifecycle implements OnModuleInit, OnApplicationShutdown {
  public constructor(
    @Inject(AGENT_DISPATCH_DISPATCHER) private readonly dispatch: AgentDispatchOutboxDispatcher | null,
    @Inject(AGENT_CANCELLATION_DISPATCHER) private readonly cancellation: AgentCancellationOutboxDispatcher | null,
  ) {}

  public onModuleInit(): void {
    this.dispatch?.start()
    this.cancellation?.start()
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.cancellation?.stop()
    await this.dispatch?.stop()
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
    AgentDispatchWorkerLifecycle,
  ],
  exports: [AGENT_DISPATCH_OUTBOX, AGENT_CANCELLATION_OUTBOX, AGENT_DISPATCH_DISPATCHER, AGENT_CANCELLATION_DISPATCHER, CHAT_TURN_SERVICE],
})
export class AgentDispatchModule {}
