import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, CUSTOM_API_ADMIN_CLIENT, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { CustomApiAdminConnectClient } from "../../infrastructure/clients/platform/custom-api-admin-connect.js"
import { handleCustomApiAdminRequest } from "../../http/routes/custom-api-admin.js"
import { send } from "../../http/response.js"

@Injectable()
export class CustomApiAdminMiddleware implements NestMiddleware {
  constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(CUSTOM_API_ADMIN_CLIENT) private readonly client: CustomApiAdminConnectClient | null,
  ) {}
  use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleCustomApiAdminRequest(request, response, this.config, this.admission, this.client)
      .then((handled) => {
        if (!handled && !response.writableEnded && !response.destroyed) next()
      })
      .catch(() => {
        if (!response.headersSent && !response.destroyed)
          send(response, 500, { error: { code: "internal_error", message: "Custom API administration failed", retryable: false } })
        else if (!response.writableEnded && !response.destroyed) response.destroy()
      })
  }
}
