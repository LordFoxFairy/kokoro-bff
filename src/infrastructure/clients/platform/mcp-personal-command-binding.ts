import { sha256Jcs } from "./jcs.js"
import type { McpPersonalInput } from "./mcp-personal-response.js"

export type McpPersonalCommandOperation = "create" | "update" | "enabled" | "remove"
export type McpPersonalCommandFields = {
  providerKey?: string
  connectorType?: "builtin" | "byok" | "mcp"
  displayName?: string
  description?: string
  enabled?: boolean
  expectedStateVersion?: string
}
export type McpPersonalCommandInput = McpPersonalInput & McpPersonalCommandFields & { commandId: string }
export const mcpPersonalCommandMethods = {
  create: "CreatePersonalMcpConnector",
  update: "UpdatePersonalMcpConnector",
  enabled: "SetPersonalMcpConnectorEnabled",
  remove: "RemovePersonalMcpConnector",
} as const
export function bindMcpPersonalCommand(operation: McpPersonalCommandOperation, input: McpPersonalCommandInput): { commandId: string; requestDigest: string } {
  const fields =
    operation === "create"
      ? {
          provider_key: input.providerKey!,
          connector_type: { builtin: 1, byok: 2, mcp: 3 }[input.connectorType!],
          display_name: input.displayName!,
          description: input.description!,
        }
      : {
          connector_id: input.id!,
          expected_state_version: input.expectedStateVersion!,
          ...(operation === "update" ? { display_name: input.displayName!, description: input.description! } : {}),
          ...(operation === "enabled" ? { enabled: input.enabled! } : {}),
        }
  return {
    commandId: input.commandId,
    requestDigest: sha256Jcs({
      method: `kokoro.platform.v1.ProductMcpPersonalService/${mcpPersonalCommandMethods[operation]}`,
      tenant_id: input.tenant,
      subject_id: input.subject,
      input: fields,
    }).sha256,
  }
}
