import { Code, ConnectError } from "@connectrpc/connect"
import type { Message } from "@bufbuild/protobuf"
import { z } from "zod"
import type { McpPersonalCommandOperation, McpPersonalCommandInput } from "./mcp-personal-command-binding.js"

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
const version = z
  .string()
  .regex(/^[1-9][0-9]{0,15}(?![\s\S])/u)
  .refine((value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER))
const date = z.string().datetime({ offset: true })
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
    enabled: z.boolean(),
    state_version: version,
    display_name: text(1, 100).optional(),
    description: text(0, 1000).optional(),
    created_at: date.optional(),
    updated_at: date.optional(),
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
const categories = ["efficiency", "creation", "business", "development", "finance", "travel", "health"] as const
const safeUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === "https:" && !url.username && !url.password
    } catch {
      return false
    }
  })
const provider = z
  .object({
    provider_key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}(?![\s\S])/u),
    display_name: text(1, 100),
    description: text(0, 1000).optional(),
    directory_type: z.enum(["app", "data_source"]),
    category_keys: z.array(z.enum(categories)).refine((values) => new Set(values).size === values.length),
    example_prompts: z.array(text(1, 1000)).max(10),
    author: text(1, 100).optional(),
    website: safeUrl.optional(),
    privacy_url: safeUrl.optional(),
    cover_image_url: safeUrl.optional(),
    updated_at: date.optional(),
    enabled: z.boolean(),
    state_version: version,
  })
  .strict()
const page = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item).max(100), next_cursor: cursor.nullable() }).strict()

