import { Inject, Injectable } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { PERSONALIZATION_PROVIDER, type PersonalizationProvider } from "./personalization.provider.js"
import { personalizationRoute } from "../../http/routes/personalization.js"
import { requestId } from "../../http/request.js"
import { send } from "../../http/response.js"

/** Account-owned transport adapter for personalization; LegacyRoutes never receives this path. */
@Injectable()
export class AccountPersonalizationMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(PERSONALIZATION_PROVIDER)
    private readonly provider: PersonalizationProvider,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse): void {
    void this.handle(request, response).catch(() => {
      if (!response.headersSent && !response.destroyed) {
        send(response, 503, {
          error: {
            code: "personalization_unavailable",
            message: "Personalization request could not be completed",
            retryable: true,
          },
        })
      } else if (!response.writableEnded && !response.destroyed) response.destroy()
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = requestId(request)
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), Math.min(this.config.upstreamTimeoutMs, 10_000))
    const onAborted = (): void => abort.abort()
    const onClosed = (): void => {
      if (!response.writableEnded) abort.abort()
    }
    request.once("aborted", onAborted)
    response.once("close", onClosed)
    try {
      const admitted = await authorizeUserRequest(request, this.config, this.admission, id, abort.signal)
      if (!admitted.ok) {
        response.setHeader("x-request-id", id)
        response.setHeader("cache-control", "no-store")
        send(
          response,
          admitted.status,
          {
            error: {
              code: admitted.code,
              message: "BFF user admission failed",
              retryable: admitted.status === 429 || admitted.status === 503,
            },
          },
          admitted.retryAfter,
        )
        return
      }
      await personalizationRoute(request, response, admitted.context, this.provider)
    } finally {
      clearTimeout(timer)
      request.removeListener("aborted", onAborted)
      response.removeListener("close", onClosed)
    }
  }
}
