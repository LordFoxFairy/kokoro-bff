const id = Object.freeze({ type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$" })
const success = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["data"],
  properties: {
    data: {
      type: "object",
      additionalProperties: false,
      required: ["source_ref", "revision", "download_info"],
      properties: {
        source_ref: { type: "string", pattern: "^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$" },
        revision: { type: "string", pattern: "^[1-9][0-9]{0,19}$" },
        download_info: {
          type: "object",
          additionalProperties: false,
          required: ["download_url", "filename", "expires_at"],
          properties: {
            download_url: { type: "string", pattern: "^/skill-downloads/[A-Za-z0-9_-]{43}$" },
            filename: { type: "string", minLength: 1, maxLength: 255 },
            expires_at: { type: "string", format: "date-time" },
          },
        },
      },
    },
  },
})
const request = Object.freeze({
  query: "forbidden",
  idempotencyKey: "forbidden",
  payload: "exactly-zero-bytes",
  contentLength: ["absent", "0"],
  transferEncoding: "forbidden",
})
const errors = Object.freeze(
  [
    { status: 400, codes: ["invalid_skill_request"] },
    { status: 401, codes: ["session_authentication_required", "session_invalid"] },
    { status: 403, codes: ["service_auth_failed", "product_tenant_forbidden", "session_forbidden", "skill_download_forbidden"] },
    { status: 404, codes: ["skill_not_found"] },
    { status: 405, codes: ["MethodNotAllowed"] },
    { status: 429, codes: ["session_rate_limited", "skill_rate_limited"] },
    { status: 502, codes: ["skill_response_invalid"] },
    { status: 503, codes: ["product_tenant_not_configured", "iam_admission_unavailable", "skill_dependency_unavailable"] },
    { status: 504, codes: ["skill_deadline_exceeded"] },
  ].map(({ status, codes }) =>
    Object.freeze({
      status,
      schema: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["error"],
        properties: Object.freeze({
          error: Object.freeze({
            type: "object",
            additionalProperties: false,
            required: ["code", "message", "retryable"],
            properties: Object.freeze({
              code: Object.freeze({ type: "string", enum: Object.freeze(codes) }),
              message: Object.freeze({ type: "string", minLength: 1 }),
              retryable: Object.freeze({ type: "boolean" }),
            }),
          }),
        }),
      }),
    }),
  ),
)

export const SKILL_DOWNLOAD_POLICY = Object.freeze({
  visibility: "browser-private",
  version: 2,
  budgetMs: 10_000,
  operations: [
    { method: "POST", path: "/browser/v1/skill-installations/{installation_id}/download", qualifier: "installation", parameter: "installation_id" },
    { method: "POST", path: "/browser/v1/skills/{version_id}/download", qualifier: "managed", parameter: "version_id" },
    { method: "POST", path: "/browser/v1/skill-shares/{share_id}/download", qualifier: "share", parameter: "share_id" },
    {
      method: "POST",
      path: "/browser/v1/projects/{projectId}/skill-installations/{installation_id}/download",
      qualifier: "project_installation",
      parameter: "installation_id",
      projectParameter: "projectId",
      projectParameterSchema: id,
    },
  ].map((operation) => Object.freeze({ ...operation, parameterSchema: id, request, responses: Object.freeze({ 200: success, errors }) })),
})
