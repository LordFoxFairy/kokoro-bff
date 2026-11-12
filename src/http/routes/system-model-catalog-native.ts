import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import { failure, ok } from "../../contracts/index.js"
import { modelCatalogData } from "../../infrastructure/clients/owner/system-model-catalog.js"
import { queryOf, pathOf } from "../request.js"
import { send } from "../response.js"
import { liveOwnerRequest, type OwnerRequestLifetime } from "./owner-request.js"

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
  lifetime: OwnerRequestLifetime,
): Promise<boolean> {
  if (!systemModelCatalogRequest(request)) return false
  const check = () => {
    lifetime.signal.throwIfAborted()
    if (request.aborted || response.destroyed || response.writableEnded || performance.now() >= lifetime.deadlineAt)
      throw new Error("Model catalog request retired")
  }
  // This GET has no command receipt. Keep the last check and actual send synchronous.
  const respond = (status: number, body: unknown) => {
    check()
    response.setHeader("x-request-id", context.requestId)
    send(response, status, body)
  }
  check()
  const query = queryOf(request)
  const ownerQuery = new URLSearchParams()
  for (const name of ["feature_key", "limit", "cursor"] as const) {
    const value = query.get(name)?.trim()
    if (value) ownerQuery.set(name, value)
  }
  const path = `/v1/system/model-catalog/catalog${ownerQuery.size === 0 ? "" : `?${ownerQuery.toString()}`}`
  const result = await liveOwnerRequest(request, config, context, "system", path, request.method ?? "GET", undefined, true, lifetime)
  check()
  if (result.status >= 400) {
    respond(result.status, result.body)
    return true
  }
  const projected = modelCatalogData(result.body)
  if (projected === null) {
    respond(502, failure("upstream_response_invalid", "Model catalog did not match the v1 owner contract", context.requestId))
    return true
  }
  respond(result.status, ok(projected, context.requestId))
  return true
}
