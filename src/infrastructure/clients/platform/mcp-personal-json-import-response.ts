import { z } from "zod"
import {
  assertMcpPersonalWireKnown,
  projectMcpPersonalConnector,
} from "./mcp-personal-response.js"
import { projectMcpPersonalServer } from "./mcp-personal-server-response.js"
import type { McpPersonalJsonImportInput } from "./mcp-personal-json-import-binding.js"

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("mcp_personal_response_invalid")
  return value as Record<string, unknown>
}

/** Projects every imported aggregate together; secrets and raw config never return. */
export function projectMcpPersonalJsonImport(
  raw: unknown,
  input: McpPersonalJsonImportInput,
): unknown {
  assertMcpPersonalWireKnown(raw)
  const value = object(raw)
  if (
    !Array.isArray(value.imports) ||
    value.imports.length < 1 ||
    value.imports.length > 32 ||
    typeof value.replayed !== "boolean"
  )
    throw new Error("mcp_personal_response_invalid")
  const imports = value.imports.map((item) => {
    const entry = object(item)
    const server = projectMcpPersonalServer(
      "server",
      { server: entry.server },
      input,
    )
    const projected = z
      .object({ server: z.record(z.string(), z.unknown()) })
      .strict()
      .parse(server)
    const connector = projectMcpPersonalConnector(entry.connector)
    if (
      connector.server_id !== projected.server.server_id ||
      connector.enabled !== false ||
      connector.status !== "pending"
    )
      throw new Error("mcp_personal_response_invalid")
    return { server: projected.server, connector }
  })
  if (
    new Set(imports.map((entry) => entry.server.server_id)).size !==
    imports.length
  )
    throw new Error("mcp_personal_response_invalid")
  return { imports, replayed: value.replayed }
}
