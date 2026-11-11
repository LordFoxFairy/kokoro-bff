import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, MCP_AUTHORIZATION, PROJECT_MCP_RECOMMENDATIONS_PROVIDER, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { McpAuthorizationClient } from "../../auth/mcp-authorization.client.js"
import {
  handleProjectMcpRecommendationsRequest,
  isProjectMcpRecommendationsRequest,
  type ProjectMcpRecommendationsProvider,
} from "../../http/routes/project-mcp-recommendations.js"

@Injectable()
export class ProjectMcpRecommendationsMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(MCP_AUTHORIZATION) private readonly mcpAuthorization: Pick<McpAuthorizationClient, "check">,
    @Inject(PROJECT_MCP_RECOMMENDATIONS_PROVIDER) private readonly provider: ProjectMcpRecommendationsProvider,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void (isProjectMcpRecommendationsRequest(request)
      ? handleProjectMcpRecommendationsRequest(request, response, this.config, this.admission, this.mcpAuthorization, this.provider)
      : Promise.resolve(false))
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
