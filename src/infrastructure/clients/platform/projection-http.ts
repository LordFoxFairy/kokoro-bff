import { strictParseRawJson } from "../../raw-json.js"
import { skillCategoryKeysSchema } from "./skill-product-schema.js"
import { projectSkillProductJson } from "./skill-product-response.js"
import { z } from "zod"
import { parseSkillExamplePrompts } from "./skill-example-prompts.js"
import { createClient } from "../../../generated/platform-http/client/client.gen.js"
import {
  getSelfManagedSkill,
  getPublishedPersonalSkill,
  listMcpServers,
  listSelfMcpConnections,
  listSelfManagedSkills,
  listVisibleSkillCatalog,
  listVisibleSkillPool,
  listVisibleSkills,
} from "../../../generated/platform-http/sdk.gen.js"
import {
  zErrorEnvelope,
  zGetSelfManagedSkillResponse,
  zGetPublishedPersonalSkillResponse,
  zListMcpServersResponse,
  zListSelfMcpConnectionsResponse,
  zListSelfManagedSkillsResponse,
  zMcpConnection,
  zPublishedPersonalSkill,
  zSelfManagedSkill,
  zSkill,
  zListVisibleSkillCatalogResponse,
  zListVisibleSkillPoolResponse,
  zListVisibleSkillsResponse,
} from "../../../generated/platform-http/zod.gen.js"
import { PlatformServiceCredentialSource } from "./platform-service-credential.js"
import type { ListSelfManagedSkillsData } from "../../../generated/platform-http/types.gen.js"

export type ProjectionOperation = "skills" | "skill" | "pool" | "catalog" | "mcp" | "mcpConnections"
export type ManagedPersonalSkillOperation = "managedSkills" | "managedSkill"
export type ManagedPersonalSkillResult =
  | { ok: true; status: 200; data: unknown }
  | {
      ok: false
      status: 400 | 404 | 502 | 503
      code: "invalid_skill_request" | "skill_not_found" | "skill_response_invalid" | "skill_dependency_unavailable"
    }
export type ProjectionResult =
  | { ok: true; status: 200; data: unknown }
  | {
      ok: false
      status: 400 | 404 | 502 | 503
      code:
        | "skill_not_found"
        | "skill_response_invalid"
        | "skill_dependency_unavailable"
        | "invalid_query_parameter"
        | "mcp_connection_response_invalid"
        | "mcp_connection_dependency_unavailable"
      retryable: boolean
    }
const invalidResponse = (): ProjectionResult => ({ ok: false, status: 502, code: "skill_response_invalid", retryable: false })
const unavailable = (): ProjectionResult => ({ ok: false, status: 503, code: "skill_dependency_unavailable", retryable: true })
const publishedFields = [
  "category_keys",
  "example_prompts",
  "name",
  "product",
  "revision",
  "skill_id",
  "skill_updated_at",
  "source_ref",
  "status",
  "summary",
  "tags",
]

function matchesPublishedIdentity(value: unknown, skillId: string | undefined): boolean {
  if (typeof skillId !== "string" || typeof value !== "object" || value === null || Array.isArray(value)) return false
  const envelope = value as Record<string, unknown>
  if (Object.keys(envelope).join(",") !== "data") return false
  const data = envelope.data
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false
  const resource = data as Record<string, unknown>
  return (
    Object.keys(resource).sort().join(",") === publishedFields.join(",") &&
    resource.skill_id === skillId &&
    resource.source_ref === `skill:${skillId}` &&
    typeof resource.revision === "string" &&
    /^[1-9][0-9]*$/u.test(resource.revision) &&
    resource.status === "active" &&
    typeof resource.name === "string" &&
    typeof resource.summary === "string" &&
    Array.isArray(resource.tags) &&
    resource.tags.every((tag) => typeof tag === "string")
  )
}

