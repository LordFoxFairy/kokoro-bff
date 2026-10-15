import { sha256Jcs } from "./jcs.js"
import type { McpPersonalInput } from "./mcp-personal-response.js"

export type McpPersonalServerOperation = "registerServer" | "server" | "prepareServer" | "updateServer" | "deleteServer"
export type McpPersonalServerMutation = Exclude<McpPersonalServerOperation, "server">
export type McpPersonalServerFields = {
  displayName?: string
  serverUrl?: string
  notes?: string
  headers?: Array<{ name: string; value: string }>
  oauthClient?: { clientId: string; clientSecret: string }
  expectedStateVersion?: string
  clearNotes?: boolean
  headerUpserts?: Array<{ name: string; value: string }>
  headerRemovals?: string[]
  revokeOauthClient?: boolean
}
export type McpPersonalServerInput = McpPersonalInput & McpPersonalServerFields & { commandId?: string }

/** Binds Platform's public command digest while excluding confidential header/client-secret values. */
export function bindMcpPersonalServerCommand(
  operation: McpPersonalServerMutation,
  input: McpPersonalServerInput,
): { commandId: string; requestDigest: string } {
  const method = {
    registerServer: "RegisterPersonalMcpServer",
    prepareServer: "PreparePersonalMcpServer",
    updateServer: "UpdatePersonalMcpServer",
    deleteServer: "DeletePersonalMcpServer",
  }[operation]
  const body =
    operation === "registerServer"
      ? {
          display_name: input.displayName!,
          server_url: input.serverUrl!,
          notes: input.notes ?? null,
          headers: (input.headers ?? []).map(({ name }) => name.toLowerCase()).sort(),
          oauth_client_id: input.oauthClient?.clientId ?? null,
          oauth_client_present: input.oauthClient !== undefined,
        }
      : operation === "prepareServer" || operation === "deleteServer"
        ? { server_id: input.id!, expected_state_version: input.expectedStateVersion! }
        : {
            server_id: input.id!,
            expected_state_version: input.expectedStateVersion!,
            display_name: input.displayName ?? null,
            notes: input.notes ?? null,
            clear_notes: input.clearNotes ?? false,
            server_url: input.serverUrl ?? null,
            header_upserts: (input.headerUpserts ?? []).map(({ name }) => name.toLowerCase()).sort(),
            header_removals: (input.headerRemovals ?? []).map((name) => name.toLowerCase()).sort(),
            oauth_client_id: input.oauthClient?.clientId ?? null,
            oauth_client_present: input.oauthClient !== undefined,
            revoke_oauth_client: input.revokeOauthClient ?? false,
          }
  return {
    commandId: input.commandId!,
    requestDigest: sha256Jcs({
      method: `kokoro.platform.v1.ProductMcpPersonalService/${method}`,
      tenant_id: input.tenant,
      subject_id: input.subject,
      input: body,
    }).sha256,
  }
}

export const bindMcpPersonalServerRegistration = (input: McpPersonalServerInput): { commandId: string; requestDigest: string } =>
  bindMcpPersonalServerCommand("registerServer", input)
