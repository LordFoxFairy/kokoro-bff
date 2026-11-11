import type { IncomingMessage, ServerResponse } from "node:http"
import type { RequestContext } from "../../domain/request-context.js"
import type { ProjectMutationStore } from "../../infrastructure/postgres/project-store.js"
import type { IdempotencyEntry, IdempotencyReceipt, MutationTicket } from "../../application/idempotency.js"
import { failure, ok } from "../../contracts/index.js"
import { pathOf } from "../request.js"
import { reply, send } from "../response.js"
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
  const execute = async (commands: Pick<ProjectMutationStore, "create" | "updateInstruction">): Promise<IdempotencyReceipt> => {
    if (route.kind === "create") {
      const name = projectName(json.name)
      if (name === null) return { status: 400, body: failure("invalid_project", "Project name is required", id) }
      const project = await commands.create(scope, name, typeof json.description === "string" ? json.description : "")
      return { status: 200, body: ok({ project }, id) }
    }
    if (typeof json.instruction !== "string") return { status: 400, body: failure("invalid_project_instruction", "Project instruction must be a string", id) }
    const project = await commands.updateInstruction(scope, route.projectId, json.instruction)
    return {
      status: project === null ? 404 : 200,
      body: project === null ? failure("project_not_found", "Project was not found", id) : ok({ project }, id),
    }
  }
  try {
    if (mutation?.persistent !== undefined) {
      const result = await projects.withReceipt(mutation, execute)
      // The business write and successful response are already committed together. Do not complete again in reply().
      if (result.kind === "receipt") send(response, result.receipt.status, result.receipt.body)
      else if (result.kind === "conflict")
        send(response, 409, failure("idempotency_conflict", "Idempotency key already used with a different request payload", id))
      else send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", id))
    } else {
      const receipt = await execute(projects)
      await reply(response, receipt.status, receipt.body, context, idempotency, mutation)
    }
    return true
  } catch (error) {
    const mapped =
      error instanceof Error && error.message === "PROJECT_SLUG_CONFLICT"
        ? { status: 409, body: failure("project_exists", "A project with this slug already exists", id) }
        : error instanceof Error && error.message === "PROJECT_NOT_FOUND"
          ? { status: 404, body: failure("project_not_found", "Project was not found", id) }
          : { status: 503, body: failure("business_store_unavailable", "The BFF business store is unavailable", id) }
    await reply(response, mapped.status, mapped.body, context, idempotency, mutation)
    return true
  }
}
