import { randomUUID } from "node:crypto"

import type { ChatRepository, ConversationPage, MessagePage, NewUserMessage } from "../../application/ports/chat-repository.js"
import type { Conversation } from "../../domain/chat/conversation.js"
import type { Message } from "../../domain/chat/message.js"
import type { Share } from "../../domain/chat/share.js"
import type { PostgresBffDatabase } from "./client.js"
import {
  conversationColumns,
  conversationFromRow,
  decodeCursor,
  encodeCursor,
  instant,
  messageColumns,
  messageFromRow,
  shareColumns,
  shareFromRow,
  type ConversationRow,
  type MessageRow,
  type ShareRow,
  type SharedRow,
} from "./chat-repository-mappers.js"

export class PostgresChatRepository implements ChatRepository {
  private readonly database: PostgresBffDatabase

  public constructor(database: PostgresBffDatabase) {
    this.database = database
  }

  public async listConversations(tenantId: string, projectRef: string | undefined, limit: number, cursor: string | null): Promise<ConversationPage> {
    const position = decodeCursor(cursor, "conv")
    const result = await this.database.pool.query<ConversationRow>(
      `SELECT ${conversationColumns}
         FROM bff_conversation
        WHERE tenant_id = $1
          AND status = 'active'
          AND ($2::text IS NULL OR project_ref = $2)
          AND ($3::timestamptz IS NULL OR (updated_at, conversation_id) < ($3, $4))
        ORDER BY updated_at DESC, conversation_id ASC
        LIMIT $5`,
      [tenantId, projectRef ?? null, position?.timestamp ?? null, position?.id ?? null, limit + 1],
    )
    const rows = result.rows.slice(0, limit)
    const last = rows.length === limit ? rows.at(-1) : undefined
    return {
      conversations: rows.map(conversationFromRow),
      next_cursor: last === undefined ? null : encodeCursor({ timestamp: instant(last.updated_at).toISOString(), id: last.conversation_id }, "conv"),
    }
  }

  public async findConversation(tenantId: string, conversationId: string, projectRef: string | undefined): Promise<Conversation | null> {
    const result = await this.database.pool.query<ConversationRow>(
      `SELECT ${conversationColumns}
         FROM bff_conversation
        WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'active'
          AND ($3::text IS NULL OR project_ref = $3)
        LIMIT 1`,
      [tenantId, conversationId, projectRef ?? null],
    )
    const row = result.rows[0]
    return row === undefined ? null : conversationFromRow(row)
  }

  public async listMessages(tenantId: string, conversationId: string, limit: number, cursor: string | null, projectRef?: string): Promise<MessagePage | null> {
    const position = decodeCursor(cursor, "msg")
    if (position !== null && position.sequence === undefined) throw new Error("CHAT_CURSOR_INVALID")
    const exists = await this.database.pool.query<{ conversation_id: string }>(
      `SELECT conversation_id FROM bff_conversation
        WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'active'
          AND ($3::text IS NULL OR project_ref = $3) LIMIT 1`,
      [tenantId, conversationId, projectRef ?? null],
    )
    if (exists.rows[0] === undefined) return null
    const result = await this.database.pool.query<MessageRow>(
      `SELECT ${messageColumns}
         FROM bff_message
        WHERE tenant_id = $1 AND conversation_id = $2
          AND ($3::timestamptz IS NULL OR (created_at, message_seq, message_id) > ($3, $4, $5))
        ORDER BY created_at ASC, message_seq ASC, message_id ASC
        LIMIT $6`,
      [tenantId, conversationId, position?.timestamp ?? null, position?.sequence ?? null, position?.id ?? null, limit + 1],
    )
    const rows = result.rows.slice(0, limit)
    const last = rows.length === limit ? rows.at(-1) : undefined
    return {
      messages: rows.map(messageFromRow),
      next_cursor: last === undefined ? null : encodeCursor({ timestamp: instant(last.created_at).toISOString(), id: last.message_id, sequence: Number(last.message_seq) }, "msg"),
    }
  }

