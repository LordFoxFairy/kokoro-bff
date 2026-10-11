import { z } from "zod"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import type { McpPersonalCommandOperation, McpPersonalCommandFields } from "../infrastructure/clients/platform/mcp-personal-command-binding.js"

const scalar = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
const metadata = (min: number, max: number) =>
  z.string().refine((value) => scalar(value) && [...value].length >= min && [...value].length <= max && (min === 0 || Boolean(value.trim())))
const cas = z
  .string()
  .regex(/^[1-9][0-9]{0,15}(?![\s\S])/u)
  .refine((value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER))
const schemas = {
  create: z
    .object({
      provider_key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}(?![\s\S])/u),
      connector_type: z.enum(["builtin", "byok", "mcp"]),
      display_name: metadata(1, 100),
      description: metadata(0, 1000),
    })
    .strict(),
  update: z.object({ display_name: metadata(1, 100), description: metadata(0, 1000), expected_state_version: cas }).strict(),
  enabled: z.object({ enabled: z.boolean(), expected_state_version: cas }).strict(),
  remove: z.object({ expected_state_version: cas }).strict(),
}
export function parseMcpPersonalCommand(operation: McpPersonalCommandOperation, bytes: Uint8Array): McpPersonalCommandFields {
  if (bytes.byteLength > 65_536) throw new Error("mcp_personal_body_too_large")
  try {
    const value = schemas[operation].parse(strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
    return {
      ...("provider_key" in value ? { providerKey: value.provider_key, connectorType: value.connector_type } : {}),
      ...("display_name" in value ? { displayName: value.display_name, description: value.description } : {}),
      ...("enabled" in value && typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
      ...("expected_state_version" in value ? { expectedStateVersion: value.expected_state_version } : {}),
    }
  } catch {
    throw new Error("invalid_mcp_personal_request")
  }
}
