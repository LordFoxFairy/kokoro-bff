import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { AGENT_RUNS_READER, BFF_CONFIG, RUN_DISPLAY_PROVIDER, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { SubmittedAgentRunReader } from "../../application/ports/submitted-agent-run-reader.js"
import type { ProjectExecutionBindingReader } from "../../application/ports/project-execution-binding-reader.js"
import { handleAgentRunsInternalRequest } from "../../http/routes/agent-runs-native.js"
import { handleRunDisplayRequest, type RunDisplayProvider } from "../../http/routes/run-display.js"

type AgentRunsReader = SubmittedAgentRunReader & ProjectExecutionBindingReader

@Injectable()
export class AgentRunsMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(AGENT_RUNS_READER) private readonly reader: AgentRunsReader,
    @Inject(RUN_DISPLAY_PROVIDER) private readonly runDisplay: RunDisplayProvider,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleAgentRunsInternalRequest(request, response, this.config, this.reader, this.reader)
      .then((handled) => handled || handleRunDisplayRequest(request, response, this.config, this.admission, this.runDisplay))
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
