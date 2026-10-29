import type { PoolClient, QueryResult, QueryResultRow } from "pg"
import { decodeProjectMcpRecommendations, parseProjectMcpRecommendations, projectMcpVersion } from "../../domain/project/mcp-recommendations.js"
import type {
  ProjectMcpRecommendationQuery,
  ReplaceProjectMcpRecommendations,
  ReplaceProjectMcpRecommendationsResult,
} from "../../application/ports/project-repository.js"
import type { PostgresBffDatabase } from "./client.js"

/** A single bounded Project configuration transaction. It never touches command receipts. */
async function transaction<T>(
  database: PostgresBffDatabase,
  input: ProjectMcpRecommendationQuery,
  work: (query: <R extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => Promise<QueryResult<R>>) => Promise<T>,
  readOnly: boolean,
): Promise<T> {
  let client: PoolClient | undefined,
    broken = false,
    open = false
  const onError = () => {
    broken = true
  }
  const within = <R>(start: () => Promise<R>): Promise<R> =>
    new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        clearTimeout(timer)
        input.signal.removeEventListener("abort", stop)
        client?.removeListener("error", stop)
      }
      const stop = () => {
        if (settled) return
        settled = true
        broken = true
        cleanup()
        reject(new Error("PROJECT_MCP_RECOMMENDATIONS_UNAVAILABLE"))
      }
      const remaining = Math.floor(input.deadlineAt - performance.now())
      const timer = setTimeout(stop, Math.max(0, remaining))
      input.signal.addEventListener("abort", stop, { once: true })
      client?.once("error", stop)
      if (broken || input.signal.aborted || remaining <= 0) {
        stop()
        return
      }
      void Promise.resolve()
        .then(() => {
          if (settled) throw new Error("PROJECT_MCP_RECOMMENDATIONS_RETIRED")
          return start()
        })
        .then(
          (value) => {
            if (settled) return
            settled = true
            cleanup()
            resolve(value)
          },
          (error) => {
            if (settled) return
            settled = true
            cleanup()
            reject(error)
          },
        )
    })
  const query = <R extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => within(() => client!.query<R>(sql, values))
  try {
    await within(async () => {
      const acquired = await database.pool.connect()
      if (broken || input.signal.aborted || performance.now() >= input.deadlineAt) {
        acquired.release()
        throw new Error("PROJECT_MCP_RECOMMENDATIONS_RETIRED")
      }
      client = acquired
      client.on("error", onError)
      return acquired
    })
    await query(readOnly ? "BEGIN READ ONLY" : "BEGIN")
    open = true
    await query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)", [
      String(Math.max(1, Math.floor(input.deadlineAt - performance.now()))),
      String(Math.min(1000, Math.max(1, Math.floor(input.deadlineAt - performance.now())))),
    ])
    const result = await work(query)
    try {
      await query("COMMIT")
      open = false
    } catch (error) {
      broken = true
      open = false
      throw new Error("PROJECT_MCP_RECOMMENDATIONS_COMMIT_UNKNOWN", { cause: error })
    }
    return result
  } catch (error) {
    if (open && !broken) {
      try {
        await query("ROLLBACK")
      } catch {
        broken = true
      }
    }
    throw error
  } finally {
    if (client) {
      client.removeListener("error", onError)
      client.release(broken)
    }
  }
}
type Row = { project_id: string; recommended_mcp_refs: unknown; mcp_recommendations_state_version: number }
const scope = "tenant_id=$1 AND owner_id=$2 AND project_id=$3 AND deleted_at IS NULL"
export function readProjectMcpRecommendations(database: PostgresBffDatabase, input: ProjectMcpRecommendationQuery) {
  return transaction(
    database,
    input,
    async (query) => {
      const rows = await query<Row>(`SELECT project_id,recommended_mcp_refs,mcp_recommendations_state_version FROM bff_project WHERE ${scope}`, [
        input.tenantId,
        input.subjectId,
        input.projectId,
      ])
      const row = rows.rows[0]
      return row ? decodeProjectMcpRecommendations(row.project_id, row.recommended_mcp_refs, row.mcp_recommendations_state_version) : null
    },
    true,
  )
}
export function replaceProjectMcpRecommendations(
  database: PostgresBffDatabase,
  input: ReplaceProjectMcpRecommendations,
): Promise<ReplaceProjectMcpRecommendationsResult> {
  const refs = parseProjectMcpRecommendations(input.recommendations)
  if (!refs || !projectMcpVersion(input.expectedStateVersion)) throw new Error("PROJECT_MCP_RECOMMENDATIONS_INVALID")
  return transaction(
    database,
    input,
    async (query) => {
      const selected = await query<Row>(`SELECT project_id,recommended_mcp_refs,mcp_recommendations_state_version FROM bff_project WHERE ${scope} FOR UPDATE`, [
        input.tenantId,
        input.subjectId,
        input.projectId,
      ])
      const row = selected.rows[0]
      if (!row) return { kind: "not_found" }
      const current = decodeProjectMcpRecommendations(row.project_id, row.recommended_mcp_refs, row.mcp_recommendations_state_version)
      if (current.state_version !== input.expectedStateVersion) return { kind: "precondition_failed" }
      if (JSON.stringify(current.recommendations) === JSON.stringify(refs)) return { kind: "replaced", data: current }
      if (row.mcp_recommendations_state_version >= 2147483647) return { kind: "precondition_failed" }
      const changed = await query<Row>(
        `UPDATE bff_project SET recommended_mcp_refs=$4::jsonb,mcp_recommendations_state_version=mcp_recommendations_state_version+1,updated_at=CURRENT_TIMESTAMP(3) WHERE ${scope} AND mcp_recommendations_state_version=$5 RETURNING project_id,recommended_mcp_refs,mcp_recommendations_state_version`,
        [input.tenantId, input.subjectId, input.projectId, JSON.stringify(refs), Number(input.expectedStateVersion)],
      )
      const updated = changed.rows[0]
      if (!updated) throw new Error("PROJECT_MCP_RECOMMENDATIONS_UPDATE_LOST")
      return {
        kind: "replaced",
        data: decodeProjectMcpRecommendations(updated.project_id, updated.recommended_mcp_refs, updated.mcp_recommendations_state_version),
      }
    },
    false,
  )
}
