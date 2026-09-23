import type { ServerResponse } from "node:http"

import { failure } from "../contracts/index.js"
import { commitReceipt, type IdempotencyEntry, type MutationTicket } from "../application/idempotency.js"
import type { RequestContext } from "../domain/request-context.js"

export function send(response: ServerResponse, status: number, body: unknown, retryAfter?: string): void {
  const payload = Buffer.from(JSON.stringify(body))
  const retryAfterSeconds = retryAfter === undefined || !/^[1-9][0-9]{0,4}$/u.test(retryAfter) ? null : Number(retryAfter)
  const controlledRetryAfter = retryAfterSeconds !== null && retryAfterSeconds <= 86_400 ? retryAfter : undefined
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": payload.byteLength,
    ...(controlledRetryAfter === undefined ? {} : { "retry-after": controlledRetryAfter }),
  })
  response.end(payload)
}

export async function reply(
  response: ServerResponse,
  status: number,
  body: unknown,
  context: RequestContext,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
): Promise<void> {
  try {
    await commitReceipt(idempotency, mutation, status, body)
    send(response, status, body)
  } catch {
    send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", context.requestId))
  }
}
