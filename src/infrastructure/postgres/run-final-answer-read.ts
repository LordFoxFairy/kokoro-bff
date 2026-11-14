import { projectReadPredicate } from "./project-access.js"
import { createHash } from "node:crypto"
import type { Pool, QueryResult, QueryResultRow } from "pg"
import type { MessageReadLifetime } from "../../application/chat/types.js"
import { FINAL_ANSWER_MAX_BYTES } from "../../domain/chat/resource-reference-selection.js"
import { withMessageReadClient } from "./message-parts-read.js"
import { parseMessageParts } from "./message-parts.js"
import { readCurrentConversation } from "./chat-conversation-access.js"

export type RunFinalAnswerQuery = MessageReadLifetime &
  Readonly<{
    tenantId: string
    subjectId: string
    conversationId: string
    runId: string
    finalMessageId: string
  }>
export type RunFinalAnswer = Readonly<{ segment_id: string; revision: string }>

export type RunFinalAnswerLookup = (query: RunFinalAnswerQuery) => Promise<RunFinalAnswer | null>

type FinalRow = { parts_format_version: unknown; revision: unknown; final_segment_id: unknown; candidates: unknown }

export type SelectedFinalAnswerInput = Readonly<{
  tenantId: string
  subjectId: string
  messageId: string
  projectId: string | null
}>

export type SelectedFinalAnswer = Readonly<{
  conversationId: string
  messageId: string
  runId: string
  finalSegmentId: string
  revision: string
  content: string
  sizeBytes: string
  contentSha256: string
}>

/** Private source material; run only on the caller's Chat transaction after locking its canonical Project. */
export async function selectedFinalAnswerInTransaction(
  client: { query: <Row extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => Promise<QueryResult<Row>> },
  input: SelectedFinalAnswerInput,
): Promise<SelectedFinalAnswer | null> {
  const result = await client.query<FinalRow & { conversation_id: string; run_id: string }>(
    `SELECT c.conversation_id,m.run_id,m.parts_format_version,m.parts_public_sequence::text AS revision,m.final_segment_id,
       (SELECT jsonb_agg(CASE WHEN jsonb_typeof(candidate.item->'text')='string'
             AND char_length(candidate.item->>'text') BETWEEN 1 AND $5::int
             AND octet_length(candidate.item->>'text') BETWEEN 1 AND $5::int
             AND octet_length((candidate.item-'text')::text)<=4096
           THEN candidate.item ELSE NULL END)
          FROM (SELECT item FROM jsonb_array_elements(m.ordered_parts) item
                 WHERE item->>'segment_id'=m.final_segment_id LIMIT 2) candidate) AS candidates
       FROM bff_message m
       JOIN bff_conversation c ON c.tenant_id=m.tenant_id AND c.conversation_id=m.conversation_id
       JOIN bff_agent_dispatch_outbox d ON d.tenant_id=m.tenant_id AND d.conversation_id=m.conversation_id
         AND d.run_id=m.run_id AND d.assistant_message_id=m.message_id AND d.subject_id=d.actor_id
      WHERE m.tenant_id=$1 AND m.message_id=$3
        AND c.status='active' AND m.role='assistant' AND m.status='completed'
        AND m.final_segment_id IS NOT NULL AND m.parts_format_version=1 AND m.parts_public_sequence>0
        AND d.execution_context_retired_at IS NULL AND d.execution_project_ref IS NOT DISTINCT FROM $4::text
        AND (($4::text IS NULL AND c.project_ref IS NULL AND c.owner_id=$2 AND d.subject_id=$2) OR EXISTS (
          SELECT 1 FROM bff_project
           WHERE bff_project.tenant_id=c.tenant_id AND bff_project.deleted_at IS NULL AND bff_project.project_id=$4
             AND ${projectReadPredicate}
             AND (bff_project.project_id=c.project_ref OR (bff_project.owner_id=c.owner_id AND bff_project.slug=c.project_ref))
             AND NOT EXISTS (
               SELECT 1 FROM bff_project other WHERE other.tenant_id=c.tenant_id AND other.deleted_at IS NULL
                 AND (other.project_id=c.project_ref OR (other.owner_id=c.owner_id AND other.slug=c.project_ref))
                 AND other.project_id<>bff_project.project_id
             )
        ))
      LIMIT 2 FOR SHARE OF c,m,d NOWAIT`,
    [input.tenantId, input.subjectId, input.messageId, input.projectId, FINAL_ANSWER_MAX_BYTES],
  )
  const row = result.rows[0]
  if (result.rows.length !== 1 || !row || !Array.isArray(row.candidates) || row.candidates.length !== 1) return null
  let state
  try {
    state = parseMessageParts(row.candidates, row.parts_format_version, row.revision)
  } catch {
    // A malformed durable slot proves nothing. Let SQL/abort errors reach the transaction owner.
    return null
  }
  const part = state?.parts[0]
  if (!state || state.publicSequence === "0" || part?.kind !== "text" || !part.completed || part.segment_id !== row.final_segment_id) return null
  const bytes = Buffer.from(part.text, "utf8")
  if (bytes.length === 0 || bytes.length > FINAL_ANSWER_MAX_BYTES || part.text.includes("\0") || bytes.toString("utf8") !== part.text) return null
  return {
    conversationId: row.conversation_id,
    messageId: input.messageId,
    runId: row.run_id,
    finalSegmentId: part.segment_id,
    revision: state.publicSequence,
    content: part.text,
    sizeBytes: String(bytes.length),
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
  }
}

/** Bind an owner-proven legacy identity, without copying or rewriting its body. */
export async function readRunFinalAnswer(pool: Pick<Pool, "connect">, query: RunFinalAnswerQuery): Promise<RunFinalAnswer | null> {
  return withMessageReadClient(pool, query, async (client) => {
    const current = await readCurrentConversation(client, query.tenantId, query.subjectId, query.conversationId, undefined, false)
    if (!current || (current.conversation.project_ref !== null && !current.projectAccess?.capabilities.includes("edit"))) return null
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
       WHERE message.tenant_id=$1 AND dispatch.subject_id=$2 AND dispatch.actor_id=$2
         AND message.conversation_id=$3 AND message.run_id=$4 AND message.role='assistant' AND message.status='completed'
         AND conversation.status='active' AND dispatch.execution_context_retired_at IS NULL
         AND message.parts_format_version=1 AND message.ordered_parts IS NOT NULL
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
