import type { IncomingMessage, ServerResponse } from "node:http"

import { failure, ok } from "../../contracts/index.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { ScheduledTaskMutationLineage } from "../../application/ports/scheduled-task-repository.js"
import { idempotencyKey } from "../request.js"
import type { RequestContext } from "../../domain/request-context.js"
import { reply } from "../response.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import { projectData, scheduledData } from "./helpers.js"
import { scheduledCreateInput, scheduledPatchInput } from "../../application/scheduled/input.js"
import { scheduledTaskResponse } from "../../application/scheduled/mappers.js"
import { scheduledTaskId } from "./scheduler.js"
import { projectName } from "../../domain/project/name.js"

export type LiveBffAuthorization =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; status: 404; code: "project_not_found" | "scheduled_task_not_found"; message: string }>

/** Gate existing private resources before generic mutation receipt admission. */
export async function authorizeLiveBffMutation(
  method: string,
  context: RequestContext,
  businessPath: readonly string[],
  json: Readonly<Record<string, unknown>>,
  store: BffBusinessStore,
): Promise<LiveBffAuthorization | null> {
  if (!new Set(["POST", "PATCH", "DELETE"]).has(method)) return null
  const scope = { tenantId: context.identity.namespace, subjectId: context.identity.userId }

  if (businessPath[0] === "projects" && businessPath.length > 1) {
    const projectId = businessPath[1]
    if (projectId !== undefined && await store.services.projects.find(scope, projectId) === null) {
      return { ok: false, status: 404, code: "project_not_found", message: "Project was not found" }
    }
    return { ok: true }
  }

  if (businessPath[0] === "scheduled-tasks") {
    if (businessPath.length > 1) {
      const taskId = businessPath[1]
      if (taskId !== undefined && await store.services.scheduledTasks.find(scope, taskId) === null) {
        return { ok: false, status: 404, code: "scheduled_task_not_found", message: "Scheduled task was not found" }
      }
      return { ok: true }
    }
    const projectId = typeof json.project_id === "string" ? json.project_id.trim() : ""
    if (projectId !== "" && await store.services.projects.find(scope, projectId) === null) {
      return { ok: false, status: 404, code: "project_not_found", message: "Project was not found" }
    }
    return { ok: true }
  }
  return null
}

function mutationLineage(context: RequestContext, request: IncomingMessage): ScheduledTaskMutationLineage {
  const key = idempotencyKey(request)
  if (key === null) throw new Error("SCHEDULED_TASK_IDEMPOTENCY_KEY_REQUIRED")
  return {
    tenantId: context.identity.namespace,
    actorId: context.identity.userId,
    requestId: context.requestId,
    idempotencyKey: key,
  }
}

