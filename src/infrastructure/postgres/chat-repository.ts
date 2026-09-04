import { randomUUID } from "node:crypto"

import type { ChatRepository, ConversationPage, MessagePage } from "../../application/ports/chat-repository.js"
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

export class PostgresChatRepository implements ChatRepository {
  private readonly database: PostgresBffDatabase

  public constructor(database: PostgresBffDatabase) {
    this.database = database
  }

  public async listConversations(tenantId: string, subjectId: string, projectRef: string | undefined, limit: number, cursor: string | null): Promise<ConversationPage> {
    const position = decodeCursor(cursor, "conv")
    if (position !== null && !("timestamp" in position)) throw new Error("CHAT_CURSOR_INVALID")
    const result = await this.database.pool.query<ConversationRow>(
      `SELECT ${conversationColumns}
         FROM bff_conversation
        WHERE tenant_id = $1
          AND owner_id = $2
          AND status = 'active'
          AND ($3::text IS NULL OR project_ref = $3)
          AND ($4::timestamptz IS NULL OR (updated_at, conversation_id) < ($4, $5))
        ORDER BY updated_at DESC, conversation_id ASC
        LIMIT $6`,
      [tenantId, subjectId, projectRef ?? null, position?.timestamp ?? null, position?.id ?? null, limit + 1],
    )
    const rows = result.rows.slice(0, limit)
    const last = rows.length === limit ? rows.at(-1) : undefined
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
          AND ($4::text IS NULL OR project_ref = $4)
        LIMIT 1`,
      [tenantId, subjectId, conversationId, projectRef ?? null],
    )
    const row = result.rows[0]
    return row === undefined ? null : conversationFromRow(row)
  }

  public async listMessages(tenantId: string, subjectId: string, conversationId: string, limit: number, cursor: string | null, projectRef?: string): Promise<MessagePage | null> {
    const position = decodeCursor(cursor, "msg")
    if (position !== null && !("sequence" in position)) throw new Error("CHAT_CURSOR_INVALID")
    const exists = await this.database.pool.query<{ conversation_id: string }>(
      `SELECT conversation_id FROM bff_conversation
        WHERE tenant_id = $1 AND owner_id = $2 AND conversation_id = $3 AND status = 'active'
          AND ($4::text IS NULL OR project_ref = $4) LIMIT 1`,
      [tenantId, subjectId, conversationId, projectRef ?? null],
    )
    if (exists.rows[0] === undefined) return null
    const result = await this.database.pool.query<MessageRow>(
      `SELECT message.message_id, message.tenant_id, message.conversation_id, message.run_id,
              message.role, message.content, message.status, message.message_seq,
              message.created_at, message.updated_at
         FROM bff_message AS message
        WHERE message.tenant_id = $1 AND message.conversation_id = $3
          AND EXISTS (
            SELECT 1 FROM bff_conversation AS conversation
             WHERE conversation.tenant_id = message.tenant_id
               AND conversation.conversation_id = message.conversation_id
               AND conversation.owner_id = $2
               AND conversation.status = 'active'
               AND ($4::text IS NULL OR conversation.project_ref = $4)
          )
          AND ($5::bigint IS NULL OR (message.message_seq, message.message_id) > ($5, $6))
        ORDER BY message.message_seq ASC, message.message_id ASC
        LIMIT $7`,
      [tenantId, subjectId, conversationId, projectRef ?? null, position?.sequence ?? null, position?.id ?? null, limit + 1],
    )
    const rows = result.rows.slice(0, limit)
    const last = rows.length === limit ? rows.at(-1) : undefined
    return {
      messages: rows.map(messageFromRow),
      next_cursor: last === undefined ? null : encodeCursor({ sequence: String(last.message_seq), id: last.message_id }, "msg"),
    }
  }

  public async renameConversation(tenantId: string, subjectId: string, conversationId: string, title: string, projectRef?: string): Promise<Conversation | null> {
    const result = await this.database.pool.query<ConversationRow>(
      `UPDATE bff_conversation SET title = $4, updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND owner_id = $2 AND conversation_id = $3 AND status = 'active'
          AND ($5::text IS NULL OR project_ref = $5)
        RETURNING ${conversationColumns}`,
      [tenantId, subjectId, conversationId, title, projectRef ?? null],
    )
    const row = result.rows[0]
    return row === undefined ? null : conversationFromRow(row)
  }

  public async deleteConversation(tenantId: string, subjectId: string, conversationId: string, projectRef?: string): Promise<boolean> {
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const result = await client.query<{ conversation_id: string }>(
        `UPDATE bff_conversation SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND owner_id = $2 AND conversation_id = $3 AND status = 'active'
            AND ($4::text IS NULL OR project_ref = $4) RETURNING conversation_id`,
        [tenantId, subjectId, conversationId, projectRef ?? null],
      )
      if (result.rows[0] === undefined) {
        await client.query("ROLLBACK")
        return false
      }
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
        `UPDATE bff_agent_dispatch_outbox
            SET status = 'failed', completed_at = CURRENT_TIMESTAMP(3),
                last_error_code = 'conversation_deleted', last_error_at = CURRENT_TIMESTAMP(3),
                lease_owner = NULL, lease_token = NULL, lease_until = NULL,
                fence = fence + 1, updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND subject_id = $2 AND conversation_id = $3
            AND status IN ('pending', 'retryable', 'leased')`,
        [tenantId, subjectId, conversationId],
      )
      await client.query(
        `UPDATE bff_message
            SET status = 'failed', updated_at = CURRENT_TIMESTAMP(3)
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
