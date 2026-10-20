import { isDeepStrictEqual } from "node:util"
import {
  zListModelProviderResponse,
  zListModelDefinitionResponse,
  zListFeatureResponse,
  zCreateModelProviderBody,
  zCreateModelProviderResponse,
  zGetModelProviderCreationResponse,
  zCreateModelDefinitionBody,
  zCreateModelDefinitionResponse,
  zCreateModelRevisionBody,
  zCreateModelRevisionResponse,
  zPublishModelRevisionResponse,
  zCreateModelLabelBody,
  zCreateModelLabelResponse,
  zUpdateModelLabelBody,
  zUpdateModelLabelResponse,
} from "../../../generated/system-http/zod.gen.js"
import { dispatch, ownerError, type SystemModelRoutingInput, type SystemModelRoutingResult } from "./system-model-routing.js"

// This closed capability table is not a general owner proxy. Credential reads,
// health, deletion and other System modules are deliberately absent.
export const modelConfigurationOperations = {
  providers: {
    method: "GET",
    publicPath: "model-providers",
    ownerPath: "model-catalog/providers",
    permission: "system:read",
    response: zListModelProviderResponse,
  },
  definitions: {
    method: "GET",
    publicPath: "model-definitions",
    ownerPath: "model-catalog/definitions",
    permission: "system:read",
    response: zListModelDefinitionResponse,
  },
  features: { method: "GET", publicPath: "model-features", ownerPath: "features", permission: "system:read", response: zListFeatureResponse },
  providerCreation: {
    method: "GET",
    publicPath: "model-provider-creations",
    ownerPath: "model-catalog/provider-creations",
    permission: "system:write",
    response: zGetModelProviderCreationResponse,
  },
  createProvider: {
    method: "POST",
    publicPath: "model-providers",
    ownerPath: "model-catalog/providers",
    permission: "system:write",
    body: zCreateModelProviderBody,
    response: zCreateModelProviderResponse,
  },
  createDefinition: {
    method: "POST",
    publicPath: "model-definitions",
    ownerPath: "model-catalog/definitions",
    permission: "system:write",
    body: zCreateModelDefinitionBody,
    response: zCreateModelDefinitionResponse,
  },
  createRevision: {
    method: "POST",
    publicPath: "model-revisions",
    ownerPath: "model-catalog/revisions",
    permission: "system:write",
    body: zCreateModelRevisionBody,
    response: zCreateModelRevisionResponse,
  },
  publishRevision: {
    method: "POST",
    publicPath: "model-revisions",
    ownerPath: "model-catalog/revisions",
    permission: "system:publish",
    response: zPublishModelRevisionResponse,
    conditional: true,
  },
  createLabel: {
    method: "POST",
    publicPath: "model-labels",
    ownerPath: "model-catalog/labels",
    permission: "system:write",
    body: zCreateModelLabelBody,
    response: zCreateModelLabelResponse,
  },
  updateLabel: {
    method: "PATCH",
    publicPath: "model-labels",
    ownerPath: "model-catalog/labels",
    permission: "system:write",
    body: zUpdateModelLabelBody,
    response: zUpdateModelLabelResponse,
    conditional: true,
  },
} as const
export type ModelConfigurationOperation = keyof typeof modelConfigurationOperations
export function matchModelConfiguration(method: string, path: readonly string[]): { operation: ModelConfigurationOperation; id?: string } | null {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
  if (path.length === 4 && path[1] === "model-revisions" && path[3] === "publish" && method === "POST" && uuid.test(path[2] ?? ""))
    return { operation: "publishRevision", id: path[2]! }
  if (path.length === 3 && path[1] === "model-labels" && method === "PATCH" && uuid.test(path[2] ?? "")) return { operation: "updateLabel", id: path[2]! }
  if (path.length !== 2) return null
  for (const [operation, spec] of Object.entries(modelConfigurationOperations)) {
    if (operation !== "publishRevision" && operation !== "updateLabel" && method === spec.method && path[1] === spec.publicPath)
      return { operation: operation as ModelConfigurationOperation }
  }
  return null
}
export type ModelConfigurationInput = SystemModelRoutingInput &
  Readonly<{
    operation: ModelConfigurationOperation
    id?: string
    body?: Record<string, unknown>
    query: URLSearchParams
    key?: string
    ifMatch?: string
  }>
