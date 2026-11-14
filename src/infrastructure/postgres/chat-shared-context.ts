import type { QueryResult, QueryResultRow } from "pg"
import type { AgentLaunchBody } from "../../domain/chat/agent-dispatch.js"
import { zLaunchRequest } from "../../generated/agent-http/zod.gen.js"

type SharedContext = NonNullable<AgentLaunchBody["shared_conversation_context"]>
export const sharedConversationLimits = { messages: 128, contentBytes: 262144 } as const
export type SharedContextRow = {
  message_id: string
  sequence: string
  role: "user" | "assistant"
  content: string | null
  content_bytes: string
  final_valid: boolean
}

/** Rows are newest-first; stop at the first whole message that does not fit, never skip a hole. */
export function sharedConversationSuffix(projectId: string, conversationId: string, newest: readonly SharedContextRow[]): SharedContext {
  const messages: SharedContext["messages"] = []
  let bytes = 0,
    earlier = false,
    previous: bigint | undefined
  for (const row of newest) {
    if (messages.length === sharedConversationLimits.messages) {
      earlier = true
      break
    }
    if (!/^(0|[1-9][0-9]*)$/u.test(row.content_bytes)) throw new Error("SHARED_CONTEXT_INVALID")
    const size = BigInt(row.content_bytes)
    if (size > BigInt(sharedConversationLimits.contentBytes - bytes)) {
      earlier = true
      break
    }
    if (
      !row.final_valid ||
      row.content === null ||
      Buffer.byteLength(row.content) !== Number(size) ||
      !/^[1-9][0-9]{0,18}$/u.test(row.sequence) ||
      BigInt(row.sequence) > 9223372036854775807n ||
      (previous !== undefined && BigInt(row.sequence) >= previous)
    )
      throw new Error("SHARED_CONTEXT_INVALID")
    previous = BigInt(row.sequence)
    bytes += Number(size)
    messages.push({ message_id: row.message_id, sequence: row.sequence, role: row.role, content: row.content })
  }
  const context = { project_ref: projectId, conversation_id: conversationId, messages: messages.reverse(), has_earlier_messages: earlier }
  const parsed = zLaunchRequest.shape.shared_conversation_context.safeParse(context)
  if (!parsed.success || parsed.data === undefined) throw new Error("SHARED_CONTEXT_INVALID")
  return parsed.data
}

/** Caller already holds the canonical Project/Conversation locks and has freshly checked the actual sender's edit grant. */
export async function readSharedConversationContext(
  query: <Row extends QueryResultRow>(sql: string, values?: unknown[]) => Promise<QueryResult<Row>>,
  tenantId: string,
  projectId: string,
  conversationId: string,
  beforeUserMessageId?: string,
): Promise<SharedContext | undefined> {
  const shared = (
    await query<{ shared: boolean }>(`SELECT EXISTS(SELECT 1 FROM bff_project_grant WHERE tenant_id=$1 AND project_id=$2) AS shared`, [tenantId, projectId])
  ).rows[0]
  if (!shared?.shared) return undefined
  const rows = await query<SharedContextRow>(
    `WITH candidates AS MATERIALIZED (
       SELECT message_id,message_seq,role,content,ordered_parts,final_segment_id
         FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2 AND origin<>'regeneration_input'
          AND ($5::text IS NULL OR message_seq<(SELECT original.message_seq FROM bff_message original WHERE original.tenant_id=$1 AND original.conversation_id=$2 AND original.message_id=$5 AND original.role='user'))
          AND (role='user' OR (role='assistant' AND status='completed' AND final_segment_id IS NOT NULL AND parts_format_version=1))
         ORDER BY message_seq DESC,message_id DESC LIMIT $3
     ), safe_text AS (
       SELECT message_id,message_seq,role,
         CASE WHEN candidates.role='user' THEN candidates.content ELSE final_part.content END AS content,
         (role='user' OR final_part.matches=1) AS final_valid
       FROM candidates LEFT JOIN LATERAL (
         SELECT count(*) AS matches,min(part->>'text') AS content FROM jsonb_array_elements(candidates.ordered_parts) part
          WHERE candidates.role='assistant' AND part->>'kind'='text' AND part->>'segment_id'=candidates.final_segment_id
            AND part->'completed'='true'::jsonb AND part->>'part_id'='text:'||candidates.final_segment_id AND jsonb_typeof(part->'text')='string'
       ) final_part ON candidates.role='assistant'
     ) SELECT message_id,message_seq::text AS sequence,role,
       CASE WHEN octet_length(content)<=$4 THEN content END AS content,
       octet_length(content)::text AS content_bytes,final_valid
       FROM safe_text ORDER BY message_seq DESC,message_id DESC`,
    [tenantId, conversationId, sharedConversationLimits.messages + 1, sharedConversationLimits.contentBytes, beforeUserMessageId ?? null],
  )
  return sharedConversationSuffix(projectId, conversationId, rows.rows)
}
