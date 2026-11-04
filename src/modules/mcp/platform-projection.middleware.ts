import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, MCP_AUTHORIZATION, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { McpAuthorizationClient } from "../../auth/mcp-authorization.client.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authenticateBrowserRequest, authorizeMcpAction, writeSessionCookies, type UserAdmissionResult } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { requestId } from "../../http/request.js"
import { send } from "../../http/response.js"
import { livePlatformProjectionRead, platformProjectionRequest } from "../../http/routes/platform-projection.js"
import { mcpRequestRemaining, startMcpRequestBudget } from "../../http/mcp-request-budget.js"

const admissionUnavailable = { ok: false, status: 503, code: "iam_admission_unavailable" } as const

function canRespond(request: IncomingMessage, response: ServerResponse): boolean {
  return !request.aborted && !response.destroyed && !response.writableEnded && !response.headersSent
}

@Injectable()
export class PlatformProjectionMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(MCP_AUTHORIZATION) private readonly authorization: Pick<McpAuthorizationClient, "check">,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    if (!platformProjectionRequest(request)) {
      next()
      return
    }
    startMcpRequestBudget(request)
    response.setHeader("cache-control", "no-store")
    const id = requestId(request)
    response.setHeader("x-request-id", id)
    void this.handle(request, response, id).catch(() => {
      if (canRespond(request, response)) send(response, 500, failure("internal_error", "The BFF encountered an internal error", id))
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse, id: string): Promise<void> {
    const controller = new AbortController()
    const { signal } = controller
    const abort = (): void => controller.abort()
    request.once("aborted", abort)
    response.once("close", abort)
    const timer = setTimeout(abort, mcpRequestRemaining(request))
    const active = (): boolean => !signal.aborted && canRespond(request, response) && mcpRequestRemaining(request) > 0
    const authorize = async (): Promise<UserAdmissionResult> => {
      if (!active()) return admissionUnavailable
      const session = await authenticateBrowserRequest(request, this.config, this.admission, id, signal)
      if (!active()) return admissionUnavailable
      writeSessionCookies(response, session.setCookies)
      if (!session.ok) return session
      const admitted = { ok: true, context: { requestId: id, identity: session.identity, platformAdmin: session.platformAdmin } } as const
      const action = await authorizeMcpAction(this.authorization, admitted, "read", signal)
      if (!active()) return admissionUnavailable
      return action.ok ? admitted : action
    }
    const result = await new Promise<UserAdmissionResult>((resolve) => {
      const unavailable = (): void => resolve(admissionUnavailable)
      signal.addEventListener("abort", unavailable, { once: true })
      void authorize()
        .then(resolve, unavailable)
        .finally(() => signal.removeEventListener("abort", unavailable))
    }).finally(() => {
      clearTimeout(timer)
      request.removeListener("aborted", abort)
      response.removeListener("close", abort)
    })
    if (!canRespond(request, response)) return
    const admitted = active() ? result : admissionUnavailable
    if (!admitted.ok) {
      send(
        response,
        admitted.status,
        { error: { code: admitted.code, message: "BFF user admission failed", retryable: admitted.status === 429 || admitted.status === 503 } },
        admitted.status === 429 ? admitted.retryAfter : undefined,
      )
      return
    }
    await livePlatformProjectionRead(request, response, this.config, admitted.context, [
      "mcp",
      new URL(request.url ?? "/", "http://bff.local").pathname.endsWith("/connections") ? "connections" : "servers",
    ])
  }
}
