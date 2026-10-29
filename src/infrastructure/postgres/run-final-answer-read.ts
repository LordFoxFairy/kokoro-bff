import type { Pool } from "pg"
import type { RunFinalAnswerQuery, RunFinalAnswer } from "../../application/ports/chat-repository.js"
import { withMessageReadClient } from "./message-parts-read.js"
import { parseMessageParts } from "./message-parts.js"

type FinalRow = { parts_format_version: unknown; revision: unknown; final_segment_id: unknown; candidates: unknown }

/** Bind an owner-proven legacy identity, without copying or rewriting its body. */
export async function readRunFinalAnswer(pool: Pick<Pool, "connect">, query: RunFinalAnswerQuery): Promise<RunFinalAnswer | null> {
  return withMessageReadClient(pool, query, async (client) => {
    const result = await client.query<FinalRow>(
      `SELECT message.parts_format_version,message.parts_public_sequence::text AS revision,message.final_segment_id,
        (SELECT jsonb_agg(CASE WHEN jsonb_typeof(item->'text')='string' AND octet_length((item-'text')::text)<=4096
          THEN item || jsonb_build_object('text','') ELSE NULL END)
         FROM (SELECT item FROM jsonb_array_elements(message.ordered_parts) item
           WHERE item->>'kind'='text' AND item->>'segment_id'=$5 LIMIT 2) matches) AS candidates
       FROM bff_message message
       JOIN bff_conversation conversation ON conversation.tenant_id=message.tenant_id AND conversation.conversation_id=message.conversation_id
       JOIN bff_agent_dispatch_outbox dispatch ON dispatch.tenant_id=message.tenant_id AND dispatch.conversation_id=message.conversation_id
         AND dispatch.assistant_message_id=message.message_id AND dispatch.run_id=message.run_id
       WHERE message.tenant_id=$1 AND conversation.owner_id=$2 AND dispatch.subject_id=$2
         AND message.conversation_id=$3 AND message.run_id=$4 AND message.role='assistant' AND message.status='completed'
         AND conversation.status='active' AND dispatch.execution_context_retired_at IS NULL
         AND message.parts_format_version=1 AND message.ordered_parts IS NOT NULL
         AND (conversation.project_ref IS NULL OR EXISTS(SELECT 1 FROM bff_project project
           WHERE project.tenant_id=conversation.tenant_id AND project.owner_id=conversation.owner_id AND project.deleted_at IS NULL
             AND (project.project_id=conversation.project_ref OR project.slug=conversation.project_ref)))
       LIMIT 2`,
      [query.tenantId, query.subjectId, query.conversationId, query.runId, query.finalMessageId],
    )
    if (result.rows.length !== 1) return null
    const row = result.rows[0]
    if (!row || (row.final_segment_id !== null && row.final_segment_id !== query.finalMessageId)) return null
    if (!Array.isArray(row.candidates) || row.candidates.length !== 1) return null
    try {
      const state = parseMessageParts(row.candidates, row.parts_format_version, row.revision)
      const part = state?.parts[0]
      if (!state || part?.kind !== "text" || !part.completed || part.segment_id !== query.finalMessageId) return null
      return { segment_id: part.segment_id, revision: state.publicSequence }
    } catch {
      // Invalid persisted shape provides no proof; database/cancellation errors
      // remain outside this catch and keep the existing read failure boundary.
      return null
    }
  })
}
