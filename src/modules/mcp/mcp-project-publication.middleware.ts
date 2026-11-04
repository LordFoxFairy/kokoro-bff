import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, MCP_AUTHORIZATION, MCP_PROJECT_PUBLICATION_CLIENT, PROJECT_LOOKUP, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { McpAuthorizationClient } from "../../auth/mcp-authorization.client.js"
import type { McpProjectPublicationConnectClient } from "../../infrastructure/clients/platform/mcp-project-publication-connect.js"
import type { ProjectLookup } from "../../application/projects/types.js"
import { handleMcpProjectPublicationRequest } from "../../http/routes/mcp-project-publication-native.js"

@Injectable()
export class McpProjectPublicationMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(MCP_AUTHORIZATION) private readonly authorization: Pick<McpAuthorizationClient, "check">,
    @Inject(PROJECT_LOOKUP) private readonly project: ProjectLookup,
    @Inject(MCP_PROJECT_PUBLICATION_CLIENT) private readonly client: McpProjectPublicationConnectClient | null,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleMcpProjectPublicationRequest(request, response, this.config, {
      sessionAdmission: this.admission,
      mcpAuthorization: this.authorization,
      project: this.project,
      client: this.client,
    }).then((handled) => { if (!handled && !response.writableEnded && !response.destroyed) next() })
      .catch(() => {
        if (!response.headersSent && !response.destroyed) {
          response.statusCode = 500
          response.setHeader("content-type", "application/json")
          response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } }))
        } else if (!response.writableEnded && !response.destroyed) response.destroy()
      })
  }
}
