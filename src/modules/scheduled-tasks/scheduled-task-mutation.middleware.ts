import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, PROJECT_SERVICE, SCHEDULED_TASK_IDEMPOTENCY, SCHEDULED_TASK_SERVICE, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ProjectService } from "../../application/project-service.js"
import type { ScheduledTaskService } from "../../application/scheduled-task-service.js"
import { scheduledCreateInput } from "../../application/scheduled/input.js"
import type { ScheduledTaskCreateInput } from "../../application/scheduled/scheduled-task-repository.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { mutationFingerprint, idempotencyKey, pathOf, readBody, requestBodyJson, requestId } from "../../http/request.js"
import { mutationTicket } from "../../application/idempotency.js"
import { send } from "../../http/response.js"
import {
  authorizeScheduledTaskMutation,
  handleScheduledTaskMutationBusiness,
  scheduledTaskMutation,
  type ScheduledTaskMutation,
} from "../../http/routes/scheduled-task-mutation-native.js"

@Injectable()
export class ScheduledTaskMutationMiddleware implements NestMiddleware {
  private readonly idempotency = new Map<string, IdempotencyEntry>()

  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(SCHEDULED_TASK_SERVICE) private readonly tasks: ScheduledTaskService,
    @Inject(PROJECT_SERVICE) private readonly projects: ProjectService,
    @Inject(SCHEDULED_TASK_IDEMPOTENCY) private readonly persistent: IdempotencyRepository,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    const kind = scheduledTaskMutation(request)
    if (kind === null) {
      next()
      return
    }
    void this.handle(request, response, kind).catch(() => {
      if (!response.headersSent && !response.writableEnded && !response.destroyed)
        send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", requestId(request)))
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse, route: ScheduledTaskMutation): Promise<void> {
    const id = requestId(request)
    response.setHeader("x-request-id", id)
    const abort = new AbortController()
    const close = (): void => {
      if (!response.writableEnded) abort.abort()
    }
    request.once("aborted", close)
    response.once("close", close)
    let mutation: import("../../application/idempotency.js").MutationTicket | null = null
    try {
      const admitted = await authorizeUserRequest(request, this.config, this.admission, id, abort.signal, response)
      if (!admitted.ok) {
        send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
        return
      }
      const key = idempotencyKey(request)
      if ((route.kind === "create" || route.kind === "project_create") && key === null) {
        send(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", id))
        return
      }
      const body = await readBody(request)
      const json = requestBodyJson(request, body)
      if (json === null) {
        send(response, 400, failure("invalid_json", "Request body must be a JSON object", id))
        return
      }
      if (key === null) {
        send(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", id))
        return
      }
      const path = pathOf(request).slice(1)
      let checkedCreate: ScheduledTaskCreateInput | undefined
      if (route.kind === "create") {
        // URL.search omits a bare '?'; this operation rejects the literal query delimiter.
        if ((request.url ?? "").includes("?")) {
          send(response, 400, failure("invalid_scheduled_task", "Scheduled task creation does not accept query parameters", id))
          return
        }
        const input = scheduledCreateInput(json)
        if (input === null) {
          send(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", id))
          return
        }
        checkedCreate = input
      }
      // DELETE may recover its original acknowledgement after the task has been physically removed.
      if (route.kind === "create" || route.kind === "project_create" || route.kind === "patch" || route.kind === "retry") {
        if (abort.signal.aborted) return
        const access = await authorizeScheduledTaskMutation(route.kind === "patch" ? "PATCH" : "POST", admitted.context, path, checkedCreate ?? null, {
          projects: this.projects,
          scheduledTasks: this.tasks,
        })
        if (abort.signal.aborted) return
        if (access !== null && !access.ok) {
          send(response, access.status, failure(access.code, access.message, id))
          return
        }
      }
      const ticket = await mutationTicket(
        key,
        request.method ?? "POST",
        `/${path.join("/")}`,
        admitted.context,
        mutationFingerprint(request, path, json, body),
        this.idempotency,
        this.persistent,
      )
      if (ticket.replay !== null) {
        send(response, ticket.replay.status, ticket.replay.body)
        return
      }
      if (ticket.conflict) {
        send(response, 409, failure("idempotency_conflict", "Idempotency key already used with a different request payload", id))
        return
      }
      if (ticket.pending) {
        send(response, 409, failure("idempotency_in_progress", "An identical mutation is already in progress", id))
        return
      }
      mutation = ticket.ticket
      await handleScheduledTaskMutationBusiness(request, response, admitted.context, this.tasks, this.projects, json, mutation, this.idempotency, checkedCreate)
    } catch (error) {
      if (!response.headersSent && !response.writableEnded && !response.destroyed)
        send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", id))
    } finally {
      request.removeListener("aborted", close)
      response.removeListener("close", close)
    }
  }
}
