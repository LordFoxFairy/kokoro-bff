import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { AGENT_CONTROL_IDEMPOTENCY, AGENT_RUNS_READER, AGUI_RUNTIME, BFF_CONFIG, CHAT_SERVICE, PROJECT_SERVICE, RUN_DISPLAY_PROVIDER, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { SubmittedAgentRunReader } from "../../application/agent-runs/submitted-agent-run-reader.js"
import type { ProjectExecutionBindingReader } from "../../application/agent-runs/project-execution-binding-reader.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import type { ProjectService } from "../../application/project-service.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import type { AgUiSessionRuntime } from "../../application/agui/session-runtime.js"
import { handleAgentRunsInternalRequest } from "../../http/routes/agent-runs-native.js"
import { handleRunDisplayRequest, type RunDisplayProvider } from "../../http/routes/run-display.js"
import { handleAgentControlRequest } from "../../http/routes/agent-control-native.js"

type AgentRunsReader = SubmittedAgentRunReader & ProjectExecutionBindingReader

@Injectable()
export class AgentRunsMiddleware implements NestMiddleware {
  private readonly idempotency = new Map<string, IdempotencyEntry>()

  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(AGENT_RUNS_READER) private readonly reader: AgentRunsReader,
    @Inject(RUN_DISPLAY_PROVIDER) private readonly runDisplay: RunDisplayProvider,
    @Inject(CHAT_SERVICE) private readonly chat: ChatApplicationService,
    @Inject(PROJECT_SERVICE) private readonly projects: ProjectService,
    @Inject(AGUI_RUNTIME) private readonly agUiRuntime: AgUiSessionRuntime,
    @Inject(AGENT_CONTROL_IDEMPOTENCY) private readonly controlIdempotency: IdempotencyRepository,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleAgentRunsInternalRequest(request, response, this.config, this.reader, this.reader)
      .then((handled) => handled || handleRunDisplayRequest(request, response, this.config, this.admission, this.runDisplay))
      .then((handled) => handled || handleAgentControlRequest(request, response, this.config, this.admission, this.chat, this.projects, this.agUiRuntime, this.idempotency, this.controlIdempotency))
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
