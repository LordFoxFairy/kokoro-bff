import { z } from "zod"
import type { McpPersonalAuthorizationInput, McpPersonalAuthorizationOperation } from "./mcp-personal-authorization-binding.js"
import { assertMcpPersonalWireKnown, projectMcpPersonalConnector, projectMcpPersonalConnection } from "./mcp-personal-response.js"

const authorizationId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u)
const authorizationUrl = z
  .string()
  .max(4096)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === "https:" && url.username === "" && url.password === "" && url.hash === ""
    } catch {
      return false
    }
  })
const date = z.string().datetime({ offset: true })
const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("mcp_personal_response_invalid")
  return value as Record<string, unknown>
}
const identity = (value: unknown): string => {
  const parsed = object(value).value
  if (typeof parsed !== "string") throw new Error("mcp_personal_response_invalid")
  return parsed
}
function timestamp(value: unknown): string {
  const parsed = object(value)
  if (
    typeof parsed.seconds !== "bigint" ||
    typeof parsed.nanos !== "number" ||
    !Number.isInteger(parsed.nanos) ||
    parsed.nanos < 0 ||
    parsed.nanos > 999_999_999
  )
    throw new Error("mcp_personal_response_invalid")
  const milliseconds = Number(parsed.seconds) * 1_000 + Math.floor(parsed.nanos / 1_000_000)
  if (!Number.isSafeInteger(milliseconds)) throw new Error("mcp_personal_response_invalid")
  const valueAt = new Date(milliseconds)
  if (Number.isNaN(valueAt.valueOf())) throw new Error("mcp_personal_response_invalid")
  return valueAt.toISOString()
}

/** Projects owner responses without retaining OAuth state, verifier, code, token, or provider secret. */
export function projectMcpPersonalAuthorization(operation: McpPersonalAuthorizationOperation, raw: unknown, input: McpPersonalAuthorizationInput): unknown {
  assertMcpPersonalWireKnown(raw)
  const value = object(raw)
  if (operation === "complete") return { connector: projectMcpPersonalConnector(value.connector) }
  if (operation === "createConnection") return { connection: projectMcpPersonalConnection(value.connection) }
  const authorization = z
    .object({
      authorization_id: authorizationId,
      authorization_url: authorizationUrl,
      expires_at: date,
    })
    .strict()
    .parse({
      authorization_id: identity(value.authorizationId),
      authorization_url: value.authorizationUrl,
      expires_at: timestamp(value.expiresAt),
    })
  if (operation === "begin" || operation === "reconnect") {
    const connector = projectMcpPersonalConnector(value.connector)
    if (connector.connector_id !== input.id) throw new Error("mcp_personal_response_invalid")
    return { authorization, connector }
  }
  throw new Error("mcp_personal_response_invalid")
}
