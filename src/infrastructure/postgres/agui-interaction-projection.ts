import type { PoolClient } from "pg"
import type { InteractionState } from "../../contracts/chat.js"
import type { AgUiSourceProjection } from "../../application/agui/ports/agui-projection-repository.js"
import { interactionDigest } from "../../application/agui/interaction-state.js"
import { isRecord } from "../../domain/json.js"
import { parseAgentInteractionState } from "../clients/agent/interaction-state.js"

function instant(value: string, label: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`)
  return parsed.toISOString()
}

export function interactionFromRow(row: Record<string, unknown>): InteractionState {
  if (row.projection_schema_version !== 1) throw new Error("AGUI_INTERACTION_VERSION_INVALID")
  const integer = (value: unknown): number => {
    if ((typeof value !== "string" && typeof value !== "number") || !Number.isSafeInteger(Number(value))) throw new Error("AGUI_INTERACTION_INTEGER_INVALID")
    return Number(value)
  }
  const actionFields = [row.action_command_id, row.action_pause_revision, row.action_kind]
  if (actionFields.some((value) => value === null) && !actionFields.every((value) => value === null)) throw new Error("AGUI_INTERACTION_ACTION_INVALID")
  return parseAgentInteractionState({
    interaction_revision: integer(row.interaction_revision),
    pause_revision: integer(row.pause_revision),
    pause_ref: row.pause_ref,
    phase: row.phase,
    groups: row.groups,
    action_result:
      row.action_command_id === null
        ? null
        : {
            command_id: row.action_command_id,
            pause_revision: integer(row.action_pause_revision),
            kind: row.action_kind,
          },
  })
}

/** Caller holds a parent/stream write lock or an authorized repeatable-read snapshot. */
export async function readRunInteraction(
  client: PoolClient,
  tenantId: string,
  sessionId: string,
  runId: string,
  subjectId: string,
  startSequence: number,
  publicWatermark: number,
  sourceWatermark: number,
): Promise<InteractionState | undefined> {
  const result = await client.query<{ projection: unknown; frame: unknown; source: unknown; start_valid: boolean }>(
    `SELECT
       (SELECT to_jsonb(projection) FROM bff_agui_run_interaction AS projection
         WHERE tenant_id=$1 AND session_id=$2 AND run_id=$3) AS projection,
       (SELECT to_jsonb(frame) FROM bff_agui_event AS frame
         WHERE tenant_id=$1 AND session_id=$2 AND event_type='CUSTOM'
           AND event_payload->>'name'='kokoro.interaction.state'
           AND event_payload #>> '{metadata,kokoro,run_id}'=$3
         ORDER BY public_sequence DESC LIMIT 1) AS frame,
       (SELECT to_jsonb(source) FROM bff_agui_source_event AS source
         JOIN bff_agui_run_interaction AS projection USING (tenant_id,session_id,source_owner,source_event_id)
         WHERE projection.tenant_id=$1 AND projection.session_id=$2 AND projection.run_id=$3) AS source,
       EXISTS (SELECT 1 FROM bff_agui_event AS start
         JOIN bff_agui_source_event AS source USING (tenant_id,session_id,source_owner,source_event_id)
         WHERE start.tenant_id=$1 AND start.session_id=$2 AND start.public_sequence=$4
           AND start.event_type='RUN_STARTED' AND start.source_owner='kokoro-agent'
           AND start.event_payload->>'runId'=$3 AND start.event_payload #>> '{metadata,kokoro,run_id}'=$3
           AND start.event_payload->>'threadId'=$2
           AND source.source_sequence <= $5) AS start_valid`,
    [tenantId, sessionId, runId, startSequence, sourceWatermark],
  )
  const pair = result.rows[0]
  if (pair === undefined || !pair.start_valid || startSequence < 1 || startSequence > publicWatermark) throw new Error("AGUI_INTERACTION_START_INVALID")
  if (pair.projection === null && pair.frame === null) return undefined
  if (!isRecord(pair.projection) || !isRecord(pair.frame) || !isRecord(pair.source)) throw new Error("AGUI_INTERACTION_PROJECTION_MISSING")
  const row = pair.projection,
    frame = pair.frame,
    source = pair.source
  const state = interactionFromRow(row)
  const payload = frame.event_payload
  if (!isRecord(payload) || !isRecord(payload.metadata) || !isRecord(payload.metadata.kokoro)) throw new Error("AGUI_INTERACTION_FRAME_INVALID")
  const metadata = payload.metadata.kokoro
  const frameState = parseAgentInteractionState(payload.value)
  const sequence = Number(row.public_sequence),
    sourceSequence = Number(row.source_sequence)
  if (
    row.subject_id !== subjectId ||
    row.source_owner !== "kokoro-agent" ||
    row.interaction_digest !== interactionDigest(state) ||
    interactionDigest(frameState) !== row.interaction_digest ||
    !Number.isSafeInteger(sequence) ||
    sequence <= startSequence ||
    sequence > publicWatermark ||
    !Number.isSafeInteger(sourceSequence) ||
    sourceSequence < 1 ||
    sourceSequence > sourceWatermark ||
    Number(frame.public_sequence) !== sequence ||
    frame.cursor !== row.public_cursor ||
    frame.source_owner !== row.source_owner ||
    frame.source_event_id !== row.source_event_id ||
    frame.event_type !== "CUSTOM" ||
    payload.type !== "CUSTOM" ||
    payload.name !== "kokoro.interaction.state" ||
    metadata.session_id !== sessionId ||
    metadata.run_id !== runId ||
    metadata.event_id !== row.source_event_id ||
    metadata.seq !== sourceSequence ||
    Number(source.source_sequence) !== sourceSequence ||
    source.source_digest !== row.source_digest ||
    !/^[0-9a-f]{64}$/u.test(String(row.source_digest)) ||
    instant(String(row.source_occurred_at), "interaction source time") !== instant(String(source.source_occurred_at), "source time") ||
    instant(String(frame.source_occurred_at), "frame source time") !== instant(String(row.source_occurred_at), "projection time") ||
    instant(String(metadata.timestamp), "metadata time") !== instant(String(row.source_occurred_at), "projection time")
  ) {
    throw new Error("AGUI_INTERACTION_INTEGRITY_INVALID")
  }
  return state
}

export async function writeRunInteraction(
  client: PoolClient,
  tenantId: string,
  sessionId: string,
  subjectId: string | null,
  source: AgUiSourceProjection,
  publicSequence: number,
  frameCursor: string,
): Promise<void> {
  const value = source.interactionState
  if (value === undefined || source.sourceRunId === null || subjectId === null) throw new Error("AGUI_INTERACTION_BINDING_INVALID")
  await client.query(
    `INSERT INTO bff_agui_run_interaction
                 (tenant_id,session_id,run_id,subject_id,projection_schema_version,interaction_revision,pause_revision,pause_ref,phase,groups,
                  action_command_id,action_pause_revision,action_kind,interaction_digest,source_owner,source_event_id,source_sequence,source_digest,source_occurred_at,public_sequence,public_cursor)
               VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
               ON CONFLICT (tenant_id,session_id,run_id) DO UPDATE SET
                 interaction_revision=EXCLUDED.interaction_revision,pause_revision=EXCLUDED.pause_revision,pause_ref=EXCLUDED.pause_ref,
                 phase=EXCLUDED.phase,groups=EXCLUDED.groups,action_command_id=EXCLUDED.action_command_id,
                 action_pause_revision=EXCLUDED.action_pause_revision,action_kind=EXCLUDED.action_kind,
                 interaction_digest=EXCLUDED.interaction_digest,source_owner=EXCLUDED.source_owner,source_event_id=EXCLUDED.source_event_id,
                 source_sequence=EXCLUDED.source_sequence,source_digest=EXCLUDED.source_digest,source_occurred_at=EXCLUDED.source_occurred_at,
                 public_sequence=EXCLUDED.public_sequence,public_cursor=EXCLUDED.public_cursor,updated_at=CURRENT_TIMESTAMP(3)`,
    [
      tenantId,
      sessionId,
      source.sourceRunId,
      subjectId,
      value.interaction_revision,
      value.pause_revision,
      value.pause_ref,
      value.phase,
      JSON.stringify(value.groups),
      value.action_result?.command_id ?? null,
      value.action_result?.pause_revision ?? null,
      value.action_result?.kind ?? null,
      interactionDigest(value),
      source.sourceOwner,
      source.sourceEventId,
      source.sourceSequence,
      source.sourceDigest,
      instant(source.sourceOccurredAt, "interaction source time"),
      publicSequence,
      frameCursor,
    ],
  )
}
