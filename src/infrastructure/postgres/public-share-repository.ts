import type { MessagePage } from "../../application/ports/chat-repository.js"
import type { PublicShareRepository } from "../../application/ports/public-share-repository.js"
import type { Conversation } from "../../domain/chat/conversation.js"
import type { Share } from "../../domain/chat/share.js"
import type { PostgresBffDatabase } from "./client.js"
import {
  conversationFromRow,
  messageFromRow,
  shareFromRow,
  type MessageRow,
  type SharedRow,
} from "./chat-repository-mappers.js"

/** Public share capability reads; no trusted subject is accepted at this boundary. */
export class PostgresPublicShareRepository implements PublicShareRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async findActiveShare(
    shareId: string,
    tenantId?: string,
    projectRef?: string,
  ): Promise<{ share: Share; conversation: Conversation } | null> {
    const result = await this.database.pool.query<SharedRow>(
      `SELECT s.share_id, s.tenant_id AS share_tenant_id, s.conversation_id AS share_conversation_id, s.url,
              s.created_at AS share_created_at, s.expires_at, s.revoked_at,
              c.conversation_id, c.tenant_id, c.owner_id, c.project_ref, c.title, c.status,
              c.created_at AS conversation_created_at, c.updated_at, c.deleted_at
         FROM bff_share AS s
         JOIN bff_conversation AS c
           ON c.tenant_id = s.tenant_id
          AND c.conversation_id = s.conversation_id
        WHERE s.share_id = $1
          AND s.tenant_id = COALESCE($2::text, s.tenant_id)
          AND ($3::text IS NULL OR c.project_ref = $3)
          AND s.revoked_at IS NULL
          AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP(3))
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

  public async listSharedMessages(
    shareId: string,
    tenantId: string,
    conversationId: string,
    limit: number,
  ): Promise<MessagePage | null> {
    const result = await this.database.pool.query<MessageRow>(
      `SELECT message.message_id, message.tenant_id, message.conversation_id, message.run_id,
              message.role, message.content, message.status, message.message_seq,
              message.created_at, message.updated_at
         FROM bff_message AS message
        WHERE message.tenant_id = $1
          AND message.conversation_id = $2
          AND EXISTS (
            SELECT 1
              FROM bff_share AS share
              JOIN bff_conversation AS conversation
                ON conversation.tenant_id = share.tenant_id
               AND conversation.conversation_id = share.conversation_id
             WHERE share.share_id = $3
               AND share.tenant_id = message.tenant_id
               AND share.conversation_id = message.conversation_id
               AND share.revoked_at IS NULL
               AND (share.expires_at IS NULL OR share.expires_at > CURRENT_TIMESTAMP(3))
               AND conversation.status = 'active'
          )
        ORDER BY message.message_seq ASC, message.message_id ASC
        LIMIT $4`,
      [tenantId, conversationId, shareId, limit],
    )
    if (result.rows.length === 0) {
      const active = await this.findActiveShare(shareId, tenantId)
      if (active === null || active.conversation.conversationId !== conversationId) return null
    }
    return { messages: result.rows.map(messageFromRow), next_cursor: null }
  }
}
