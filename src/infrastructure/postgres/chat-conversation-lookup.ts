import type { Pool, PoolClient } from "pg"
import type { MessageReadLifetime } from "../../application/chat/chat-repository.js"
import type { Conversation } from "../../domain/chat/conversation.js"
import { conversationColumns, conversationFromRow, type ConversationRow } from "./chat-repository-mappers.js"
import { withMessageReadClient } from "./message-parts-read.js"

export function createChatConversationLookup(pool: Pick<Pool, "query" | "connect">) {
  return async function findConversation(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    projectRef: string | undefined,
    lifetime?: MessageReadLifetime,
  ): Promise<Conversation | null> {
    const sql = `SELECT ${conversationColumns}
         FROM bff_conversation
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
          AND ($4::text IS NULL OR project_ref = $4)
        LIMIT 1`
    const values = [tenantId, subjectId, conversationId, projectRef ?? null]
    const result =
      lifetime === undefined
        ? await pool.query<ConversationRow>(sql, values)
        : await withMessageReadClient(pool, lifetime, (client) => client.query<ConversationRow>(sql, values))
    const row = result.rows[0]
    return row === undefined ? null : conversationFromRow(row)
  }
}

export type ChatConversationLookup = ReturnType<typeof createChatConversationLookup>

export async function readOwnedConversationSnapshotRow(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  conversationId: string,
  projectRef: string | undefined,
  direct: boolean,
): Promise<ConversationRow | undefined> {
  const conversation = await client.query<ConversationRow>(
    `SELECT ${conversationColumns}
           FROM bff_conversation
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
            AND ($4::text IS NULL OR project_ref = $4)
            AND ($5::boolean=FALSE OR project_ref IS NULL)
          LIMIT 1`,
    [tenantId, subjectId, conversationId, projectRef ?? null, direct],
  )
  return conversation.rows[0]
}
