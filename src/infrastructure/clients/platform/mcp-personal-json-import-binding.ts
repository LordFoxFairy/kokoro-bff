import { sha256Jcs } from "./jcs.js"
import type { McpPersonalInput } from "./mcp-personal-response.js"

export type McpPersonalJsonImportInput = McpPersonalInput & {
  commandId: string
  configJson: string
}

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid_mcp_personal_request")
  return value as JsonObject
}

function exactKeys(value: JsonObject, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error("invalid_mcp_personal_request")
}

/** Derives safe binding/context from the original document without rewriting its bytes. */
export function mcpPersonalJsonImportItems(configJson: string):
  | Array<{
      displayName: string
      serverUrl: string
      headers: Array<{ name: string; value: string }>
      transport?: 3
    }>
  | undefined {
  try {
    const root = object(JSON.parse(configJson))
    exactKeys(root, ["mcpServers"])
    const servers = Object.entries(object(root.mcpServers)).map(([displayName, rawServer]) => {
      const server = object(rawServer)
      exactKeys(server, ["type", "url", "headers"])
      if ((server.type !== "streamableHttp" && server.type !== "sse") || typeof server.url !== "string") throw new Error("owner_rejects_before_digest")
      const rawHeaders = server.headers === undefined ? {} : object(server.headers)
      const headers = Object.entries(rawHeaders).map(([name, value]) => {
        if (typeof value !== "string") throw new Error("owner_rejects_before_digest")
        return { name: name.toLowerCase(), value }
      })
      return { displayName, serverUrl: server.url, headers, ...(server.type === "sse" ? { transport: 3 as const } : {}) }
    })
    return servers.length > 0 && servers.length <= 32 ? servers : undefined
  } catch {
    return undefined
  }
}

/** Binds actual HTTP/SSE input; malformed/STDIO still reaches owner validation unchanged. */
export function bindMcpPersonalJsonImport(input: McpPersonalJsonImportInput): { commandId: string; requestDigest: string } {
  const items = mcpPersonalJsonImportItems(input.configJson)
  return {
    commandId: input.commandId,
    requestDigest: sha256Jcs({
      method: "kokoro.platform.v1.ProductMcpPersonalService/ImportPersonalMcpJson",
      tenant_id: input.tenant,
      subject_id: input.subject,
      ...(items === undefined
        ? { invalid_config_sha256: sha256Jcs({ config_json: input.configJson }).sha256 }
        : {
            input: {
              servers: items.map((item) => ({
                ...(item.transport === undefined ? {} : { transport: item.transport }),
                display_name: item.displayName,
                server_url: item.serverUrl,
                notes: null,
                headers: item.headers.map(({ name }) => name).sort(),
              })),
            },
          }),
    }).sha256,
  }
}
