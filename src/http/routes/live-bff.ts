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
  try {
    if (businessPath[0] === "projects") {
      const projectId = businessPath[1]
      if (businessPath.length === 1 && method === "GET") {
        await reply(response, 200, ok(projectData(await store.services.projects.list(tenantId)), context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 1 && method === "POST") {
        const name = projectName(json.name)
        if (name === null) {
          await reply(response, 400, failure("invalid_project", "Project name is required", context.requestId), context, idempotency, mutation)
          return true
        }
        const project = await store.services.projects.create(tenantId, name, typeof json.description === "string" ? json.description : "")
        await reply(response, 200, ok({ project }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 2 && projectId !== undefined && method === "GET") {
        const project = await store.services.projects.find(tenantId, projectId)
        await reply(response, project === null ? 404 : 200, project === null ? failure("project_not_found", "Project was not found", context.requestId) : ok({ project }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 2 && projectId !== undefined && method === "PATCH") {
        if (typeof json.instruction !== "string") {
          await reply(response, 400, failure("invalid_project_instruction", "Project instruction must be a string", context.requestId), context, idempotency, mutation)
          return true
        }
        const project = await store.services.projects.updateInstruction(tenantId, projectId, json.instruction, context.identity.userId)
        await reply(response, project === null ? 404 : 200, project === null ? failure("project_not_found", "Project was not found", context.requestId) : ok({ project }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 3 && projectId !== undefined && businessPath[2] === "instruction-revisions" && method === "GET") {
        const revisions = await store.services.projects.revisions(tenantId, projectId)
        await reply(response, revisions === null ? 404 : 200, revisions === null ? failure("project_not_found", "Project was not found", context.requestId) : ok({ items: revisions }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 3 && projectId !== undefined && businessPath[2] === "tasks" && method === "GET") {
        if (await store.services.projects.find(tenantId, projectId) === null) {
          await reply(response, 404, failure("project_not_found", "Project was not found", context.requestId), context, idempotency, mutation)
        } else {
          await reply(response, 200, ok({ tasks: await store.services.projects.tasks(tenantId, projectId) }, context.requestId), context, idempotency, mutation)
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
        const project = await store.services.projects.find(tenantId, projectId)
        if (project === null) {
          await reply(response, 404, failure("project_not_found", "Project was not found", context.requestId), context, idempotency, mutation)
        } else {
          await store.services.projects.setSkill(tenantId, project.id, businessPath[3], json.enabled)
          await reply(response, 200, ok({ skill: { project_id: project.id, name: businessPath[3], enabled: json.enabled } }, context.requestId), context, idempotency, mutation)
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
          tenantId,
          context.identity.userId,
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
        const tasks = await store.services.scheduledTasks.list(tenantId)
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
          tenantId,
          context.identity.userId,
          input,
          scheduledTaskId(context, `/${businessPath.join("/")}`, lineage.idempotencyKey),
          lineage,
        )
        await reply(response, 200, ok({ task: scheduledTaskResponse(task) }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 2 && taskId !== undefined && method === "GET") {
        const task = await store.services.scheduledTasks.find(tenantId, taskId)
        await reply(response, task === null ? 404 : 200, task === null ? failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId) : ok({ task: scheduledTaskResponse(task) }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 2 && taskId !== undefined && method === "PATCH") {
        const patch = scheduledPatchInput(json)
        if (patch === null) {
          await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", context.requestId), context, idempotency, mutation)
          return true
        }
        const task = await store.services.scheduledTasks.update(tenantId, taskId, patch, mutationLineage(context, request))
        if (task === null) {
          await reply(response, 404, failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId), context, idempotency, mutation)
        } else {
          await reply(response, 200, ok({ task: scheduledTaskResponse(task) }, context.requestId), context, idempotency, mutation)
        }
        return true
      }
      if (businessPath.length === 2 && taskId !== undefined && method === "DELETE") {
        const deleted = await store.services.scheduledTasks.delete(tenantId, taskId, mutationLineage(context, request))
        await reply(response, deleted ? 200 : 404, deleted ? ok({ ok: true }, context.requestId) : failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 3 && taskId !== undefined && businessPath[2] === "retry" && method === "POST") {
        const task = await store.services.scheduledTasks.update(tenantId, taskId, { status: "active", enabled: true }, mutationLineage(context, request))
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
