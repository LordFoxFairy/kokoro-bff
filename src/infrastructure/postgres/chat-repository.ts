import { readRunInteraction } from "./agui-interaction-projection.js"
import { randomUUID } from "node:crypto"

import type { ChatExecutionHead, ChatArtifactDelivery, ChatRepository, ChatSnapshot, ConversationCollectionFilter, ConversationPage, MessagePage } from "../../application/ports/chat-repository.js"
import type { Conversation } from "../../domain/chat/conversation.js"
import type { Share } from "../../domain/chat/share.js"
import type { PostgresBffDatabase } from "./client.js"
import {
  conversationColumns,
  conversationFromRow,
  decodeCursor,
  encodeCursor,
  instant,
  messageFromRow,
  shareColumns,
  shareFromRow,
  type ConversationRow,
  type MessageRow,
  type ShareRow,
} from "./chat-repository-mappers.js"

type ArtifactDeliveryRow = {
  conversation_id: string
  artifact_id: string
  source_asset_id: string
  source_artifact_kind: string
  source_title: string
  source_mime: string
  source_size_bytes: string
  run_id: string
  delivered_at: Date | string
}

type ActiveRunRow = {
  consumer_subject_id: unknown
  expected_run_id: unknown
  latest_run_id: unknown
  terminal_run_id: unknown
  latest_run_start_sequence: string | null
  source_high_watermark: string
}

type ExecutionHeadRow = { run_id: string; subject_id: string }

