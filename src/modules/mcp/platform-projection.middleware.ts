import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { requestId } from "../../http/request.js"
import { send } from "../../http/response.js"
import { livePlatformProjectionRead, platformProjectionRequest } from "../../http/routes/platform-projection.js"
import { startMcpRequestBudget } from "../../http/mcp-request-budget.js"

@Injectable()
export class PlatformProjectionMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    if (!platformProjectionRequest(request)) {
      next()
      return
    }
    startMcpRequestBudget(request, 10_000)
    response.setHeader("cache-control", "no-store")
    void this.handle(request, response).catch(() => {
      if (!response.headersSent && !response.writableEnded && !response.destroyed)
        send(response, 503, failure("skill_dependency_unavailable", "Platform projection is unavailable", requestId(request)))
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = requestId(request)
    const admitted = await authorizeUserRequest(request, this.config, this.admission, id, AbortSignal.timeout(10_000), response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return
    }
    await livePlatformProjectionRead(request, response, this.config, admitted.context, [
      "mcp",
      new URL(request.url ?? "/", "http://bff.local").pathname.endsWith("/connections") ? "connections" : "servers",
    ])
  }
}
