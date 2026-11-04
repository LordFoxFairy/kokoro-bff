import type { NestApplicationOptions } from "@nestjs/common"
import { ExpressAdapter } from "@nestjs/platform-express"
import { createServer, type RequestListener } from "node:http"

const MAX_HTTP_HEADER_BYTES = 32 * 1024

/** Retains the bounded BFF ingress budget for a full-size Model Admission proof and its envelope. */
export class BffExpressAdapter extends ExpressAdapter {
  public override initHttpServer(options: NestApplicationOptions): void {
    if (options.httpsOptions || options.forceCloseConnections) {
      throw new Error("BFF HTTP adapter does not support HTTPS or forced connection close")
    }
    // Let Nest install its shutdown admission middleware, then replace the unbound server before Nest caches it.
    super.initHttpServer(options)
    this.setHttpServer(createServer({ maxHeaderSize: MAX_HTTP_HEADER_BYTES }, this.getInstance<RequestListener>()))
  }
}
