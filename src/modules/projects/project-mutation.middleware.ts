import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, PROJECT_IDEMPOTENCY, PROJECT_EDIT_LOOKUP, PROJECT_READ_LOOKUP, PROJECT_MUTATIONS, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ProjectLookup } from "../../application/projects/types.js"
import type { ProjectMutationStore } from "../../infrastructure/postgres/project-store.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { mutationTicket } from "../../application/idempotency.js"
import { idempotencyKey, mutationFingerprint, pathOf, readBody, requestBodyJson, requestId } from "../../http/request.js"
import { send } from "../../http/response.js"
import { handleProjectMutationBusiness, projectMutation, type ProjectMutation } from "../../http/routes/project-mutation-native.js"

/** Projects-owned create/instruction commands; unrelated traffic continues to the next feature. */
@Injectable()
export class ProjectMutationMiddleware implements NestMiddleware {
  private readonly idempotency = new Map<string, IdempotencyEntry>()

  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(PROJECT_EDIT_LOOKUP) private readonly lookup: ProjectLookup,
    @Inject(PROJECT_READ_LOOKUP) private readonly readLookup: ProjectLookup,
    @Inject(PROJECT_MUTATIONS) private readonly mutations: ProjectMutationStore,
    @Inject(PROJECT_IDEMPOTENCY)
    private readonly persistent: IdempotencyRepository,
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
    try {
      const admitted = await authorizeUserRequest(request, this.config, this.admission, id, abort.signal, response)
      if (!admitted.ok) {
        send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
        return
      }
      const key = idempotencyKey(request)
      if (route.kind === "instruction" && key === null) {
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
      if (route.kind === "instruction") {
        if (abort.signal.aborted) return
        const { namespace: tenantId, userId: subjectId } = admitted.context.identity
        const project = await this.lookup.find({ tenantId, subjectId }, route.projectId)
        if (abort.signal.aborted) return
        if (project === null) {
          const visible = await this.readLookup.find({ tenantId, subjectId }, route.projectId)
          if (abort.signal.aborted) return
          send(
            response,
            visible === null ? 404 : 403,
            failure(visible === null ? "project_not_found" : "project_edit_forbidden", "Project cannot be edited", id),
          )
          return
        }
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
      await handleProjectMutationBusiness(request, response, admitted.context, this.mutations, json, mutation, this.idempotency)
    } catch (error) {
      if (!response.headersSent && !response.writableEnded && !response.destroyed) {
        send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", id))
      }
    } finally {
      request.removeListener("aborted", close)
      response.removeListener("close", close)
    }
  }
}