  public async appendUserMessage(input: NewUserMessage): Promise<{ userMessage: Message; assistantMessageId: string } | null> {
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const conversation = await client.query<ConversationRow>(
        `SELECT ${conversationColumns} FROM bff_conversation
          WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'active'
            AND ($3::text IS NULL OR project_ref = $3) FOR UPDATE`,
        [input.tenantId, input.conversationId, input.projectRef ?? null],
      )
      if (conversation.rows[0] === undefined) {
        await client.query("ROLLBACK")
        return null
      }
      const existing = await client.query<MessageRow>(
        `SELECT ${messageColumns} FROM bff_message WHERE tenant_id = $1 AND message_id = $2 LIMIT 1`,
        [input.tenantId, input.messageId],
      )
      if (existing.rows[0] !== undefined) {
        await client.query("COMMIT")
        return { userMessage: messageFromRow(existing.rows[0]), assistantMessageId: `${input.messageId.replace(/_user$/u, "_assistant")}` }
      }
      const sequence = await client.query<{ next_seq: string }>(
        `SELECT COALESCE(MAX(message_seq), 0) + 1 AS next_seq FROM bff_message
          WHERE tenant_id = $1 AND conversation_id = $2`,
        [input.tenantId, input.conversationId],
      )
      const nextSequence = Number(sequence.rows[0]?.next_seq)
      if (!Number.isSafeInteger(nextSequence) || nextSequence < 1) throw new Error("CHAT_MESSAGE_SEQUENCE_INVALID")
      const inserted = await client.query<MessageRow>(
        `INSERT INTO bff_message
          (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq)
         VALUES ($1, $2, $3, $4, 'user', $5, 'completed', $6)
         RETURNING ${messageColumns}`,
        [input.messageId, input.tenantId, input.conversationId, input.runId, input.content, nextSequence],
      )
      await client.query(
        `UPDATE bff_conversation SET updated_at = CURRENT_TIMESTAMP(3) WHERE tenant_id = $1 AND conversation_id = $2`,
        [input.tenantId, input.conversationId],
      )
      await client.query("COMMIT")
      const row = inserted.rows[0]
      if (row === undefined) throw new Error("CHAT_MESSAGE_INSERT_RETURNED_NO_ROW")
      return { userMessage: messageFromRow(row), assistantMessageId: `${input.messageId.replace(/_user$/u, "_assistant")}` }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async renameConversation(tenantId: string, conversationId: string, title: string, projectRef?: string): Promise<Conversation | null> {
    const result = await this.database.pool.query<ConversationRow>(
      `UPDATE bff_conversation SET title = $3, updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'active'
          AND ($4::text IS NULL OR project_ref = $4)
        RETURNING ${conversationColumns}`,
      [tenantId, conversationId, title, projectRef ?? null],
    )
    const row = result.rows[0]
    return row === undefined ? null : conversationFromRow(row)
  }

  public async deleteConversation(tenantId: string, conversationId: string, projectRef?: string): Promise<boolean> {
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const result = await client.query<{ conversation_id: string }>(
        `UPDATE bff_conversation SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'active'
            AND ($3::text IS NULL OR project_ref = $3) RETURNING conversation_id`,
        [tenantId, conversationId, projectRef ?? null],
      )
      if (result.rows[0] === undefined) {
        await client.query("ROLLBACK")
        return false
      }
      await client.query(
        `UPDATE bff_share SET revoked_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND conversation_id = $2 AND revoked_at IS NULL`,
        [tenantId, conversationId],
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
          WHERE tenant_id = $1 AND session_id = $2`,
        [tenantId, conversationId],
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

  public async createShare(tenantId: string, conversationId: string, projectRef?: string): Promise<Share | null> {
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const conversation = await client.query<{ conversation_id: string }>(
        `SELECT conversation_id FROM bff_conversation
          WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'active'
            AND ($3::text IS NULL OR project_ref = $3) FOR UPDATE`,
        [tenantId, conversationId, projectRef ?? null],
      )
      if (conversation.rows[0] === undefined) {
        await client.query("ROLLBACK")
        return null
      }
      const existing = await client.query<ShareRow>(
        `SELECT ${shareColumns} FROM bff_share
          WHERE tenant_id = $1 AND conversation_id = $2 AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))
          LIMIT 1`,
        [tenantId, conversationId],
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
          WHERE tenant_id = $1 AND conversation_id = $2 AND revoked_at IS NULL
            AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP(3)`,
        [tenantId, conversationId],
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

  public async revokeShare(tenantId: string, conversationId: string, projectRef?: string): Promise<Share | null> {
    const result = await this.database.pool.query<ShareRow>(
      `UPDATE bff_share SET revoked_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND conversation_id = $2 AND revoked_at IS NULL
          AND ($3::text IS NULL OR EXISTS (
            SELECT 1 FROM bff_conversation c
             WHERE c.tenant_id = bff_share.tenant_id AND c.conversation_id = bff_share.conversation_id
               AND c.project_ref = $3 AND c.status = 'active'
          ))
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))
        RETURNING ${shareColumns}`,
      [tenantId, conversationId, projectRef ?? null],
    )
    const row = result.rows[0]
    return row === undefined ? null : shareFromRow(row)
  }

  public async findActiveShare(shareId: string, tenantId?: string, projectRef?: string): Promise<{ share: Share; conversation: Conversation } | null> {
    const result = await this.database.pool.query<SharedRow>(
      `SELECT s.share_id, s.tenant_id AS share_tenant_id, s.conversation_id AS share_conversation_id, s.url,
              s.created_at AS share_created_at, s.expires_at, s.revoked_at,
              c.conversation_id, c.tenant_id, c.owner_id, c.project_ref, c.title, c.status,
              c.created_at AS conversation_created_at, c.updated_at, c.deleted_at
         FROM bff_share s
         JOIN bff_conversation c ON c.tenant_id = s.tenant_id AND c.conversation_id = s.conversation_id
        WHERE s.share_id = $1 AND s.tenant_id = COALESCE($2::text, s.tenant_id)
          AND ($3::text IS NULL OR c.project_ref = $3)
          AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP(3))
          AND c.status = 'active'
        LIMIT 1`,
      [shareId, tenantId ?? null, projectRef ?? null],
    )
    const row = result.rows[0]
    return row === undefined ? null : {
      share: shareFromRow({
        share_id: row.share_id,
        tenant_id: row.share_tenant_id,
        conversation_id: row.share_conversation_id,
        url: row.url,
        created_at: row.share_created_at,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at,
      }),
      conversation: conversationFromRow({
        conversation_id: row.conversation_id,
        tenant_id: row.tenant_id,
        owner_id: row.owner_id,
        project_ref: row.project_ref,
        title: row.title,
        status: row.status,
        created_at: row.conversation_created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
      }),
    }
  }
}
