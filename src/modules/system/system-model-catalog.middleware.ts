import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { requestId } from "../../http/request.js"
import { send } from "../../http/response.js"
import { handleSystemModelCatalogBusiness, systemModelCatalogRequest } from "../../http/routes/system-model-catalog-native.js"

@Injectable()
export class SystemModelCatalogMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    if (!systemModelCatalogRequest(request)) {
      next()
      return
    }
    void this.handle(request, response).catch(() => {
      if (!request.aborted && !response.headersSent && !response.writableEnded && !response.destroyed) {
        const id = requestId(request)
        response.setHeader("x-request-id", id)
        send(response, 503, failure("system_projection_not_configured", "System model catalog is unavailable", id))
      }
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = requestId(request)
    const deadlineAt = performance.now() + Math.min(this.config.upstreamTimeoutMs, 10_000)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - performance.now()))
    const onAborted = () => controller.abort()
    const onClosed = () => {
      if (!response.writableEnded) controller.abort()
    }
    request.once("aborted", onAborted)
    response.once("close", onClosed)
    const check = () => {
      if (request.aborted || response.destroyed || response.writableEnded || performance.now() >= deadlineAt) controller.abort()
      controller.signal.throwIfAborted()
    }
    try {
      check()
      response.setHeader("x-request-id", id)
      const admitted = await authorizeUserRequest(request, this.config, this.admission, id, controller.signal, response)
      check()
      if (!admitted.ok) {
        send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
        return
      }
      await handleSystemModelCatalogBusiness(request, response, this.config, admitted.context, { signal: controller.signal, deadlineAt })
    } finally {
      clearTimeout(timer)
      request.removeListener("aborted", onAborted)
      response.removeListener("close", onClosed)
    }
  }
}
