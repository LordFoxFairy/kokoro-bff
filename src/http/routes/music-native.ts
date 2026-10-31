import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { mutationTicket } from "../../application/idempotency.js"
import { liveMoriBusiness } from "./music.js"
import { mutationFingerprint, idempotencyKey, isMutation, requiresIdempotency, pathOf, readBody, requestBodyJson, requestId } from "../request.js"
import { reply, send } from "../response.js"

export type MusicIdempotency = Readonly<{
  entries: Map<string, IdempotencyEntry>
  persistent?: IdempotencyRepository
}>

export async function handleMoriRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  idempotency: MusicIdempotency,
): Promise<boolean> {
  let path: string[]
  try {
    path = pathOf(request)
  } catch {
    return false
  }
  if (path[0] !== "v1" || path[1] !== "mori") return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  const aborted = (): void => controller.abort()
  const closed = (): void => { if (!response.writableEnded) controller.abort() }
  request.once("aborted", aborted)
  response.once("close", closed)
  if (request.aborted || response.destroyed) controller.abort()
  const work = Promise.resolve().then(() => {
    controller.signal.throwIfAborted()
    return authorizeUserRequest(request, config, admission, id, controller.signal)
  })
  const admitted = await new Promise<Awaited<typeof work>>((resolve) => {
    const unavailable = (): void => resolve({ ok: false, status: 503, code: "iam_admission_unavailable" })
    controller.signal.addEventListener("abort", unavailable, { once: true })
    void work.then(resolve, unavailable).finally(() => controller.signal.removeEventListener("abort", unavailable))
    if (controller.signal.aborted) unavailable()
  }).finally(() => {
    clearTimeout(timer)
    request.removeListener("aborted", aborted)
    response.removeListener("close", closed)
  })
  if (request.aborted || response.destroyed) return true
  if (!admitted.ok) {
    send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
    return true
  }
  const businessPath = path.slice(1)
  const method = request.method ?? "GET"
  const mutationRequired = requiresIdempotency(method, businessPath)
  const key = idempotencyKey(request)
  if (mutationRequired && key === null) {
    send(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", id))
    return true
  }
  let body: Buffer | undefined
  let json: Record<string, unknown> = {}
  if (isMutation(method)) {
    try {
      body = await readBody(request)
    } catch {
      send(response, 413, failure("request_body_too_large", "Request body is too large", id))
      return true
    }
    const parsed = requestBodyJson(request, body)
    if (parsed === null) {
      send(response, 400, failure("invalid_json", "Request body must be a JSON object", id))
      return true
    }
    json = parsed
  }
  let mutation: MutationTicket | null = null
  if (mutationRequired) {
    const result = await mutationTicket(
      key,
      method,
      `/${businessPath.join("/")}`,
      admitted.context,
      mutationFingerprint(request, businessPath, json, body ?? Buffer.alloc(0)),
      idempotency.entries,
      idempotency.persistent,
    )
    if (result.replay !== null) {
      send(response, result.replay.status, result.replay.body)
      return true
    }
    if (result.conflict) {
      send(response, 409, failure("idempotency_conflict", "Idempotency key already used with a different request payload", id))
      return true
    }
    if (result.pending) {
      send(response, 409, failure("idempotency_in_progress", "An identical mutation is already in progress", id))
      return true
    }
    mutation = result.ticket
  }
  try {
    await liveMoriBusiness(request, response, config, admitted.context, businessPath, body, mutation, idempotency.entries)
  } catch {
    await reply(response, 503, failure("music_owner_unavailable", "The configured Music owner is unavailable", id), admitted.context, idempotency.entries, mutation)
  }
  return true
}
