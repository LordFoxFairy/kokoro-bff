import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, MUSIC_IDEMPOTENCY, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { handleMoriRequest, type MusicIdempotency } from "../../http/routes/music-native.js"

@Injectable()
export class MusicMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(MUSIC_IDEMPOTENCY) private readonly idempotency: MusicIdempotency,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleMoriRequest(request, response, this.config, this.admission, this.idempotency)
      .then((handled) => { if (!handled && !response.writableEnded && !response.destroyed) next() })
      .catch(() => {
        if (!response.headersSent && !response.writableEnded && !response.destroyed) {
          response.statusCode = 500
          response.setHeader("content-type", "application/json")
          response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } }))
        } else if (!response.writableEnded && !response.destroyed) response.destroy()
      })
  }
}