const connectionResponse = zListSelfMcpConnectionsResponse.strict().extend({
  data: zListSelfMcpConnectionsResponse.shape.data.strict().extend({
    connections: zMcpConnection.strict().array(),
  }),
})
const connectionError = zErrorEnvelope.strict().extend({ error: zErrorEnvelope.shape.error.strict() })
function validExamples(value: unknown): boolean {
  try {
    parseSkillExamplePrompts(value)
    return true
  } catch {
    return false
  }
}
const visibleSkill = z
  .preprocess((input, context) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return input
    try {
      const value = input as Record<string, unknown>
      // Validate original nested facts before generated object parsers can
      // strip unknown product/publisher/provenance members.
      return { ...value, product: projectSkillProductJson(value.product) }
    } catch {
      context.addIssue({ code: "custom", message: "Skill product facts are invalid" })
      return z.NEVER
    }
  }, zSkill.strict())
  .transform((value, context) => {
    try {
      return {
        ...value,
        example_prompts: parseSkillExamplePrompts(value.example_prompts),
        category_keys: skillCategoryKeysSchema.parse(value.category_keys),
      }
    } catch {
      context.addIssue({ code: "custom", message: "Skill source facts are invalid" })
      return z.NEVER
    }
  })
  .refine(({ skill_updated_at }) => skill_updated_at.endsWith("Z"))
const publishedSkill = zPublishedPersonalSkill
  .extend({
    example_prompts: z.custom<string[]>(validExamples),
    category_keys: skillCategoryKeysSchema,
    product: z.unknown().transform(projectSkillProductJson),
  })
  .strict()
  .refine(({ skill_updated_at }) => skill_updated_at.endsWith("Z"))
const managedSkill = zSelfManagedSkill
  .extend({
    example_prompts: z.custom<string[]>(validExamples),
    category_keys: skillCategoryKeysSchema,
    product: z.unknown().transform(projectSkillProductJson),
  })
  .strict()
  .refine(({ skill_updated_at }) => skill_updated_at.endsWith("Z"))
const visibleSkillsResponse = zListVisibleSkillsResponse.strict().extend({
  data: zListVisibleSkillsResponse.shape.data.strict().extend({ skills: visibleSkill.array() }),
})
const visibleSkillPoolResponse = zListVisibleSkillPoolResponse.strict().extend({
  data: zListVisibleSkillPoolResponse.shape.data.strict().extend({ skills: visibleSkill.array() }),
})
const visibleSkillCatalogResponse = zListVisibleSkillCatalogResponse.strict().extend({
  data: zListVisibleSkillCatalogResponse.shape.data.strict().extend({ skills: visibleSkill.array() }),
})
const publishedSkillResponse = zGetPublishedPersonalSkillResponse.strict().extend({ data: publishedSkill })
const managedListResponse = zListSelfManagedSkillsResponse.strict().extend({
  data: zListSelfManagedSkillsResponse.shape.data.strict().extend({ skills: managedSkill.array() }),
})
const managedDetailResponse = zGetSelfManagedSkillResponse.strict().extend({ data: managedSkill })
const managedError = zErrorEnvelope.strict().extend({ error: zErrorEnvelope.shape.error.strict() })

function matchesManagedIdentity(value: unknown, skillId?: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const data = (value as { data?: unknown }).data
  const items = skillId === undefined ? (data as { skills?: unknown } | undefined)?.skills : [data]
  if (!Array.isArray(items)) return false
  return items.every((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return false
    const identity = item as { skill_id?: unknown; source_ref?: unknown }
    if (typeof identity.skill_id !== "string" || typeof identity.source_ref !== "string") return false
    return identity.source_ref === `skill:${identity.skill_id}` && (skillId === undefined || identity.skill_id === skillId)
  })
}

// A caller budget also bounds providers/streams that settle after cancellation.
function whileActive<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => reject(signal.reason)
    signal.addEventListener("abort", aborted, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted)
        if (signal.aborted) reject(signal.reason)
        else resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted)
        reject(error)
      },
    )
    if (signal.aborted) {
      signal.removeEventListener("abort", aborted)
      reject(signal.reason)
    }
  })
}

