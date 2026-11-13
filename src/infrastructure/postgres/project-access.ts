import type { QueryResult, QueryResultRow } from "pg"
import type { ProjectOwnerScope } from "../../application/projects/types.js"

// These predicates deliberately target this owner table and the admitted $2 subject.
// They are not an IAM/Storage policy or a replacement for the private owner lookup.
export const projectReadPredicate = `(bff_project.owner_id=$2 OR EXISTS (
  SELECT 1 FROM bff_project_grant project_grant
   WHERE project_grant.tenant_id=bff_project.tenant_id AND project_grant.project_id=bff_project.project_id
     AND project_grant.subject_id=$2 AND project_grant.revoked_at IS NULL
     AND (project_grant.expires_at IS NULL OR project_grant.expires_at>statement_timestamp())))`
export const projectEditPredicate = `(bff_project.owner_id=$2 OR EXISTS (
  SELECT 1 FROM bff_project_grant project_grant
   WHERE project_grant.tenant_id=bff_project.tenant_id AND project_grant.project_id=bff_project.project_id
     AND project_grant.subject_id=$2 AND project_grant.grant_role='editor' AND project_grant.revoked_at IS NULL
     AND (project_grant.expires_at IS NULL OR project_grant.expires_at>statement_timestamp())))`

/** Same Project lock as grant mutation; authorization uses a fresh statement after any lock wait. */
export async function lockProjectForEdit(
  client: {
    query<Row extends QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>
  },
  scope: ProjectOwnerScope,
  projectId: string,
): Promise<{ kind: "editable"; projectId: string } | { kind: "not_found" | "forbidden" }> {
  const parent = (
    await client.query<{ project_id: string }>(
      `SELECT project_id FROM bff_project WHERE tenant_id=$1 AND deleted_at IS NULL
       AND project_id=$2 FOR UPDATE`,
      [scope.tenantId, projectId],
    )
  ).rows[0]
  if (!parent) return { kind: "not_found" }
  const current = (
    await client.query<{ can_read: boolean; can_edit: boolean }>(
      `SELECT ${projectReadPredicate} AS can_read, ${projectEditPredicate} AS can_edit
       FROM bff_project WHERE tenant_id=$1 AND project_id=$3 AND deleted_at IS NULL`,
      [scope.tenantId, scope.subjectId, parent.project_id],
    )
  ).rows[0]
  return current?.can_edit ? { kind: "editable", projectId: parent.project_id } : { kind: current?.can_read ? "forbidden" : "not_found" }
}
