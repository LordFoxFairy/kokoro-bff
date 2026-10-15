import { z } from "zod"
import { strictParseRawJson } from "../infrastructure/raw-json.js"

const payload = z
  .object({
    config_json: z
      .string()
      .refine(
        (value) =>
          Buffer.byteLength(value, "utf8") >= 1 &&
          Buffer.byteLength(value, "utf8") <= 65_536,
      ),
  })
  .strict()

/**
 * The browser only supplies the opaque JSON document. Platform owns its
 * transport grammar and persists nothing until the entire document validates.
 */
export function parseMcpPersonalJsonImport(body: Uint8Array): {
  configJson: string
} {
  if (body.byteLength > 65_536) throw new Error("mcp_personal_body_too_large")
  try {
    return {
      configJson: payload.parse(
        strictParseRawJson(
          new TextDecoder("utf-8", { fatal: true }).decode(body),
        ),
      ).config_json,
    }
  } catch {
    throw new Error("invalid_mcp_personal_request")
  }
}
