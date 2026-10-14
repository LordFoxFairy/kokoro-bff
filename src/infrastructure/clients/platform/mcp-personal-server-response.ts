import { Code, ConnectError } from "@connectrpc/connect"
import { z } from "zod"
import { PersonalMcpErrorDetailSchema, PersonalMcpErrorReason } from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import type { McpPersonalServerInput, McpPersonalServerOperation } from "./mcp-personal-server-binding.js"
import { assertMcpPersonalWireKnown, projectMcpPersonalConnector } from "./mcp-personal-response.js"

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u)
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const version = z
  .string()
  .regex(/^[1-9][0-9]{0,9}(?![\s\S])/u)
  .refine((value) => BigInt(value) <= 2_147_483_647n)
const text = (min: number, max: number) =>
  z
    .string()
    .refine(
      (value) =>
        !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) &&
        Buffer.byteLength(value, "utf8") >= min &&
        Buffer.byteLength(value, "utf8") <= max &&
        (min === 0 || Boolean(value.trim())),
    )
const serverUrl = z
  .string()
  .max(255)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === "https:" && url.username === "" && url.password === "" && url.hash === "" && url.toString() === value
    } catch {
      return false
    }
  })
const header = z
  .object({
    name: z.string().regex(/^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/u),
    configured: z.boolean(),
    state_version: version,
    status: z.enum(["active", "revoked"]),
  })
  .strict()
  .refine((value) => value.configured === (value.status === "active"))
const oauth = z
  .object({
    client_id: text(1, 1024),
    configured: z.boolean(),
    origin: z.enum(["byo", "dcr"]),
    status: z.enum(["configured", "revoked"]),
    state_version: version,
  })
  .strict()
  .refine((value) => value.configured === (value.status === "configured"))
const selector = text(1, 256)
const displayName = text(1, 1000)
const requiredScopes = z
  .array(text(1, 128))
  .max(2000)
  .refine((values) => new Set(values).size === values.length)
const declaration = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tool"),
      selector,
      display_name: displayName,
      input_schema_digest: digest,
      output_schema_digest: digest.optional(),
      required_scopes: requiredScopes,
    })
    .strict(),
  z.object({ kind: z.literal("resource"), selector, display_name: displayName }).strict(),
  z.object({ kind: z.literal("prompt"), selector, display_name: displayName }).strict(),
])
const server = z
  .object({
    server_id: id,
    display_name: text(1, 100),
    server_url: serverUrl,
    status: z.enum(["pending", "registered", "disabled"]),
    state_version: version,
    notes: text(1, 4000).optional(),
    headers: z.array(header).max(32),
    oauth_client: oauth.optional(),
    prepare_status: z.enum(["pending_prepare", "prepare_failed", "needs_oauth", "ready"]),
    authorization_status: z.enum(["pending", "approved", "revoked", "failed"]).optional(),
    declarations: z.array(declaration).max(2000),
    declaration_digest: digest.optional(),
    connection_id: id.optional(),
    declarations_available: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.headers.map(({ name }) => name)).size !== value.headers.length)
      context.addIssue({ code: "custom", message: "duplicate header descriptor" })
    if (new Set(value.declarations.map(({ selector: valueSelector }) => valueSelector)).size !== value.declarations.length)
      context.addIssue({ code: "custom", message: "duplicate declaration" })
    if (
      (!value.declarations_available && (value.declarations.length > 0 || value.declaration_digest !== undefined)) ||
      (value.declarations_available && value.declaration_digest === undefined)
    )
      context.addIssue({ code: "custom", message: "declaration availability mismatch" })
    if (value.prepare_status === "ready" && !value.declarations_available) context.addIssue({ code: "custom", message: "ready server lacks declarations" })
  })

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("mcp_personal_response_invalid")
  return value as Record<string, unknown>
}
function identity(value: unknown): unknown {
  return object(value).value
}
function projectDeclaration(raw: unknown): unknown {
  const value = object(raw)
  const kind = object(value.kind)
  const item = object(kind.value)
  if (kind.case === "tool")
    return {
      kind: "tool",
      selector: item.selector,
      display_name: item.displayName,
      input_schema_digest: item.inputSchemaDigest,
      ...(item.outputSchemaDigest === undefined ? {} : { output_schema_digest: item.outputSchemaDigest }),
      required_scopes: item.requiredScopes,
    }
  if (kind.case === "resource" || kind.case === "prompt") return { kind: kind.case, selector: item.selector, display_name: item.displayName }
  throw new Error("mcp_personal_response_invalid")
}
function projectServer(raw: unknown): z.infer<typeof server> {
  const value = object(raw)
  const declarations = Array.isArray(value.declarations) ? value.declarations.map(projectDeclaration) : undefined
  const headers = Array.isArray(value.headers)
    ? value.headers.map((rawHeader) => {
        const valueHeader = object(rawHeader)
        return {
          name: valueHeader.name,
          configured: valueHeader.configured,
          state_version: typeof valueHeader.stateVersion === "bigint" ? String(valueHeader.stateVersion) : undefined,
          status: valueHeader.status,
        }
      })
    : undefined
  const valueOauth = value.oauthClient === undefined ? undefined : object(value.oauthClient)
  return server.parse({
    server_id: identity(value.serverId),
    display_name: value.displayName,
    server_url: value.serverUrl,
    status: value.status,
    state_version: typeof value.stateVersion === "bigint" ? String(value.stateVersion) : undefined,
    ...(value.notes === undefined ? {} : { notes: value.notes }),
    headers,
    ...(valueOauth === undefined
      ? {}
      : {
          oauth_client: {
            client_id: valueOauth.clientId,
            configured: valueOauth.configured,
            origin: valueOauth.origin,
            status: valueOauth.status,
            state_version: typeof valueOauth.stateVersion === "bigint" ? String(valueOauth.stateVersion) : undefined,
          },
        }),
    prepare_status: ({ 1: "pending_prepare", 2: "prepare_failed", 3: "needs_oauth", 4: "ready" } as Record<number, string>)[Number(value.prepareStatus)],
    ...(value.authorizationStatus === undefined ? {} : { authorization_status: value.authorizationStatus }),
    declarations,
    ...(value.declarationDigest === undefined ? {} : { declaration_digest: value.declarationDigest }),
    ...(value.connectionId === undefined ? {} : { connection_id: identity(value.connectionId) }),
    declarations_available: value.declarationsAvailable,
  })
}

