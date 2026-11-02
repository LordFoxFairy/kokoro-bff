import type { PoolClient, QueryResult, QueryResultRow } from "pg"
import type { ProjectPinQuery, SetProjectPin } from "../../application/ports/project-repository.js"
import type { ProjectPin, ProjectPinList, ProjectPinState } from "../../domain/project/pin.js"
import { projectPinId } from "../../domain/project/pin.js"
import type { PostgresBffDatabase } from "./client.js"
type PinLifetime = Readonly<{ signal: AbortSignal; deadlineAt: number }>
/** A single bounded Project configuration transaction. It never touches command receipts. */
async function transaction<T>(
  database: PostgresBffDatabase,
  input: PinLifetime,
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
        reject(new Error("PROJECT_PIN_UNAVAILABLE"))
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
          if (settled) throw new Error("PROJECT_PIN_RETIRED")
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
        throw new Error("PROJECT_PIN_RETIRED")
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
      throw new Error("PROJECT_PIN_COMMIT_UNKNOWN", { cause: error })
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
      try {
        client.release(broken)
      } finally {
        client.removeListener("error", onError)
      }
    }
  }
}
type PinRow = { project_id: string; pinned_at: Date | string | null }
function pin(row: PinRow): ProjectPin {
  const instant = row.pinned_at instanceof Date ? row.pinned_at : new Date(row.pinned_at ?? "")
  if (!projectPinId(row.project_id) || !Number.isFinite(instant.getTime())) throw new Error("PROJECT_PIN_ROW_INVALID")
  return { projectId: row.project_id, pinnedAt: instant }
}
export function listProjectPins(database: PostgresBffDatabase, input: ProjectPinQuery): Promise<ProjectPinList | null> {
  return transaction(
    database,
    input,
    async (query) => {
      if (input.projectId !== null) {
        const result = await query<PinRow>(
          `SELECT p.project_id,pin.pinned_at FROM bff_project p
        LEFT JOIN bff_project_pin pin ON pin.tenant_id=p.tenant_id AND pin.project_id=p.project_id AND pin.subject_id=$2
        WHERE p.tenant_id=$1 AND p.owner_id=$2 AND p.project_id=$3 AND p.deleted_at IS NULL`,
          [input.tenantId, input.subjectId, input.projectId],
        )
        const row = result.rows[0]
        return row ? { items: row.pinned_at === null ? [] : [pin(row)], nextPosition: null } : null
      }
      const rows = await query<PinRow>(
        `SELECT pin.project_id,pin.pinned_at FROM bff_project_pin pin
      JOIN bff_project p ON p.tenant_id=pin.tenant_id AND p.project_id=pin.project_id AND p.owner_id=$2 AND p.deleted_at IS NULL
      WHERE pin.tenant_id=$1 AND pin.subject_id=$2
        AND ($3::timestamptz IS NULL OR pin.pinned_at<$3 OR (pin.pinned_at=$3 AND pin.project_id COLLATE "C">$4::text COLLATE "C"))
      ORDER BY pin.pinned_at DESC,pin.project_id COLLATE "C" ASC LIMIT $5`,
        [input.tenantId, input.subjectId, input.position?.pinnedAt ?? null, input.position?.projectId ?? null, input.limit + 1],
      )
      const items = rows.rows.slice(0, input.limit).map(pin),
        last = items.at(-1)
      return { items, nextPosition: rows.rows.length > input.limit && last ? { projectId: last.projectId, pinnedAt: last.pinnedAt.toISOString() } : null }
    },
    true,
  )
}
export function setProjectPin(database: PostgresBffDatabase, input: SetProjectPin): Promise<ProjectPinState | null> {
  return transaction(
    database,
    input,
    async (query) => {
      const parent = await query(`SELECT project_id FROM bff_project WHERE tenant_id=$1 AND owner_id=$2 AND project_id=$3 AND deleted_at IS NULL FOR UPDATE`, [
        input.tenantId,
        input.subjectId,
        input.projectId,
      ])
      if (!parent.rows[0]) return null
      if (!input.isPinned) {
        await query(`DELETE FROM bff_project_pin WHERE tenant_id=$1 AND subject_id=$2 AND project_id=$3`, [input.tenantId, input.subjectId, input.projectId])
        return { projectId: input.projectId, isPinned: false, pinnedAt: null }
      }
      await query(`INSERT INTO bff_project_pin(tenant_id,subject_id,project_id) VALUES($1,$2,$3) ON CONFLICT(tenant_id,subject_id,project_id) DO NOTHING`, [
        input.tenantId,
        input.subjectId,
        input.projectId,
      ])
      const result = await query<PinRow>(`SELECT project_id,pinned_at FROM bff_project_pin WHERE tenant_id=$1 AND subject_id=$2 AND project_id=$3`, [
        input.tenantId,
        input.subjectId,
        input.projectId,
      ])
      if (!result.rows[0]) throw new Error("PROJECT_PIN_WRITE_LOST")
      return { ...pin(result.rows[0]), isPinned: true }
    },
    false,
  )
}
