import type { Pool, PoolClient } from "pg"
import type { SharedTaskItem, SharedTasksPosition, SharedTasksRead } from "../../application/ports/chat-repository.js"

/** One owner query on one leased client; cancellation never ends the shared pool. */
export async function listOwnedSharedTasks(
  pool: Pick<Pool, "connect">,
  tenantId: string,
  subjectId: string,
  limit: number,
  position: SharedTasksPosition | null,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<SharedTasksRead> {
  let client: PoolClient | undefined
  let lease: PoolClient | undefined
  let retired = false
  let destroy = false
  let reject!: (error: Error) => void
  const interrupted = new Promise<never>((_, fail) => {
    reject = fail
  })
  const stop = () => {
    retired = true
    destroy = true
    reject(new Error("SHARED_TASKS_READ_RETIRED"))
    if (client) {
      client.release(true)
      client = undefined
    }
  }
  const timer = setTimeout(stop, Math.max(0, deadlineAt - performance.now()))
  signal.addEventListener("abort", stop, { once: true })
  const active = () => {
    if (retired || signal.aborted || performance.now() >= deadlineAt) throw new Error("SHARED_TASKS_READ_RETIRED")
  }
  try {
    active()
    const acquisition = pool.connect()
    void acquisition.then(
      (late) => {
        if (retired) late.release()
      },
      () => undefined,
    )
    client = await Promise.race([acquisition, interrupted])
    lease = client
    lease.on("error", stop)
    active()
    const query = async (sql: string, values?: unknown[]) => {
      active()
      const owned = client
      if (!owned) throw new Error("SHARED_TASKS_READ_RETIRED")
      const result = await Promise.race([owned.query(sql, values), interrupted])
      active()
      return result
    }
    await query("BEGIN READ ONLY")
    const remaining = Math.max(1, Math.floor(deadlineAt - performance.now()))
    await query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)", [String(remaining)])
    const result = await query(
      `SELECT c.conversation_id,c.title,s.created_at AS shared_at,s.expires_at
      FROM bff_share s JOIN bff_conversation c ON c.tenant_id=s.tenant_id AND c.conversation_id=s.conversation_id
      WHERE s.tenant_id=$1 AND c.owner_id=$2 AND c.status='active' AND s.resource_kind='conversation'
        AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>statement_timestamp())
        AND (c.project_ref IS NULL OR EXISTS (SELECT 1 FROM bff_project p WHERE p.tenant_id=c.tenant_id AND p.owner_id=c.owner_id AND p.deleted_at IS NULL AND (p.project_id=c.project_ref OR p.slug=c.project_ref)))
        AND ($3::timestamptz IS NULL OR s.created_at<$3 OR (s.created_at=$3 AND c.conversation_id COLLATE "C">$4::text COLLATE "C"))
      ORDER BY s.created_at DESC,c.conversation_id COLLATE "C" ASC LIMIT $5`,
      [tenantId, subjectId, position?.sharedAt ?? null, position?.sessionId ?? null, limit + 1],
    )
    const instant = (value: unknown): string => {
      if (!(value instanceof Date) && typeof value !== "string") throw new Error("SHARED_TASKS_ROW_INVALID")
      const date = new Date(value)
      if (!Number.isFinite(date.getTime())) throw new Error("SHARED_TASKS_ROW_INVALID")
      return date.toISOString()
    }
    const items: SharedTaskItem[] = result.rows.map((row) => {
      if (
        typeof row.conversation_id !== "string" ||
        !row.conversation_id ||
        typeof row.title !== "string" ||
        !row.title.replace(/^ +| +$/gu, "") ||
        Array.from(row.title.replace(/^ +| +$/gu, "")).length > 200
      )
        throw new Error("SHARED_TASKS_ROW_INVALID")
      return {
        session_id: row.conversation_id,
        title: row.title,
        shared_at: instant(row.shared_at),
        expires_at: row.expires_at === null ? null : instant(row.expires_at),
      }
    })
    const visibleItems = items.slice(0, limit)
    const last = result.rows.length > limit ? visibleItems.at(-1) : undefined
    await query("COMMIT")
    return { items: visibleItems, nextPosition: last ? { sharedAt: last.shared_at, sessionId: last.session_id } : null }
  } catch (error) {
    // A failed transaction or unknown result must never return a contaminated connection.
    destroy = true
    throw error
  } finally {
    retired = true
    clearTimeout(timer)
    signal.removeEventListener("abort", stop)
    lease?.removeListener("error", stop)
    client?.release(destroy)
  }
}
