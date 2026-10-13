import { sha256Jcs } from "./jcs.js"
import type { McpPersonalInput } from "./mcp-personal-response.js"

export type McpPersonalServerOperation = "registerServer" | "server"
export type McpPersonalServerFields = { displayName?: string; serverUrl?: string }
export type McpPersonalServerInput = McpPersonalInput & McpPersonalServerFields & { commandId?: string }

/** Binds exactly the owner-owned URL registration command; tenant and subject come from the trusted BFF context. */
export function bindMcpPersonalServerRegistration(input: McpPersonalServerInput): { commandId: string; requestDigest: string } {
  return {
    commandId: input.commandId!,
    requestDigest: sha256Jcs({
      method: "kokoro.platform.v1.ProductMcpPersonalService/RegisterPersonalMcpServer",
      tenant_id: input.tenant,
      subject_id: input.subject,
      input: { display_name: input.displayName!, server_url: input.serverUrl! },
    }).sha256,
  }
}
