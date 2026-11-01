import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, BILLING_IDEMPOTENCY, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { mutationTicket } from "../../application/idempotency.js"
import { idempotencyKey, mutationFingerprint, pathOf, readBody, requestBodyJson, requestId, requiresIdempotency } from "../../http/request.js"
import { send } from "../../http/response.js"
import { billingPersonalRequest, handleBillingPersonalBusiness } from "../../http/routes/billing-personal-native.js"

@Injectable()
export class BillingPersonalMiddleware implements NestMiddleware {
  private readonly idempotency = new Map<string, IdempotencyEntry>()

  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(BILLING_IDEMPOTENCY) private readonly persistent: IdempotencyRepository,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    if (!billingPersonalRequest(request)) {
      next()
      return
    }
    void this.handle(request, response).catch(() => {
      if (!response.headersSent && !response.writableEnded && !response.destroyed) send(response, 503, failure("billing_unavailable", "Billing is unavailable", requestId(request)))
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = requestId(request)
    response.setHeader("x-request-id", id)
    const admitted = await authorizeUserRequest(request, this.config, this.admission, id, AbortSignal.timeout(10_000))
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return
    }
    let body: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let json: Record<string, unknown> = {}
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method ?? "")) {
      body = await readBody(request)
      const parsed = requestBodyJson(request, body)
      if (parsed === null) {
        send(response, 400, failure("invalid_json", "Request body must be a JSON object", id))
        return
      }
      json = parsed
    }
    const path = pathOf(request).slice(1)
    const key = idempotencyKey(request)
    if (requiresIdempotency(request.method ?? "GET", path) && key === null) {
      send(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", id))
      return
    }
    const ticket = await mutationTicket(
      key,
      request.method ?? "GET",
      `/${path.join("/")}`,
      admitted.context,
      mutationFingerprint(request, path, json, body),
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
    await handleBillingPersonalBusiness(request, response, this.config, admitted.context, path, json, ticket.ticket, this.idempotency)
  }
}
