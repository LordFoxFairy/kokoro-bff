import { parseCustomApiProfileSelection } from "../../domain/chat/custom-api-profile-selection.js"
import type { PoolClient } from "pg"
import type { ChatComposerSelection } from "../../contracts/chat.js"
import { AGENT_DISPATCH_SCHEMA_VERSION } from "../../domain/chat/agent-dispatch.js"
import { parseMcpConnectionSelection } from "../../domain/chat/mcp-connection-selection.js"

type SelectionRow = {
  message_id: string
  source_matches: boolean | null
  has_selection: boolean | null
  selected_mcp_connection_ids: unknown
  has_custom_api_selection: boolean | null
  selected_custom_api_profiles: unknown
}

/** Called only after the private snapshot ACL, on that same read transaction. */
export async function readChatComposerSelection(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  subjectId: string,
  conversationId: string,
): Promise<ChatComposerSelection | undefined> {
  const result = await client.query<SelectionRow>(
    `SELECT latest.message_id,
       (dispatch.payload->'schema_version' = $4::jsonb
        AND dispatch.payload#>'{launch,message_id}' = to_jsonb(latest.message_id)
        AND dispatch.payload#>'{launch,run_id}' = to_jsonb(latest.run_id)
        AND dispatch.payload#>'{launch,session_id}' = to_jsonb($3::text)) AS source_matches,
       (dispatch.payload->'launch') ? 'selected_mcp_connection_ids' AS has_selection,
       CASE WHEN octet_length((dispatch.payload#>'{launch,selected_mcp_connection_ids}')::text) <= 4096
         THEN dispatch.payload#>'{launch,selected_mcp_connection_ids}' END AS selected_mcp_connection_ids,
       (dispatch.payload->'launch') ? 'selected_custom_api_profiles' AS has_custom_api_selection,
       CASE WHEN octet_length((dispatch.payload#>'{launch,selected_custom_api_profiles}')::text) <= 16384
         THEN dispatch.payload#>'{launch,selected_custom_api_profiles}' END AS selected_custom_api_profiles
     FROM (
       SELECT message_id, run_id FROM bff_message
       WHERE tenant_id=$1 AND conversation_id=$3 AND role='user' AND origin='normal'
       ORDER BY message_seq DESC, message_id DESC LIMIT 1
     ) AS latest
     LEFT JOIN bff_agent_dispatch_outbox AS dispatch
       ON dispatch.tenant_id=$1 AND dispatch.subject_id=$2 AND dispatch.actor_id=$2
       AND dispatch.conversation_id=$3 AND dispatch.user_message_id=latest.message_id AND dispatch.run_id=latest.run_id`,
    [tenantId, subjectId, conversationId, JSON.stringify(AGENT_DISPATCH_SCHEMA_VERSION)],
  )
  const row = result.rows[0]
  // Never skip the latest empty, unproven or invalid source to resurrect older choices.
  if (result.rows.length !== 1 || !row || row.source_matches !== true || typeof row.has_selection !== "boolean") return undefined
  const ids = row.has_selection ? parseMcpConnectionSelection(row.selected_mcp_connection_ids) : []
  if (typeof row.has_custom_api_selection !== "boolean") return undefined
  const profiles = row.has_custom_api_selection ? parseCustomApiProfileSelection(row.selected_custom_api_profiles) : []
  if (ids === null || profiles === null) return undefined
  return {
    source_message_id: row.message_id,
    selected_mcp_connection_ids: ids,
    selected_custom_api_profiles: profiles,
  }
}
