import type { Pool, PoolClient } from "pg"
import type { ChatExecutionHead, ChatRunControlState, RunProcessPage } from "../../application/agui/run-read.js"
import { readOwnedConversationSnapshotRow } from "./chat-conversation-lookup.js"
import { conversationFromRow } from "./chat-repository-mappers.js"
import { readRunInteraction } from "./agui-interaction-projection.js"
import { readRunProcessPage } from "./agui-process-page.js"

type ActiveRunRow = {
  consumer_subject_id: unknown
  expected_run_id: unknown
  latest_run_id: unknown
  terminal_run_id: unknown
  latest_run_start_sequence: string | null
  source_high_watermark: string
}

type ExecutionHeadRow = { run_id: string; subject_id: string }

function executionHeadFromRows(head: ExecutionHeadRow | undefined, stream: ActiveRunRow | undefined, subjectId: string): ChatExecutionHead | undefined {
  if (
    stream !== undefined &&
    [stream.expected_run_id, stream.latest_run_id, stream.terminal_run_id].some((value) => value !== null && (typeof value !== "string" || value.trim() === ""))
  )
    throw new Error("CHAT_ACTIVE_RUN_STATE_INVALID")
  if (head === undefined) {
    if (stream?.expected_run_id !== null && stream?.expected_run_id !== undefined) throw new Error("CHAT_ACTIVE_RUN_STATE_INVALID")
    return undefined
  }
  if (head.run_id.trim() === "" || head.subject_id !== subjectId || stream === undefined || stream.consumer_subject_id !== subjectId) {
    throw new Error("CHAT_EXECUTION_HEAD_IDENTITY_INVALID")
  }
  if (stream.expected_run_id !== null && stream.expected_run_id !== head.run_id) {
    throw new Error("CHAT_EXECUTION_HEAD_STATE_INVALID")
  }
  if (stream.terminal_run_id === head.run_id) throw new Error("CHAT_EXECUTION_HEAD_STATE_INVALID")
  if (stream.latest_run_id === head.run_id) {
    if (stream.expected_run_id !== head.run_id) throw new Error("CHAT_EXECUTION_HEAD_STATE_INVALID")
    return { runId: head.run_id, state: "active", pendingPauses: [] }
  }
  return { runId: head.run_id, state: "queued", pendingPauses: [] }
}

/** Observe projection facts at the caller's existing repeatable-read snapshot. */
export async function readAgUiSnapshotState(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  conversationId: string,
  includeProcess: boolean,
): Promise<{ watermark: string | null; processPage: RunProcessPage | null; executionHead: ChatExecutionHead | undefined }> {
  const cursor = await client.query<{ cursor: string; public_sequence: string }>(
    `SELECT cursor, public_sequence FROM bff_agui_event
          WHERE tenant_id = $1 AND session_id = $2
          ORDER BY public_sequence DESC LIMIT 1`,
    [tenantId, conversationId],
  )
  const activeRunResult = await client.query<ActiveRunRow>(
    `SELECT consumer_subject_id, expected_run_id, latest_run_id, terminal_run_id, latest_run_start_sequence, source_high_watermark
           FROM bff_agui_stream
          WHERE tenant_id = $1 AND session_id = $2
          LIMIT 1`,
    [tenantId, conversationId],
  )
  const watermark = cursor.rows[0]?.cursor ?? null
  const processPage =
    includeProcess && watermark !== null
      ? await readRunProcessPage(client, {
          tenantId,
          sessionId: conversationId,
          subjectId,
          watermark,
          cursor: null,
          limit: 100,
        })
      : null
  const heads = await client.query<ExecutionHeadRow>(
    [
      "SELECT run_id,subject_id FROM bff_agent_dispatch_outbox",
      "WHERE tenant_id=$1 AND conversation_id=$2 AND status IN ('pending','leased','retryable','admitted')",
      "ORDER BY conversation_dispatch_seq,outbox_id LIMIT 1",
    ].join("\n"),
    [tenantId, conversationId],
  )
  let executionHead = executionHeadFromRows(heads.rows[0], activeRunResult.rows[0], subjectId)
  if (executionHead !== undefined && executionHead.state === "active") {
    const stream = activeRunResult.rows[0]
    const start = Number(stream?.latest_run_start_sequence),
      watermark = Number(cursor.rows[0]?.public_sequence)
    const sourceWatermark = Number(stream?.source_high_watermark)
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(watermark) || !Number.isSafeInteger(sourceWatermark))
      throw new Error("CHAT_EXECUTION_HEAD_WATERMARK_INVALID")
    const state = await readRunInteraction(client, tenantId, conversationId, executionHead.runId, subjectId, start, watermark, sourceWatermark)
    if (state?.phase === "waiting" || state?.phase === "resuming") executionHead = { runId: executionHead.runId, state: state.phase, pendingPauses: [state] }
  } else if (executionHead !== undefined) {
    const publicWatermark = Number(cursor.rows[0]?.public_sequence ?? 0),
      sourceWatermark = Number(activeRunResult.rows[0]?.source_high_watermark)
    if (!Number.isSafeInteger(publicWatermark) || !Number.isSafeInteger(sourceWatermark)) throw new Error("CHAT_EXECUTION_HEAD_WATERMARK_INVALID")
    // A strict initial terminal is a non-actionable prelude, not an active process.
    await readRunInteraction(client, tenantId, conversationId, executionHead.runId, subjectId, null, publicWatermark, sourceWatermark)
  }
  return { watermark, processPage, executionHead }
}

export function createAgUiRunControlReader(pool: Pick<Pool, "connect">) {
  return async function readRunControlState(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    projectRef: string | undefined,
  ): Promise<ChatRunControlState | null> {
    const client = await pool.connect()
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
      const row = await readOwnedConversationSnapshotRow(client, tenantId, subjectId, conversationId, projectRef, false)
      if (row === undefined) {
        await client.query("COMMIT")
        return null
      }
      const { executionHead } = await readAgUiSnapshotState(client, tenantId, subjectId, conversationId, false)
      conversationFromRow(row)
      await client.query("COMMIT")
      return executionHead === undefined ? {} : { executionHead }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}

export type AgUiRunControlReader = ReturnType<typeof createAgUiRunControlReader>
