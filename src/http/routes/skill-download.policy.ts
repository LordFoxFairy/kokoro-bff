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

// This describes the existing opaque byte route, not the metadata POST union.
// Admission may omit retryable; mapped failures and capitalized bare codes have
// different exact shapes. FailedPrecondition still uses the existing 503 fallback.
const byteErrorCases = [
  { status: 400, variants: [{ codes: ["invalid_skill_request"], retryable: "required-false" }] },
  {
    status: 401,
    variants: [
      { codes: ["Unauthenticated"], retryable: "absent" },
      { codes: ["session_authentication_required", "session_invalid"], retryable: "optional-false" },
    ],
  },
  {
    status: 403,
    variants: [
      { codes: ["PermissionDenied"], retryable: "absent" },
      { codes: ["service_auth_failed", "product_tenant_forbidden", "session_forbidden"], retryable: "optional-false" },
      { codes: ["skill_download_forbidden"], retryable: "required-false" },
    ],
  },
  {
    status: 404,
    variants: [
      { codes: ["NotFound"], retryable: "absent" },
      { codes: ["skill_not_found"], retryable: "required-false" },
    ],
  },
  { status: 405, variants: [{ codes: ["MethodNotAllowed"], retryable: "absent" }] },
  { status: 410, variants: [{ codes: ["Gone"], retryable: "absent" }] },
  {
    status: 429,
    variants: [
      { codes: ["session_rate_limited"], retryable: "optional-true" },
      { codes: ["skill_rate_limited"], retryable: "required-true" },
    ],
  },
  { status: 502, variants: [{ codes: ["skill_response_invalid"], retryable: "required-false" }] },
  {
    status: 503,
    variants: [
      { codes: ["product_tenant_not_configured", "iam_admission_unavailable"], retryable: "optional-true" },
      { codes: ["skill_dependency_unavailable"], retryable: "required-true" },
    ],
  },
  { status: 504, variants: [{ codes: ["skill_deadline_exceeded"], retryable: "required-true" }] },
] as const

const byteOperation = Object.freeze({
  method: "GET",
  path: "/skill-downloads/{handle}",
  parameter: "handle",
  parameterSchema: Object.freeze({ type: "string", pattern: "^[A-Za-z0-9_-]{43}$" }),
  description:
    "The issued canonical reference is opaque. Missing, expired or noncanonical lookup keys return Gone; the handle never replaces fresh admission and exact qualification.",
  request: Object.freeze({
    query: "forbidden",
    idempotencyKey: "forbidden",
    payload: "exactly-zero-bytes",
    contentLength: ["absent"],
    transferEncoding: "forbidden",
  }),
  automaticRetry: false,
  streaming: Object.freeze({
    beforeHeaders: "complete-size-and-sha256-verified-spool-and-current-qualification",
    callerCancellation: "abort",
    afterHeadersFailure: "terminate-stream-without-appending-json",
    redirects: "forbidden",
  }),
  responseHeaders: Object.freeze({
    "cache-control": { const: "no-store" },
    "x-request-id": { type: "string", minLength: 1 },
  }),
  errorFraming: Object.freeze({
    contentType: "application/json; charset=utf-8",
    contentLength: "exact-utf8-json-byte-length",
    contentDisposition: "absent",
    retryAfter: { required: false, pattern: "^[1-9][0-9]{0,4}$", maximumSeconds: 86_400, source: "current-admission-only" },
  }),
  responses: Object.freeze({
    200: Object.freeze({
      body: { kind: "binary", mediaType: "application/zip", minBytes: 1, maxBytes: 33_554_432 },
      filenameMaxUtf8Bytes: 255,
      headers: {
        type: "object",
        required: ["content-type", "content-length", "content-disposition", "cache-control", "x-request-id", "x-content-type-options", "referrer-policy"],
        properties: {
          "content-type": { const: "application/zip" },
          "content-length": { type: "string", pattern: "^[1-9][0-9]*$" },
          "content-disposition": { type: "string", pattern: "^attachment; filename=\"skill\\.zip\"; filename\\*=UTF-8''(?:[A-Za-z0-9!._~-]|%[0-9A-F]{2})+$" },
          "cache-control": { const: "no-store" },
          "x-request-id": { type: "string", minLength: 1 },
          "x-content-type-options": { const: "nosniff" },
          "referrer-policy": { const: "no-referrer" },
        },
      },
    }),
    errors: Object.freeze(
      byteErrorCases.map(({ status, variants }) =>
        Object.freeze({
          status,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["error"],
            properties: {
              error: {
                oneOf: variants.map(({ codes, retryable }) => ({
                  type: "object",
                  additionalProperties: false,
                  required: ["code", "message", ...(retryable.startsWith("required-") ? ["retryable"] : [])],
                  properties: {
                    code: { type: "string", enum: codes },
                    message: { type: "string", minLength: 1 },
                    ...(retryable === "absent" ? {} : { retryable: { type: "boolean", const: retryable.endsWith("true") } }),
                  },
                })),
              },
            },
          },
        }),
      ),
    ),
  }),
})

export const SKILL_DOWNLOAD_POLICY = Object.freeze({
  visibility: "browser-private",
  version: 3,
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
  byte_operation: byteOperation,
})
