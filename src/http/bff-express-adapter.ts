import type { NestApplicationOptions } from "@nestjs/common"
import { ExpressAdapter } from "@nestjs/platform-express"
import { createServer, type IncomingMessage, type RequestListener, type ServerResponse } from "node:http"
import { failure } from "../contracts/index.js"
import { requestId } from "./request.js"
import { send } from "./response.js"

const MAX_HTTP_HEADER_BYTES = 32 * 1024

/** Keeps the BFF's bounded header parser and Product error envelope on the Nest transport. */
export class BffExpressAdapter extends ExpressAdapter {
  public override setNotFoundHandler(handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void, prefix?: string): void {
    super.setNotFoundHandler((request: IncomingMessage, response: ServerResponse, next: () => void) => {
      const path = this.getRequestUrl(request).split(/[?#]/u, 1)[0]
      if (path !== "/v1" && !path?.startsWith("/v1/")) {
        return handler(request, response, next)
      }
      // Nest reaches this only after every registered handler declined the request.
      const id = requestId(request)
      response.setHeader("x-request-id", id)
      send(response, 404, failure("bff_route_not_found", "Business route was not found", id))
    }, prefix)
  }

  public override initHttpServer(options: NestApplicationOptions): void {
    if (options.httpsOptions || options.forceCloseConnections) {
      throw new Error("BFF HTTP adapter does not support HTTPS or forced connection close")
    }
    // Let Nest install its shutdown admission middleware, then replace the unbound server before Nest caches it.
    super.initHttpServer(options)
    this.setHttpServer(createServer({ maxHeaderSize: MAX_HTTP_HEADER_BYTES }, this.getInstance<RequestListener>()))
  }
}
