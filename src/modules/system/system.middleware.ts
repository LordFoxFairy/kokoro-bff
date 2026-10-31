import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { handleSystemNativeRequest } from "../../http/routes/system-native.js"

@Injectable()
export class SystemMiddleware implements NestMiddleware {
  public constructor(@Inject(BFF_CONFIG) private readonly config: BffConfig) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleSystemNativeRequest(request, response, this.config)
      .then((handled) => {
        if (!handled && !response.writableEnded && !response.destroyed) next()
      })
      .catch(() => {
        if (!response.headersSent && !response.destroyed) {
          response.statusCode = 500
          response.setHeader("content-type", "application/json")
          response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } }))
        } else if (!response.writableEnded && !response.destroyed) response.destroy()
      })
  }
}
