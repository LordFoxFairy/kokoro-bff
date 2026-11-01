import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, CUSTOM_API_CLIENT, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { handleCustomApiRequest, customApiOperation } from "../../http/routes/custom-api.js"
import { pathOf } from "../../http/request.js"
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
    void handleCustomApiRequest(request, response, this.config, this.admission, this.client).then((handled) => {
      if (!handled && !response.writableEnded && !response.destroyed) next()
    })
  }
}
