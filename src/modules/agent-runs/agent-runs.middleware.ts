import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import {
  AGENT_CONTROL_IDEMPOTENCY,
  AGENT_RUNS_READER,
  AGUI_RUN_CONTROL_READER,
  BFF_CONFIG,
  CHAT_CONVERSATION_LOOKUP,
  PROJECT_LOOKUP,
  RUN_DISPLAY_PROVIDER,
  SESSION_ADMISSION,
} from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { AgentRunsReader } from "../../infrastructure/postgres/project-execution-binding.js"
import type { ChatConversationLookup } from "../../infrastructure/postgres/chat-conversation-lookup.js"
import type { ProjectLookup } from "../../application/projects/types.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import type { AgUiRunControlReader } from "../../infrastructure/postgres/agui-run-state-read.js"
import { handleAgentRunsInternalRequest } from "../../http/routes/agent-runs-native.js"
import { handleRunDisplayRequest, type RunDisplayProvider } from "../../http/routes/run-display.js"
import { handleAgentControlRequest } from "../../http/routes/agent-control-native.js"
import { handleAgentConnectionSetupRequest } from "../../http/routes/agent-connection-setup-native.js"

@Injectable()
export class AgentRunsMiddleware implements NestMiddleware {
  private readonly idempotency = new Map<string, IdempotencyEntry>()

  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(AGENT_RUNS_READER) private readonly reader: AgentRunsReader,
    @Inject(RUN_DISPLAY_PROVIDER) private readonly runDisplay: RunDisplayProvider,
    @Inject(CHAT_CONVERSATION_LOOKUP) private readonly findConversation: ChatConversationLookup,
    @Inject(PROJECT_LOOKUP) private readonly projects: ProjectLookup,
    @Inject(AGUI_RUN_CONTROL_READER) private readonly readControl: AgUiRunControlReader,
    @Inject(AGENT_CONTROL_IDEMPOTENCY) private readonly controlIdempotency: IdempotencyRepository,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleAgentRunsInternalRequest(request, response, this.config, this.reader, this.reader)
      .then((handled) => handled || handleAgentConnectionSetupRequest(request, response, this.config, this.admission))
      .then((handled) => handled || handleRunDisplayRequest(request, response, this.config, this.admission, this.runDisplay))
      .then(
        (handled) =>
          handled ||
          handleAgentControlRequest(
            request,
            response,
            this.config,
            this.admission,
            this.findConversation,
            this.projects,
            this.readControl,
            this.idempotency,
            this.controlIdempotency,
          ),
      )
      .then((handled) => {
        if (!handled && !response.writableEnded && !response.destroyed) next()
      })
      .catch(() => {
        if (!response.headersSent && !response.writableEnded && !response.destroyed) {
          response.statusCode = 500
          response.setHeader("content-type", "application/json")
          response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } }))
        } else if (!response.writableEnded && !response.destroyed) response.destroy()
      })
  }
}
