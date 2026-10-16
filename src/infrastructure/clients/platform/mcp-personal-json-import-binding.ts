import { sha256Jcs } from "./jcs.js"
import type { McpPersonalInput } from "./mcp-personal-response.js"

export type McpPersonalJsonImportInput = McpPersonalInput & {
  commandId: string
  configJson: string
}

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("invalid_mcp_personal_request")
  return value as JsonObject
}

function exactKeys(value: JsonObject, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("invalid_mcp_personal_request")
}

/**
 * Mirrors Platform's HTTP import digest shape while retaining the original
 * document for the owner to validate atomically. Unsupported transports do not
 * get rewritten here: Platform returns its typed precondition instead.
 */
export function bindMcpPersonalJsonImport(input: McpPersonalJsonImportInput): {
  commandId: string
  requestDigest: string
} {
  const fallback = () => ({
    commandId: input.commandId,
    // Platform parses before it compares this digest. The fallback exists only
    // to deliver malformed/STDIO/SSE documents to that owner validation and
    // intentionally contains a hash, never raw secret configuration.
    requestDigest: sha256Jcs({
      method:
        "kokoro.platform.v1.ProductMcpPersonalService/ImportPersonalMcpJson",
      tenant_id: input.tenant,
      subject_id: input.subject,
      invalid_config_sha256: sha256Jcs({ config_json: input.configJson })
        .sha256,
    }).sha256,
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(input.configJson)
  } catch {
    return fallback()
  }
  try {
    const root = object(parsed)
    exactKeys(root, ["mcpServers"])
    const rawServers = object(root.mcpServers)
    const servers = Object.entries(rawServers).map(
      ([displayName, rawServer]) => {
        const server = object(rawServer)
        if (server.type !== "streamableHttp")
          throw new Error("owner_rejects_before_digest")
        exactKeys(server, ["type", "url", "headers"])
        if (typeof server.url !== "string")
          throw new Error("owner_rejects_before_digest")
        const headers =
          server.headers === undefined ? {} : object(server.headers)
        const names = Object.entries(headers).map(([name, value]) => {
          if (typeof value !== "string")
            throw new Error("owner_rejects_before_digest")
          return name.toLowerCase()
        })
        return {
          display_name: displayName,
          server_url: server.url,
          notes: null,
          headers: names.sort(),
        }
      },
    )
    if (servers.length < 1 || servers.length > 32) return fallback()
    return {
      commandId: input.commandId,
      requestDigest: sha256Jcs({
        method:
          "kokoro.platform.v1.ProductMcpPersonalService/ImportPersonalMcpJson",
        tenant_id: input.tenant,
        subject_id: input.subject,
        input: { servers },
      }).sha256,
    }
  } catch {
    return fallback()
  }
}
