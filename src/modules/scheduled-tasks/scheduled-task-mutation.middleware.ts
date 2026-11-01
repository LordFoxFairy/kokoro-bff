import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, PROJECT_SERVICE, SCHEDULED_TASK_IDEMPOTENCY, SCHEDULED_TASK_SERVICE, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ProjectService } from "../../application/project-service.js"
import type { ScheduledTaskService } from "../../application/scheduled-task-service.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure, ok } from "../../contracts/index.js"
import { mutationFingerprint, idempotencyKey, pathOf, readBody, requestBodyJson, requestId } from "../../http/request.js"
import { mutationTicket } from "../../application/idempotency.js"
import { reply, send } from "../../http/response.js"
import { scheduledCreateInput, scheduledPatchInput } from "../../application/scheduled/input.js"
import { scheduledTaskResponse } from "../../application/scheduled/mappers.js"
import { scheduledTaskId } from "../../http/routes/scheduler.js"

function mutationPath(request: IncomingMessage): { kind: "create" | "project_create" | "patch" | "delete" | "retry"; taskId?: string; projectId?: string } | null {
  const path = pathOf(request)
  if (path[0] === "v1" && path[1] === "scheduled-tasks") {
    if (path.length === 3 && request.method === "POST") return { kind: "create" }
    const taskId = path[2]
    if (typeof taskId !== "string" || taskId === "") return null
    if (path.length === 4 && path[3] === "retry" && request.method === "POST") return { kind: "retry", taskId }
    if (path.length === 3 && request.method === "PATCH") return { kind: "patch", taskId }
    if (path.length === 3 && request.method === "DELETE") return { kind: "delete", taskId }
  }
  if (path[0] === "v1" && path[1] === "projects" && path.length === 4 && path[3] === "scheduled-tasks" && request.method === "POST") {
    const projectId = path[2]
    if (typeof projectId !== "string" || projectId === "") return null
    return { kind: "project_create", projectId }
  }
  return null
}

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
    const kind = mutationPath(request)
    if (kind === null) {
      next()
      return
    }
    void this.handle(request, response, kind).catch(() => {
      if (!response.headersSent && !response.writableEnded && !response.destroyed) send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", requestId(request)))
    })
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
    route: { kind: "create" | "project_create" | "patch" | "delete" | "retry"; taskId?: string; projectId?: string },
  ): Promise<void> {
    const id = requestId(request)
    response.setHeader("x-request-id", id)
    const abort = new AbortController()
    const close = (): void => { if (!response.writableEnded) abort.abort() }
    request.once("aborted", close)
    response.once("close", close)
    let mutation: import("../../application/idempotency.js").MutationTicket | null = null
    let admittedContext: RequestContext | null = null
    try {
      const admitted = await authorizeUserRequest(request, this.config, this.admission, id, abort.signal)
      if (!admitted.ok) { send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter); return }
      admittedContext = admitted.context
      const body = await readBody(request)
      const json = requestBodyJson(request, body)
      if (json === null) { send(response, 400, failure("invalid_json", "Request body must be a JSON object", id)); return }
      const key = idempotencyKey(request)
      if (key === null) { send(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", id)); return }
      const path = pathOf(request).slice(1)
      const ticket = await mutationTicket(key, request.method ?? "POST", `/${path.join("/")}`, admitted.context, mutationFingerprint(request, path, json, body), this.idempotency, this.persistent)
      if (ticket.replay !== null) { send(response, ticket.replay.status, ticket.replay.body); return }
      if (ticket.conflict) { send(response, 409, failure("idempotency_conflict", "Idempotency key already used with a different request payload", id)); return }
      if (ticket.pending) { send(response, 409, failure("idempotency_in_progress", "An identical mutation is already in progress", id)); return }
      mutation = ticket.ticket
      const scope = { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId }
      if (route.projectId !== undefined && await this.projects.find(scope, route.projectId) === null) { await reply(response, 404, failure("project_not_found", "Project was not found", id), admitted.context, this.idempotency, mutation); return }
      if (route.taskId !== undefined && await this.tasks.find(scope, route.taskId) === null) { await reply(response, 404, failure("scheduled_task_not_found", "Scheduled task was not found", id), admitted.context, this.idempotency, mutation); return }
      let task
      if (route.kind === "create" || route.kind === "project_create") {
        if (new URL(request.url ?? "/", "http://bff.local").search !== "") { await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task creation does not accept query parameters", id), admitted.context, this.idempotency, mutation); return }
        const input = scheduledCreateInput(json, route.projectId)
        if (input === null) { await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", id), admitted.context, this.idempotency, mutation); return }
        if (input.projectId !== undefined && await this.projects.find(scope, input.projectId) === null) { await reply(response, 404, failure("project_not_found", "Project was not found", id), admitted.context, this.idempotency, mutation); return }
        const lineage = { tenantId: scope.tenantId, actorId: scope.subjectId, requestId: id, idempotencyKey: key }
        task = await this.tasks.create(scope, input, scheduledTaskId(admitted.context, `/${path.join("/")}`, key), lineage)
      } else {
        const lineage = { tenantId: scope.tenantId, actorId: scope.subjectId, requestId: id, idempotencyKey: key }
        if (route.kind === "patch") {
          const patch = scheduledPatchInput(json)
          if (patch === null) { await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", id), admitted.context, this.idempotency, mutation); return }
          task = await this.tasks.update(scope, route.taskId!, patch, lineage)
        } else if (route.kind === "delete") {
          const deleted = await this.tasks.delete(scope, route.taskId!, lineage)
          await reply(response, deleted ? 200 : 404, deleted ? ok({ ok: true }, id) : failure("scheduled_task_not_found", "Scheduled task was not found", id), admitted.context, this.idempotency, mutation)
          return
        } else {
          task = await this.tasks.update(scope, route.taskId!, { status: "active", enabled: true }, lineage)
        }
        if (task === null) { await reply(response, 404, failure("scheduled_task_not_found", "Scheduled task was not found", id), admitted.context, this.idempotency, mutation); return }
      }
      await reply(response, 200, ok({ task: scheduledTaskResponse(task) }, id), admitted.context, this.idempotency, mutation)
    } catch (error) {
      if (mutation !== null) {
        const code = error instanceof Error && ["SCHEDULED_TASK_CALENDAR_INVALID", "SCHEDULED_TASK_LOCAL_TIME_GAP", "SCHEDULED_TASK_ONCE_NOT_FUTURE"].includes(error.message)
          ? "invalid_scheduled_task"
          : "business_store_unavailable"
        if (admittedContext !== null)
          await reply(response, code === "invalid_scheduled_task" ? 400 : 503, failure(code, code === "invalid_scheduled_task" ? "Scheduled task fields are invalid" : "The BFF business store is unavailable", id), admittedContext, this.idempotency, mutation).catch(() => undefined)
      } else if (!response.headersSent && !response.writableEnded && !response.destroyed) send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", id))
    } finally {
      request.removeListener("aborted", close)
      response.removeListener("close", close)
    }
  }
}
