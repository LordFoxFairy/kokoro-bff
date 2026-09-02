import type { IncomingMessage } from "node:http"

import { failure } from "../contracts/index.js"
import { PENDING_RECEIPT_STATUS, type IdempotencyRepository } from "../modules/idempotency/repository.js"
import { fingerprintBody, idempotencyKey, type Context } from "../http/request.js"

export type IdempotencyReceipt = { status: number; body: unknown }
export type IdempotencyEntry = { fingerprint: string; receipt: IdempotencyReceipt }
export type MutationTicket = { scope: string; fingerprint: string; persistent?: IdempotencyRepository }

function mutationScope(context: Context, method: string, path: string, key: string): string {
  return `${context.identity.namespace}:${method}:${path}:${key}`
}

export async function mutationTicket(
  request: IncomingMessage,
  method: string,
  path: string,
  context: Context,
  body: Buffer,
  idempotency: Map<string, IdempotencyEntry>,
  persistent?: IdempotencyRepository,
): Promise<{ ticket: MutationTicket | null; replay: IdempotencyReceipt | null; conflict: boolean; pending: boolean }> {
  const key = idempotencyKey(request)
  if (key === null) return { ticket: null, replay: null, conflict: false, pending: false }
  const scope = mutationScope(context, method, path, key)
  const fingerprint = fingerprintBody(request, body)
  if (persistent !== undefined) {
    const claim = await persistent.claimReceipt(scope, fingerprint)
    if (claim.claimed) return { ticket: { scope, fingerprint, persistent }, replay: null, conflict: false, pending: false }
    const prior = claim.receipt
    if (prior === null) return { ticket: null, replay: null, conflict: false, pending: true }
    if (prior.fingerprint !== fingerprint) return { ticket: null, replay: null, conflict: true, pending: false }
    if (prior.status === PENDING_RECEIPT_STATUS) return { ticket: null, replay: null, conflict: false, pending: true }
    return { ticket: null, replay: prior, conflict: false, pending: false }
  }
  const prior = idempotency.get(scope)
  if (prior !== undefined) {
    if (prior.fingerprint !== fingerprint) return { ticket: null, replay: null, conflict: true, pending: false }
    if (prior.receipt.status === PENDING_RECEIPT_STATUS) return { ticket: null, replay: null, conflict: false, pending: true }
    return { ticket: null, replay: prior.receipt, conflict: false, pending: false }
  }
  idempotency.set(scope, { fingerprint, receipt: { status: PENDING_RECEIPT_STATUS, body: {} } })
  return { ticket: { scope, fingerprint }, replay: null, conflict: false, pending: false }
}

export async function commitReceipt(
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
  status: number,
  body: unknown,
): Promise<void> {
  if (mutation === null) return
  if (status >= 500) {
    const current = idempotency.get(mutation.scope)
    if (current?.fingerprint === mutation.fingerprint && current.receipt.status === PENDING_RECEIPT_STATUS) idempotency.delete(mutation.scope)
    if (mutation.persistent !== undefined) await mutation.persistent.releaseReceipt(mutation.scope, mutation.fingerprint)
    return
  }
  if (mutation.persistent !== undefined) {
    try {
      await mutation.persistent.putReceipt(mutation.scope, { fingerprint: mutation.fingerprint, status, body })
    } catch (error) {
      await mutation.persistent.releaseReceipt(mutation.scope, mutation.fingerprint).catch(() => undefined)
      throw error
    }
  }
  idempotency.set(mutation.scope, { fingerprint: mutation.fingerprint, receipt: { status, body: structuredClone(body) } })
}

export function idempotencyFailure(requestId: string, code: string, message: string): { status: number; body: unknown } {
  return { status: 409, body: failure(code, message, requestId) }
}
