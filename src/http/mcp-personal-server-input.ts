import { z } from "zod"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import type { McpPersonalServerFields, McpPersonalServerOperation } from "../infrastructure/clients/platform/mcp-personal-server-binding.js"

const scalar = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
const displayName = z.string().refine((value) => scalar(value) && [...value].length >= 1 && [...value].length <= 100 && Boolean(value.trim()))
const serverUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    if (!scalar(value) || value.trim() !== value) return false
    try {
      const url = new URL(value)
      return url.protocol === "https:" && url.username === "" && url.password === "" && url.hash === "" && url.toString() === value
    } catch {
      return false
    }
  })

const schemas = {
  registerServer: z.object({ display_name: displayName, server_url: serverUrl }).strict(),
} satisfies Record<Exclude<McpPersonalServerOperation, "server">, z.ZodTypeAny>

/** Parses the only browser-supplied fields for a private URL MCP registration. */
export function parseMcpPersonalServer(operation: Exclude<McpPersonalServerOperation, "server">, bytes: Uint8Array): McpPersonalServerFields {
  if (bytes.byteLength > 65_536) throw new Error("mcp_personal_body_too_large")
  try {
    const value = schemas[operation].parse(strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
    return { displayName: value.display_name, serverUrl: value.server_url }
  } catch {
    throw new Error("invalid_mcp_personal_request")
  }
}
