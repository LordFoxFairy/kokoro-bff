import type { QueryResult, QueryResultRow } from "pg"
import type { AgentLaunchBody } from "../../domain/chat/agent-dispatch.js"
import { zLaunchRequest } from "../../generated/agent-http/zod.gen.js"

type SnapshotQuery = <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<Row>>

/** One statement snapshot on the caller's already-bounded Chat transaction; no separate lease. */
export async function readChatPersonalContext(
  query: SnapshotQuery,
  owner: { tenantId: string; actorId: string },
): Promise<NonNullable<AgentLaunchBody["personal_context"]>> {
  const result = await query<{ profile: unknown; knowledge: unknown }>(
    `WITH usage AS (
       SELECT COALESCE((SELECT enabled FROM bff_personal_knowledge_usage WHERE tenant_id=$1 AND owner_id=$2),FALSE) AS enabled,
              COALESCE((SELECT revision FROM bff_personal_knowledge_usage WHERE tenant_id=$1 AND owner_id=$2),0) AS revision
     ), active_knowledge AS (
       SELECT knowledge_id,revision,name,when_to_use,content FROM bff_personal_knowledge
        WHERE tenant_id=$1 AND owner_id=$2 AND deleted_at IS NULL AND (SELECT enabled FROM usage)
        ORDER BY knowledge_id LIMIT 101
     )
     SELECT (SELECT jsonb_build_object('revision',revision,'nickname',nickname,'occupation',occupation,'about',about,'instructions',instructions)
               FROM bff_personalization WHERE tenant_id=$1 AND owner_id=$2) AS profile,
            jsonb_build_object('usage_revision',usage.revision,'enabled',usage.enabled,
              'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('knowledge_id',knowledge_id,'revision',revision,
                'name',name,'when_to_use',when_to_use,'content',content) ORDER BY knowledge_id) FROM active_knowledge),'[]'::jsonb)) AS knowledge
       FROM usage`,
    [owner.tenantId, owner.actorId],
  )
  if (result.rows.length !== 1) throw new Error("CHAT_PERSONAL_CONTEXT_INVALID")
  const row = result.rows[0]!
  const parsed = zLaunchRequest.shape.personal_context.safeParse({
    schema_version: 1,
    owner: { tenant_ref: owner.tenantId, user_ref: owner.actorId },
    profile: row.profile,
    knowledge: row.knowledge,
  })
  if (!parsed.success || parsed.data == null) throw new Error("CHAT_PERSONAL_CONTEXT_INVALID")
  return parsed.data
}
