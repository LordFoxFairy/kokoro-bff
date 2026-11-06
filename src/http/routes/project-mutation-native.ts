import type { IncomingMessage, ServerResponse } from "node:http"
import type { RequestContext } from "../../domain/request-context.js"
import type { ProjectMutationStore } from "../../infrastructure/postgres/project-store.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import { failure, ok } from "../../contracts/index.js"
import { pathOf } from "../request.js"
import { reply } from "../response.js"
import { projectName } from "../../domain/project/name.js"

export type ProjectMutation = Readonly<{ kind: "create" } | { kind: "instruction"; projectId: string }>

export function projectMutation(request: IncomingMessage): ProjectMutation | null {
  let path: string[]
  try {
    path = pathOf(request)
  } catch {
    return null
  }
  if (path[0] !== "v1" || path[1] !== "projects") return null
  if (request.method === "POST" && path.length === 2) return { kind: "create" }
  if (request.method === "PATCH" && path.length === 3 && path[2] !== undefined && path[2] !== "") return { kind: "instruction", projectId: path[2] }
  return null
}

/** Execute a project mutation after admission and idempotency receipt claim. */
export async function handleProjectMutationBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  projects: ProjectMutationStore,
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
): Promise<boolean> {
  const route = projectMutation(request)
  if (route === null) return false
  const id = context.requestId
  const scope = { tenantId: context.identity.namespace, subjectId: context.identity.userId }
  try {
    if (route.kind === "create") {
      const name = projectName(json.name)
      if (name === null) {
        await reply(response, 400, failure("invalid_project", "Project name is required", id), context, idempotency, mutation)
        return true
      }
      const project = await projects.create(scope, name, typeof json.description === "string" ? json.description : "")
      await reply(response, 200, ok({ project }, id), context, idempotency, mutation)
      return true
    }
    if (typeof json.instruction !== "string") {
      await reply(response, 400, failure("invalid_project_instruction", "Project instruction must be a string", id), context, idempotency, mutation)
      return true
    }
    const project = await projects.updateInstruction(scope, route.projectId, json.instruction)
    await reply(
      response,
      project === null ? 404 : 200,
      project === null ? failure("project_not_found", "Project was not found", id) : ok({ project }, id),
      context,
      idempotency,
      mutation,
    )
    return true
  } catch (error) {
    const mapped = error instanceof Error && error.message === "PROJECT_SLUG_CONFLICT"
      ? { status: 409, body: failure("project_exists", "A project with this slug already exists", id) }
      : error instanceof Error && error.message === "PROJECT_NOT_FOUND"
        ? { status: 404, body: failure("project_not_found", "Project was not found", id) }
        : { status: 503, body: failure("business_store_unavailable", "The BFF business store is unavailable", id) }
    await reply(response, mapped.status, mapped.body, context, idempotency, mutation)
    return true
  }
}
