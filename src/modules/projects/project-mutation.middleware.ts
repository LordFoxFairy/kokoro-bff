import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import {
  BFF_CONFIG,
  PROJECT_IDEMPOTENCY,
  PROJECT_SERVICE,
  SESSION_ADMISSION,
} from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ProjectService } from "../../application/project-service.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure, ok } from "../../contracts/index.js"
import { mutationTicket } from "../../application/idempotency.js"
import { idempotencyKey, mutationFingerprint, pathOf, readBody, requestBodyJson, requestId } from "../../http/request.js"
import { reply, send } from "../../http/response.js"
import { projectName } from "../../domain/project/name.js"

type ProjectMutation = Readonly<{ kind: "create" } | { kind: "instruction"; projectId: string }>

function projectMutation(request: IncomingMessage): ProjectMutation | null {
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

/** Projects-owned create/instruction commands; unrelated traffic continues to the next feature. */
@Injectable()
export class ProjectMutationMiddleware implements NestMiddleware {
  private readonly idempotency = new Map<string, IdempotencyEntry>()

  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(PROJECT_SERVICE) private readonly projects: ProjectService,
    @Inject(PROJECT_IDEMPOTENCY) private readonly persistent: IdempotencyRepository,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    const route = projectMutation(request)
    if (route === null) {
      next()
      return
    }
    void this.handle(request, response, route).catch(() => {
      if (!response.headersSent && !response.writableEnded && !response.destroyed)
        send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", requestId(request)))
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse, route: ProjectMutation): Promise<void> {
    const id = requestId(request)
    response.setHeader("x-request-id", id)
    const abort = new AbortController()
    const close = (): void => {
      if (!response.writableEnded) abort.abort()
    }
    request.once("aborted", close)
    response.once("close", close)
    let mutation: import("../../application/idempotency.js").MutationTicket | null = null
    let context: import("../../domain/request-context.js").RequestContext | null = null
    try {
      const admitted = await authorizeUserRequest(request, this.config, this.admission, id, abort.signal)
      if (!admitted.ok) {
        send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
        return
      }
      context = admitted.context
      const body = await readBody(request)
      const json = requestBodyJson(request, body)
      if (json === null) {
        send(response, 400, failure("invalid_json", "Request body must be a JSON object", id))
        return
      }
      const key = idempotencyKey(request)
      if (key === null) {
        send(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", id))
        return
      }
      const businessPath = pathOf(request).slice(1)
      const ticket = await mutationTicket(
        key,
        request.method ?? "POST",
        `/${businessPath.join("/")}`,
        admitted.context,
        mutationFingerprint(request, businessPath, json, body),
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
      const scope = { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId }
      if (route.kind === "create") {
        const name = projectName(json.name)
        if (name === null) {
          await reply(response, 400, failure("invalid_project", "Project name is required", id), admitted.context, this.idempotency, mutation)
          return
        }
        const project = await this.projects.create(scope, name, typeof json.description === "string" ? json.description : "")
        await reply(response, 200, ok({ project }, id), admitted.context, this.idempotency, mutation)
        return
      }
      if (typeof json.instruction !== "string") {
        await reply(response, 400, failure("invalid_project_instruction", "Project instruction must be a string", id), admitted.context, this.idempotency, mutation)
        return
      }
      const project = await this.projects.updateInstruction(scope, route.projectId, json.instruction)
      await reply(
        response,
        project === null ? 404 : 200,
        project === null ? failure("project_not_found", "Project was not found", id) : ok({ project }, id),
        admitted.context,
        this.idempotency,
        mutation,
      )
    } catch (error) {
      if (mutation !== null && context !== null) {
        const mapped = error instanceof Error && error.message === "PROJECT_SLUG_CONFLICT"
          ? { status: 409, body: failure("project_exists", "A project with this slug already exists", id) }
          : error instanceof Error && error.message === "PROJECT_NOT_FOUND"
            ? { status: 404, body: failure("project_not_found", "Project was not found", id) }
            : { status: 503, body: failure("business_store_unavailable", "The BFF business store is unavailable", id) }
        await reply(response, mapped.status, mapped.body, context, this.idempotency, mutation).catch(() => undefined)
      } else if (!response.headersSent && !response.writableEnded && !response.destroyed) {
        send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", id))
      }
    } finally {
      request.removeListener("aborted", close)
      response.removeListener("close", close)
    }
  }
}
