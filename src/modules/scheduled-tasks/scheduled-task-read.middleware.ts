import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { SCHEDULED_TASK_READ_SERVICE, SESSION_ADMISSION, BFF_CONFIG } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ScheduledTaskReadService } from "../../application/scheduled-task-read-service.js"
import { handleScheduledTaskReadRequest } from "../../http/routes/scheduled-task-native.js"

@Injectable()
export class ScheduledTaskReadMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(SCHEDULED_TASK_READ_SERVICE) private readonly reader: ScheduledTaskReadService,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleScheduledTaskReadRequest(request, response, this.config, this.admission, this.reader)
      .then((handled) => {
        if (!handled && !response.writableEnded && !response.destroyed) next()
      })
      .catch(() => {
        if (!response.headersSent && !response.writableEnded && !response.destroyed) {
          response.statusCode = 500
          response.setHeader("content-type", "application/json")
          response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } }))
        } else if (!response.writableEnded && !response.destroyed) response.destroy()
      })
  }
}
