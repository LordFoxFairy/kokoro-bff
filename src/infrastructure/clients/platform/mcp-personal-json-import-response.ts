import { z } from "zod"
import { assertMcpPersonalWireKnown, projectMcpPersonalConnector } from "./mcp-personal-response.js"
import { projectMcpPersonalServer } from "./mcp-personal-server-response.js"
import { mcpPersonalJsonImportItems, type McpPersonalJsonImportInput } from "./mcp-personal-json-import-binding.js"

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("mcp_personal_response_invalid")
  return value as Record<string, unknown>
}

/** Projects every imported aggregate together; secrets and raw config never return. */
export function projectMcpPersonalJsonImport(raw: unknown, input: McpPersonalJsonImportInput): unknown {
  assertMcpPersonalWireKnown(raw)
  const value = object(raw)
  if (!Array.isArray(value.imports) || value.imports.length < 1 || value.imports.length > 32 || typeof value.replayed !== "boolean")
    throw new Error("mcp_personal_response_invalid")
  const items = mcpPersonalJsonImportItems(input.configJson)
  if (!items || items.length !== value.imports.length) throw new Error("mcp_personal_response_invalid")
  const historicalBatch = value.replayed === true && items.every((item) => item.transport === undefined)
  const imports = value.imports.map((item, index) => {
    const entry = object(item),
      original = items[index]
    if (!original || (object(entry.server).transport === undefined && !historicalBatch)) throw new Error("mcp_personal_response_invalid")
    // Use the complete registration ACK context, never masquerade as a fresh Get.
    const projected = object(
      projectMcpPersonalServer(
        "registerServer",
        { server: entry.server, connector: entry.connector, replayed: value.replayed },
        {
          tenant: input.tenant,
          subject: input.subject,
          requestId: input.requestId,
          commandId: input.commandId,
          ...original,
        },
      ),
    )
    const server = z.record(z.string(), z.unknown()).parse(projected.server)
    const connector = projectMcpPersonalConnector(entry.connector)
    if (connector.server_id !== server.server_id || connector.enabled !== false || connector.status !== "pending")
      throw new Error("mcp_personal_response_invalid")
    return { server, connector }
  })
  if (new Set(imports.map((entry) => entry.server.server_id)).size !== imports.length) throw new Error("mcp_personal_response_invalid")
  return { imports, replayed: value.replayed }
}
