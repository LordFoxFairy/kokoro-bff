import { assetDownloadRemaining, withinAssetDownloadBudget } from "../../application/asset-download-budget.js"
import type { ProjectOwnerScope } from "../../application/ports/project-repository.js"
import type { PostgresBffDatabase } from "./client.js"
import type { PoolClient, QueryResult, QueryResultRow } from "pg"

/** Read current Project ownership on an exact, bounded lease; never hold it across owner IO. */
export async function findActiveResourceProjectId(
  database: PostgresBffDatabase,
  scope: ProjectOwnerScope,
  idOrSlug: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<string | null> {
  const leaseAbort = new AbortController()
  const combined = AbortSignal.any([signal, leaseAbort.signal])
  let client: PoolClient
  client = await withinAssetDownloadBudget(
    combined,
    deadlineAt,
    () => database.pool.connect(),
    (late) => late.release(),
  )
  let destroy = false
  const onError = (): void => {
    destroy = true
    leaseAbort.abort()
  }
  client.on("error", onError)
  const query = async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>> => {
    try {
      return await withinAssetDownloadBudget(combined, deadlineAt, () => client.query<Row>(text, values))
    } catch (error) {
      // SQL may still be running. Only this leased connection is retired; no guessed rollback.
      destroy = true
      throw error
    }
  }
  try {
    await query("BEGIN READ ONLY")
    const remaining = assetDownloadRemaining(combined, deadlineAt)
    await query(
      "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('client_connection_check_interval','100ms',true)",
      [`${Math.min(1000, remaining)}ms`, `${remaining}ms`],
    )
    const result = await query<{ project_id: string }>(
      `SELECT project_id FROM bff_project
       WHERE tenant_id=$1 AND owner_id=$2 AND deleted_at IS NULL AND (project_id=$3 OR slug=$3) LIMIT 1`,
      [scope.tenantId, scope.subjectId, idOrSlug],
    )
    await query("COMMIT")
    assetDownloadRemaining(combined, deadlineAt)
    return result.rows[0]?.project_id ?? null
  } catch (error) {
    destroy = true
    throw error
  } finally {
    try {
      client.release(destroy)
    } finally {
      client.off("error", onError)
    }
  }
}
