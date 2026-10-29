import { Code, ConnectError } from "@connectrpc/connect"
import type { ProjectMcpRecommendation } from "../../../domain/project/mcp-recommendations.js"
import { validateMcpPersonalPublic } from "./mcp-personal-response.js"
import { customApiPublic } from "./custom-api-response.js"
import type { McpPersonalConnectClient } from "./mcp-personal-connect.js"
import type { CustomApiConnectClient } from "./custom-api-connect.js"

export type RecommendationCandidateClients = {
  mcpPersonalClient: Pick<McpPersonalConnectClient, "read"> | null
  customApiClient: Pick<CustomApiConnectClient, "execute"> | null
}
/** Metadata reads only. No credentials, configuration bytes or commands enter the recommendation fact. */
export async function validateProjectMcpRecommendationCandidates(
  refs: readonly ProjectMcpRecommendation[],
  clients: RecommendationCandidateClients,
  identity: { tenant: string; subject: string; requestId: string },
  signal: AbortSignal,
  deadlineAt: number,
): Promise<void> {
  const stopped = new AbortController()
  signal = AbortSignal.any([signal, stopped.signal])
  let offset = 0
  const current = () => {
    signal.throwIfAborted()
    if (performance.now() >= deadlineAt) throw new ConnectError("Recommendation deadline", Code.Unavailable)
  }
  const invalid = (): never => {
    throw new Error("project_mcp_recommendations_response_invalid")
  }
  try {
    await Promise.all(
      Array.from({ length: Math.min(4, refs.length) }, async () => {
        for (;;) {
          current()
          const ref = refs[offset++]
          if (!ref) return
          if (ref.kind === "custom_api") {
            if (!clients.customApiClient) throw new ConnectError("Custom API owner unavailable", Code.Unavailable)
            const raw = await clients.customApiClient.execute("get", { ...identity, profileId: ref.profile_id }, signal, deadlineAt)
            current()
            const parsed = customApiPublic.get.safeParse(raw)
            if (!parsed.success || parsed.data.custom_api.profile_id !== ref.profile_id) invalid()
          } else {
            if (!clients.mcpPersonalClient) throw new ConnectError("MCP owner unavailable", Code.Unavailable)
            const operation = ref.kind === "provider" ? "provider" : "connector"
            const id = ref.kind === "provider" ? ref.provider_key : ref.connector_id
            const raw = await clients.mcpPersonalClient.read(operation, { ...identity, id }, signal, deadlineAt)
            current()
            let parsed: unknown
            try {
              parsed = validateMcpPersonalPublic(operation, raw, { ...identity, id })
            } catch {
              invalid()
            }
            if (ref.kind === "mcp_connector") {
              const connector = (parsed as { connector: { connector_type: string; status: string } }).connector
              if (connector.connector_type !== "mcp" || connector.status === "revoked")
                throw new ConnectError("Recommendation unavailable", Code.FailedPrecondition)
            }
          }
        }
      }),
    )
  } finally {
    stopped.abort()
  }
}
