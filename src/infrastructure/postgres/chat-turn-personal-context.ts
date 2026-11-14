import type { QueryResult, QueryResultRow } from "pg"
import type { LaunchRequest } from "../../generated/agent-http/types.gen.js"
import { zLaunchRequest } from "../../generated/agent-http/zod.gen.js"

type Query = <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<Row>>

/** One statement on ChatTurn's existing bounded transaction; no account repository lease or owner I/O. */
export async function readChatTurnPersonalContext(
  query: Query,
  owner: Readonly<{ tenantId: string; actorId: string }>,
): Promise<NonNullable<LaunchRequest["personal_context"]> | undefined> {
  const result = await query<{
    profile: unknown
    usage: unknown
    items: unknown
  }>(
    `WITH usage AS (
       SELECT enabled,revision FROM bff_personal_knowledge_usage WHERE tenant_id=$1 AND owner_id=$2
     ), knowledge AS (
       SELECT knowledge_id,revision,name,when_to_use,content FROM bff_personal_knowledge
        WHERE tenant_id=$1 AND owner_id=$2 AND deleted_at IS NULL
          AND COALESCE((SELECT enabled FROM usage),FALSE)
        ORDER BY knowledge_id LIMIT 101
     )
     SELECT (SELECT jsonb_build_object('revision',revision,'nickname',nickname,'occupation',occupation,'about',about,'instructions',instructions)
               FROM bff_personalization WHERE tenant_id=$1 AND owner_id=$2) AS profile,
            (SELECT jsonb_build_object('usage_revision',revision,'enabled',enabled) FROM usage) AS usage,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('knowledge_id',knowledge_id,'revision',revision,'name',name,
              'when_to_use',when_to_use,'content',content) ORDER BY knowledge_id) FROM knowledge),'[]'::jsonb) AS items`,
    [owner.tenantId, owner.actorId],
  )
  if (result.rows.length !== 1) throw new Error("CHAT_PERSONAL_CONTEXT_INVALID")
  const row = result.rows[0]!
  if (row.profile === null && row.usage === null) return undefined
  const usage = row.usage === null ? { usage_revision: 0, enabled: false } : row.usage
  if (typeof usage !== "object" || usage === null || Array.isArray(usage)) throw new Error("CHAT_PERSONAL_CONTEXT_INVALID")
  const parsed = zLaunchRequest.shape.personal_context.safeParse({
    schema_version: 1,
    owner: { tenant_ref: owner.tenantId, user_ref: owner.actorId },
    profile: row.profile,
    knowledge: { ...usage, items: row.items },
  })
  if (!parsed.success || parsed.data == null) throw new Error("CHAT_PERSONAL_CONTEXT_INVALID")
  return parsed.data
}
