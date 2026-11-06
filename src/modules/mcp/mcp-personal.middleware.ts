import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, MCP_AUTHORIZATION, MCP_PERSONAL_CLIENT, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { McpPersonalConnectClient } from "../../infrastructure/clients/platform/mcp-personal-connect.js"
import type { McpAuthorizationClient } from "../../auth/mcp-authorization.client.js"
import { handleMcpPersonalRequest, isMcpPersonalRequest } from "../../http/routes/mcp-personal.js"

@Injectable()
export class McpPersonalMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(MCP_PERSONAL_CLIENT) private readonly client: McpPersonalConnectClient | null,
    @Inject(MCP_AUTHORIZATION) private readonly authorization: Pick<McpAuthorizationClient, "check">,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    if (!isMcpPersonalRequest(request)) {
      next()
      return
    }
    void handleMcpPersonalRequest(request, response, this.config, this.admission, this.client, this.authorization).then((handled) => {
      if (!handled && !response.writableEnded && !response.destroyed) next()
    })
  }
}
