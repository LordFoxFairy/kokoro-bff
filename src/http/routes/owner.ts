import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config.js"
import type { Skill } from "../../contracts/index.js"
import { failure, ok } from "../../contracts/index.js"
import { proxyUpstream } from "../../upstream.js"
import { billingPlansData, capabilityMcpData, capabilitySkillsData, checkoutUrlData, libraryData, mappedOwnerQuery, modelCatalogData, ownerIdentityHeaders, systemManifestData } from "../../application/projections.js"
import { normalizeUpstreamResponse, reply } from "../response.js"
import { incomingHeaders, queryOf, type Context } from "../request.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import type { LiveOwnerResult } from "./types.js"

export async function liveOwnerRequest(
  request: IncomingMessage,
  config: BffConfig,
  context: Context,
  owner: string,
  path: string,
  method: string,
  body?: Buffer,
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
    return normalizeUpstreamResponse(upstream, context.requestId)
  } catch {
    return { status: 502, body: failure("upstream_unreachable", `The configured ${owner} upstream is unavailable`, context.requestId) }
  }
}

export async function liveOwnerBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: Context,
  businessPath: string[],
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
): Promise<boolean> {
  const method = request.method || "GET"

  if (businessPath.length === 2 && businessPath[0] === "system" && businessPath[1] === "runtime-manifest" && method === "GET") {
    const query = queryOf(request)
    const productId = query.get("product_id")?.trim() ?? ""
    const locale = query.get("locale")?.trim() || "en-US"
    const surfaceId = query.get("surface_id")?.trim() || "user-web"
    if (productId === "" || locale === "" || surfaceId === "") {
      await reply(response, 400, failure("invalid_runtime_manifest_request", "product_id, locale, and surface_id are required", context.requestId), context, idempotency, mutation)
      return true
    }
    const ownerQuery = new URLSearchParams({ product_id: productId, locale, surface_id: surfaceId })
    const result = await liveOwnerRequest(request, config, context, "system", `/system/runtime-manifest?${ownerQuery.toString()}`, method)
    if (result.status >= 400) {
      await reply(response, result.status, result.body, context, idempotency, mutation)
      return true
    }
    const projected = systemManifestData(result.body)
    if (projected === null || projected.product_id !== productId || projected.locale !== locale) {
      await reply(response, 502, failure("upstream_response_invalid", "System runtime manifest did not match the v1 owner contract", context.requestId), context, idempotency, mutation)
      return true
    }
    await reply(response, result.status, ok(projected, context.requestId), context, idempotency, mutation)
    return true
  }
  if (businessPath[0] === "system") {
    await reply(response, 503, failure("system_projection_not_configured", "This System operation is not exposed by the BFF owner adapter", context.requestId), context, idempotency, mutation)
    return true
  }

  const capabilityPath = businessPath[0] === "skills"
    ? businessPath.length === 1 && method === "GET"
      ? "/bff/skills"
      : businessPath.length === 2 && businessPath[1] === "pool" && method === "GET"
        ? "/bff/skills/pool"
        : businessPath.length === 2 && businessPath[1] === "catalog" && method === "GET"
          ? "/bff/skills/catalog"
          : null
    : businessPath.length === 2 && businessPath[0] === "mcp" && businessPath[1] === "servers" && method === "GET"
      ? "/bff/mcp/servers"
      : null
  if (capabilityPath !== null) {
    const query = capabilityPath === "/bff/mcp/servers"
      ? mappedOwnerQuery(request, { provider_key: "provider_key", limit: "limit", cursor: "cursor" })
      : mappedOwnerQuery(request, { q: "q", query: "query", tags: "tags", scope_kind: "scope_kind", limit: "limit", cursor: "cursor" })
    const result = await liveOwnerRequest(request, config, context, "capability", `${capabilityPath}${query}`, method)
    if (result.status >= 400) {
      await reply(response, result.status, result.body, context, idempotency, mutation)
      return true
    }
    const projected = capabilityPath === "/bff/mcp/servers"
      ? capabilityMcpData(result.body, context.identity.namespace)
      : capabilitySkillsData(result.body, capabilityPath === "/bff/skills/catalog")
    if (projected === null) {
      await reply(response, 502, failure("upstream_response_invalid", "Capability projection did not match the v1 owner contract", context.requestId), context, idempotency, mutation)
      return true
    }
    await reply(response, result.status, ok(projected, context.requestId), context, idempotency, mutation)
    return true
  }
  if (businessPath[0] === "skills" || businessPath[0] === "mcp") {
    await reply(response, 503, failure("capability_projection_not_configured", "This Capability operation is not exposed by the BFF owner adapter", context.requestId), context, idempotency, mutation)
    return true
  }

  if (businessPath.length === 1 && businessPath[0] === "library" && method === "GET") {
    const result = await liveOwnerRequest(request, config, context, "storage", "/internal/bff/library", method)
    if (result.status >= 400) {
      await reply(response, result.status, result.body, context, idempotency, mutation)
      return true
    }
    const projected = libraryData(result.body)
    if (projected === null) {
      await reply(response, 502, failure("upstream_response_invalid", "Storage library projection did not match the v1 owner contract", context.requestId), context, idempotency, mutation)
      return true
    }
    await reply(response, result.status, ok(projected, context.requestId), context, idempotency, mutation)
    return true
  }
  if (businessPath[0] === "library" || businessPath[0] === "assets" || businessPath[0] === "artifacts") {
    await reply(response, 503, failure("storage_projection_not_configured", "This Storage operation is not exposed by the BFF owner adapter", context.requestId), context, idempotency, mutation)
    return true
  }

  if (businessPath.length === 1 && businessPath[0] === "models" && method === "GET") {
    const query = queryOf(request)
    const ownerQuery = new URLSearchParams()
    for (const [incomingName, ownerName] of [["feature_key", "featureKey"], ["limit", "limit"], ["cursor", "cursor"]] as const) {
      const value = query.get(incomingName)?.trim()
      if (value) ownerQuery.set(ownerName, value)
    }
    const path = `/bff/model-catalog${ownerQuery.size === 0 ? "" : `?${ownerQuery.toString()}`}`
    const result = await liveOwnerRequest(request, config, context, "model", path, method)
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

  if (businessPath[0] === "billing" && businessPath[1] === "plans" && businessPath.length === 2 && method === "GET") {
    const result = await liveOwnerRequest(request, config, context, "billing", "/v1/commerce/catalog", method)
    if (result.status >= 400) {
      await reply(response, result.status, result.body, context, idempotency, mutation)
      return true
    }
    const projected = billingPlansData(result.body)
    if (projected === null) {
      await reply(response, 502, failure("upstream_response_invalid", "Billing catalog did not match the v1 owner contract", context.requestId), context, idempotency, mutation)
      return true
    }
    await reply(response, result.status, ok(projected, context.requestId), context, idempotency, mutation)
    return true
  }

  if (businessPath[0] === "billing" && businessPath[1] === "checkout" && businessPath.length === 2 && method === "POST") {
    const planId = typeof json.plan_id === "string" ? json.plan_id.trim() : ""
    if (planId === "") {
      await reply(response, 400, failure("invalid_checkout", "plan_id is required", context.requestId), context, idempotency, mutation)
      return true
    }
    const catalogResult = await liveOwnerRequest(request, config, context, "billing", "/v1/commerce/catalog", "GET")
    if (catalogResult.status >= 400) {
      await reply(response, catalogResult.status, catalogResult.body, context, idempotency, mutation)
      return true
    }
    const catalog = billingPlansData(catalogResult.body)
    const plan = catalog?.plans.find((candidate) => candidate.id === planId)
    if (plan === undefined) {
      await reply(response, 404, failure("plan_not_found", "Billing plan was not found", context.requestId, ), context, idempotency, mutation)
      return true
    }
    const checkoutBody = Buffer.from(JSON.stringify({
      offer_revision_id: plan.id,
      amount_minor: plan.amount_minor,
      currency: plan.currency,
      quote_snapshot: {
        key: plan.key,
        credit_micros: plan.credit_micros,
        name: plan.name,
        plan_id: plan.id,
      },
    }))
    const checkoutResult = await liveOwnerRequest(request, config, context, "billing", "/v1/billing/checkout", method, checkoutBody)
    if (checkoutResult.status >= 400) {
      await reply(response, checkoutResult.status, checkoutResult.body, context, idempotency, mutation)
      return true
    }
    const projected = checkoutUrlData(checkoutResult.body)
    if (projected === null) {
      await reply(response, 502, failure("upstream_response_invalid", "Billing checkout did not return a checkout URL", context.requestId), context, idempotency, mutation)
      return true
    }
    await reply(response, checkoutResult.status, ok(projected, context.requestId), context, idempotency, mutation)
    return true
  }

  return false
}

export function skillPoolData(skills: Skill[]): { skills: Array<{
  name: string
  description: string
  content_hash: string
  scope: string
  enabled?: boolean
  categories?: string[]
  updated_at?: number
}> } {
  return {
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      content_hash: skill.content_hash,
      scope: skill.scope,
      ...(skill.enabled === undefined ? {} : { enabled: skill.enabled }),
      ...(skill.categories === undefined ? {} : { categories: skill.categories }),
      ...(skill.updated_at === undefined ? {} : { updated_at: skill.updated_at }),
    })),
  }
}

export function skillCatalogData(skills: Skill[]): { skills: Array<{
  name: string
  description: string
  content_hash: string
  scope: string
  installed: boolean
  enabled: boolean
  categories?: string[]
  updated_at?: number
}>; next_cursor: null } {
  return {
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      content_hash: skill.content_hash,
      scope: skill.scope,
      installed: skill.installed ?? true,
      enabled: skill.enabled ?? true,
      ...(skill.categories === undefined ? {} : { categories: skill.categories }),
      ...(skill.updated_at === undefined ? {} : { updated_at: skill.updated_at }),
    })),
    next_cursor: null,
  }
}
