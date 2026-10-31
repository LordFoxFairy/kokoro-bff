import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, MCP_AUTHORIZATION, MCP_PACKAGE_ADMIN_CLIENT, MCP_PROVIDER_ADMIN_CLIENT, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { McpAuthorizationClient } from "../../auth/mcp-authorization.client.js"
import type { McpPackageAdminConnectClient } from "../../infrastructure/clients/platform/mcp-package-admin-connect.js"
import type { McpProviderAdminConnectClient } from "../../infrastructure/clients/platform/mcp-provider-admin-connect.js"
import { handleMcpAdminRequest } from "../../http/routes/mcp-admin-native.js"

@Injectable()
export class McpAdminMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(MCP_AUTHORIZATION) private readonly authorization: Pick<McpAuthorizationClient, "check">,
    @Inject(MCP_PROVIDER_ADMIN_CLIENT) private readonly providerClient: McpProviderAdminConnectClient | null,
    @Inject(MCP_PACKAGE_ADMIN_CLIENT) private readonly packageClient: McpPackageAdminConnectClient | null,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleMcpAdminRequest(request, response, this.config, this.admission, this.authorization, this.providerClient, this.packageClient)
      .then((handled) => { if (!handled && !response.writableEnded && !response.destroyed) next() })
      .catch(() => {
        if (!response.headersSent && !response.destroyed) {
          response.statusCode = 500
          response.setHeader("content-type", "application/json")
          response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } }))
        } else if (!response.writableEnded && !response.destroyed) response.destroy()
      })
  }
}
