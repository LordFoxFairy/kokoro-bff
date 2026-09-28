import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { mutationTicket, type IdempotencyEntry, type MutationTicket } from "../../application/idempotency.js"
import { personalFileFingerprint, uploadPersonalFile } from "../../application/personal-file-upload.js"
import { PersonalFileError } from "../../application/personal-file-upload.error.js"
import type { PersonalFileContext, PersonalFileStorage } from "../../application/personal-file-upload.types.js"
import { PersonalFileUploadClient } from "../../infrastructure/clients/storage/personal-file-upload.js"
import { failure, ok } from "../../contracts/index.js"
import { parsePersonalFile } from "../personal-file-input.js"
import { reply, send } from "../response.js"

export async function personalFileUploadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  body: Buffer,
  receipts: IdempotencyRepository | null,
  idempotency: Map<string, IdempotencyEntry>,
  clientFactory: (config: NonNullable<BffConfig["storage"]>, context: PersonalFileContext) => PersonalFileStorage = (storage, scope) =>
    new PersonalFileUploadClient(storage, scope),
): Promise<void> {
  let mutation: MutationTicket | null = null
  const cancellation = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded) cancellation.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(45_000)])
  response.setHeader("x-request-id", context.requestId)
  try {
    if (receipts === null) throw new PersonalFileError("business_store_unavailable", 503, true)
    if (new URL(request.url ?? "/", "http://bff.invalid").search !== "") throw new PersonalFileError("invalid_library_file", 400)
    const rawKeys =
      request.rawHeaders?.flatMap((header, index, headers) => (index % 2 === 0 && header.toLowerCase() === "idempotency-key" ? [headers[index + 1]] : [])) ?? []
    const key = rawKeys[0]
    if (rawKeys.length !== 1 || typeof key !== "string" || key !== request.headers["idempotency-key"] || !/^[\x21-\x2b\x2d-\x7e]{1,191}$/u.test(key))
      throw new PersonalFileError("invalid_idempotency_key", 400)
    const input = await parsePersonalFile(request.headers["content-type"] ?? "", body)
    const ticket = await mutationTicket(key, "POST", "/library/files", context, personalFileFingerprint(input), idempotency, receipts).catch(() => {
      throw new PersonalFileError("business_store_unavailable", 503, true)
    })
    if (ticket.replay !== null) {
      send(response, ticket.replay.status, ticket.replay.body)
      return
    }
    if (ticket.conflict || ticket.pending) throw new PersonalFileError(ticket.conflict ? "idempotency_conflict" : "idempotency_in_progress", 409)
    mutation = ticket.ticket
    if (config.storage === undefined) throw new PersonalFileError("storage_unavailable", 503, true)
    const uploadContext = { tenantId: context.identity.namespace, subjectId: context.identity.userId, key, requestId: context.requestId }
    const file = await uploadPersonalFile(uploadContext, input, receipts, clientFactory(config.storage, uploadContext), signal)
    await reply(response, 200, ok({ file }, context.requestId), context, idempotency, mutation)
  } catch (error) {
    const known = error instanceof PersonalFileError ? error : new PersonalFileError("storage_unavailable", 503, true)
    await reply(response, known.status, failure(known.code, "Personal file upload did not complete", context.requestId), context, idempotency, mutation)
  } finally {
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
