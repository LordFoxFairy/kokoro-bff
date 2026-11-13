import { projectMessageRegeneration } from "./message-regeneration.js"
import type { MessageReadLifetime } from "../../application/chat/types.js"
import { projectReadPredicate } from "./project-access.js"
import type { ShareMetadataQuery, ShareMetadataRead } from "../../application/chat/types.js"
import { readChatComposerSelection } from "./chat-composer-selection.js"
import { readCurrentConversation } from "./chat-conversation-access.js"
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
import { enqueueStorageScopeRelease } from "./project-scope-release-outbox-repository.js"
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
  source_asset_id: string | null
  source_artifact_kind: string
  source_title: string
  source_mime: string
  source_size_bytes: string
  source_display_path: string | null
  run_id: string
  delivered_at: Date | string
}

function artifactDeliveryFromRow(row: ArtifactDeliveryRow): ChatArtifactDelivery {
  const size = Number(row.source_size_bytes)
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("CHAT_ARTIFACT_SIZE_INVALID")
  return {
    conversationId: row.conversation_id,
    artifactId: row.artifact_id,
    ...(row.source_asset_id === null ? {} : { assetId: row.source_asset_id }),
    artifactKind: row.source_artifact_kind,
    title: row.source_title,
    mime: row.source_mime,
    size,
    runId: row.run_id,
    deliveredAt: instant(row.delivered_at),
    ...(row.source_display_path === null ? {} : { displayPath: row.source_display_path }),
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
    lifetime?: MessageReadLifetime,
  ): Promise<ConversationPage> {
    const position = decodeCursor(cursor, "conv")
    if (position !== null && !("timestamp" in position)) throw new Error("CHAT_CURSOR_INVALID")
    const collectionPredicate =
      filter.kind === "all"
        ? "$3::text IS NULL"
        : filter.kind === "direct"
          ? "$3::text IS NULL AND project_ref IS NULL"
          : "EXISTS(SELECT 1 FROM bff_project WHERE bff_project.tenant_id=bff_conversation.tenant_id AND bff_project.project_id=$3 AND (bff_project.project_id=bff_conversation.project_ref OR (bff_project.owner_id=bff_conversation.owner_id AND bff_project.slug=bff_conversation.project_ref)))"
    const projectRef = filter.kind === "project" ? filter.projectRef : null
    const result = await withMessageReadClient(this.database.pool, messageReadLifetime(lifetime), (client) =>
      client.query<ConversationRow>(
        `SELECT ${conversationColumns}
         FROM bff_conversation
        WHERE tenant_id = $1
          AND status = 'active' AND (owner_id<>$2 OR archived_at IS NULL)
          AND (
            (project_ref IS NULL AND owner_id=$2)
            OR EXISTS (
              SELECT 1 FROM bff_project WHERE bff_project.deleted_at IS NULL AND bff_project.tenant_id=bff_conversation.tenant_id
                AND (bff_project.project_id=bff_conversation.project_ref OR (bff_project.owner_id=bff_conversation.owner_id AND bff_project.slug=bff_conversation.project_ref))
                AND ${projectReadPredicate}
            )
          )
          AND (${collectionPredicate})
          AND ($4::timestamptz IS NULL OR updated_at < $4 OR (updated_at = $4 AND conversation_id > $5))
        ORDER BY updated_at DESC, conversation_id ASC
        LIMIT $6`,
        [tenantId, subjectId, projectRef ?? null, position?.timestamp ?? null, position?.id ?? null, limit + 1],
      ),
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
      const readable = await readCurrentConversation(client, tenantId, subjectId, conversationId, projectRef, scope === "direct")
      if (!readable) return null
      context?.onProjectRead?.(readable.projectAccess)
      const row = readable.conversation
      const projectView = readable.projectAccess !== null
      const composerSelection = await readChatComposerSelection(client, tenantId, subjectId, conversationId)
      const messages = await client.query<PrivateMessageRow>(
        `SELECT latest.origin,latest.regenerated_from_message_id,latest.regeneration_user_message_id,latest.message_id,latest.tenant_id,latest.conversation_id,latest.run_id,
          latest.role,latest.selected_skill_source_refs,latest.content,latest.parts_format_version,latest.parts_public_sequence,latest.final_segment_id,latest.parts_count,
          latest.status,latest.agent_failure_code,latest.agent_failure_retryable,latest.message_seq,latest.created_at,latest.updated_at,latest.project_shared
         FROM (
           SELECT message.origin,message.regenerated_from_message_id,message.regeneration_user_message_id,message.message_id,message.tenant_id,message.conversation_id,message.run_id,
             message.role,CASE WHEN $3::boolean AND NOT ($6::boolean AND COALESCE(dispatch.subject_id=$4 AND dispatch.actor_id=$4,$5::boolean))
               THEN '[]'::jsonb ELSE message.selected_skill_source_refs END AS selected_skill_source_refs,
             CASE WHEN message.ordered_parts IS NULL THEN message.content END AS content,message.parts_format_version,message.parts_public_sequence,message.final_segment_id,
             CASE WHEN message.ordered_parts IS NOT NULL THEN CASE WHEN $3::boolean AND NOT ($6::boolean AND COALESCE(dispatch.subject_id=$4 AND dispatch.actor_id=$4,$5::boolean))
               THEN (SELECT count(*)::int FROM jsonb_array_elements(message.ordered_parts) part WHERE part->>'kind'='text' AND part->>'segment_id'=message.final_segment_id AND part->'completed'='true'::jsonb)
               ELSE jsonb_array_length(message.ordered_parts) END END AS parts_count,
             message.status,message.agent_failure_code,message.agent_failure_retryable,message.message_seq,message.created_at,message.updated_at,
             ($3::boolean AND NOT ($6::boolean AND COALESCE(dispatch.subject_id=$4 AND dispatch.actor_id=$4,$5::boolean))) AS project_shared
           FROM bff_message message LEFT JOIN bff_agent_dispatch_outbox dispatch ON dispatch.tenant_id=message.tenant_id AND dispatch.conversation_id=message.conversation_id
             AND dispatch.run_id=message.run_id AND ((message.role='user' AND dispatch.user_message_id=message.message_id) OR (message.role='assistant' AND dispatch.assistant_message_id=message.message_id))
           WHERE message.tenant_id=$1 AND message.conversation_id=$2 AND message.origin<>'regeneration_input'
             AND (NOT $3::boolean OR ($6::boolean AND COALESCE(dispatch.subject_id=$4 AND dispatch.actor_id=$4,$5::boolean)) OR message.role='user'
               OR (message.status='completed' AND message.final_segment_id IS NOT NULL AND message.parts_format_version=1))
           ORDER BY message.message_seq DESC,message.message_id DESC LIMIT 100
         ) latest ORDER BY latest.message_seq ASC,latest.message_id ASC`,
        [tenantId, conversationId, projectView, subjectId, row.owner_id === subjectId, readable.projectAccess?.capabilities.includes("edit") ?? true],
      )
      const deliveries = await client.query<ArtifactDeliveryRow>(
        `SELECT artifact.conversation_id,artifact.artifact_id,
           CASE WHEN $3::boolean AND NOT COALESCE(dispatch.subject_id=$4 AND dispatch.actor_id=$4,$5::boolean) THEN NULL ELSE artifact.source_asset_id END AS source_asset_id,
           artifact.source_artifact_kind,artifact.source_title,artifact.source_mime,artifact.source_size_bytes,
           CASE WHEN $3::boolean AND NOT COALESCE(dispatch.subject_id=$4 AND dispatch.actor_id=$4,$5::boolean) THEN NULL ELSE artifact.source_display_path END AS source_display_path,
           artifact.run_id,artifact.delivered_at
         FROM bff_conversation_artifact artifact LEFT JOIN bff_agent_dispatch_outbox dispatch ON dispatch.tenant_id=artifact.tenant_id
           AND dispatch.conversation_id=artifact.conversation_id AND dispatch.run_id=artifact.run_id
         WHERE artifact.tenant_id=$1 AND artifact.conversation_id=$2 AND (NOT $3::boolean OR artifact.source_owner='kokoro-agent')
         ORDER BY artifact.delivered_at DESC,artifact.artifact_id ASC LIMIT 101`,
        [tenantId, conversationId, projectView, subjectId, row.owner_id === subjectId],
      )
      const { watermark, processPage, executionHead } = await readAgUiSnapshotState(
        client,
        tenantId,
        subjectId,
        conversationId,
        true,
        projectView,
        readable.projectAccess?.capabilities.includes("edit") ?? true,
      )
      const visibleMessages = await privateMessagesFromRows(
        client,
        messages.rows,
        { tenantId, subjectId, conversationId, projectRef: row.project_ref, requestedProjectRef: projectRef ?? null, scope },
        watermark,
        processPage?.run_id ?? null,
        [...messages.rows].reverse().find((message) => message.role === "assistant")?.message_id ?? null,
      )
      const messagesWithControls = projectView
        ? await projectMessageRegeneration(client, { tenantId, subjectId, conversationId }, visibleMessages)
        : visibleMessages
      return {
        ...(readable.projectAccess === null ? {} : { projectAccess: readable.projectAccess }),
        conversation: conversationFromRow(row),
        ...(composerSelection === undefined ? {} : { composerSelection }),
        messages: messagesWithControls,
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
      const readable = await readCurrentConversation(client, tenantId, subjectId, conversationId, projectRef, context?.scope === "direct")
      if (!readable) return null
      context?.onProjectRead?.(readable.projectAccess)
      const result = await client.query<PrivateMessageRow>(
        `SELECT message.origin,message.regenerated_from_message_id,message.regeneration_user_message_id,message.message_id,message.tenant_id,message.conversation_id,message.run_id,
           message.role,CASE WHEN $7::boolean AND NOT ($9::boolean AND COALESCE(dispatch.subject_id=$2 AND dispatch.actor_id=$2,$8::boolean))
             THEN '[]'::jsonb ELSE message.selected_skill_source_refs END AS selected_skill_source_refs,
           CASE WHEN message.ordered_parts IS NULL THEN message.content END AS content,message.parts_format_version,message.parts_public_sequence,message.final_segment_id,
           CASE WHEN message.ordered_parts IS NOT NULL THEN CASE WHEN $7::boolean AND NOT ($9::boolean AND COALESCE(dispatch.subject_id=$2 AND dispatch.actor_id=$2,$8::boolean))
             THEN (SELECT count(*)::int FROM jsonb_array_elements(message.ordered_parts) part WHERE part->>'kind'='text' AND part->>'segment_id'=message.final_segment_id AND part->'completed'='true'::jsonb)
             ELSE jsonb_array_length(message.ordered_parts) END END AS parts_count,
           message.status,message.agent_failure_code,message.agent_failure_retryable,message.message_seq,message.created_at,message.updated_at,
           ($7::boolean AND NOT ($9::boolean AND COALESCE(dispatch.subject_id=$2 AND dispatch.actor_id=$2,$8::boolean))) AS project_shared
         FROM bff_message message LEFT JOIN bff_agent_dispatch_outbox dispatch ON dispatch.tenant_id=message.tenant_id AND dispatch.conversation_id=message.conversation_id
           AND dispatch.run_id=message.run_id AND ((message.role='user' AND dispatch.user_message_id=message.message_id) OR (message.role='assistant' AND dispatch.assistant_message_id=message.message_id))
         WHERE message.tenant_id=$1 AND message.conversation_id=$3 AND message.origin<>'regeneration_input'
           AND (NOT $7::boolean OR ($9::boolean AND COALESCE(dispatch.subject_id=$2 AND dispatch.actor_id=$2,$8::boolean)) OR message.role='user'
             OR (message.status='completed' AND message.final_segment_id IS NOT NULL AND message.parts_format_version=1))
           AND ($4::bigint IS NULL OR (message.message_seq,message.message_id)>($4::bigint,$5::text))
         ORDER BY message.message_seq ASC,message.message_id ASC LIMIT $6`,
        [
          tenantId,
          subjectId,
          conversationId,
          position?.sequence ?? null,
          position?.id ?? null,
          limit + 1,
          readable.projectAccess !== null,
          readable.conversation.owner_id === subjectId,
          readable.projectAccess?.capabilities.includes("edit") ?? true,
        ],
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
      const visibleMessages = await privateMessagesFromRows(
        client,
        rows,
        {
          tenantId,
          subjectId,
          conversationId,
          projectRef: readable.conversation.project_ref,
          requestedProjectRef: projectRef ?? null,
          scope: context?.scope ?? "all",
        },
        head,
        selected?.run_id ?? null,
        selected?.message_id ?? null,
      )
      const messagesWithControls = readable.projectAccess
        ? await projectMessageRegeneration(client, { tenantId, subjectId, conversationId }, visibleMessages)
        : visibleMessages
      return {
        messages: messagesWithControls,
        ...(readable.projectAccess ? { projectAccess: readable.projectAccess } : {}),
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
      await enqueueStorageScopeRelease(client, { tenantId, subjectId }, null, "conversation_workspace", conversationId)
      await client.query("COMMIT")
      return true
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async readShareMetadata(query: ShareMetadataQuery): Promise<ShareMetadataRead | null> {
    return withMessageReadClient(this.database.pool, query, async (client) => {
      const result = await client.query<{
        share_id: string | null
        created_at: Date | string | null
        expires_at: Date | string | null
      }>(
        `SELECT s.share_id,s.created_at,s.expires_at
           FROM bff_conversation c
           LEFT JOIN bff_share s ON s.tenant_id=c.tenant_id AND s.conversation_id=c.conversation_id
             AND s.resource_kind='conversation' AND s.revoked_at IS NULL
             AND (s.expires_at IS NULL OR s.expires_at > statement_timestamp())
          WHERE c.tenant_id=$1 AND c.owner_id=$2 AND c.conversation_id=$3 AND c.status='active'
            AND ($4::text IS NULL OR c.project_ref=$4)
            AND ($5::text='all' OR c.project_ref IS NULL)
            AND (c.project_ref IS NULL OR EXISTS (
              SELECT 1 FROM bff_project p WHERE p.tenant_id=c.tenant_id AND p.owner_id=c.owner_id
                AND (p.project_id=c.project_ref OR p.slug=c.project_ref) AND p.deleted_at IS NULL))`,
        [query.tenantId, query.subjectId, query.conversationId, query.projectRef ?? null, query.scope],
      )
      if (result.rows.length === 0) return null
      if (result.rows.length !== 1) throw new Error("SHARE_METADATA_INVALID")
      const row = result.rows[0]!
      if (row.share_id === null) {
        if (row.created_at !== null || row.expires_at !== null) throw new Error("SHARE_METADATA_INVALID")
        return { share: null }
      }
      if (typeof row.share_id !== "string" || row.share_id.trim() === "" || row.created_at === null) throw new Error("SHARE_METADATA_INVALID")
      return {
        share: {
          share_id: row.share_id,
          created_at: instant(row.created_at).toISOString(),
          expires_at: row.expires_at === null ? null : instant(row.expires_at).toISOString(),
        },
      }
    })
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
