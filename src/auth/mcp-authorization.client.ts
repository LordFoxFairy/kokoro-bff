import { randomUUID } from "node:crypto"
import { zApiErrorResponse, zCheckAuthorizationBody, zCheckAuthorizationResponse } from "../generated/iam-http/zod.gen.js"
import type { SessionAdmissionClientOptions } from "./session-admission.client.js"
import { createIamHttpClient } from "../infrastructure/clients/iam-http-transport.js"
import { iamUserContextHeaders } from "./iam-user-context.js"
import { checkAuthorization } from "../generated/iam-http/sdk.gen.js"
import type { McpAuthorizationInput, McpAuthorizationResult } from "./mcp-authorization.types.js"

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u
const responseSchema = zCheckAuthorizationResponse.extend({ data: zCheckAuthorizationResponse.shape.data.strict() }).strict()
const errorSchema = zApiErrorResponse.extend({ error: zApiErrorResponse.shape.error.strict() }).strict()
export class McpAuthorizationClient {
  private readonly client: ReturnType<typeof createIamHttpClient> | null
  private readonly credentialFile: string | null
  public constructor(options: SessionAdmissionClientOptions) {
    this.credentialFile = options.credentialFile ?? null
    this.client = options.baseUrl === null ? null : createIamHttpClient({ ...options, baseUrl: options.baseUrl })
  }

  public async check(input: McpAuthorizationInput): Promise<McpAuthorizationResult> {
    const unavailable = {
      ok: false,
      status: 503,
      code: "iam_admission_unavailable",
    } as const
    if (this.client === null || !input.tenantId.trim() || !input.subjectId.trim()) return unavailable
    const requestBody = zCheckAuthorizationBody.safeParse({ resource: input.resource, action: input.action })
    if (!requestBody.success) return unavailable
    const requestId = REQUEST_ID_PATTERN.test(input.requestId) ? input.requestId : randomUUID()
    try {
      input.signal.throwIfAborted()
      const result = await checkAuthorization({
        client: this.client,
        body: requestBody.data,
        headers: { ...(await iamUserContextHeaders({ ...input, credentialFile: this.credentialFile })), accept: "application/json", "x-request-id": requestId },
        signal: input.signal,
        responseValidator: async (raw) => responseSchema.parse(raw),
      })
      const response = result.response
      if (response === undefined) return unavailable
      input.signal.throwIfAborted()
      if (
        response.headers.get("x-request-id") !== requestId ||
        !response.headers
          .get("cache-control")
          ?.split(",")
          .some((value) => value.trim().toLowerCase() === "no-store") ||
        response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
      )
        return unavailable
      const body: unknown = response.status === 200 ? result.data : result.error
      if (response.status === 200) {
        const parsed = responseSchema.safeParse(body)
        if (
          !parsed.success ||
          parsed.data.data.tenant_id !== input.tenantId ||
          parsed.data.data.subject_id !== input.subjectId ||
          parsed.data.data.decision_source !== "current_membership"
        )
          return unavailable
        return parsed.data.data.allowed ? { ok: true } : { ok: false, status: 403, code: "session_forbidden" }
      }
      const error = errorSchema.safeParse(body)
      if (!error.success) return unavailable
      if (response.status === 401 && error.data.error.code === "UNAUTHENTICATED") return unavailable
      if (response.status === 403 && error.data.error.code === "PERMISSION_DENIED") return { ok: false, status: 403, code: "session_forbidden" }
      if (response.status === 429 && error.data.error.code === "RATE_LIMITED") {
        const after = response.headers.get("retry-after")
        const retryAfter = after !== null && /^[1-9][0-9]{0,4}(?![\s\S])/u.test(after) && Number(after) <= 86_400 ? after : undefined
        return {
          ok: false,
          status: 429,
          code: "session_rate_limited",
          ...(retryAfter === undefined ? {} : { retryAfter }),
        }
      }
      return unavailable
    } catch {
      return unavailable
    }
  }
}
