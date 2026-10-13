import { z } from "zod"
import type { McpPersonalServerInput, McpPersonalServerOperation } from "./mcp-personal-server-binding.js"
import { assertMcpPersonalWireKnown, projectMcpPersonalConnector } from "./mcp-personal-response.js"

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u)
const version = z
  .string()
  .regex(/^[1-9][0-9]{0,15}(?![\s\S])/u)
  .refine((value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER))
const text = (min: number, max: number) =>
  z
    .string()
    .refine(
      (value) =>
        !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) &&
        [...value].length >= min &&
        [...value].length <= max &&
        (min === 0 || Boolean(value.trim())),
    )
const serverUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === "https:" && url.username === "" && url.password === "" && url.hash === "" && url.toString() === value
    } catch {
      return false
    }
  })
const server = z
  .object({
    server_id: id,
    display_name: text(1, 100),
    server_url: serverUrl,
    status: z.enum(["pending", "registered", "disabled"]),
    state_version: version,
  })
  .strict()

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("mcp_personal_response_invalid")
  return value as Record<string, unknown>
}
function identity(value: unknown): unknown {
  return object(value).value
}
function projectServer(raw: unknown): z.infer<typeof server> {
  const value = object(raw)
  return server.parse({
    server_id: identity(value.serverId),
    display_name: value.displayName,
    server_url: value.serverUrl,
    status: value.status,
    state_version: typeof value.stateVersion === "bigint" ? String(value.stateVersion) : undefined,
  })
}

/** Projects the owner response without exposing its declarations, OAuth metadata, or credentials. */
export function projectMcpPersonalServer(operation: McpPersonalServerOperation, raw: unknown, input: McpPersonalServerInput): unknown {
  assertMcpPersonalWireKnown(raw)
  const value = object(raw)
  if (operation === "server") {
    const result = { server: projectServer(value.server) }
    if (result.server.server_id !== input.id) throw new Error("mcp_personal_response_invalid")
    return result
  }
  const result = { server: projectServer(value.server), connector: projectMcpPersonalConnector(value.connector) }
  if (
    result.server.display_name !== input.displayName ||
    result.server.server_url !== input.serverUrl ||
    result.connector.server_id !== result.server.server_id ||
    result.connector.enabled ||
    (result.server.status === "pending" && result.connector.status !== "pending") ||
    (result.server.status === "registered" && result.connector.status !== "active")
  )
    throw new Error("mcp_personal_response_invalid")
  return result
}
