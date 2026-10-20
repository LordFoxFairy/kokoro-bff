import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import { failure, ok } from "../../contracts/index.js"
import { proxyUpstream } from "../../upstream.js"
import { modelCatalogData } from "../../infrastructure/clients/owner/system-model-catalog.js"
import { ownerIdentityHeaders } from "../../infrastructure/clients/owner/identity.js"
import { reply } from "../response.js"
import { normalizeSystemUpstreamResponse, normalizeUpstreamResponse } from "../../infrastructure/clients/upstream-response.js"
import { incomingHeaders, queryOf } from "../request.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import type { LiveOwnerResult } from "./types.js"
import { livePlatformProjectionRead } from "./platform-projection.js"
import { readBillingCatalog } from "../../infrastructure/clients/owner/billing-catalog.js"
import { readBillingCreditAccount, readBillingCreditLedger } from "../../infrastructure/clients/owner/billing-personal-read.js"

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

async function billingPersonalRead(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  businessPath: string[],
  json: Record<string, unknown>,
  idempotency: Map<string, IdempotencyEntry>,
): Promise<boolean> {
  if (request.method !== "GET" || businessPath[0] !== "billing" || businessPath.length !== 2 || !["summary", "ledger"].includes(businessPath[1] ?? "")) {
    return false
  }
  if (Object.keys(json).length !== 0 || (businessPath[1] === "summary" && queryOf(request).size !== 0)) {
    await reply(response, 400, failure("invalid_query_parameter", "Billing read parameters are invalid", context.requestId), context, idempotency, null)
    return true
  }
  const ledgerQuery = businessPath[1] === "ledger" ? billingLedgerQuery(request) : undefined
  if (ledgerQuery === null) {
    await reply(response, 400, failure("invalid_query_parameter", "Billing ledger query is invalid", context.requestId), context, idempotency, null)
    return true
  }
  const abort = new AbortController()
  const onAbort = (): void => abort.abort()
  const onClose = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAbort)
  response.once("close", onClose)
  if (request.aborted || response.destroyed) abort.abort()
  try {
    const result =
      businessPath[1] === "summary"
        ? await readBillingCreditAccount(config, context, abort.signal)
        : await readBillingCreditLedger(config, context, ledgerQuery!, abort.signal)
    if (response.destroyed) return true
    if (result.ok) await reply(response, 200, ok(result.data, context.requestId), context, idempotency, null)
    else {
      const message =
        result.code === "billing_account_not_found"
          ? "Billing account was not found"
          : result.code === "upstream_response_invalid"
            ? "Billing returned an invalid response"
            : "Billing is unavailable"
      await reply(response, result.status, failure(result.code, message, context.requestId), context, idempotency, null)
    }
    return true
  } finally {
    request.removeListener("aborted", onAbort)
    response.removeListener("close", onClose)
  }
}

export async function liveOwnerRequest(
  request: IncomingMessage,
  config: BffConfig,
  context: RequestContext,
  owner: string,
  path: string,
  method: string,
  body?: Buffer,
  strictSystemEnvelope = false,
): Promise<LiveOwnerResult> {
  const baseUrl = config.upstreams[owner] ?? null
  if (baseUrl === null) {
    return { status: 503, body: failure("upstream_not_configured", `No upstream is configured for ${owner}`, context.requestId) }
  }
  try {
    const upstream = await proxyUpstream(
      config,
      baseUrl,
      path,
      method,
      context.requestId,
      incomingHeaders(request),
      body,
      ownerIdentityHeaders(context),
      "web-bff",
    )
    return strictSystemEnvelope ? normalizeSystemUpstreamResponse(upstream, context.requestId) : normalizeUpstreamResponse(upstream, context.requestId)
  } catch {
    return { status: 502, body: failure("upstream_unreachable", `The configured ${owner} upstream is unavailable`, context.requestId) }
  }
}

export async function liveOwnerBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  businessPath: string[],
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
): Promise<boolean> {
  const method = request.method || "GET"

  if (await livePlatformProjectionRead(request, response, config, context, businessPath)) return true

  if (await billingPersonalRead(request, response, config, context, businessPath, json, idempotency)) return true

  if (businessPath[0] === "system") {
    await reply(
      response,
      503,
      failure("system_projection_not_configured", "This System operation is not exposed by the BFF owner adapter", context.requestId),
      context,
      idempotency,
      mutation,
    )
    return true
  }

  if (businessPath[0] === "skills") {
    await reply(
      response,
      503,
      failure("platform_operation_not_available", "This Platform operation is not exposed by the BFF owner adapter", context.requestId),
      context,
      idempotency,
      mutation,
    )
    return true
  }

  if (businessPath.length === 1 && businessPath[0] === "models" && method === "GET") {
    const query = queryOf(request)
    const ownerQuery = new URLSearchParams()
    for (const name of ["feature_key", "limit", "cursor"] as const) {
      const value = query.get(name)?.trim()
      if (value) ownerQuery.set(name, value)
    }
    const path = `/v1/system/model-catalog/catalog${ownerQuery.size === 0 ? "" : `?${ownerQuery.toString()}`}`
    const result = await liveOwnerRequest(request, config, context, "system", path, method, undefined, true)
    if (result.status >= 400) {
      await reply(response, result.status, result.body, context, idempotency, mutation)
      return true
    }
    const projected = modelCatalogData(result.body)
    if (projected === null) {
      await reply(
        response,
        502,
        failure("upstream_response_invalid", "Model catalog did not match the v1 owner contract", context.requestId),
        context,
        idempotency,
        mutation,
      )
      return true
    }
    await reply(response, result.status, ok(projected, context.requestId), context, idempotency, mutation)
    return true
  }

  if (businessPath[0] === "billing" && businessPath[1] === "plans" && businessPath.length === 2 && method === "GET") {
    const abort = new AbortController()
    const onAbort = (): void => abort.abort()
    const onClose = (): void => {
      if (!response.writableEnded) abort.abort()
    }
    request.once("aborted", onAbort)
    response.once("close", onClose)
    if (request.aborted || response.destroyed) abort.abort()
    try {
      const result = await readBillingCatalog(config, context, abort.signal)
      if (!response.destroyed)
        await reply(
          response,
          result.ok ? 200 : 503,
          result.ok ? ok({ plans: result.plans }, context.requestId) : failure("billing_unavailable", "Billing catalog is unavailable", context.requestId),
          context,
          idempotency,
          mutation,
        )
    } finally {
      request.removeListener("aborted", onAbort)
      response.removeListener("close", onClose)
    }
    return true
  }

  if (businessPath[0] === "billing" && businessPath[1] === "checkout" && businessPath.length === 2 && method === "POST") {
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
