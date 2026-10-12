import { z } from "zod"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import type {
  McpPersonalAuthorizationOperation,
  McpPersonalAuthorizationFields,
} from "../infrastructure/clients/platform/mcp-personal-authorization-binding.js"

const scalar = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u)
const cas = z
  .string()
  .regex(/^[1-9][0-9]{0,15}(?![\s\S])/u)
  .refine((value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER))
const opaque = z.string().refine((value) => scalar(value) && value.length >= 1 && value.length <= 4096)
const selectors = z
  .array(z.string().refine((value) => scalar(value) && value.length >= 1 && value.length <= 256 && value.trim() === value))
  .refine((value) => new Set(value).size === value.length)

const schemas = {
  begin: z.object({ server_id: id, expected_state_version: cas }).strict(),
  reconnect: z.object({ server_id: id, expected_state_version: cas }).strict(),
  complete: z
    .object({ state: opaque, code: opaque.optional(), error: opaque.optional() })
    .strict()
    .refine((value) => (value.code === undefined) !== (value.error === undefined)),
  createConnection: z.object({ connector_id: id, server_id: id, allowed_selectors: selectors, expected_state_version: cas }).strict(),
} satisfies Record<McpPersonalAuthorizationOperation, z.ZodTypeAny>

/** Parses the narrow browser-private OAuth/connection command body; callback values remain opaque. */
export function parseMcpPersonalAuthorization(operation: McpPersonalAuthorizationOperation, bytes: Uint8Array): McpPersonalAuthorizationFields {
  if (bytes.byteLength > 65_536) throw new Error("mcp_personal_body_too_large")
  try {
    const raw = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    if (operation === "complete") {
      const value = schemas.complete.parse(raw)
      return value.code === undefined ? { state: value.state, error: value.error! } : { state: value.state, code: value.code }
    }
    if (operation === "createConnection") {
      const value = schemas.createConnection.parse(raw)
      return {
        connectorId: value.connector_id,
        serverId: value.server_id,
        allowedSelectors: value.allowed_selectors,
        expectedStateVersion: value.expected_state_version,
      }
    }
    const value = schemas[operation].parse(raw)
    return { serverId: value.server_id, expectedStateVersion: value.expected_state_version }
  } catch {
    throw new Error("invalid_mcp_personal_request")
  }
}