/** Projects only Platform's safe descriptors; header values, client secrets, tokens and fingerprints never cross this boundary. */
export function projectMcpPersonalServer(operation: McpPersonalServerOperation, raw: unknown, input: McpPersonalServerInput): unknown {
  assertMcpPersonalWireKnown(raw)
  const value = object(raw)
  if (operation === "deleteServer") {
    const result = {
      server_id: identity(value.serverId),
      deleted: value.deleted,
      replayed: value.replayed,
    }
    if (result.server_id !== input.id || result.deleted !== true || typeof result.replayed !== "boolean") throw new Error("mcp_personal_response_invalid")
    return result
  }
  const resultServer = projectServer(value.server)
  if ((operation !== "registerServer" && resultServer.server_id !== input.id) || (operation === "registerServer" && input.id !== undefined))
    throw new Error("mcp_personal_response_invalid")
  if (operation === "server") return { server: resultServer }
  const connector = projectMcpPersonalConnector(value.connector)
  const replayed = value.replayed
  if (
    typeof replayed !== "boolean" ||
    connector.server_id !== resultServer.server_id ||
    connector.enabled ||
    (resultServer.status === "pending" && connector.status !== "pending") ||
    (resultServer.status === "registered" && connector.status !== "active")
  )
    throw new Error("mcp_personal_response_invalid")
  if (operation === "registerServer") {
    if (
      resultServer.display_name !== input.displayName ||
      resultServer.server_url !== input.serverUrl ||
      resultServer.notes !== input.notes ||
      new Set(resultServer.headers.filter(({ configured }) => configured).map(({ name }) => name)).size !== (input.headers ?? []).length ||
      (input.headers ?? []).some(({ name }) => !resultServer.headers.some((entry) => entry.name === name && entry.configured)) ||
      (input.oauthClient === undefined
        ? resultServer.oauth_client !== undefined
        : resultServer.oauth_client?.client_id !== input.oauthClient.clientId || !resultServer.oauth_client.configured)
    )
      throw new Error("mcp_personal_response_invalid")
  } else if (BigInt(resultServer.state_version) <= BigInt(input.expectedStateVersion!)) throw new Error("mcp_personal_response_invalid")
  if (operation === "prepareServer") {
    const declarations = Array.isArray(value.declarations) ? declaration.array().max(2000).parse(value.declarations.map(projectDeclaration)) : undefined
    if (JSON.stringify(declarations) !== JSON.stringify(resultServer.declarations)) throw new Error("mcp_personal_response_invalid")
    return { server: resultServer, connector, declarations, replayed }
  }
  if (operation === "updateServer") {
    if (
      (input.displayName !== undefined && resultServer.display_name !== input.displayName) ||
      (input.serverUrl !== undefined && resultServer.server_url !== input.serverUrl) ||
      (input.notes !== undefined && resultServer.notes !== input.notes) ||
      (input.clearNotes && resultServer.notes !== undefined) ||
      (input.headerUpserts ?? []).some(({ name }) => !resultServer.headers.some((entry) => entry.name === name && entry.configured)) ||
      (input.headerRemovals ?? []).some((name) => resultServer.headers.some((entry) => entry.name === name && entry.configured)) ||
      (input.oauthClient !== undefined && (resultServer.oauth_client?.client_id !== input.oauthClient.clientId || !resultServer.oauth_client.configured)) ||
      (input.revokeOauthClient && resultServer.oauth_client?.configured === true)
    )
      throw new Error("mcp_personal_response_invalid")
  }
  return { server: resultServer, connector, replayed }
}

export function mcpPersonalServerFault(error: unknown): { status: number; code: string; retryable: boolean } | null {
  if (!(error instanceof ConnectError) || error.code !== Code.FailedPrecondition) return null
  try {
    const details = error.findDetails(PersonalMcpErrorDetailSchema)
    const detail = details[0]
    if (
      details.length !== 1 ||
      detail === undefined ||
      detail.$unknown?.length ||
      ![PersonalMcpErrorReason.NOT_PREPARED, PersonalMcpErrorReason.NEEDS_CLIENT, PersonalMcpErrorReason.AUTH_METHOD_UNSUPPORTED].includes(detail.reason)
    )
      return { status: 502, code: "mcp_personal_response_invalid", retryable: false }
    return { status: 412, code: "mcp_personal_precondition_failed", retryable: false }
  } catch {
    return { status: 502, code: "mcp_personal_response_invalid", retryable: false }
  }
}
