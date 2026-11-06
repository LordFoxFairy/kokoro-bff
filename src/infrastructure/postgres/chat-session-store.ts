import { readChatComposerSelection } from "./chat-composer-selection.js"
import { readOwnedConversationSnapshotRow } from "./chat-conversation-lookup.js"
import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import type { MessagePartsPage } from "../../contracts/chat.js"
import type { MessagePartsQuery, PrivateMessageReadContext, PrivateMessagePage } from "../../application/chat/types.js"
import { withMessageReadClient, messageReadLifetime, privateMessagesFromRows, readMessageParts, type PrivateMessageRow } from "./message-parts-read.js"

import type { ChatArtifactDelivery, ChatSnapshot, ConversationCollectionFilter, ConversationPage } from "../../application/chat/types.js"
import type { Conversation } from "../../domain/chat/conversation.js"
import type { Share } from "../../domain/chat/share.js"
import type { PostgresBffDatabase } from "./client.js"
import { deleteLockedConversationFacts } from "./conversation-delete.js"
import {
  conversationColumns,
  conversationFromRow,
  decodeCursor,
  encodeCursor,
  instant,
  shareColumns,
  shareFromRow,
  type ConversationRow,
  type ShareRow,
} from "./chat-repository-mappers.js"
import { readAgUiSnapshotState } from "./agui-run-state-read.js"

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

