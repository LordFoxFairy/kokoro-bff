import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { handleBrowserAuthSessionRequest } from "../../auth/auth-session.http.js"

@Injectable()
export class AuthenticationMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly authentication: SessionAdmission,
  ) {}
  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleBrowserAuthSessionRequest(request, response, this.config, this.authentication)
      .then((handled) => {
        if (!handled) next()
      })
      .catch(() => {
        if (!response.headersSent) {
          response.statusCode = 503
          response.end()
        } else response.destroy()
      })
  }
}
