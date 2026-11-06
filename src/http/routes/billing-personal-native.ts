import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import { failure, ok } from "../../contracts/index.js"
import { initializeBillingCreditAccount, readBillingCreditAccount, readBillingCreditLedger } from "../../infrastructure/clients/owner/billing-personal-read.js"
import { readBillingCatalog } from "../../infrastructure/clients/owner/billing-catalog.js"
import { reply } from "../response.js"
import { pathOf, queryOf } from "../request.js"

function billingLedgerQuery(request: IncomingMessage): Readonly<{ limit: number; cursor?: string }> | null {
  const query = queryOf(request)
  if ([...query.keys()].some((name) => name !== "limit" && name !== "cursor")) return null
  const limits = query.getAll("limit")
  const cursors = query.getAll("cursor")
  if (limits.length > 1 || cursors.length > 1) return null
  const rawLimit = limits[0]
  if (rawLimit !== undefined && !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(rawLimit)) return null
  const cursor = cursors[0]
  if (cursor !== undefined && (cursor.length < 1 || cursor.length > 2048)) return null
  return { limit: rawLimit === undefined ? 50 : Number(rawLimit), ...(cursor === undefined ? {} : { cursor }) }
}

export function billingPersonalRequest(request: IncomingMessage): boolean {
  try {
    const path = pathOf(request)
    if (path[0] !== "v1" || path[1] !== "billing") return false
    if (request.method === "GET" && path.length === 3 && ["summary", "ledger", "plans"].includes(path[2] ?? "")) return true
    if (request.method === "PUT" && path.length === 3 && path[2] === "credit-account") return true
    return request.method === "POST" && path.length === 3 && path[2] === "checkout"
  } catch {
    return false
  }
}

export async function handleBillingPersonalBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  businessPath: string[],
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
): Promise<boolean> {
  const method = request.method ?? "GET"
  const initializing = method === "PUT" && businessPath.join("/") === "billing/credit-account"
  const personalRead =
    initializing ||
    (method === "GET" && businessPath[0] === "billing" && businessPath.length === 2 && ["summary", "ledger"].includes(businessPath[1] ?? ""))
  if (!personalRead && !(businessPath[0] === "billing" && businessPath.length === 2 && ["plans", "checkout"].includes(businessPath[1] ?? ""))) return false

  if (personalRead) {
    if (Object.keys(json).length !== 0 || (businessPath[1] === "summary" && queryOf(request).size !== 0) || (initializing && (request.url ?? "").includes("?"))) {
      await reply(response, 400, failure("invalid_query_parameter", "Billing read parameters are invalid", context.requestId), context, idempotency, mutation)
      return true
    }
    const ledgerQuery = businessPath[1] === "ledger" ? billingLedgerQuery(request) : undefined
    if (ledgerQuery === null) {
      await reply(response, 400, failure("invalid_query_parameter", "Billing ledger query is invalid", context.requestId), context, idempotency, mutation)
      return true
    }
    const abort = new AbortController()
    const onAbort = (): void => abort.abort()
    const onClose = (): void => { if (!response.writableEnded) abort.abort() }
    request.once("aborted", onAbort)
    response.once("close", onClose)
    if (request.aborted || response.destroyed) abort.abort()
    try {
      const result = initializing
        ? await initializeBillingCreditAccount(config, context, abort.signal)
        : businessPath[1] === "summary"
          ? await readBillingCreditAccount(config, context, abort.signal)
          : await readBillingCreditLedger(config, context, ledgerQuery!, abort.signal)
      if (response.destroyed) return true
      if (result.ok) await reply(response, 200, ok(result.data, context.requestId), context, idempotency, mutation)
      else {
        const message =
          result.code === "billing_account_disabled"
            ? "Billing account is disabled"
            : result.code === "billing_account_not_found"
              ? "Billing account was not found"
              : result.code === "upstream_response_invalid"
                ? "Billing returned an invalid response"
                : "Billing is unavailable"
        await reply(response, result.status, failure(result.code, message, context.requestId), context, idempotency, mutation)
      }
      return true
    } finally {
      request.removeListener("aborted", onAbort)
      response.removeListener("close", onClose)
    }
  }

  if (businessPath[1] === "plans" && method === "GET") {
    const abort = new AbortController()
    const onAbort = (): void => abort.abort()
    const onClose = (): void => { if (!response.writableEnded) abort.abort() }
    request.once("aborted", onAbort)
    response.once("close", onClose)
    if (request.aborted || response.destroyed) abort.abort()
    try {
      const result = await readBillingCatalog(config, context, abort.signal)
      if (!response.destroyed)
        await reply(response, result.ok ? 200 : 503, result.ok ? ok({ plans: result.plans }, context.requestId) : failure("billing_unavailable", "Billing catalog is unavailable", context.requestId), context, idempotency, mutation)
    } finally {
      request.removeListener("aborted", onAbort)
      response.removeListener("close", onClose)
    }
    return true
  }

  if (businessPath[1] === "checkout" && method === "POST") {
    const planId = typeof json.plan_id === "string" ? json.plan_id.trim() : ""
    if (planId === "") {
      await reply(response, 400, failure("invalid_checkout", "plan_id is required", context.requestId), context, idempotency, mutation)
      return true
    }
    await reply(response, 503, failure("billing_unavailable", "Billing checkout is unavailable", context.requestId), context, idempotency, mutation)
    return true
  }
  return false
}

