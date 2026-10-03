import { createHash } from "node:crypto"
import type { PoolClient } from "pg"

import type { AgUiEvent } from "../../application/agui/project-chat-event.js"
import type { AgUiSourceProjection } from "../../application/agui/ports/agui-projection-repository.js"

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value !== "object") throw new Error("AGUI_PROCESS_PAYLOAD_INVALID")
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

export async function projectRunProcessFrame(
  client: PoolClient,
  scope: Readonly<{ tenantId: string; sessionId: string; subjectId: string }>,
  source: AgUiSourceProjection,
  frame: AgUiEvent,
  publicSequence: number,
  publicCursor: string,
): Promise<void> {
  const runId = frame.runId ?? frame.metadata.kokoro.run_id
  if (runId === null || runId === undefined || runId === "") return
  const provenance = [
    source.sourceOwner,
    source.sourceEventId,
    source.sourceSequence,
    source.sourceDigest,
    source.sourceOccurredAt,
    publicSequence,
    publicCursor,
  ]
  if (frame.type === "RUN_STARTED") {
    const inserted = await client.query(
      `INSERT INTO bff_agui_run_process
         (tenant_id,session_id,run_id,subject_id,start_source_owner,start_source_event_id,start_source_sequence,start_source_digest,start_source_occurred_at,start_public_sequence,start_public_cursor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (tenant_id,session_id,run_id) DO UPDATE SET run_id=EXCLUDED.run_id
        WHERE bff_agui_run_process.subject_id=EXCLUDED.subject_id
          AND bff_agui_run_process.start_source_owner=EXCLUDED.start_source_owner
          AND bff_agui_run_process.start_source_event_id=EXCLUDED.start_source_event_id
          AND bff_agui_run_process.start_source_sequence=EXCLUDED.start_source_sequence
          AND bff_agui_run_process.start_source_digest=EXCLUDED.start_source_digest
          AND bff_agui_run_process.start_source_occurred_at=EXCLUDED.start_source_occurred_at
          AND bff_agui_run_process.start_public_sequence=EXCLUDED.start_public_sequence
          AND bff_agui_run_process.start_public_cursor=EXCLUDED.start_public_cursor
       RETURNING run_id`,
      [scope.tenantId, scope.sessionId, runId, scope.subjectId, ...provenance],
    )
    if (inserted.rowCount !== 1) throw new Error("AGUI_PROCESS_START_IDENTITY_CONFLICT")
    return
  }
  if (frame.type !== "CUSTOM") return
  if (frame.name === "kokoro.todo.updated") {
    const value = frame.value as { todos?: unknown }
    if (!Array.isArray(value?.todos)) throw new Error("AGUI_PROCESS_TODO_INVALID")
    const result = await client.query(
      `UPDATE bff_agui_run_process SET
         todo_observed=TRUE,todos=$5::jsonb,todo_digest=$6,
         todo_source_owner=$7,todo_source_event_id=$8,todo_source_sequence=$9,todo_source_digest=$10,
         todo_source_occurred_at=$11,todo_public_sequence=$12,todo_public_cursor=$13,updated_at=CURRENT_TIMESTAMP(3)
       WHERE tenant_id=$1 AND session_id=$2 AND run_id=$3 AND subject_id=$4`,
      [scope.tenantId, scope.sessionId, runId, scope.subjectId, JSON.stringify(value.todos), digest(value.todos), ...provenance],
    )
    if (result.rowCount !== 1) throw new Error("AGUI_PROCESS_START_MISSING")
    return
  }
  if (frame.name !== "kokoro.activity.updated") return
  const value = frame.value
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("AGUI_PROCESS_ACTIVITY_INVALID")
  const activity = value as Record<string, unknown>
  if (typeof activity.activity_id !== "string" || typeof activity.activity !== "string") throw new Error("AGUI_PROCESS_ACTIVITY_INVALID")
  const result = await client.query(
    `INSERT INTO bff_agui_run_activity
       (tenant_id,session_id,run_id,activity_id,subject_id,activity_kind,safe_payload,payload_digest,
        first_source_owner,first_source_event_id,first_source_sequence,first_source_digest,first_source_occurred_at,first_public_sequence,first_public_cursor,
        latest_source_owner,latest_source_event_id,latest_source_sequence,latest_source_digest,latest_source_occurred_at,latest_public_sequence,latest_public_cursor)
     SELECT $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$9,$10,$11,$12,$13,$14,$15
      WHERE EXISTS (SELECT 1 FROM bff_agui_run_process WHERE tenant_id=$1 AND session_id=$2 AND run_id=$3 AND subject_id=$5)
     ON CONFLICT (tenant_id,session_id,run_id,activity_id) DO UPDATE SET
       activity_kind=EXCLUDED.activity_kind,safe_payload=EXCLUDED.safe_payload,payload_digest=EXCLUDED.payload_digest,
       latest_source_owner=EXCLUDED.latest_source_owner,latest_source_event_id=EXCLUDED.latest_source_event_id,
       latest_source_sequence=EXCLUDED.latest_source_sequence,latest_source_digest=EXCLUDED.latest_source_digest,
       latest_source_occurred_at=EXCLUDED.latest_source_occurred_at,latest_public_sequence=EXCLUDED.latest_public_sequence,
       latest_public_cursor=EXCLUDED.latest_public_cursor,updated_at=CURRENT_TIMESTAMP(3)
     RETURNING activity_id`,
    [
      scope.tenantId,
      scope.sessionId,
      runId,
      activity.activity_id,
      scope.subjectId,
      activity.activity,
      JSON.stringify(activity),
      digest(activity),
      ...provenance,
    ],
  )
  if (result.rowCount !== 1) throw new Error("AGUI_PROCESS_START_MISSING")
}
