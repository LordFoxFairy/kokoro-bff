import { z } from "zod"

/** Independent code-first browser media contract; no command or public API policy changes. */
export const mcpServerIconId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u)
export const MCP_SERVER_ICON_CONTRACT = {
  profile: "mcp-server-icon-browser",
  version: "1.0.0",
  owner: "kokoro-bff",
  visibility: "browser-private",
  path: "/browser/v1/mcp/servers/{server_id}/icon",
  method: "GET",
  operation_id: "getPersonalMcpServerIcon",
  permission: "mcp_personal.read",
  body: false,
  query: false,
  command_headers: false,
  automatic_retries: false,
  new_command_authorized: false,
  max_bytes: 1_048_576,
  max_reference_ttl_ms: 301_000,
  success: {
    status: 200,
    content_types: ["image/png", "image/jpeg"],
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-length": "exact_verified_bytes",
      "x-request-id": "request_correlation",
    },
  },
  // The existing private MCP read and bootstrap admission tuples, not command recovery grants.
  errors: [
    { status: 400, code: "invalid_mcp_personal_request", retryable: false },
    { status: 404, code: "mcp_personal_not_found", retryable: false },
    { status: 502, code: "mcp_personal_response_invalid", retryable: false },
    { status: 503, code: "mcp_personal_dependency_unavailable", retryable: true },
    { status: 401, code: "session_authentication_required", retryable: false },
    { status: 401, code: "session_invalid", retryable: false },
    { status: 403, code: "service_auth_failed", retryable: false },
    { status: 403, code: "product_tenant_forbidden", retryable: false },
    { status: 403, code: "session_forbidden", retryable: false },
    { status: 429, code: "session_rate_limited", retryable: true },
    { status: 503, code: "product_tenant_not_configured", retryable: true },
    { status: 503, code: "iam_admission_unavailable", retryable: true },
  ],
} as const
