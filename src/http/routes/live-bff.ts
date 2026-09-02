import type { IncomingMessage, ServerResponse } from "node:http"

import { randomUUID } from "node:crypto"

import type { BffConfig } from "../../config.js"
import { failure, ok } from "../../contracts/index.js"
import { PostgresBffRepositories } from "../../infrastructure/postgres/repositories.js"
import { idempotencyKey, type Context } from "../request.js"
import { reply } from "../response.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import { projectData, scheduledData } from "./helpers.js"
import { markScheduledTaskFailed, reconcileSchedulerTask } from "./scheduler.js"
import { scheduledCreateInput, scheduledPatchInput } from "../../modules/scheduled/input.js"
import { scheduledTaskId } from "./scheduler.js"

export async function liveBffBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: Context,
  businessPath: string[],
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
  store: PostgresBffRepositories,
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
        const name = typeof json.name === "string" ? json.name.trim() : ""
        if (name === "") {
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
        let task = await store.services.scheduledTasks.create(
          tenantId,
          context.identity.userId,
          input,
          scheduledTaskId(context, `/${businessPath.join("/")}`, idempotencyKey(request) ?? randomUUID()),
        )
        if (task.status === "failed") {
          task = (await store.services.scheduledTasks.update(tenantId, task.id, { status: "active", enabled: true })) ?? task
        }
        const scheduleResult = await reconcileSchedulerTask(request, config, context, task, context.identity.userId, "register")
        if (scheduleResult.status >= 400) {
          await markScheduledTaskFailed(store, tenantId, task.id)
          await reply(response, 503, failure("scheduler_registration_failed", "Scheduled task could not be registered", context.requestId), context, idempotency, mutation)
        } else {
          await reply(response, 200, ok({ task }, context.requestId), context, idempotency, mutation)
        }
        return true
      }
    }

    if (businessPath[0] === "scheduled-tasks") {
      const taskId = businessPath[1]
      if (businessPath.length === 1 && method === "GET") {
        await reply(response, 200, ok(scheduledData(await store.services.scheduledTasks.list(tenantId)), context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 1 && method === "POST") {
        const input = scheduledCreateInput(json, typeof json.project_id === "string" ? json.project_id : undefined)
        if (input === null) {
          await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", context.requestId), context, idempotency, mutation)
          return true
        }
        let task = await store.services.scheduledTasks.create(
          tenantId,
          context.identity.userId,
          input,
          scheduledTaskId(context, `/${businessPath.join("/")}`, idempotencyKey(request) ?? randomUUID()),
        )
        if (task.status === "failed") {
          task = (await store.services.scheduledTasks.update(tenantId, task.id, { status: "active", enabled: true })) ?? task
        }
        const scheduleResult = await reconcileSchedulerTask(request, config, context, task, context.identity.userId, "register")
        if (scheduleResult.status >= 400) {
          await markScheduledTaskFailed(store, tenantId, task.id)
          await reply(response, 503, failure("scheduler_registration_failed", "Scheduled task could not be registered", context.requestId), context, idempotency, mutation)
        } else {
          await reply(response, 200, ok({ task }, context.requestId), context, idempotency, mutation)
        }
        return true
      }
      if (businessPath.length === 2 && taskId !== undefined && method === "GET") {
        const task = await store.services.scheduledTasks.find(tenantId, taskId)
        await reply(response, task === null ? 404 : 200, task === null ? failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId) : ok({ task }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 2 && taskId !== undefined && method === "PATCH") {
        const patch = scheduledPatchInput(json)
        if (patch === null) {
          await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", context.requestId), context, idempotency, mutation)
          return true
        }
        const record = taskId === undefined ? null : await store.services.scheduledTasks.findRecord(tenantId, taskId)
        const task = record === null ? null : await store.services.scheduledTasks.update(tenantId, taskId, patch)
        if (task === null) {
          await reply(response, 404, failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId), context, idempotency, mutation)
        } else {
          const scheduleResult = await reconcileSchedulerTask(request, config, context, task, record?.ownerId ?? context.identity.userId, "replace")
          if (scheduleResult.status >= 400) {
            await markScheduledTaskFailed(store, tenantId, task.id)
            await reply(response, 503, failure("scheduler_update_failed", "Scheduled task scheduler registration could not be updated", context.requestId), context, idempotency, mutation)
          } else {
            await reply(response, 200, ok({ task }, context.requestId), context, idempotency, mutation)
          }
        }
        return true
      }
      if (businessPath.length === 2 && taskId !== undefined && method === "DELETE") {
        const record = await store.services.scheduledTasks.findRecord(tenantId, taskId)
        if (record === null) {
          await reply(response, 404, failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId), context, idempotency, mutation)
        } else {
          const scheduleResult = await reconcileSchedulerTask(request, config, context, record.task, record.ownerId, "delete")
          if (scheduleResult.status >= 400) {
            await reply(response, 503, failure("scheduler_delete_failed", "Scheduled task scheduler registration could not be removed", context.requestId), context, idempotency, mutation)
          } else {
            const deleted = await store.services.scheduledTasks.delete(tenantId, taskId)
            await reply(response, deleted ? 200 : 404, deleted ? ok({ ok: true }, context.requestId) : failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId), context, idempotency, mutation)
          }
        }
        return true
      }
      if (businessPath.length === 3 && taskId !== undefined && businessPath[2] === "retry" && method === "POST") {
        const record = await store.services.scheduledTasks.findRecord(tenantId, taskId)
        const task = record === null ? null : await store.services.scheduledTasks.update(tenantId, taskId, { status: "active", enabled: true })
        if (task === null) {
          await reply(response, 404, failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId), context, idempotency, mutation)
        } else {
          const scheduleResult = await reconcileSchedulerTask(request, config, context, task, record?.ownerId ?? context.identity.userId, "replace")
          if (scheduleResult.status >= 400) {
            await markScheduledTaskFailed(store, tenantId, task.id)
            await reply(response, 503, failure("scheduler_retry_failed", "Scheduled task could not be registered again", context.requestId), context, idempotency, mutation)
          } else {
            await reply(response, 200, ok({ task }, context.requestId), context, idempotency, mutation)
          }
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