export type McpPersonalOperation = "connectors" | "connector" | "connections" | "connection" | "providers" | "provider"
export type McpPersonalInput = {
  tenant: string
  subject: string
  requestId: string
  id?: string
  status?: "pending" | "active" | "error" | "revoked"
  limit?: number
  cursor?: string
  query?: string
  directoryType?: "app" | "data_source"
  categoryKey?: (typeof categories)[number]
}
export function validateMcpPersonalPublic(operation: McpPersonalOperation, value: unknown, input: McpPersonalInput): unknown {
  const parsed =
    operation === "providers"
      ? page(provider).parse(value)
      : operation === "provider"
        ? z.object({ provider }).strict().parse(value)
        : operation === "connectors"
          ? page(connector).parse(value)
          : operation === "connections"
            ? page(connection).parse(value)
            : operation === "connector"
              ? z.object({ connector }).strict().parse(value)
              : z.object({ connection }).strict().parse(value)
  if (operation === "provider" && "provider" in parsed && (parsed.provider.provider_key !== input.id || !parsed.provider.enabled))
    throw new Error("mcp_personal_response_invalid")
  if (
    (operation === "connector" && "connector" in parsed && parsed.connector.connector_id !== input.id) ||
    (operation === "connection" && "connection" in parsed && parsed.connection.connection_id !== input.id)
  )
    throw new Error("mcp_personal_response_invalid")
  if ("items" in parsed) {
    const ids = parsed.items.map((item) => ("connection_id" in item ? item.connection_id : "connector_id" in item ? item.connector_id : item.provider_key))
    if (
      parsed.items.length > (input.limit ?? 50) ||
      new Set(ids).size !== ids.length ||
      (operation === "providers" &&
        parsed.items.some(
          (item) =>
            "directory_type" in item &&
            (!item.enabled ||
              (input.directoryType !== undefined && item.directory_type !== input.directoryType) ||
              (input.categoryKey !== undefined && !item.category_keys.includes(input.categoryKey))),
        )) ||
      (operation === "connections" && parsed.items.some((item) => "connector_id" in item && item.connector_id !== input.id)) ||
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
    enabled: value.enabled,
    state_version: typeof value.stateVersion === "bigint" ? String(value.stateVersion) : undefined,
    ...(value.displayName === undefined ? {} : { display_name: value.displayName }),
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(value.createdAt === undefined ? {} : { created_at: value.createdAt }),
    ...(value.updatedAt === undefined ? {} : { updated_at: value.updatedAt }),
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
function projectProvider(raw: unknown) {
  const value = object(raw)
  return {
    provider_key: value.providerKey,
    display_name: value.displayName,
    directory_type: value.directoryType,
    category_keys: value.categoryKeys,
    example_prompts: value.examplePrompts,
    enabled: value.enabled,
    state_version: typeof value.stateVersion === "bigint" ? String(value.stateVersion) : undefined,
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(value.author === undefined ? {} : { author: value.author }),
    ...(value.website === undefined ? {} : { website: value.website }),
    ...(value.privacyUrl === undefined ? {} : { privacy_url: value.privacyUrl }),
    ...(value.coverImageUrl === undefined ? {} : { cover_image_url: value.coverImageUrl }),
    ...(value.updatedAt === undefined ? {} : { updated_at: value.updatedAt }),
  }
}
export function validateMcpPersonalCommand(operation: McpPersonalCommandOperation, raw: unknown, input: McpPersonalCommandInput): unknown {
  const result = z.object({ connector }).strict().parse(raw)
  const value = result.connector
  if (
    (operation !== "create" && value.connector_id !== input.id) ||
    (operation === "create" &&
      (value.provider_key !== input.providerKey ||
        value.connector_type !== input.connectorType ||
        value.display_name !== input.displayName ||
        value.description !== input.description ||
        value.enabled ||
        value.state_version !== "1" ||
        !["pending", "active"].includes(value.status))) ||
    (operation === "update" && (value.display_name !== input.displayName || value.description !== input.description || value.status === "revoked")) ||
    (operation === "enabled" && (value.enabled !== input.enabled || value.status === "revoked")) ||
    (operation === "remove" && (value.enabled || value.status !== "revoked"))
  )
    throw new Error("mcp_personal_response_invalid")
  return result
}
export function projectMcpPersonalCommand(operation: McpPersonalCommandOperation, raw: unknown, input: McpPersonalCommandInput): unknown {
  known(raw)
  return validateMcpPersonalCommand(operation, { connector: projectConnector(object(raw).connector) }, input)
}
export function projectMcpPersonalResponse(operation: McpPersonalOperation, raw: unknown, input: McpPersonalInput): unknown {
  known(raw)
  const value = object(raw)
  if (operation === "provider") return validateMcpPersonalPublic(operation, { provider: projectProvider(value.provider) }, input)
  if (operation === "connector") return validateMcpPersonalPublic(operation, { connector: projectConnector(value.connector) }, input)
  if (operation === "connection") return validateMcpPersonalPublic(operation, { connection: projectConnection(value.connection) }, input)
  const items = operation === "providers" ? value.providers : operation === "connectors" ? value.connectors : value.connections
  if (!Array.isArray(items)) throw new Error("mcp_personal_response_invalid")
  const resultPage = object(value.page)
  const next = resultPage.nextCursor
  if (next !== undefined && (typeof next !== "string" || next === "")) throw new Error("mcp_personal_response_invalid")
  return validateMcpPersonalPublic(
    operation,
    {
      items: items.map((item) =>
        operation === "providers" ? projectProvider(item) : operation === "connectors" ? projectConnector(item) : projectConnection(item),
      ),
      next_cursor: next === undefined ? null : next,
    },
    input,
  )
}
export function mcpPersonalFault(error: unknown, hasCursor = false, command = false): { status: number; code: string; retryable: boolean } {
  if (command && error instanceof Error && error.message === "invalid_mcp_personal_request")
    return { status: 400, code: "invalid_mcp_personal_request", retryable: false }
  if (error instanceof Error && error.message === "mcp_personal_body_too_large")
    return { status: 413, code: "mcp_personal_request_too_large", retryable: false }
  if (error instanceof ConnectError) {
    if (command && error.code === Code.AlreadyExists) return { status: 409, code: "mcp_personal_idempotency_conflict", retryable: false }
    if (command && error.code === Code.Aborted) return { status: 409, code: "mcp_personal_command_in_progress", retryable: true }
    if (command && error.code === Code.FailedPrecondition) return { status: 412, code: "mcp_personal_precondition_failed", retryable: false }
    if (error.code === Code.NotFound) return { status: 404, code: "mcp_personal_not_found", retryable: false }
    if (error.code === Code.InvalidArgument)
      return hasCursor || command
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
