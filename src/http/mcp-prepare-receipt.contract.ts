import { mcpPrepareReceiptResponseSchema } from "../infrastructure/clients/platform/mcp-personal-server-response.js"
import { z } from "zod"
import { MCP_SERVER_ICON_CONTRACT } from "../application/mcp-server-icon.contract.js"
import { CONNECTOR_COMMAND_FAULT_POLICY } from "../infrastructure/clients/platform/connector-command-fault.js"

export const mcpPrepareReceiptQuerySchema = z
  .object({
    expected_state_version: z
      .string()
      .regex(/^[1-9][0-9]{0,9}(?![\s\S])/u)
      .refine((value) => BigInt(value) <= 2_147_483_647n),
  })
  .strict()
export const mcpPrepareReceiptKeySchema = z.string().regex(/^[\x21-\x7e]{1,191}(?![\s\S])/u)
const lookupErrors = [
  ...MCP_SERVER_ICON_CONTRACT.errors,
  ...Object.values(CONNECTOR_COMMAND_FAULT_POLICY.mcp).map(({ status, code, retryable }) => ({ status, code, retryable })),
]

/** Query-only successor; no existing command recovery tuple grants POST authority here. */
export const MCP_PREPARE_RECEIPT_POLICY = {
  profile: "mcp-prepare-receipt-lookup",
  version: "1.0.0",
  visibility: "browser-private",
  path: "/browser/v1/mcp/servers/{server_id}/prepare-receipt",
  operation_id: "getMcpPrepareReceipt",
  permission: "mcp_personal.read",
  lookup_only: true,
  completed_only: true,
  negative_ack: false,
  automatic_retries: false,
  new_command_authorized: false,
  prepare_authorized: false,
  supersedes_prepare_inspection_recovery: true,
  same_command: { method: "GET", target: "original_lookup" },
  errors: [...new Map(lookupErrors.map((fault) => [`${fault.status}:${fault.code}:${fault.retryable}`, fault])).values()],
} as const

export { mcpPrepareReceiptResponseSchema }
