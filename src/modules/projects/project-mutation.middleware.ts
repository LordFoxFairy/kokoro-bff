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
import { failure } from "../../contracts/index.js"
import { mutationTicket } from "../../application/idempotency.js"
import { idempotencyKey, mutationFingerprint, pathOf, readBody, requestBodyJson, requestId } from "../../http/request.js"
import { send } from "../../http/response.js"
import { handleProjectMutationBusiness, projectMutation } from "../../http/routes/project-mutation-native.js"

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
    void this.handle(request, response).catch(() => {
      if (!response.headersSent && !response.writableEnded && !response.destroyed)
        send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", requestId(request)))
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
      const admitted = await authorizeUserRequest(request, this.config, this.admission, id, abort.signal)
      if (!admitted.ok) {
        send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
        return
      }
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
      await handleProjectMutationBusiness(request, response, admitted.context, this.projects, json, mutation, this.idempotency)
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
