export type AgUiConsumerRegistration = {
  text: string
  values: [tenantId: string, sessionId: string, subjectId: string, expectedRunId: string | null]
}

/** One canonical upsert shared by HTTP admission and the background consumer port. */
export function agUiConsumerRegistration(tenantId: string, sessionId: string, subjectId: string, expectedRunId?: string): AgUiConsumerRegistration {
  if (tenantId.trim() === "" || sessionId.trim() === "" || subjectId.trim() === "") {
    throw new Error("AG-UI consumer identity is required")
  }
  if (expectedRunId !== undefined && expectedRunId.trim() === "") {
    throw new Error("AG-UI expected run identity must not be empty")
  }
  return {
    text: `WITH registered AS (INSERT INTO bff_agui_stream (tenant_id, session_id, consumer_subject_id, expected_run_id)
       SELECT $1, $2, $3, $4
       WHERE $4::text IS NULL OR EXISTS (
         SELECT 1 FROM bff_agent_dispatch_outbox dispatch
          WHERE dispatch.tenant_id=$1 AND dispatch.conversation_id=$2 AND dispatch.run_id=$4
            AND dispatch.subject_id=$3 AND dispatch.actor_id=$3 AND dispatch.execution_context_retired_at IS NULL
            AND dispatch.status IN ('pending','leased','retryable','admitted')
            AND NOT EXISTS (SELECT 1 FROM bff_agent_dispatch_outbox earlier
              WHERE earlier.tenant_id=dispatch.tenant_id AND earlier.conversation_id=dispatch.conversation_id
                AND earlier.status IN ('pending','leased','retryable','admitted')
                AND earlier.conversation_dispatch_seq<dispatch.conversation_dispatch_seq))
       ON CONFLICT (tenant_id, session_id) DO UPDATE
         SET version = bff_agui_stream.version + CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN 1
               ELSE 0
             END,
             consumer_subject_id = CASE WHEN EXCLUDED.expected_run_id IS NOT NULL AND bff_agui_stream.expected_run_id IS NULL
               THEN EXCLUDED.consumer_subject_id ELSE COALESCE(bff_agui_stream.consumer_subject_id,EXCLUDED.consumer_subject_id) END,
             terminal_run_id = CASE
               WHEN EXCLUDED.expected_run_id IS NULL OR bff_agui_stream.expected_run_id = EXCLUDED.expected_run_id
                 THEN bff_agui_stream.terminal_run_id
               ELSE NULL
             END,
             latest_run_start_sequence = bff_agui_stream.latest_run_start_sequence,
             expected_run_id = COALESCE(EXCLUDED.expected_run_id, bff_agui_stream.expected_run_id),
             consumer_state = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN 'active'
               ELSE bff_agui_stream.consumer_state
             END,
             consumer_lease_owner = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN NULL
               ELSE bff_agui_stream.consumer_lease_owner
             END,
             consumer_lease_token = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN NULL
               ELSE bff_agui_stream.consumer_lease_token
             END,
             consumer_lease_until = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN NULL
               ELSE bff_agui_stream.consumer_lease_until
             END,
             consumer_fence = bff_agui_stream.consumer_fence + CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN 1
               ELSE 0
             END,
             consumer_failure_count = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN 0
               ELSE bff_agui_stream.consumer_failure_count
             END,
             consumer_last_error_code = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN NULL
               ELSE bff_agui_stream.consumer_last_error_code
             END,
             consumer_last_error_at = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN NULL
               ELSE bff_agui_stream.consumer_last_error_at
             END,
             consumer_next_poll_at = LEAST(bff_agui_stream.consumer_next_poll_at, CURRENT_TIMESTAMP(3)),
             updated_at = CURRENT_TIMESTAMP(3)
       WHERE EXCLUDED.expected_run_id IS NULL OR bff_agui_stream.consumer_subject_id IS NULL
          OR bff_agui_stream.expected_run_id IS NULL
          OR (bff_agui_stream.consumer_subject_id=EXCLUDED.consumer_subject_id AND bff_agui_stream.expected_run_id=EXCLUDED.expected_run_id)
       RETURNING tenant_id,session_id,consumer_subject_id),
       allocated_source AS (
         INSERT INTO bff_agui_source_cursor(tenant_id,session_id,source_owner,subject_id)
          SELECT tenant_id,session_id,'kokoro-agent',consumer_subject_id FROM registered
          WHERE consumer_subject_id IS NOT NULL
          ON CONFLICT DO NOTHING
       ) SELECT session_id FROM registered`,
    values: [tenantId, sessionId, subjectId, expectedRunId ?? null],
  }
}
