import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import { failure, ok } from "../../contracts/index.js"
import { modelCatalogData } from "../../infrastructure/clients/owner/system-model-catalog.js"
import { queryOf, pathOf } from "../request.js"
import { reply } from "../response.js"
import { liveOwnerRequest } from "./owner.js"

export function systemModelCatalogRequest(request: IncomingMessage): boolean {
  try {
    const path = pathOf(request)
    return request.method === "GET" && path.length === 2 && path[0] === "v1" && path[1] === "models"
  } catch {
    return false
  }
}

export async function handleSystemModelCatalogBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
): Promise<boolean> {
  if (!systemModelCatalogRequest(request)) return false
  const query = queryOf(request)
  const ownerQuery = new URLSearchParams()
  for (const name of ["feature_key", "limit", "cursor"] as const) {
    const value = query.get(name)?.trim()
    if (value) ownerQuery.set(name, value)
  }
  const path = `/v1/system/model-catalog/catalog${ownerQuery.size === 0 ? "" : `?${ownerQuery.toString()}`}`
  const result = await liveOwnerRequest(request, config, context, "system", path, request.method ?? "GET", undefined, true)
  if (result.status >= 400) {
    await reply(response, result.status, result.body, context, idempotency, mutation)
    return true
  }
  const projected = modelCatalogData(result.body)
  if (projected === null) {
    await reply(response, 502, failure("upstream_response_invalid", "Model catalog did not match the v1 owner contract", context.requestId), context, idempotency, mutation)
    return true
  }
  await reply(response, result.status, ok(projected, context.requestId), context, idempotency, mutation)
  return true
}
