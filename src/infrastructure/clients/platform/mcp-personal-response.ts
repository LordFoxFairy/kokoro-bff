import { Code, ConnectError } from "@connectrpc/connect"
import type { Message } from "@bufbuild/protobuf"
import { z } from "zod"

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u)
const cursor = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+$/u)
const scopes = z
  .array(
    z
      .string()
      .min(1)
      .max(128)
      .refine((value) => !/\s/u.test(value)),
  )
  .refine((values) => new Set(values).size === values.length)
const selectors = z
  .array(
    z
      .string()
      .min(1)
      .max(256)
      .refine((value) => value.trim() === value),
  )
  .refine((values) => new Set(values).size === values.length)
const connector = z
  .object({
    connector_id: id,
    connector_type: z.enum(["builtin", "byok", "mcp"]),
    provider_key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u),
    status: z.enum(["pending", "active", "error", "revoked"]),
    approved_scopes: scopes,
  })
  .strict()
const connection = z
  .object({
    connection_id: id,
    connector_id: id,
    server_id: id,
    allowed_selectors: selectors,
    policy_digest: z.string().regex(/^[a-f0-9]{64}$/u),
    status: z.enum(["active", "revoked"]),
  })
  .strict()
const page = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item).max(100), next_cursor: cursor.nullable() }).strict()

export type McpPersonalOperation = "connectors" | "connector" | "connections" | "connection"
export type McpPersonalInput = {
  tenant: string
  subject: string
  requestId: string
  id?: string
  status?: "pending" | "active" | "error" | "revoked"
  limit?: number
  cursor?: string
}
export function validateMcpPersonalPublic(operation: McpPersonalOperation, value: unknown, input: McpPersonalInput): unknown {
  const parsed =
    operation === "connectors"
      ? page(connector).parse(value)
      : operation === "connections"
        ? page(connection).parse(value)
        : operation === "connector"
          ? z.object({ connector }).strict().parse(value)
          : z.object({ connection }).strict().parse(value)
  if (
    (operation === "connector" && "connector" in parsed && parsed.connector.connector_id !== input.id) ||
    (operation === "connection" && "connection" in parsed && parsed.connection.connection_id !== input.id)
  )
    throw new Error("mcp_personal_response_invalid")
  if ("items" in parsed) {
    const ids = parsed.items.map((item) => ("connection_id" in item ? item.connection_id : item.connector_id))
    if (
      new Set(ids).size !== ids.length ||
      (operation === "connections" && parsed.items.some((item) => item.connector_id !== input.id)) ||
      (operation === "connectors" && input.status !== undefined && parsed.items.some((item) => "status" in item && item.status !== input.status))
    )
      throw new Error("mcp_personal_response_invalid")
  }
  return parsed
}
function known(value: unknown): void {
  if (typeof value !== "object" || value === null || value instanceof Uint8Array) return
  if ((value as Message).$unknown?.length) throw new Error("mcp_personal_response_invalid")
  for (const [key, child] of Object.entries(value))
    if (!key.startsWith("$")) {
      if (Array.isArray(child)) child.forEach(known)
      else known(child)
    }
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("mcp_personal_response_invalid")
  return value as Record<string, unknown>
}
function identity(value: unknown): unknown {
  return object(value).value
}
function projectConnector(raw: unknown) {
  const value = object(raw)
  return {
    connector_id: identity(value.connectorId),
    connector_type: ({ 1: "builtin", 2: "byok", 3: "mcp" } as Record<number, string>)[Number(value.connectorType)],
    provider_key: value.providerKey,
    status: ({ 1: "pending", 2: "active", 3: "error", 4: "revoked" } as Record<number, string>)[Number(value.status)],
    approved_scopes: value.approvedScopes,
  }
}
function projectConnection(raw: unknown) {
  const value = object(raw)
  return {
    connection_id: identity(value.connectionId),
    connector_id: identity(value.connectorId),
    server_id: identity(value.serverId),
    allowed_selectors: value.allowedSelectors,
    policy_digest: value.policyDigest,
    status: value.status,
  }
}
export function projectMcpPersonalResponse(operation: McpPersonalOperation, raw: unknown, input: McpPersonalInput): unknown {
  known(raw)
  const value = object(raw)
  if (operation === "connector") return validateMcpPersonalPublic(operation, { connector: projectConnector(value.connector) }, input)
  if (operation === "connection") return validateMcpPersonalPublic(operation, { connection: projectConnection(value.connection) }, input)
  const items = operation === "connectors" ? value.connectors : value.connections
  if (!Array.isArray(items)) throw new Error("mcp_personal_response_invalid")
  const resultPage = object(value.page)
  const next = resultPage.nextCursor
  if (next !== undefined && (typeof next !== "string" || next === "")) throw new Error("mcp_personal_response_invalid")
  return validateMcpPersonalPublic(
    operation,
    {
      items: items.map((item) => (operation === "connectors" ? projectConnector(item) : projectConnection(item))),
      next_cursor: next === undefined ? null : next,
    },
    input,
  )
}
export function mcpPersonalFault(error: unknown, hasCursor = false): { status: number; code: string; retryable: boolean } {
  if (error instanceof ConnectError) {
    if (error.code === Code.NotFound) return { status: 404, code: "mcp_personal_not_found", retryable: false }
    if (error.code === Code.InvalidArgument)
      return hasCursor
        ? { status: 400, code: "invalid_mcp_personal_request", retryable: false }
        : { status: 502, code: "mcp_personal_response_invalid", retryable: false }
    if (error.code === Code.Internal || error.code === Code.DataLoss || error.code === Code.Unknown)
      return { status: 502, code: "mcp_personal_response_invalid", retryable: false }
    if ([Code.Unauthenticated, Code.PermissionDenied, Code.Unavailable, Code.DeadlineExceeded, Code.ResourceExhausted, Code.Canceled].includes(error.code))
      return { status: 503, code: "mcp_personal_dependency_unavailable", retryable: true }
    return { status: 502, code: "mcp_personal_response_invalid", retryable: false }
  }
  return error instanceof z.ZodError || (error instanceof Error && error.message === "mcp_personal_response_invalid")
    ? { status: 502, code: "mcp_personal_response_invalid", retryable: false }
    : { status: 503, code: "mcp_personal_dependency_unavailable", retryable: true }
}
