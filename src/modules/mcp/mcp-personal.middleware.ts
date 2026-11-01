import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, MCP_AUTHORIZATION, MCP_PERSONAL_CLIENT, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { McpPersonalConnectClient } from "../../infrastructure/clients/platform/mcp-personal-connect.js"
import type { McpAuthorizationClient } from "../../auth/mcp-authorization.client.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { pathOf, requestId } from "../../http/request.js"
import { send } from "../../http/response.js"
import { startMcpRequestBudget } from "../../http/mcp-request-budget.js"
import { isMcpPersonalRequest, mcpPersonalOperation, mcpPersonalRoute, type McpPersonalProvider } from "../../http/routes/mcp-personal.js"

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
    startMcpRequestBudget(request, 10_000)
    response.setHeader("cache-control", "no-store")
    void this.handle(request, response).catch(() => {
      if (!response.headersSent && !response.writableEnded && !response.destroyed) send(response, 503, failure("mcp_personal_dependency_unavailable", "Personal MCP is unavailable", requestId(request)))
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = requestId(request)
    const admitted = await authorizeUserRequest(request, this.config, this.admission, id, AbortSignal.timeout(10_000))
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return
    }
    const path = pathOf(request).slice(2)
    if (mcpPersonalOperation(path, request.method ?? "GET") === null) return
    const provider: McpPersonalProvider = {
      mcpPersonalClient: this.client,
      mcpAuthorization: this.authorization,
      sessionAdmission: this.admission,
    }
    await mcpPersonalRoute(request, response, this.config, provider, admitted, path)
  }
}
