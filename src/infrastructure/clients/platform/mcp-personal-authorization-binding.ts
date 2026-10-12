import { sha256Jcs } from "./jcs.js"
import type { McpPersonalInput } from "./mcp-personal-response.js"

export type McpPersonalAuthorizationOperation = "begin" | "reconnect" | "complete" | "createConnection"
export type McpPersonalAuthorizationFields = {
  connectorId?: string
  serverId?: string
  expectedStateVersion?: string
  state?: string
  code?: string
  error?: string
  allowedSelectors?: string[]
}
export type McpPersonalAuthorizationInput = McpPersonalInput & McpPersonalAuthorizationFields & { commandId?: string }

/** Binds only the idempotent connection creation; OAuth redirects never use BFF command identities. */
export function bindMcpPersonalConnection(input: McpPersonalAuthorizationInput): { commandId: string; requestDigest: string } {
  return {
    commandId: input.commandId!,
    requestDigest: sha256Jcs({
      method: "kokoro.platform.v1.ProductMcpPersonalService/CreatePersonalMcpConnection",
      tenant_id: input.tenant,
      subject_id: input.subject,
      input: {
        connector_id: input.id!,
        server_id: input.serverId!,
        allowed_selectors: input.allowedSelectors!,
        expected_state_version: input.expectedStateVersion!,
      },
    }).sha256,
  }
}
