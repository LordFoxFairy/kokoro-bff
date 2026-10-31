import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, MCP_AUTHORIZATION, MCP_PERSONAL_CLIENT, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { McpAuthorizationClient } from "../../auth/mcp-authorization.client.js"
import type { McpPersonalConnectClient } from "../../infrastructure/clients/platform/mcp-personal-connect.js"
import { handleConnectorListRequest } from "../../http/routes/connector-list-native.js"

@Injectable()
export class ConnectorListMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(MCP_PERSONAL_CLIENT) private readonly personal: McpPersonalConnectClient | null,
    @Inject(MCP_AUTHORIZATION) private readonly authorization: Pick<McpAuthorizationClient, "check">,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleConnectorListRequest(request, response, this.config, this.admission, this.personal, this.authorization)
      .then((handled) => { if (!handled && !response.writableEnded && !response.destroyed) next() })
      .catch(() => { if (!response.headersSent && !response.destroyed) { response.statusCode = 500; response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } })) } })
  }
}
