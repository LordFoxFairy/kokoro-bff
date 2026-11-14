import { projectAccess, type ProjectAccess } from "../../domain/project/access.js"
import type { QueryResult, QueryResultRow } from "pg"
import { conversationColumns, type ConversationRow } from "./chat-repository-mappers.js"

export type CurrentConversationRead = Readonly<{ conversation: ConversationRow; projectAccess: ProjectAccess | null }>

/** Read permission is the real reader's native identity. It never substitutes the creator as an actor. */
export async function readCurrentConversation(
  client: { query<Row extends QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<Row>> },
  tenantId: string,
  subjectId: string,
  conversationId: string,
  requestedProjectId: string | undefined,
  direct: boolean,
): Promise<CurrentConversationRead | null> {
  type Row = ConversationRow & {
    canonical_project_id: string | null
    project_owner_id: string | null
    access_version: string | null
    grant_subject_id: string | null
    grant_role: "viewer" | "editor" | null
    grant_expires_at: Date | null
    grant_revoked_at: Date | null
    evaluated_at: Date
  }
  const columns = conversationColumns
    .split(",")
    .map((column) => `conversation.${column.trim()}`)
    .join(",")
  const rows = (
    await client.query<Row>(
      `SELECT ${columns},project.project_id AS canonical_project_id,project.owner_id AS project_owner_id,
       project.access_version::text,grantee.subject_id AS grant_subject_id,grantee.grant_role,
       grantee.expires_at AS grant_expires_at,grantee.revoked_at AS grant_revoked_at,statement_timestamp() AS evaluated_at
     FROM bff_conversation conversation
     LEFT JOIN bff_project project ON project.tenant_id=conversation.tenant_id AND project.deleted_at IS NULL
       AND (project.project_id=conversation.project_ref OR (project.owner_id=conversation.owner_id AND project.slug=conversation.project_ref))
     LEFT JOIN bff_project_grant grantee ON grantee.tenant_id=project.tenant_id AND grantee.project_id=project.project_id AND grantee.subject_id=$2
     WHERE conversation.tenant_id=$1 AND conversation.conversation_id=$3 AND conversation.status='active'
       AND ($4::text IS NULL OR project.project_id=$4) AND (NOT $5::boolean OR conversation.project_ref IS NULL)
     LIMIT 2`,
      [tenantId, subjectId, conversationId, requestedProjectId ?? null, direct],
    )
  ).rows
  // Ambiguous historical bindings are not resolved by guessing the creator or a caller-owned slug.
  if (rows.length !== 1) return null
  const row = rows[0]!
  if (row.tenant_id !== tenantId || row.conversation_id !== conversationId) throw Error("CHAT_CONVERSATION_READ_BINDING_INVALID")
  if (row.project_ref === null) return row.owner_id === subjectId && requestedProjectId === undefined ? { conversation: row, projectAccess: null } : null
  if (!row.canonical_project_id || !row.project_owner_id || !row.access_version) return null
  const access = projectAccess(
    { projectId: row.canonical_project_id, tenantId, ownerId: row.project_owner_id, accessVersion: row.access_version, deleted: false },
    { tenantId, subjectId },
    row.grant_subject_id && row.grant_role
      ? {
          tenantId,
          projectId: row.canonical_project_id,
          subjectId: row.grant_subject_id,
          role: row.grant_role,
          expiresAt: row.grant_expires_at?.toISOString() ?? null,
          revokedAt: row.grant_revoked_at?.toISOString() ?? null,
        }
      : null,
    row.evaluated_at.getTime(),
  )
  return access ? { conversation: row, projectAccess: access } : null
}
