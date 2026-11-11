import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { iamProtocolRelay } from "../../http/routes/iam-protocol-relay.js"

export async function handleIamRelayRequest(request: IncomingMessage, response: ServerResponse, config: BffConfig): Promise<boolean> {
  if (!(request.url ?? "").startsWith("/iam")) return false
  await iamProtocolRelay(request, response, config)
  return true
}

@Injectable()
export class IamRelayMiddleware implements NestMiddleware {
  public constructor(@Inject(BFF_CONFIG) private readonly config: BffConfig) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    if (!(request.url ?? "").startsWith("/iam")) {
      next()
      return
    }
    void iamProtocolRelay(request, response, this.config).catch(() => {
      if (!response.headersSent && !response.destroyed) {
        response.statusCode = 500
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } }))
      } else if (!response.writableEnded && !response.destroyed) response.destroy()
    })
  }
}
