import { createClient } from "../../../generated/platform-http/client/client.gen.js"
import {
  getPublishedPersonalSkill,
  listMcpServers,
  listVisibleSkillCatalog,
  listVisibleSkillPool,
  listVisibleSkills,
} from "../../../generated/platform-http/sdk.gen.js"
import {
  zErrorEnvelope,
  zGetPublishedPersonalSkillResponse,
  zListMcpServersResponse,
  zListVisibleSkillCatalogResponse,
  zListVisibleSkillPoolResponse,
  zListVisibleSkillsResponse,
} from "../../../generated/platform-http/zod.gen.js"
import { ProjectionCredentialSource } from "./projection-credential.js"
import { ProjectionTokenSource } from "./projection-token.js"

export type ProjectionOperation = "skills" | "skill" | "pool" | "catalog" | "mcp"
export type ProjectionResult =
  | { ok: true; status: 200; data: unknown }
  | { ok: false; status: 404 | 502 | 503; code: "skill_not_found" | "skill_response_invalid" | "skill_dependency_unavailable"; retryable: boolean }
const invalidResponse = (): ProjectionResult => ({ ok: false, status: 502, code: "skill_response_invalid", retryable: false })
const unavailable = (): ProjectionResult => ({ ok: false, status: 503, code: "skill_dependency_unavailable", retryable: true })
const publishedFields = ["name", "revision", "skill_id", "source_ref", "status", "summary", "tags"]

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
export class PlatformProjectionHttpClient {
  readonly #tokens: ProjectionTokenSource
  constructor(
    private readonly baseUrl: string,
    iamUrl: string,
    credentialFile: string,
    private readonly timeoutMs = 5000,
    private readonly maxBytes = 1024 * 1024,
  ) {
    this.#tokens = new ProjectionTokenSource(iamUrl, new ProjectionCredentialSource(credentialFile), timeoutMs)
  }
  async read(
    operation: ProjectionOperation,
    tenantId: string,
    subject: string,
    requestId: string,
    input: { query?: Record<string, unknown>; skillId?: string } = {},
    signal?: AbortSignal,
  ): Promise<ProjectionResult> {
    let token: string
    try {
      token = await this.#tokens.get(tenantId, signal)
    } catch {
      return unavailable()
    }
    let invalidOwnerResponse = false
    const bounded = async (request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const controller = new AbortController()
      const joined = signal
        ? AbortSignal.any([signal, controller.signal, AbortSignal.timeout(this.timeoutMs)])
        : AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)])
      const baseRequest = new Request(request, init)
      const fetchHeaders = new Headers(baseRequest.headers)
      fetchHeaders.set("authorization", `Bearer ${token}`)
      const response = await fetch(new Request(baseRequest, { headers: fetchHeaders, signal: joined, redirect: "error" }))
      const declaredLength = response.headers.get("content-length")
      if (declaredLength !== null && /^[0-9]+$/u.test(declaredLength) && Number(declaredLength) > this.maxBytes) {
        invalidOwnerResponse = true
        await response.body?.cancel()
        controller.abort()
        throw new Error("projection_response_too_large")
      }
      if (response.body === null) return response
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const next = await reader.read()
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
        await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return new Response(bytes, { status: response.status, headers: response.headers })
    }
    const client = createClient({ baseUrl: this.baseUrl, fetch: bounded, redirect: "error" })
    const headers = { "x-kokoro-tenant-id": tenantId, "x-kokoro-subject": subject, "x-kokoro-request-id": requestId }
    const result =
      operation === "skills"
        ? await listVisibleSkills({ client, auth: token, headers, ...(input.query === undefined ? {} : { query: input.query as never }) })
        : operation === "pool"
          ? await listVisibleSkillPool({ client, auth: token, headers, ...(input.query === undefined ? {} : { query: input.query as never }) })
          : operation === "catalog"
            ? await listVisibleSkillCatalog({ client, auth: token, headers, ...(input.query === undefined ? {} : { query: input.query as never }) })
            : operation === "mcp"
              ? await listMcpServers({ client, auth: token, headers, ...(input.query === undefined ? {} : { query: input.query as never }) })
              : await getPublishedPersonalSkill({ client, auth: token, headers, path: { skill_id: input.skillId ?? "" } })
    const status = result.response?.status
    if (status === undefined) return invalidOwnerResponse ? invalidResponse() : unavailable()
    if (result.response?.headers.get("x-kokoro-request-id") !== requestId || result.response?.headers.get("cache-control") !== "no-store")
      return invalidResponse()
    if (status === 200 && result.data !== undefined) {
      const schema =
        operation === "skills"
          ? zListVisibleSkillsResponse
          : operation === "pool"
            ? zListVisibleSkillPoolResponse
            : operation === "catalog"
              ? zListVisibleSkillCatalogResponse
              : operation === "mcp"
                ? zListMcpServersResponse
                : zGetPublishedPersonalSkillResponse
      const parsed = schema.safeParse(result.data)
      if (!parsed.success || (operation === "skill" && !matchesPublishedIdentity(result.data, input.skillId))) return invalidResponse()
      return { ok: true, status: 200, data: parsed.data.data }
    }
    const parsed = zErrorEnvelope.safeParse(result.error)
    if (!parsed.success) return invalidResponse()
    if (status === 404 && operation === "skill" && parsed.data.error.code === "capability.route_not_found")
      return { ok: false, status: 404, code: "skill_not_found", retryable: false }
    if (status === 401 || status === 403 || status === 503) return unavailable()
    return invalidResponse()
  }
}
