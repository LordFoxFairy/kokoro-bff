import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, CUSTOM_API_CLIENT, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { pathOf, requestId } from "../../http/request.js"
import { send } from "../../http/response.js"
import { startMcpRequestBudget } from "../../http/mcp-request-budget.js"
import { customApiOperation, customApiRoute } from "../../http/routes/custom-api.js"
import type { CustomApiConnectClient } from "../../infrastructure/clients/platform/custom-api-connect.js"

export type CustomApiClient = Pick<CustomApiConnectClient, "execute">

export function isCustomApiRequest(request: IncomingMessage): boolean {
  try {
    const path = pathOf(request)
    return path[0] === "browser" && path[1] === "v1" && customApiOperation(path.slice(2), request.method ?? "GET") !== null
  } catch {
    return false
  }
}

@Injectable()
export class CustomApiMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(CUSTOM_API_CLIENT) private readonly client: CustomApiClient | null,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    if (!isCustomApiRequest(request)) {
      next()
      return
    }
    startMcpRequestBudget(request, 10_000)
    response.setHeader("cache-control", "no-store")
    void this.handle(request, response).catch(() => {
      if (!response.headersSent && !response.writableEnded && !response.destroyed)
        send(response, 503, failure("custom_api_dependency_unavailable", "Custom API is unavailable", requestId(request)))
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = requestId(request)
    const admitted = await authorizeUserRequest(request, this.config, this.admission, id, AbortSignal.timeout(10_000))
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return
    }
    await customApiRoute(request, response, this.client, admitted.context, id, pathOf(request).slice(2))
  }
}