export async function liveBffBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  businessPath: string[],
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
  store: BffBusinessStore,
): Promise<boolean> {
  const method = request.method || "GET"
  const tenantId = context.identity.namespace
  const ownerScope = { tenantId, subjectId: context.identity.userId }
  try {
    if (businessPath[0] === "projects") {
      const projectId = businessPath[1]
      if (businessPath.length === 1 && method === "GET") {
        await reply(response, 200, ok(projectData(await store.services.projects.list(ownerScope)), context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 1 && method === "POST") {
        const name = projectName(json.name)
        if (name === null) {
          await reply(response, 400, failure("invalid_project", "Project name is required", context.requestId), context, idempotency, mutation)
          return true
        }
        const project = await store.services.projects.create(ownerScope, name, typeof json.description === "string" ? json.description : "")
        await reply(response, 200, ok({ project }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 2 && projectId !== undefined && method === "GET") {
        const project = await store.services.projects.find(ownerScope, projectId)
        await reply(response, project === null ? 404 : 200, project === null ? failure("project_not_found", "Project was not found", context.requestId) : ok({ project }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 2 && projectId !== undefined && method === "PATCH") {
        if (typeof json.instruction !== "string") {
          await reply(response, 400, failure("invalid_project_instruction", "Project instruction must be a string", context.requestId), context, idempotency, mutation)
          return true
        }
        const project = await store.services.projects.updateInstruction(ownerScope, projectId, json.instruction)
        await reply(response, project === null ? 404 : 200, project === null ? failure("project_not_found", "Project was not found", context.requestId) : ok({ project }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 3 && projectId !== undefined && businessPath[2] === "instruction-revisions" && method === "GET") {
        const revisions = await store.services.projects.revisions(ownerScope, projectId)
        await reply(response, revisions === null ? 404 : 200, revisions === null ? failure("project_not_found", "Project was not found", context.requestId) : ok({ items: revisions }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 3 && projectId !== undefined && businessPath[2] === "tasks" && method === "GET") {
        const tasks = await store.services.projects.tasks(ownerScope, projectId)
        if (tasks === null) {
          await reply(response, 404, failure("project_not_found", "Project was not found", context.requestId), context, idempotency, mutation)
        } else {
          await reply(response, 200, ok({ tasks }, context.requestId), context, idempotency, mutation)
        }
        return true
      }
      if (businessPath.length === 3 && projectId !== undefined && businessPath[2] === "resources" && method === "POST") {
        await reply(response, 503, failure("storage_projection_not_configured", "Storage resource projection is not configured", context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 4 && projectId !== undefined && businessPath[2] === "skills" && businessPath[3] !== undefined && method === "PATCH") {
        if (typeof json.enabled !== "boolean") {
          await reply(response, 400, failure("invalid_project_skill", "Skill enabled must be a boolean", context.requestId), context, idempotency, mutation)
          return true
        }
        const project = await store.services.projects.find(ownerScope, projectId)
        if (project === null) {
          await reply(response, 404, failure("project_not_found", "Project was not found", context.requestId), context, idempotency, mutation)
        } else {
          const updated = await store.services.projects.setSkill(ownerScope, project.id, businessPath[3], json.enabled)
          await reply(response, updated ? 200 : 404, updated
            ? ok({ skill: { project_id: project.id, name: businessPath[3], enabled: json.enabled } }, context.requestId)
            : failure("project_not_found", "Project was not found", context.requestId), context, idempotency, mutation)
        }
        return true
      }
      if (businessPath.length === 3 && projectId !== undefined && businessPath[2] === "scheduled-tasks" && method === "POST") {
        const input = scheduledCreateInput(json, projectId)
        if (input === null) {
          await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", context.requestId), context, idempotency, mutation)
          return true
        }
        const lineage = mutationLineage(context, request)
        const task = await store.services.scheduledTasks.create(
          ownerScope,
          input,
          scheduledTaskId(context, `/${businessPath.join("/")}`, lineage.idempotencyKey),
          lineage,
        )
        await reply(response, 200, ok({ task: scheduledTaskResponse(task) }, context.requestId), context, idempotency, mutation)
        return true
      }
    }

    if (businessPath[0] === "scheduled-tasks") {
      const taskId = businessPath[1]
      if (businessPath.length === 1 && method === "GET") {
        const tasks = await store.services.scheduledTasks.list(ownerScope)
        await reply(response, 200, ok(scheduledData(tasks.map(scheduledTaskResponse)), context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 1 && method === "POST") {
        const input = scheduledCreateInput(json, typeof json.project_id === "string" ? json.project_id : undefined)
        if (input === null) {
          await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", context.requestId), context, idempotency, mutation)
          return true
        }
        const lineage = mutationLineage(context, request)
        const task = await store.services.scheduledTasks.create(
          ownerScope,
          input,
          scheduledTaskId(context, `/${businessPath.join("/")}`, lineage.idempotencyKey),
          lineage,
        )
        await reply(response, 200, ok({ task: scheduledTaskResponse(task) }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 2 && taskId !== undefined && method === "GET") {
        const task = await store.services.scheduledTasks.find(ownerScope, taskId)
        await reply(response, task === null ? 404 : 200, task === null ? failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId) : ok({ task: scheduledTaskResponse(task) }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 2 && taskId !== undefined && method === "PATCH") {
        const patch = scheduledPatchInput(json)
        if (patch === null) {
          await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", context.requestId), context, idempotency, mutation)
          return true
        }
        const task = await store.services.scheduledTasks.update(ownerScope, taskId, patch, mutationLineage(context, request))
        if (task === null) {
          await reply(response, 404, failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId), context, idempotency, mutation)
        } else {
          await reply(response, 200, ok({ task: scheduledTaskResponse(task) }, context.requestId), context, idempotency, mutation)
        }
        return true
      }
      if (businessPath.length === 2 && taskId !== undefined && method === "DELETE") {
        const deleted = await store.services.scheduledTasks.delete(ownerScope, taskId, mutationLineage(context, request))
        await reply(response, deleted ? 200 : 404, deleted ? ok({ ok: true }, context.requestId) : failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 3 && taskId !== undefined && businessPath[2] === "retry" && method === "POST") {
        const task = await store.services.scheduledTasks.update(ownerScope, taskId, { status: "active", enabled: true }, mutationLineage(context, request))
        if (task === null) {
          await reply(response, 404, failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId), context, idempotency, mutation)
        } else {
          await reply(response, 200, ok({ task: scheduledTaskResponse(task) }, context.requestId), context, idempotency, mutation)
        }
        return true
      }
    }
    return false
  } catch (error) {
    if (error instanceof Error && error.message === "PROJECT_SLUG_CONFLICT") {
      await reply(response, 409, failure("project_exists", "A project with this slug already exists", context.requestId), context, idempotency, mutation)
    } else if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
      await reply(response, 404, failure("project_not_found", "Project was not found", context.requestId), context, idempotency, mutation)
    } else {
      await reply(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", context.requestId), context, idempotency, mutation)
    }
    return true
  }
}
