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
  | { ok: false; status: 400 | 401 | 403 | 404 | 429 | 502 | 503; code: string; retryable: boolean; retryAfter?: string }
const validRequestId = (v: string | null): boolean => v !== null && v.trim().length > 0 && v.trim().length <= 255
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
    const token = await this.#tokens.get(tenantId, signal)
    const bounded = async (request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const joined = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs)
      const baseRequest = new Request(request, init)
      const fetchHeaders = new Headers(baseRequest.headers)
      fetchHeaders.set("authorization", `Bearer ${token}`)
      const response = await fetch(new Request(baseRequest, { headers: fetchHeaders, signal: joined, redirect: "error" }))
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > this.maxBytes) throw new Error("projection_response_too_large")
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
    if (!validRequestId(result.response?.headers.get("x-kokoro-request-id") ?? null) || result.response?.headers.get("cache-control") !== "no-store")
      return { ok: false, status: 502, code: "skill_response_invalid", retryable: false }
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
      return parsed.success ? { ok: true, status: 200, data: parsed.data.data } : { ok: false, status: 502, code: "skill_response_invalid", retryable: false }
    }
    const parsed = zErrorEnvelope.safeParse(result.error)
    if (!parsed.success || ![400, 401, 403, 404, 429, 503].includes(status ?? 0))
      return { ok: false, status: 502, code: "skill_response_invalid", retryable: false }
    const retryAfter = result.response?.headers.get("retry-after") ?? undefined
    return {
      ok: false,
      status: status as 400 | 401 | 403 | 404 | 429 | 503,
      code: parsed.data.error.code,
      retryable: parsed.data.error.retryable,
      ...(retryAfter && /^[1-9][0-9]{0,4}$/.test(retryAfter) ? { retryAfter } : {}),
    }
  }
}