export async function systemModelConfiguration(input: ModelConfigurationInput): Promise<SystemModelRoutingResult> {
  const spec = modelConfigurationOperations[input.operation]
  const expected = "body" in spec && input.body !== undefined ? spec.body.safeParse(input.body) : null
  if (expected !== null && !expected.success) return { ok: false, status: 400, code: "invalid_admin_model_routing_request" }
  const expectedBody = expected?.success ? expected.data : input.body
  if (input.baseUrl === null || input.secret === null) return { ok: false, status: 503, code: "admin_model_routing_unavailable" }
  const suffix = input.id === undefined ? "" : `/${encodeURIComponent(input.id)}${input.operation === "publishRevision" ? "/publish" : ""}`
  const url = new URL(`/v1/system/${spec.ownerPath}${suffix}`, input.baseUrl)
  url.search = input.query.toString()
  const result = await dispatch(input, url, {
    method: spec.method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.secret}`,
      "x-kokoro-service": "model-management",
      "x-kokoro-tenant-id": input.tenantId,
      "x-kokoro-actor-id": input.actorId,
      "x-kokoro-iam-permissions": spec.permission,
      "x-request-id": input.requestId,
      ...(input.key === undefined ? {} : { "idempotency-key": input.key }),
      ...(input.ifMatch === undefined ? {} : { "if-match": input.ifMatch }),
      ...(input.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  })
  if (!("response" in result)) return result
  const expectedStatus = spec.method === "POST" && input.operation !== "publishRevision" ? 201 : 200
  if (result.response.status !== expectedStatus)
    return ownerError(result.raw, result.response.status, spec.method === "GET" && input.operation !== "providerCreation" ? "read" : "write")
  const parsed = spec.response.safeParse(result.raw)
  if (!parsed.success || !isDeepStrictEqual(result.raw, parsed.data)) return { ok: false, status: 502, code: "admin_model_routing_response_invalid" }
  if (
    input.operation === "providerCreation" &&
    !result.response.headers
      .get("cache-control")
      ?.split(",")
      .some((value) => value.trim().toLowerCase() === "no-store")
  )
    return { ok: false, status: 502, code: "admin_model_routing_response_invalid" }
  const data = parsed.data.data
  if (input.signal.aborted || Date.now() >= input.deadlineAt) return { ok: false, status: 503, code: "admin_model_routing_unavailable" }
  if (spec.method === "GET" && input.operation !== "providerCreation" && "items" in data) return { ok: true, data: data.items, nextCursor: data.next_cursor }
  // Never acknowledge a different resource/body, including a cross-provider draft.
  if (input.id !== undefined && (!("id" in data) || data.id !== input.id)) return { ok: false, status: 502, code: "admin_model_routing_response_invalid" }
  if (expectedBody !== undefined)
    for (const [key, value] of Object.entries(expectedBody)) {
      if (key !== "api_key" && (!Object.hasOwn(data, key) || !isDeepStrictEqual((data as Record<string, unknown>)[key], value)))
        return { ok: false, status: 502, code: "admin_model_routing_response_invalid" }
    }
  if (input.operation === "publishRevision" && (!("published_at" in data) || data.published_at === null || ("retired_at" in data && data.retired_at !== null)))
    return { ok: false, status: 502, code: "admin_model_routing_response_invalid" }
  if (input.signal.aborted || Date.now() >= input.deadlineAt) return { ok: false, status: 503, code: "admin_model_routing_unavailable" }
  return { ok: true, data }
}
