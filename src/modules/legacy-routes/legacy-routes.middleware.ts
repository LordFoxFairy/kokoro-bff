import { Injectable } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { LegacyRoutesRuntime } from "./legacy-routes.runtime.js"

@Injectable()
export class LegacyRoutesMiddleware {
  public constructor(private readonly runtime: LegacyRoutesRuntime) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void this.runtime.use(request, response).catch(() => {
      if (!response.headersSent) {
        response.statusCode = 500
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } }))
      } else {
        response.destroy()
      }
      next()
    })
  }
}
