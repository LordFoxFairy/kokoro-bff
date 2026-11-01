import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, SCHEDULED_AGENT_DISPATCH_REPOSITORY, SCHEDULED_TASK_SERVICE, SCHEDULER_DISPATCH_RECEIPTS } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { ScheduledTaskService } from "../../application/scheduled-task-service.js"
import type { SchedulerDispatchReceiptRepository } from "../../application/ports/scheduler-dispatch-receipt-repository.js"
import type { ScheduledAgentDispatchRepository } from "../../application/ports/scheduled-agent-dispatch-repository.js"
import { schedulerDispatch } from "../../http/routes/scheduler.js"

@Injectable()
export class SchedulerDispatchMiddleware implements NestMiddleware {
  private readonly idempotency = new Map<string, import("../../application/idempotency.js").IdempotencyEntry>()

  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SCHEDULED_TASK_SERVICE) private readonly scheduledTasks: ScheduledTaskService,
    @Inject(SCHEDULER_DISPATCH_RECEIPTS) private readonly receipts: SchedulerDispatchReceiptRepository,
    @Inject(SCHEDULED_AGENT_DISPATCH_REPOSITORY) private readonly scheduledAgentDispatch: ScheduledAgentDispatchRepository,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void schedulerDispatch(request, response, this.config, {
      schedulerDispatchReceipts: this.receipts,
      scheduledTasks: this.scheduledTasks,
      scheduledAgentDispatch: this.scheduledAgentDispatch,
    }, this.idempotency).then((handled) => {
      if (!handled && !response.writableEnded && !response.destroyed) next()
    }).catch(() => {
      if (!response.headersSent && !response.writableEnded && !response.destroyed) {
        response.statusCode = 500
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } }))
      } else if (!response.writableEnded && !response.destroyed) response.destroy()
    })
  }
}
