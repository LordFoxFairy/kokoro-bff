import type { Pool, PoolClient, QueryResultRow } from "pg"
import { performance } from "node:perf_hooks"
import type { ProjectOwnerScope } from "../../application/projects/types.js"
import { projectAccess, type ProjectAccess, type ProjectGrantBody } from "../../domain/project/access.js"

export type ProjectGrantView = Readonly<{
  project_id: string
  subject_id: string
  role: "viewer" | "editor"
  expires_at: string | null
  revoked_at: string | null
  access_version: string
}>
export type ProjectGrantReceipt = Readonly<{
  fingerprint: string
  data: ProjectGrantView
}>
export type ProjectGrantCommand = ProjectOwnerScope &
  Readonly<{
    projectId: string
    targetSubjectId: string
    expectedAccessVersion: string
    body: ProjectGrantBody | null
    receiptScope: string
    fingerprint: string
    signal: AbortSignal
    deadlineAt: number
  }>
export type ProjectGrantResult =
  | Readonly<{ kind: "committed"; data: ProjectGrantView; replayed: boolean }>
  | Readonly<{
      kind: "not_found" | "forbidden" | "conflict" | "precondition_failed" | "invalid"
    }>
export type ProjectGrantStore = Readonly<{
  access(scope: ProjectOwnerScope, projectId: string, signal: AbortSignal, deadlineAt: number): Promise<ProjectAccess | null>
  list(
    scope: ProjectOwnerScope,
    projectId: string,
    after: string | null,
    limit: number,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<{ items: ProjectGrantView[]; next: string | null } | null>
  receipt(scope: string, signal: AbortSignal, deadlineAt: number): Promise<ProjectGrantReceipt | null>
  mutate(command: ProjectGrantCommand): Promise<ProjectGrantResult>
}>
type ProjectRow = QueryResultRow & {
  project_id: string
  tenant_id: string
  owner_id: string
  access_version: string
  deleted_at: Date | null
  evaluated_at: Date
}
type GrantRow = QueryResultRow & {
  subject_id: string
  grant_role: "viewer" | "editor"
  expires_at: Date | null
  revoked_at: Date | null
}
const instant = (value: Date | null): string | null => (value === null ? null : value.toISOString())
function view(project: Pick<ProjectRow, "project_id" | "access_version">, grant: GrantRow): ProjectGrantView {
  return {
    project_id: project.project_id,
    subject_id: grant.subject_id,
    role: grant.grant_role,
    expires_at: instant(grant.expires_at),
    revoked_at: instant(grant.revoked_at),
    access_version: project.access_version,
  }
}

/** One bounded physical lease. Abort destroys the exact client, never rolls back over a pending query. */
async function grantLease<T>(pool: Pool, signal: AbortSignal, deadlineAt: number, work: (client: PoolClient) => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  const remaining = Math.floor(deadlineAt - performance.now())
  if (remaining < 1) throw Error("PROJECT_GRANT_DEADLINE")
  let client: PoolClient | undefined,
    destroyed = false,
    acquired = false,
    open = false
  let reject!: (error: Error) => void
  const stopped = new Promise<never>((_resolve, fail) => {
    reject = fail
  })
  const abort = () => {
    destroyed = true
    reject(Error("PROJECT_GRANT_RETIRED"))
  }
  const timer = setTimeout(abort, remaining)
  signal.addEventListener("abort", abort, { once: true })
  const checkout = pool.connect()
  try {
    client = await Promise.race([checkout, stopped])
    acquired = true
    client.on("error", abort)
    signal.throwIfAborted()
    open = true
    await Promise.race([client.query("BEGIN"), stopped])
    await Promise.race([
      client.query("SELECT set_config('statement_timeout',$1,true)", [String(Math.max(1, Math.floor(deadlineAt - performance.now())))]),
      stopped,
    ])
    const result = await Promise.race([work(client), stopped])
    try {
      await Promise.race([client.query("COMMIT"), stopped])
      open = false
    } catch (cause) {
      destroyed = true
      throw Error("PROJECT_GRANT_COMMIT_UNKNOWN", { cause })
    }
    signal.throwIfAborted()
    return result
  } catch (error) {
    if (open && client && !destroyed) {
      try {
        await Promise.race([client.query("ROLLBACK"), stopped])
        open = false
      } catch {
        destroyed = true
      }
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", abort)
    if (client) {
      client.release(destroyed)
      client.off("error", abort)
    } else if (!acquired)
      void checkout.then(
        (late) => late.release(true),
        () => undefined,
      )
  }
}

export function createProjectGrantStore(pool: Pool): ProjectGrantStore {
  return {
    access: (scope, projectId, signal, deadline) =>
      grantLease(pool, signal, deadline, async (client) => {
        const result = await client.query<ProjectRow & Partial<GrantRow>>(
          `SELECT p.project_id,p.tenant_id,p.owner_id,p.access_version::text,p.deleted_at,statement_timestamp() AS evaluated_at,
                g.subject_id,g.grant_role,g.expires_at,g.revoked_at
           FROM bff_project p LEFT JOIN bff_project_grant g
             ON g.tenant_id=p.tenant_id AND g.project_id=p.project_id AND g.subject_id=$2
          WHERE p.tenant_id=$1 AND p.project_id=$3 AND p.deleted_at IS NULL`,
          [scope.tenantId, scope.subjectId, projectId],
        )
        const row = result.rows[0]
        if (!row) return null
        return projectAccess(
          {
            projectId: row.project_id,
            tenantId: row.tenant_id,
            ownerId: row.owner_id,
            accessVersion: row.access_version,
            deleted: row.deleted_at !== null,
          },
          scope,
          row.subject_id && row.grant_role
            ? {
                tenantId: scope.tenantId,
                projectId,
                subjectId: row.subject_id,
                role: row.grant_role,
                expiresAt: instant(row.expires_at ?? null),
                revokedAt: instant(row.revoked_at ?? null),
              }
            : null,
          row.evaluated_at.getTime(),
        )
      }),
    list: (scope, projectId, after, limit, signal, deadline) =>
      grantLease(pool, signal, deadline, async (client) => {
        // One snapshot includes owner admission, a possibly empty page and the access version.
        const result = await client.query<ProjectRow & { grants: GrantRow[] }>(
          `SELECT p.project_id,p.access_version::text,COALESCE((
          SELECT jsonb_agg(jsonb_build_object('subject_id',page.subject_id,'grant_role',page.grant_role,
             'expires_at',page.expires_at,'revoked_at',page.revoked_at) ORDER BY page.subject_id COLLATE "C")
          FROM (SELECT subject_id,grant_role,expires_at,revoked_at FROM bff_project_grant
             WHERE tenant_id=p.tenant_id AND project_id=p.project_id AND ($4::text IS NULL OR subject_id COLLATE "C">$4)
             ORDER BY subject_id COLLATE "C" LIMIT $5) page),'[]'::jsonb) AS grants
         FROM bff_project p WHERE p.tenant_id=$1 AND p.owner_id=$2 AND p.project_id=$3 AND p.deleted_at IS NULL`,
          [scope.tenantId, scope.subjectId, projectId, after, limit + 1],
        )
        const parent = result.rows[0]
        if (!parent) return null
        const page = parent.grants.slice(0, limit)
        return {
          items: page.map((row) =>
            view(parent, {
              ...row,
              expires_at: row.expires_at === null ? null : new Date(row.expires_at),
              revoked_at: row.revoked_at === null ? null : new Date(row.revoked_at),
            }),
          ),
          next: parent.grants.length > limit ? page.at(-1)!.subject_id : null,
        }
      }),
    receipt: (scope, signal, deadline) =>
      grantLease(pool, signal, deadline, async (client) => {
        const row = (
          await client.query<{
            fingerprint: string
            status: number
            response_body: { data: ProjectGrantView }
          }>("SELECT fingerprint,status,response_body FROM bff_idempotency_receipt WHERE scope=$1", [scope])
        ).rows[0]
        if (!row) return null
        if (row.status !== 200 || !row.response_body?.data) throw Error("PROJECT_GRANT_RECEIPT_INVALID")
        return { fingerprint: row.fingerprint, data: row.response_body.data }
      }),
    mutate: (command) =>
      grantLease(pool, command.signal, command.deadlineAt, async (client) => {
        const parent = (
          await client.query<ProjectRow>(
            `SELECT project_id,tenant_id,owner_id,access_version::text,deleted_at,statement_timestamp() AS evaluated_at
           FROM bff_project WHERE tenant_id=$1 AND project_id=$2 AND deleted_at IS NULL FOR UPDATE`,
            [command.tenantId, command.projectId],
          )
        ).rows[0]
        if (!parent) return { kind: "not_found" } as const
        if (parent.owner_id !== command.subjectId) return { kind: "forbidden" } as const
        if (command.targetSubjectId === parent.owner_id) return { kind: "invalid" } as const
        const old = (
          await client.query<{
            fingerprint: string
            status: number
            response_body: { data: ProjectGrantView }
          }>("SELECT fingerprint,status,response_body FROM bff_idempotency_receipt WHERE scope=$1", [command.receiptScope])
        ).rows[0]
        if (old) {
          if (old.fingerprint !== command.fingerprint) return { kind: "conflict" } as const
          if (old.status !== 200 || old.response_body?.data?.project_id !== command.projectId || old.response_body.data.subject_id !== command.targetSubjectId)
            throw Error("PROJECT_GRANT_RECEIPT_INVALID")
          return {
            kind: "committed",
            data: old.response_body.data,
            replayed: true,
          } as const
        }
        if (parent.access_version !== command.expectedAccessVersion) return { kind: "precondition_failed" } as const
        let grant: GrantRow | undefined
        if (command.body) {
          if (command.body.expires_at !== null && Date.parse(command.body.expires_at) <= parent.evaluated_at.getTime()) return { kind: "invalid" } as const
          grant = (
            await client.query<GrantRow>(
              `INSERT INTO bff_project_grant(tenant_id,project_id,subject_id,grant_role,expires_at,granted_by)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,project_id,subject_id) DO UPDATE
             SET grant_role=EXCLUDED.grant_role,expires_at=EXCLUDED.expires_at,revoked_at=NULL,
                 granted_by=EXCLUDED.granted_by,updated_at=CURRENT_TIMESTAMP(3)
           RETURNING subject_id,grant_role,expires_at,revoked_at`,
              [command.tenantId, command.projectId, command.targetSubjectId, command.body.role, command.body.expires_at, command.subjectId],
            )
          ).rows[0]
        } else {
          grant = (
            await client.query<GrantRow>(
              `UPDATE bff_project_grant SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP(3)),granted_by=$4,updated_at=CURRENT_TIMESTAMP(3)
           WHERE tenant_id=$1 AND project_id=$2 AND subject_id=$3 RETURNING subject_id,grant_role,expires_at,revoked_at`,
              [command.tenantId, command.projectId, command.targetSubjectId, command.subjectId],
            )
          ).rows[0]
          if (!grant) return { kind: "not_found" } as const
        }
        if (!grant) throw Error("PROJECT_GRANT_WRITE_LOST")
        const updated = (
          await client.query<{ access_version: string }>(
            "UPDATE bff_project SET access_version=access_version+1 WHERE tenant_id=$1 AND project_id=$2 RETURNING access_version::text",
            [command.tenantId, command.projectId],
          )
        ).rows[0]
        if (!updated) throw Error("PROJECT_GRANT_VERSION_LOST")
        const data = view({ ...parent, access_version: updated.access_version }, grant)
        await client.query("INSERT INTO bff_idempotency_receipt(scope,fingerprint,status,response_body) VALUES($1,$2,200,$3::jsonb)", [
          command.receiptScope,
          command.fingerprint,
          JSON.stringify({ data }),
        ])
        return { kind: "committed", data, replayed: false } as const
      }),
  }
}
