import { z } from "zod"
import { mcpReauthorizationResponseSchema } from "../infrastructure/clients/platform/mcp-personal-server-response.js"
import { CONNECTOR_COMMAND_FAULT_POLICY } from "../infrastructure/clients/platform/connector-command-fault.js"
import { MCP_SERVER_ICON_CONTRACT } from "../application/mcp-server-icon.contract.js"

export const mcpReauthorizationIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u)
// The same closed decimal range survives JSON Schema publication, not only Zod refinement.
const cas = z
  .string()
  .regex(
    /^(?:[1-9][0-9]{0,8}|1[0-9]{9}|20[0-9]{8}|21[0-3][0-9]{7}|214[0-6][0-9]{6}|2147[0-3][0-9]{5}|21474[0-7][0-9]{4}|214748[0-2][0-9]{3}|2147483[0-5][0-9]{2}|21474836[0-3][0-9]|214748364[0-6])(?![\s\S])/u,
  )
export const mcpReauthorizationRequestSchema = z
  .object({
    source_connector_id: mcpReauthorizationIdSchema,
    expected_server_state_version: cas,
    expected_connector_state_version: cas,
  })
  .strict()
export const mcpReauthorizationKeySchema = z.string().regex(/^[\x21-\x7e]{1,191}(?![\s\S])/u)
export const MCP_REAUTHORIZATION_POLICY = {
  profile: "mcp-private-server-reauthorization",
  version: "1.0.0",
  visibility: "browser-private",
  path: "/browser/v1/mcp/servers/{server_id}/reauthorize",
  operation_id: "reauthorizePersonalMcpServer",
  permission: "mcp_personal.manage",
  state_version: { minimum: 1, maximum: 2147483646, encoding: "canonical_decimal_string" },
  automatic_retries: false,
  new_command_authorized: false,
  prepare_authorized: false,
  connected: false,
  same_command: { method: "POST", target: "original", body: "original_source_and_double_cas", key: "original" },
  historical_completed: "original_safe_ack_even_after_delete; never_current_or_execution_qualification",
  errors: [
    ...new Map(
      [
        ...MCP_SERVER_ICON_CONTRACT.errors,
        ...Object.values(CONNECTOR_COMMAND_FAULT_POLICY.mcp),
        ...Object.values(CONNECTOR_COMMAND_FAULT_POLICY.mcp_preconditions),
        { status: 412, code: "mcp_personal_precondition_failed", retryable: false },
        { status: 413, code: "mcp_personal_request_too_large", retryable: false },
        { status: 409, code: "mcp_personal_server_url_conflict", retryable: false },
      ].map(({ status, code, retryable }) => [`${status}:${code}:${retryable}`, { status, code, retryable }]),
    ).values(),
  ],
} as const
export { mcpReauthorizationResponseSchema }