function executionHeadFromRows(
  head: ExecutionHeadRow | undefined,
  stream: ActiveRunRow | undefined,
  subjectId: string,
): ChatExecutionHead | undefined {
  if (stream !== undefined && [stream.expected_run_id, stream.latest_run_id, stream.terminal_run_id].some((value) => value !== null && (typeof value !== "string" || value.trim() === ""))) throw new Error("CHAT_ACTIVE_RUN_STATE_INVALID")
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

function artifactDeliveryFromRow(row: ArtifactDeliveryRow): ChatArtifactDelivery {
  const size = Number(row.source_size_bytes)
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("CHAT_ARTIFACT_SIZE_INVALID")
  return {
    conversationId: row.conversation_id,
    artifactId: row.artifact_id,
    assetId: row.source_asset_id,
    artifactKind: row.source_artifact_kind,
    title: row.source_title,
    mime: row.source_mime,
    size,
    runId: row.run_id,
    deliveredAt: instant(row.delivered_at),
  }
}

export class PostgresChatRepository implements ChatRepository {
  private readonly database: PostgresBffDatabase

  public constructor(database: PostgresBffDatabase) {
    this.database = database
  }

  public async listConversations(tenantId: string, subjectId: string, filter: ConversationCollectionFilter, limit: number, cursor: string | null): Promise<ConversationPage> {
    const position = decodeCursor(cursor, "conv")
    if (position !== null && !("timestamp" in position)) throw new Error("CHAT_CURSOR_INVALID")
    const collectionPredicate = filter.kind === "all"
      ? "$3::text IS NULL"
      : filter.kind === "direct"
        ? "$3::text IS NULL AND project_ref IS NULL"
        : "project_ref = $3::text"
    const projectRef = filter.kind === "project" ? filter.projectRef : null
    const result = await this.database.pool.query<ConversationRow>(
      `SELECT ${conversationColumns}
         FROM bff_conversation
        WHERE tenant_id = $1
          AND owner_id = $2
          AND status = 'active'
          AND (
            project_ref IS NULL
            OR EXISTS (
              SELECT 1 FROM bff_project AS project
               WHERE project.tenant_id = bff_conversation.tenant_id
                 AND project.owner_id = bff_conversation.owner_id
                 AND (project.project_id = bff_conversation.project_ref OR project.slug = bff_conversation.project_ref)
            )
          )
          AND (${collectionPredicate})
          AND ($4::timestamptz IS NULL OR updated_at < $4 OR (updated_at = $4 AND conversation_id > $5))
        ORDER BY updated_at DESC, conversation_id ASC
        LIMIT $6`,
      [tenantId, subjectId, projectRef ?? null, position?.timestamp ?? null, position?.id ?? null, limit + 1],
    )
    const rows = result.rows.slice(0, limit)
    const last = result.rows.length > limit ? rows.at(-1) : undefined
    return {
      conversations: rows.map(conversationFromRow),
      next_cursor: last === undefined ? null : encodeCursor({ timestamp: instant(last.updated_at).toISOString(), id: last.conversation_id }, "conv"),
    }
  }

  public async findConversation(tenantId: string, subjectId: string, conversationId: string, projectRef: string | undefined): Promise<Conversation | null> {
    const result = await this.database.pool.query<ConversationRow>(
      `SELECT ${conversationColumns}
         FROM bff_conversation
        WHERE tenant_id = $1 AND owner_id = $2 AND conversation_id = $3 AND status = 'active'
          AND (
            project_ref IS NULL
            OR EXISTS (
              SELECT 1 FROM bff_project AS project
               WHERE project.tenant_id = bff_conversation.tenant_id
                 AND project.owner_id = bff_conversation.owner_id
                 AND (project.project_id = bff_conversation.project_ref OR project.slug = bff_conversation.project_ref)
            )
          )
          AND ($4::text IS NULL OR project_ref = $4)
        LIMIT 1`,
      [tenantId, subjectId, conversationId, projectRef ?? null],
    )
    const row = result.rows[0]
    return row === undefined ? null : conversationFromRow(row)
  }

  public async readSnapshot(tenantId: string, subjectId: string, conversationId: string, projectRef: string | undefined): Promise<ChatSnapshot | null> {
    return this.readSnapshotState(tenantId, subjectId, conversationId, projectRef, true)
  }

  public async readRunControlState(tenantId: string, subjectId: string, conversationId: string, projectRef: string | undefined): Promise<import("../../application/ports/chat-repository.js").ChatRunControlState | null> {
    const state = await this.readSnapshotState(tenantId, subjectId, conversationId, projectRef, false)
    return state === null ? null : state.executionHead === undefined ? {} : { executionHead: state.executionHead }
  }

  private async readSnapshotState(tenantId: string, subjectId: string, conversationId: string, projectRef: string | undefined, includeHistory: boolean): Promise<ChatSnapshot | null> {
    const client = await this.database.pool.connect()
    try {
      // Every read, including the cursor, observes one committed projection boundary.
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
      const conversation = await client.query<ConversationRow>(
        `SELECT ${conversationColumns}
           FROM bff_conversation
          WHERE tenant_id = $1 AND owner_id = $2 AND conversation_id = $3 AND status = 'active'
            AND (
              project_ref IS NULL
              OR EXISTS (
                SELECT 1 FROM bff_project AS project
                 WHERE project.tenant_id = bff_conversation.tenant_id
                   AND project.owner_id = bff_conversation.owner_id
                   AND (project.project_id = bff_conversation.project_ref OR project.slug = bff_conversation.project_ref)
              )
            )
            AND ($4::text IS NULL OR project_ref = $4)
          LIMIT 1`,
        [tenantId, subjectId, conversationId, projectRef ?? null],
      )
      const row = conversation.rows[0]
      if (row === undefined) {
        await client.query("COMMIT")
        return null
      }
      const messages = includeHistory ? await client.query<MessageRow>(
        `SELECT latest.message_id, latest.tenant_id, latest.conversation_id, latest.run_id,
                latest.role, latest.content, latest.status, latest.agent_failure_code, latest.agent_failure_retryable, latest.message_seq,
                latest.created_at, latest.updated_at
           FROM (
             SELECT message_id, tenant_id, conversation_id, run_id, role, content, status, agent_failure_code, agent_failure_retryable,
                    message_seq, created_at, updated_at
               FROM bff_message
              WHERE tenant_id = $1 AND conversation_id = $2
              ORDER BY message_seq DESC, message_id DESC
              LIMIT 100
           ) AS latest
          ORDER BY latest.message_seq ASC, latest.message_id ASC`,
        [tenantId, conversationId],
      ) : { rows: [] }
      const deliveries = includeHistory ? await client.query<ArtifactDeliveryRow>(
        `SELECT conversation_id, artifact_id, source_asset_id, source_artifact_kind,
                source_title, source_mime, source_size_bytes, run_id, delivered_at
           FROM bff_conversation_artifact
          WHERE tenant_id = $1 AND conversation_id = $2
          ORDER BY delivered_at DESC, artifact_id ASC
          LIMIT 101`,
        [tenantId, conversationId],
      ) : { rows: [] }
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
        const start = Number(stream?.latest_run_start_sequence), watermark = Number(cursor.rows[0]?.public_sequence)
        const sourceWatermark = Number(stream?.source_high_watermark)
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(watermark) || !Number.isSafeInteger(sourceWatermark)) throw new Error("CHAT_EXECUTION_HEAD_WATERMARK_INVALID")
        const state = await readRunInteraction(client, tenantId, conversationId, executionHead.runId, subjectId, start, watermark, sourceWatermark)
        if (state?.phase === "waiting" || state?.phase === "resuming") executionHead = { runId: executionHead.runId, state: state.phase, pendingPauses: [state] }
      } else if (executionHead !== undefined) {
        const unexpected = await client.query(`SELECT 1 FROM bff_agui_run_interaction WHERE tenant_id=$1 AND session_id=$2 AND run_id=$3`, [tenantId,conversationId,executionHead.runId])
        if (unexpected.rows.length !== 0) throw new Error("CHAT_QUEUED_INTERACTION_INVALID")
      }
      await client.query("COMMIT")
      return {
        conversation: conversationFromRow(row),
        messages: messages.rows.map(messageFromRow),
        deliveries: deliveries.rows.slice(0, 100).map(artifactDeliveryFromRow),
        deliveriesHasMore: deliveries.rows.length > 100,
        eventWatermark: cursor.rows[0]?.cursor ?? null,
        ...(executionHead === undefined ? {} : { executionHead }),
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async listMessages(tenantId: string, subjectId: string, conversationId: string, limit: number, cursor: string | null, projectRef?: string): Promise<MessagePage | null> {
    const position = decodeCursor(cursor, "msg")
    if (position !== null && !("sequence" in position)) throw new Error("CHAT_CURSOR_INVALID")
    const exists = await this.database.pool.query<{ conversation_id: string }>(
      `SELECT conversation_id FROM bff_conversation
        WHERE tenant_id = $1 AND owner_id = $2 AND conversation_id = $3 AND status = 'active'
          AND (
            project_ref IS NULL
            OR EXISTS (
              SELECT 1 FROM bff_project AS project
               WHERE project.tenant_id = bff_conversation.tenant_id
                 AND project.owner_id = bff_conversation.owner_id
                 AND (project.project_id = bff_conversation.project_ref OR project.slug = bff_conversation.project_ref)
            )
          )
          AND ($4::text IS NULL OR project_ref = $4) LIMIT 1`,
      [tenantId, subjectId, conversationId, projectRef ?? null],
    )
    if (exists.rows[0] === undefined) return null
    const result = await this.database.pool.query<MessageRow>(
      `SELECT message.message_id, message.tenant_id, message.conversation_id, message.run_id,
              message.role, message.content, message.status, message.agent_failure_code, message.agent_failure_retryable, message.message_seq,
              message.created_at, message.updated_at
         FROM bff_message AS message
        WHERE message.tenant_id = $1 AND message.conversation_id = $3
          AND EXISTS (
            SELECT 1 FROM bff_conversation AS conversation
             WHERE conversation.tenant_id = message.tenant_id
               AND conversation.conversation_id = message.conversation_id
               AND conversation.owner_id = $2
               AND conversation.status = 'active'
               AND (
                 conversation.project_ref IS NULL
                 OR EXISTS (
                   SELECT 1 FROM bff_project AS project
                    WHERE project.tenant_id = conversation.tenant_id
                      AND project.owner_id = conversation.owner_id
                      AND (project.project_id = conversation.project_ref OR project.slug = conversation.project_ref)
                 )
               )
               AND ($4::text IS NULL OR conversation.project_ref = $4)
          )
          AND ($5::bigint IS NULL OR (message.message_seq, message.message_id) > ($5, $6))
        ORDER BY message.message_seq ASC, message.message_id ASC
        LIMIT $7`,
      [tenantId, subjectId, conversationId, projectRef ?? null, position?.sequence ?? null, position?.id ?? null, limit + 1],
    )
    const rows = result.rows.slice(0, limit)
    const last = result.rows.length > limit ? rows.at(-1) : undefined
    return {
      messages: rows.map(messageFromRow),
      next_cursor: last === undefined ? null : encodeCursor({ sequence: String(last.message_seq), id: last.message_id }, "msg"),
    }
  }

  public async renameConversation(tenantId: string, subjectId: string, conversationId: string, title: string, projectRef?: string): Promise<Conversation | null> {
    const result = await this.database.pool.query<ConversationRow>(
      `UPDATE bff_conversation SET title = $4, updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND owner_id = $2 AND conversation_id = $3 AND status = 'active'
          AND (
            project_ref IS NULL
            OR EXISTS (
              SELECT 1 FROM bff_project AS project
               WHERE project.tenant_id = bff_conversation.tenant_id
                 AND project.owner_id = bff_conversation.owner_id
                 AND (project.project_id = bff_conversation.project_ref OR project.slug = bff_conversation.project_ref)
            )
          )
          AND ($5::text IS NULL OR project_ref = $5)
        RETURNING ${conversationColumns}`,
      [tenantId, subjectId, conversationId, title, projectRef ?? null],
    )
    const row = result.rows[0]
    return row === undefined ? null : conversationFromRow(row)
  }

  public async deleteConversation(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    requestId: string,
    projectRef?: string,
  ): Promise<boolean> {
    if (requestId.trim() === "") throw new Error("CHAT_DELETE_REQUEST_ID_REQUIRED")
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const result = await client.query<{ conversation_id: string }>(
        `UPDATE bff_conversation SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND owner_id = $2 AND conversation_id = $3 AND status = 'active'
            AND (
              project_ref IS NULL
              OR EXISTS (
                SELECT 1 FROM bff_project AS project
                 WHERE project.tenant_id = bff_conversation.tenant_id
                   AND project.owner_id = bff_conversation.owner_id
                   AND (project.project_id = bff_conversation.project_ref OR project.slug = bff_conversation.project_ref)
              )
            )
            AND ($4::text IS NULL OR project_ref = $4) RETURNING conversation_id`,
        [tenantId, subjectId, conversationId, projectRef ?? null],
      )
      if (result.rows[0] === undefined) {
        await client.query("ROLLBACK")
        return false
      }
      await client.query(`DELETE FROM bff_agui_run_interaction WHERE tenant_id=$1 AND session_id=$2`, [tenantId, conversationId])
      await client.query(
        `DELETE FROM bff_conversation_artifact
          WHERE tenant_id = $1 AND conversation_id = $2`,
        [tenantId, conversationId],
      )
      await client.query(
        `UPDATE bff_share SET revoked_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND conversation_id = $3 AND revoked_at IS NULL
            AND EXISTS (
              SELECT 1 FROM bff_conversation AS conversation
               WHERE conversation.tenant_id = bff_share.tenant_id
                 AND conversation.conversation_id = bff_share.conversation_id
                 AND conversation.owner_id = $2
            )`,
        [tenantId, subjectId, conversationId],
      )
      await client.query(
        `UPDATE bff_agui_stream
            SET consumer_state = 'stopped',
                consumer_fence = consumer_fence + 1,
                consumer_lease_owner = NULL,
                consumer_lease_token = NULL,
                consumer_lease_until = NULL,
                consumer_last_error_code = 'conversation_deleted',
                consumer_last_error_at = CURRENT_TIMESTAMP(3),
                updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND session_id = $3 AND consumer_subject_id = $2`,
        [tenantId, subjectId, conversationId],
      )
      await client.query(
        `INSERT INTO bff_agent_cancellation_outbox
          (cancellation_id, tenant_id, conversation_id, conversation_dispatch_seq, run_id,
           subject_id, actor_id, request_id, command_id, identity_assertion_ref, payload,
           status, attempt_count, available_at, fence)
         SELECT 'cancel_' || dispatch.outbox_id,
                dispatch.tenant_id,
                dispatch.conversation_id,
                dispatch.conversation_dispatch_seq,
                dispatch.run_id,
                dispatch.subject_id,
                $2,
                $4,
                'cancel_' || dispatch.outbox_id,
                dispatch.identity_assertion_ref,
                jsonb_build_object('kind', 'run.cancel', 'session_id', dispatch.conversation_id),
                'cancel_requested', 0, CURRENT_TIMESTAMP(3), 0
           FROM bff_agent_dispatch_outbox AS dispatch
          WHERE dispatch.tenant_id = $1
            AND dispatch.subject_id = $2
            AND dispatch.conversation_id = $3
            AND dispatch.attempt_count > 0
         ON CONFLICT (tenant_id, run_id) DO NOTHING`,
        [tenantId, subjectId, conversationId, requestId],
      )
      await client.query(
        `UPDATE bff_agent_dispatch_outbox
            SET status = 'retryable', admission_unknown_seen = TRUE,
                last_error_code = 'conversation_deleted', last_error_at = CURRENT_TIMESTAMP(3),
                lease_owner = NULL, lease_token = NULL, lease_until = NULL,
                fence = fence + 1, updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND subject_id = $2 AND conversation_id = $3
            AND status IN ('leased', 'retryable') AND attempt_count > 0`,
        [tenantId, subjectId, conversationId],
      )
      await client.query(
        `UPDATE bff_agent_dispatch_outbox
            SET status = 'failed', completed_at = CURRENT_TIMESTAMP(3),
                last_error_code = 'conversation_deleted', last_error_at = CURRENT_TIMESTAMP(3),
                lease_owner = NULL, lease_token = NULL, lease_until = NULL,
                fence = fence + 1, updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND subject_id = $2 AND conversation_id = $3
            AND status IN ('pending', 'retryable', 'leased')
            AND attempt_count = 0 AND admission_unknown_seen = FALSE`,
        [tenantId, subjectId, conversationId],
      )
      await client.query(
        `UPDATE bff_message
            SET status = 'failed', agent_failure_code = NULL, agent_failure_retryable = NULL,
                updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND conversation_id = $3
            AND role = 'assistant' AND status IN ('pending', 'streaming')
            AND EXISTS (
              SELECT 1 FROM bff_conversation AS conversation
               WHERE conversation.tenant_id = bff_message.tenant_id
                 AND conversation.conversation_id = bff_message.conversation_id
                 AND conversation.owner_id = $2
            )`,
        [tenantId, subjectId, conversationId],
      )
      await client.query("COMMIT")
      return true
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async createShare(tenantId: string, subjectId: string, conversationId: string, projectRef?: string): Promise<Share | null> {
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const conversation = await client.query<{ conversation_id: string }>(
        `SELECT conversation_id FROM bff_conversation
          WHERE tenant_id = $1 AND owner_id = $2 AND conversation_id = $3 AND status = 'active'
            AND (
              project_ref IS NULL
              OR EXISTS (
                SELECT 1 FROM bff_project AS project
                 WHERE project.tenant_id = bff_conversation.tenant_id
                   AND project.owner_id = bff_conversation.owner_id
                   AND (project.project_id = bff_conversation.project_ref OR project.slug = bff_conversation.project_ref)
              )
            )
            AND ($4::text IS NULL OR project_ref = $4) FOR UPDATE`,
        [tenantId, subjectId, conversationId, projectRef ?? null],
      )
      if (conversation.rows[0] === undefined) {
        await client.query("ROLLBACK")
        return null
      }
      const existing = await client.query<ShareRow>(
        `SELECT ${shareColumns} FROM bff_share
          WHERE tenant_id = $1 AND conversation_id = $3 AND revoked_at IS NULL
            AND EXISTS (
              SELECT 1 FROM bff_conversation AS conversation
               WHERE conversation.tenant_id = bff_share.tenant_id
                 AND conversation.conversation_id = bff_share.conversation_id
                 AND conversation.owner_id = $2
            )
            AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))
          LIMIT 1`,
        [tenantId, subjectId, conversationId],
      )
      if (existing.rows[0] !== undefined) {
        await client.query("COMMIT")
        return shareFromRow(existing.rows[0])
      }
      // Expired shares are retained for audit/retention, but are no longer
      // active. Revoke them inside the conversation lock before the partial
      // unique index is checked for the replacement share.
      await client.query(
        `UPDATE bff_share SET revoked_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND conversation_id = $3 AND revoked_at IS NULL
            AND EXISTS (
              SELECT 1 FROM bff_conversation AS conversation
               WHERE conversation.tenant_id = bff_share.tenant_id
                 AND conversation.conversation_id = bff_share.conversation_id
                 AND conversation.owner_id = $2
            )
            AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP(3)`,
        [tenantId, subjectId, conversationId],
      )
      const shareId = `shr_${randomUUID().replaceAll("-", "")}`
      const inserted = await client.query<ShareRow>(
        `INSERT INTO bff_share (share_id, tenant_id, conversation_id, url)
         VALUES ($1, $2, $3, $4) RETURNING ${shareColumns}`,
        [shareId, tenantId, conversationId, `/v1/shared/${shareId}`],
      )
      await client.query("COMMIT")
      const row = inserted.rows[0]
      if (row === undefined) throw new Error("CHAT_SHARE_INSERT_RETURNED_NO_ROW")
      return shareFromRow(row)
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async revokeShare(tenantId: string, subjectId: string, conversationId: string, projectRef?: string): Promise<Share | null> {
    const result = await this.database.pool.query<ShareRow>(
      `UPDATE bff_share SET revoked_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND conversation_id = $3 AND revoked_at IS NULL
          AND EXISTS (
            SELECT 1 FROM bff_conversation AS conversation
             WHERE conversation.tenant_id = bff_share.tenant_id
               AND conversation.conversation_id = bff_share.conversation_id
               AND conversation.owner_id = $2
               AND conversation.status = 'active'
               AND (
                 conversation.project_ref IS NULL
                 OR EXISTS (
                   SELECT 1 FROM bff_project AS project
                    WHERE project.tenant_id = conversation.tenant_id
                      AND project.owner_id = conversation.owner_id
                      AND (project.project_id = conversation.project_ref OR project.slug = conversation.project_ref)
                 )
               )
               AND ($4::text IS NULL OR conversation.project_ref = $4)
          )
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))
        RETURNING ${shareColumns}`,
      [tenantId, subjectId, conversationId, projectRef ?? null],
    )
    const row = result.rows[0]
    return row === undefined ? null : shareFromRow(row)
  }

}