export class PostgresChatSessionStore {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async listConversations(
    tenantId: string,
    subjectId: string,
    filter: ConversationCollectionFilter,
    limit: number,
    cursor: string | null,
  ): Promise<ConversationPage> {
    const position = decodeCursor(cursor, "conv")
    if (position !== null && !("timestamp" in position)) throw new Error("CHAT_CURSOR_INVALID")
    const collectionPredicate =
      filter.kind === "all" ? "$3::text IS NULL" : filter.kind === "direct" ? "$3::text IS NULL AND project_ref IS NULL" : "project_ref = $3::text"
    const projectRef = filter.kind === "project" ? filter.projectRef : null
    const result = await this.database.pool.query<ConversationRow>(
      `SELECT ${conversationColumns}
         FROM bff_conversation
        WHERE tenant_id = $1
          AND owner_id = $2
          AND status = 'active' AND archived_at IS NULL
          AND (
            project_ref IS NULL
            OR EXISTS (
              SELECT 1 FROM bff_project AS project
               WHERE project.deleted_at IS NULL AND project.tenant_id = bff_conversation.tenant_id
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

  public async readSnapshot(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    projectRef: string | undefined,
    context?: PrivateMessageReadContext,
  ): Promise<ChatSnapshot | null> {
    context ??= { ...messageReadLifetime(), scope: "all" }
    const scope = context.scope
    if (scope === "direct" && projectRef !== undefined) throw new Error("MESSAGE_PARTS_SCOPE_INVALID")
    const read = async (client: PoolClient): Promise<ChatSnapshot | null> => {
      const row = await readOwnedConversationSnapshotRow(client, tenantId, subjectId, conversationId, projectRef, scope === "direct")
      if (row === undefined) {
        return null
      }
      const composerSelection = await readChatComposerSelection(client, tenantId, subjectId, conversationId)
      const messages = await client.query<PrivateMessageRow>(
        `SELECT latest.origin,latest.regenerated_from_message_id,latest.regeneration_user_message_id,latest.message_id, latest.tenant_id, latest.conversation_id, latest.run_id,
                latest.role, latest.selected_skill_source_refs, latest.content, latest.parts_format_version, latest.parts_public_sequence, latest.final_segment_id, latest.parts_count, latest.status, latest.agent_failure_code, latest.agent_failure_retryable, latest.message_seq,
                latest.created_at, latest.updated_at
           FROM (
             SELECT origin,regenerated_from_message_id,regeneration_user_message_id,message_id, tenant_id, conversation_id, run_id, role, selected_skill_source_refs,
                    CASE WHEN ordered_parts IS NULL THEN content ELSE NULL END AS content, parts_format_version, parts_public_sequence, final_segment_id,
                    CASE WHEN ordered_parts IS NOT NULL THEN jsonb_array_length(ordered_parts) END AS parts_count, status, agent_failure_code, agent_failure_retryable,
                    message_seq, created_at, updated_at
               FROM bff_message
              WHERE tenant_id = $1 AND conversation_id = $2 AND origin <> 'regeneration_input'
              ORDER BY message_seq DESC, message_id DESC
              LIMIT 100
           ) AS latest
          ORDER BY latest.message_seq ASC, latest.message_id ASC`,
        [tenantId, conversationId],
      )
      const deliveries = await client.query<ArtifactDeliveryRow>(
        `SELECT conversation_id, artifact_id, source_asset_id, source_artifact_kind,
                source_title, source_mime, source_size_bytes, run_id, delivered_at
           FROM bff_conversation_artifact
          WHERE tenant_id = $1 AND conversation_id = $2
          ORDER BY delivered_at DESC, artifact_id ASC
          LIMIT 101`,
        [tenantId, conversationId],
      )
      const { watermark, processPage, executionHead } = await readAgUiSnapshotState(client, tenantId, subjectId, conversationId, true)
      return {
        conversation: conversationFromRow(row),
        ...(composerSelection === undefined ? {} : { composerSelection }),
        messages: await privateMessagesFromRows(
          client,
          messages.rows,
          { tenantId, subjectId, conversationId, projectRef: row.project_ref, requestedProjectRef: projectRef ?? null, scope },
          watermark,
          processPage?.run_id ?? null,
          [...messages.rows].reverse().find((message) => message.role === "assistant")?.message_id ?? null,
        ),
        deliveries: deliveries.rows.slice(0, 100).map(artifactDeliveryFromRow),
        deliveriesHasMore: deliveries.rows.length > 100,
        eventWatermark: watermark,
        executionProcess:
          processPage === null
            ? null
            : {
                run_id: processPage.run_id,
                todos: processPage.todos,
                activities: processPage.activities,
                next_cursor: processPage.next_cursor,
              },
        ...(executionHead === undefined ? {} : { executionHead }),
      }
    }
    return withMessageReadClient(this.database.pool, messageReadLifetime(context), read)
  }

  public readMessageParts(query: MessagePartsQuery): Promise<MessagePartsPage | null> {
    return readMessageParts(this.database.pool, query)
  }

  public async listMessages(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    limit: number,
    cursor: string | null,
    projectRef?: string,
    context?: PrivateMessageReadContext,
  ): Promise<PrivateMessagePage | null> {
    if (context?.scope === "direct" && projectRef !== undefined) throw new Error("MESSAGE_PARTS_SCOPE_INVALID")
    const position = decodeCursor(cursor, "msg")
    if (position !== null && !("sequence" in position)) throw new Error("CHAT_CURSOR_INVALID")
    return withMessageReadClient(this.database.pool, messageReadLifetime(context), async (client) => {
      const exists = await client.query<{ conversation_id: string; project_ref: string | null }>(
        `SELECT conversation_id,project_ref FROM bff_conversation
        WHERE tenant_id = $1 AND owner_id = $2 AND conversation_id = $3 AND status = 'active'
          AND (
            project_ref IS NULL
            OR EXISTS (
              SELECT 1 FROM bff_project AS project
               WHERE project.deleted_at IS NULL AND project.tenant_id = bff_conversation.tenant_id
                 AND project.owner_id = bff_conversation.owner_id
                 AND (project.project_id = bff_conversation.project_ref OR project.slug = bff_conversation.project_ref)
            )
          )
          AND ($4::text IS NULL OR project_ref = $4) AND ($5::boolean=FALSE OR project_ref IS NULL) LIMIT 1`,
        [tenantId, subjectId, conversationId, projectRef ?? null, context?.scope === "direct"],
      )
      if (exists.rows[0] === undefined) return null
      const result = await client.query<PrivateMessageRow>(
        `SELECT message.origin,message.regenerated_from_message_id,message.regeneration_user_message_id,message.message_id, message.tenant_id, message.conversation_id, message.run_id,
              message.role, message.selected_skill_source_refs, CASE WHEN message.ordered_parts IS NULL THEN message.content ELSE NULL END AS content,
              message.parts_format_version,message.parts_public_sequence,message.final_segment_id,CASE WHEN message.ordered_parts IS NOT NULL THEN jsonb_array_length(message.ordered_parts) END AS parts_count,message.status, message.agent_failure_code, message.agent_failure_retryable, message.message_seq,
              message.created_at, message.updated_at
         FROM bff_message AS message
        WHERE message.tenant_id = $1 AND message.conversation_id = $3 AND message.origin <> 'regeneration_input'
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
                    WHERE project.deleted_at IS NULL AND project.tenant_id = conversation.tenant_id
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
      const head =
        (
          await client.query<{ cursor: string }>(
            "SELECT cursor FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 ORDER BY public_sequence DESC LIMIT 1",
            [tenantId, conversationId],
          )
        ).rows[0]?.cursor ?? null
      const selected = (
        await client.query<{ run_id: string | null; message_id: string | null }>(
          `SELECT stream.latest_run_id AS run_id,(SELECT message_id FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2 AND role='assistant' ORDER BY message_seq DESC,message_id DESC LIMIT 1) AS message_id FROM bff_agui_stream stream WHERE stream.tenant_id=$1 AND stream.session_id=$2 AND stream.consumer_subject_id=$3`,
          [tenantId, conversationId, subjectId],
        )
      ).rows[0]
      return {
        messages: await privateMessagesFromRows(
          client,
          rows,
          {
            tenantId,
            subjectId,
            conversationId,
            projectRef: exists.rows[0].project_ref,
            requestedProjectRef: projectRef ?? null,
            scope: context?.scope ?? "all",
          },
          head,
          selected?.run_id ?? null,
          selected?.message_id ?? null,
        ),
        next_cursor: last === undefined ? null : encodeCursor({ sequence: String(last.message_seq), id: last.message_id }, "msg"),
      }
    })
  }

  public async renameConversation(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    title: string,
    projectRef?: string,
  ): Promise<Conversation | null> {
    const result = await this.database.pool.query<ConversationRow>(
      `UPDATE bff_conversation SET title = $4, updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND owner_id = $2 AND conversation_id = $3 AND status = 'active'
          AND (
            project_ref IS NULL
            OR EXISTS (
              SELECT 1 FROM bff_project AS project
               WHERE project.deleted_at IS NULL AND project.tenant_id = bff_conversation.tenant_id
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

  public async deleteConversation(tenantId: string, subjectId: string, conversationId: string, requestId: string, projectRef?: string): Promise<boolean> {
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
                 WHERE project.deleted_at IS NULL AND project.tenant_id = bff_conversation.tenant_id
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
      await deleteLockedConversationFacts(client, tenantId, subjectId, conversationId, requestId)
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
                 WHERE project.deleted_at IS NULL AND project.tenant_id = bff_conversation.tenant_id
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
          WHERE tenant_id = $1 AND conversation_id = $3 AND resource_kind = 'conversation' AND revoked_at IS NULL
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
          WHERE tenant_id = $1 AND conversation_id = $3 AND resource_kind = 'conversation' AND revoked_at IS NULL
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
        `INSERT INTO bff_share (share_id, tenant_id, resource_kind, conversation_id, url)
         VALUES ($1, $2, 'conversation', $3, $4) RETURNING ${shareColumns}`,
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
        WHERE tenant_id = $1 AND conversation_id = $3 AND resource_kind = 'conversation' AND revoked_at IS NULL
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
                    WHERE project.deleted_at IS NULL AND project.tenant_id = conversation.tenant_id
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

export function createChatSessionMutations(store: PostgresChatSessionStore) {
  return {
    renameConversation: store.renameConversation.bind(store),
    deleteConversation: store.deleteConversation.bind(store),
    createShare: store.createShare.bind(store),
    revokeShare: store.revokeShare.bind(store),
  }
}

export type ChatSessionMutations = ReturnType<typeof createChatSessionMutations>
