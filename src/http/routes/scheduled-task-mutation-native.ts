import type { IncomingMessage, ServerResponse } from "node:http"
import type { RequestContext } from "../../domain/request-context.js"
import type { ScheduledTaskCreateInput, ScheduledTaskMutationLineage } from "../../application/scheduled/task-facts.js"
import type { ScheduledTaskService } from "../../application/scheduled-task-service.js"
import type { ProjectLookup } from "../../application/projects/types.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import { failure, ok } from "../../contracts/index.js"
import { idempotencyKey, pathOf } from "../request.js"
import { reply } from "../response.js"
import { scheduledCreateInput, scheduledPatchInput } from "../../application/scheduled/input.js"
import { scheduledTaskResponse } from "../../application/scheduled/mappers.js"
import { scheduledTaskId } from "./scheduler.js"

export type ScheduledTaskMutation = Readonly<
  | { kind: "create" }
  | { kind: "project_create"; projectId: string }
  | { kind: "patch"; taskId: string }
  | { kind: "delete"; taskId: string }
  | { kind: "retry"; taskId: string }
>

export type ScheduledTaskAuthorization =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; status: 400; code: "invalid_scheduled_task"; message: string }>
  | Readonly<{ ok: false; status: 404; code: "project_not_found" | "scheduled_task_not_found"; message: string }>

export type ScheduledTaskMutationOwners = Readonly<{
  projects: ProjectLookup
  scheduledTasks: Pick<ScheduledTaskService, "find">
}>

export function scheduledTaskMutation(request: IncomingMessage): ScheduledTaskMutation | null {
  let path: string[]
  try {
    path = pathOf(request)
  } catch {
    return null
  }
  if (path[0] === "v1" && path[1] === "scheduled-tasks") {
    if (path.length === 2 && request.method === "POST") return { kind: "create" }
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

export async function authorizeScheduledTaskMutation(
  method: string,
  context: RequestContext,
  businessPath: readonly string[],
  scheduledCreate: ScheduledTaskCreateInput | null,
  owners: ScheduledTaskMutationOwners,
): Promise<ScheduledTaskAuthorization | null> {
  if (!new Set(["POST", "PATCH", "DELETE"]).has(method)) return null
  const scope = { tenantId: context.identity.namespace, subjectId: context.identity.userId }
  if (businessPath[0] === "projects" && businessPath.length > 1) {
    const projectId = businessPath[1]
    if (projectId !== undefined && (await owners.projects.find(scope, projectId)) === null)
      return { ok: false, status: 404, code: "project_not_found", message: "Project was not found" }
    return { ok: true }
  }
  if (businessPath[0] !== "scheduled-tasks") return null
  if (businessPath.length > 1) {
    const taskId = businessPath[1]
    if (taskId !== undefined && (await owners.scheduledTasks.find(scope, taskId)) === null)
      return { ok: false, status: 404, code: "scheduled_task_not_found", message: "Scheduled task was not found" }
    return { ok: true }
  }
  if (method === "POST") {
    if (scheduledCreate === null) return { ok: false, status: 400, code: "invalid_scheduled_task", message: "Scheduled task fields are invalid" }
    if (scheduledCreate.projectId !== undefined && (await owners.projects.find(scope, scheduledCreate.projectId)) === null)
      return { ok: false, status: 404, code: "project_not_found", message: "Project was not found" }
  }
  return { ok: true }
}

function mutationLineage(context: RequestContext, key: string): ScheduledTaskMutationLineage {
  return {
    tenantId: context.identity.namespace,
    actorId: context.identity.userId,
    requestId: context.requestId,
    idempotencyKey: key,
  }
}

/** Execute a scheduled-task mutation after admission and idempotency receipt claim. */
export async function handleScheduledTaskMutationBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  tasks: ScheduledTaskService,
  projects: ProjectLookup,
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
  checkedCreate?: ScheduledTaskCreateInput,
): Promise<boolean> {
  const route = scheduledTaskMutation(request)
  if (route === null) return false
  const id = context.requestId
  const key = idempotencyKey(request)
  if (key === null) {
    await reply(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", id), context, idempotency, mutation)
    return true
  }
  const scope = { tenantId: context.identity.namespace, subjectId: context.identity.userId }
  try {
    if (route.kind === "create" || route.kind === "project_create") {
      const preflight = route.kind === "create" ? checkedCreate : undefined
      if (preflight === undefined && new URL(request.url ?? "/", "http://bff.local").search !== "") {
        await reply(
          response,
          400,
          failure("invalid_scheduled_task", "Scheduled task creation does not accept query parameters", id),
          context,
          idempotency,
          mutation,
        )
        return true
      }
      const input = preflight ?? scheduledCreateInput(json, route.kind === "project_create" ? route.projectId : undefined)
      if (input === null) {
        await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", id), context, idempotency, mutation)
        return true
      }
      if (preflight === undefined && input.projectId !== undefined && (await projects.find(scope, input.projectId)) === null) {
        await reply(response, 404, failure("project_not_found", "Project was not found", id), context, idempotency, mutation)
        return true
      }
      const task = await tasks.create(scope, input, scheduledTaskId(context, `/${pathOf(request).slice(1).join("/")}`, key), mutationLineage(context, key))
      await reply(response, 200, ok({ task: scheduledTaskResponse(task) }, id), context, idempotency, mutation)
      return true
    }
    if (route.kind === "patch") {
      const patch = scheduledPatchInput(json)
      if (patch === null) {
        await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", id), context, idempotency, mutation)
        return true
      }
      const task = await tasks.update(scope, route.taskId, patch, mutationLineage(context, key))
      await reply(
        response,
        task === null ? 404 : 200,
        task === null ? failure("scheduled_task_not_found", "Scheduled task was not found", id) : ok({ task: scheduledTaskResponse(task) }, id),
        context,
        idempotency,
        mutation,
      )
      return true
    }
    if (route.kind === "delete") {
      const deleted = await tasks.delete(scope, route.taskId, mutationLineage(context, key))
      await reply(
        response,
        deleted ? 200 : 404,
        deleted ? ok({ ok: true }, id) : failure("scheduled_task_not_found", "Scheduled task was not found", id),
        context,
        idempotency,
        mutation,
      )
      return true
    }
    const task = await tasks.update(scope, route.taskId, { status: "active", enabled: true }, mutationLineage(context, key))
    await reply(
      response,
      task === null ? 404 : 200,
      task === null ? failure("scheduled_task_not_found", "Scheduled task was not found", id) : ok({ task: scheduledTaskResponse(task) }, id),
      context,
      idempotency,
      mutation,
    )
    return true
  } catch (error) {
    const projectNotFound = error instanceof Error && error.message === "PROJECT_NOT_FOUND"
    const invalid =
      error instanceof Error && ["SCHEDULED_TASK_CALENDAR_INVALID", "SCHEDULED_TASK_LOCAL_TIME_GAP", "SCHEDULED_TASK_ONCE_NOT_FUTURE"].includes(error.message)
    await reply(
      response,
      projectNotFound ? 404 : invalid ? 400 : 503,
      failure(
        projectNotFound ? "project_not_found" : invalid ? "invalid_scheduled_task" : "business_store_unavailable",
        projectNotFound ? "Project was not found" : invalid ? "Scheduled task fields are invalid" : "The BFF business store is unavailable",
        id,
      ),
      context,
      idempotency,
      mutation,
    )
    return true
  }
}