export class PlatformProjectionHttpClient {
  readonly #tokens: PlatformServiceCredentialSource
  constructor(
    private readonly baseUrl: string,
    credentialFile: string,
    private readonly timeoutMs = 5000,
    private readonly maxBytes = 1024 * 1024,
  ) {
    this.#tokens = new PlatformServiceCredentialSource(credentialFile, "projection")
  }
  async read(
    operation: ProjectionOperation,
    tenantId: string,
    subject: string,
    requestId: string,
    input: { query?: Record<string, unknown>; skillId?: string } = {},
    signal?: AbortSignal,
  ): Promise<ProjectionResult> {
    if (operation !== "mcpConnections") return this.#read(operation, tenantId, subject, requestId, input, signal)
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(new Error("projection_deadline")), this.timeoutMs)
    const total = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal
    try {
      total.throwIfAborted()
      return await whileActive(this.#read(operation, tenantId, subject, requestId, input, total), total)
    } catch {
      return { ok: false, status: 503, code: "mcp_connection_dependency_unavailable", retryable: true }
    } finally {
      clearTimeout(timer)
    }
  }
  async readManagedPersonalSkill(
    operation: ManagedPersonalSkillOperation,
    tenantId: string,
    subject: string,
    requestId: string,
    input: { query?: ListSelfManagedSkillsData["query"]; skillId?: string },
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<ManagedPersonalSkillResult> {
    const invalid = (): ManagedPersonalSkillResult => ({ ok: false, status: 502, code: "skill_response_invalid" })
    const dependency = (): ManagedPersonalSkillResult => ({ ok: false, status: 503, code: "skill_dependency_unavailable" })
    let invalidOwnerResponse = false
    const active = (): void => {
      signal.throwIfAborted()
      if (performance.now() >= deadlineAt) throw new Error("managed_personal_skill_deadline")
    }
    try {
      active()
      const token = await whileActive(this.#tokens.get(tenantId, signal), signal)
      active()
      const bounded = async (request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        active()
        const baseRequest = new Request(request, init)
        const headers = new Headers(baseRequest.headers)
        headers.set("authorization", `Bearer ${token}`)
        const pending = fetch(new Request(baseRequest, { headers, signal, redirect: "error" }))
        const ownerResponse = await whileActive(
          pending.then((late) => {
            if (signal.aborted) {
              void late.body?.cancel().catch(() => undefined)
              throw signal.reason
            }
            return late
          }),
          signal,
        )
        active()
        const declaredLength = ownerResponse.headers.get("content-length")
        if (declaredLength !== null && (!/^[0-9]+$/u.test(declaredLength) || Number(declaredLength) > this.maxBytes)) {
          invalidOwnerResponse = true
          void ownerResponse.body?.cancel().catch(() => undefined)
          throw new Error("projection_response_too_large")
        }
        if (ownerResponse.body === null) return ownerResponse
        const reader = ownerResponse.body.getReader()
        const chunks: Uint8Array[] = []
        let size = 0
        try {
          for (;;) {
            active()
            const next = await whileActive(reader.read(), signal)
            active()
            if (next.done) break
            size += next.value.byteLength
            if (size > this.maxBytes) {
              invalidOwnerResponse = true
              throw new Error("projection_response_too_large")
            }
            chunks.push(next.value)
          }
        } finally {
          void reader.cancel().catch(() => undefined)
          reader.releaseLock()
        }
        active()
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        active()
        try {
          if (ownerResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new Error("media")
          const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
          const schema = ownerResponse.status === 200 ? (operation === "managedSkills" ? managedListResponse : managedDetailResponse) : managedError
          if (!schema.safeParse(decoded).success) throw new Error("shape")
        } catch {
          invalidOwnerResponse = true
          throw new Error("projection_response_invalid")
        }
        active()
        return new Response(bytes, { status: ownerResponse.status, headers: ownerResponse.headers })
      }
      const client = createClient({ baseUrl: this.baseUrl, fetch: bounded, redirect: "error" })
      const headers = { "x-kokoro-tenant-id": tenantId, "x-kokoro-subject": subject, "x-kokoro-request-id": requestId }
      const result =
        operation === "managedSkills"
          ? await listSelfManagedSkills({
              responseValidator: async (value) => managedListResponse.parseAsync(value),
              client,
              auth: token,
              headers,
              ...(input.query === undefined ? {} : { query: input.query }),
            })
          : await getSelfManagedSkill({
              responseValidator: async (value) => managedDetailResponse.parseAsync(value),
              client,
              auth: token,
              headers,
              path: { skill_id: input.skillId ?? "" },
            })
      active()
      const ownerResultResponse = result.response
      const status = ownerResultResponse?.status
      if (status === undefined || ownerResultResponse === undefined) return invalidOwnerResponse ? invalid() : dependency()
      if (ownerResultResponse.headers.get("x-kokoro-request-id") !== requestId || ownerResultResponse.headers.get("cache-control") !== "no-store")
        return invalid()
      if (status === 200 && result.data !== undefined) {
        const parsed = (operation === "managedSkills" ? managedListResponse : managedDetailResponse).safeParse(result.data)
        if (!parsed.success || !matchesManagedIdentity(result.data, input.skillId)) return invalid()
        if (operation === "managedSkills") {
          const data = parsed.data.data as { skills: unknown[]; next_cursor?: string }
          return { ok: true, status: 200, data: { skills: data.skills, next_cursor: data.next_cursor ?? null } }
        }
        return { ok: true, status: 200, data: parsed.data.data }
      }
      const parsed = managedError.safeParse(result.error)
      if (!parsed.success) return invalid()
      const { code, retryable } = parsed.data.error
      if (status === 400 && code === "capability.invalid_request" && !retryable) return { ok: false, status: 400, code: "invalid_skill_request" }
      if (status === 404 && operation === "managedSkill" && code === "capability.route_not_found" && !retryable)
        return { ok: false, status: 404, code: "skill_not_found" }
      if (
        (status === 400 && code === "capability.subject_invalid" && !retryable) ||
        (status === 401 && code === "capability.service_auth_failed" && !retryable) ||
        (status === 403 && ["capability.permission_denied", "capability.tenant_mismatch"].includes(code) && !retryable) ||
        (status === 503 && code === "capability.dependencies_unavailable" && retryable)
      )
        return dependency()
      return invalid()
    } catch {
      return invalidOwnerResponse ? invalid() : dependency()
    }
  }
  async #read(
    operation: ProjectionOperation,
    tenantId: string,
    subject: string,
    requestId: string,
    input: { query?: Record<string, unknown>; skillId?: string },
    signal?: AbortSignal,
  ): Promise<ProjectionResult> {
    const self = operation === "mcpConnections"
    const invalid = (): ProjectionResult => (self ? { ok: false, status: 502, code: "mcp_connection_response_invalid", retryable: false } : invalidResponse())
    const dependency = (): ProjectionResult =>
      self ? { ok: false, status: 503, code: "mcp_connection_dependency_unavailable", retryable: true } : unavailable()
    let token: string
    try {
      token = await this.#tokens.get(tenantId, signal)
    } catch {
      return dependency()
    }
    if (self) signal?.throwIfAborted()
    let invalidOwnerResponse = false
    const bounded = async (request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const controller = new AbortController()
      const joined = signal
        ? AbortSignal.any([signal, controller.signal, AbortSignal.timeout(this.timeoutMs)])
        : AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)])
      const baseRequest = new Request(request, init)
      const fetchHeaders = new Headers(baseRequest.headers)
      fetchHeaders.set("authorization", `Bearer ${token}`)
      if (self) joined.throwIfAborted()
      const pending = fetch(new Request(baseRequest, { headers: fetchHeaders, signal: joined, redirect: "error" }))
      const response = self
        ? await whileActive(
            pending.then((late) => {
              if (joined.aborted) {
                void late.body?.cancel().catch(() => undefined)
                throw joined.reason
              }
              return late
            }),
            joined,
          )
        : await pending
      const declaredLength = response.headers.get("content-length")
      if (declaredLength !== null && /^[0-9]+$/u.test(declaredLength) && Number(declaredLength) > this.maxBytes) {
        invalidOwnerResponse = true
        controller.abort()
        void response.body?.cancel().catch(() => undefined)
        throw new Error("projection_response_too_large")
      }
      if (response.body === null) return response
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const next = self ? await whileActive(reader.read(), joined) : await reader.read()
          if (next.done) break
          size += next.value.byteLength
          if (size > this.maxBytes) {
            invalidOwnerResponse = true
            controller.abort()
            throw new Error("projection_response_too_large")
          }
          chunks.push(next.value)
        }
      } finally {
        void reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      if (self || operation === "catalog" || (response.status === 200 && operation !== "mcp")) {
        if (self) joined.throwIfAborted()
        try {
          if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new Error("media")
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
          if (operation === "catalog") strictParseRawJson(text)
          const value: unknown = JSON.parse(text)
          const schema =
            response.status !== 200
              ? connectionError
              : operation === "mcpConnections"
                ? connectionResponse
                : operation === "skills"
                  ? visibleSkillsResponse
                  : operation === "pool"
                    ? visibleSkillPoolResponse
                    : operation === "catalog"
                      ? visibleSkillCatalogResponse
                      : operation === "skill"
                        ? publishedSkillResponse
                        : undefined
          if (schema === undefined || !schema.safeParse(value).success) throw new Error("shape")
        } catch {
          invalidOwnerResponse = true
          throw new Error("projection_response_invalid")
        }
      }
      return new Response(bytes, { status: response.status, headers: response.headers })
    }
    const client = createClient({ baseUrl: this.baseUrl, fetch: bounded, redirect: "error" })
    const headers = { "x-kokoro-tenant-id": tenantId, "x-kokoro-subject": subject, "x-kokoro-request-id": requestId }
    const result =
      operation === "mcpConnections"
        ? await listSelfMcpConnections({ client, auth: token, headers, ...(input.query === undefined ? {} : { query: input.query as never }) })
        : operation === "skills"
          ? await listVisibleSkills({
              responseValidator: async (value) => visibleSkillsResponse.parseAsync(value),
              client,
              auth: token,
              headers,
              ...(input.query === undefined ? {} : { query: input.query as never }),
            })
          : operation === "pool"
            ? await listVisibleSkillPool({
                responseValidator: async (value) => visibleSkillPoolResponse.parseAsync(value),
                client,
                auth: token,
                headers,
                ...(input.query === undefined ? {} : { query: input.query as never }),
              })
            : operation === "catalog"
              ? await listVisibleSkillCatalog({
                  responseValidator: async (value) => visibleSkillCatalogResponse.parseAsync(value),
                  client,
                  auth: token,
                  headers,
                  ...(input.query === undefined ? {} : { query: input.query as never }),
                })
              : operation === "mcp"
                ? await listMcpServers({ client, auth: token, headers, ...(input.query === undefined ? {} : { query: input.query as never }) })
                : await getPublishedPersonalSkill({
                    responseValidator: async (value) => publishedSkillResponse.parseAsync(value),
                    client,
                    auth: token,
                    headers,
                    path: { skill_id: input.skillId ?? "" },
                  })
    const status = result.response?.status
    if (status === undefined) return invalidOwnerResponse ? invalid() : dependency()
    if (result.response?.headers.get("x-kokoro-request-id") !== requestId || result.response?.headers.get("cache-control") !== "no-store") return invalid()
    if (status === 200 && result.data !== undefined) {
      const schema =
        operation === "mcpConnections"
          ? zListSelfMcpConnectionsResponse
          : operation === "skills"
            ? visibleSkillsResponse
            : operation === "pool"
              ? visibleSkillPoolResponse
              : operation === "catalog"
                ? visibleSkillCatalogResponse
                : operation === "mcp"
                  ? zListMcpServersResponse
                  : publishedSkillResponse
      const parsed = schema.safeParse(result.data)
      if (!parsed.success || (operation === "skill" && !matchesPublishedIdentity(result.data, input.skillId))) return invalid()
      return { ok: true, status: 200, data: parsed.data.data }
    }
    const parsed = zErrorEnvelope.safeParse(result.error)
    if (!parsed.success) return invalid()
    if (self) {
      const { code, retryable } = parsed.data.error
      if (status === 400 && code === "capability.invalid_request" && !retryable)
        return { ok: false, status: 400, code: "invalid_query_parameter", retryable: false }
      if (
        (status === 401 && code === "capability.service_auth_failed" && !retryable) ||
        (status === 403 && ["capability.permission_denied", "capability.tenant_mismatch"].includes(code) && !retryable) ||
        (status === 500 && code === "capability.internal_error" && !retryable) ||
        (status === 503 && code === "capability.dependencies_unavailable" && retryable)
      )
        return dependency()
      return invalid()
    }
    if (status === 400 && operation === "catalog" && parsed.data.error.code === "capability.invalid_request" && parsed.data.error.retryable === false)
      return { ok: false, status: 400, code: "invalid_query_parameter", retryable: false }
    if (status === 404 && operation === "skill" && parsed.data.error.code === "capability.route_not_found")
      return { ok: false, status: 404, code: "skill_not_found", retryable: false }
    const { code, retryable } = parsed.data.error
    if (
      (status === 401 && code === "capability.service_auth_failed" && !retryable) ||
      (status === 403 && ["capability.permission_denied", "capability.tenant_mismatch"].includes(code) && !retryable) ||
      (status === 503 && code === "capability.dependencies_unavailable" && retryable)
    )
      return unavailable()
    return invalidResponse()
  }
}
