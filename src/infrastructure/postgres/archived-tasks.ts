import type { Pool } from "pg"
import type {
  ArchivedTasksQuery,
  ArchivedTasksRead,
  ArchiveState,
  ArchiveStateQuery,
  ArchiveStateCommand,
  ArchiveStateResult,
} from "../../application/ports/chat-repository.js"
import { ArchiveSqlLease } from "./archive-sql-lease.js"

const validParent = `(c.project_ref IS NULL OR EXISTS (SELECT 1 FROM bff_project p WHERE p.tenant_id=c.tenant_id AND p.owner_id=c.owner_id AND p.deleted_at IS NULL AND (p.project_id=c.project_ref OR p.slug=c.project_ref)))`
function instant(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== "string") throw new Error("ARCHIVE_ROW_INVALID")
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error("ARCHIVE_ROW_INVALID")
  return date.toISOString()
}
function state(row: Record<string, unknown>): ArchiveState {
  if (typeof row.conversation_id !== "string" || !row.conversation_id) throw new Error("ARCHIVE_ROW_INVALID")
  return { session_id: row.conversation_id, archived_at: row.archived_at === null ? null : instant(row.archived_at) }
}
export async function listOwnedArchivedTasks(pool: Pick<Pool, "connect">, query: ArchivedTasksQuery): Promise<ArchivedTasksRead> {
  const lease = await ArchiveSqlLease.acquire(pool, query)
  let clean = false
  try {
    await lease.begin(true)
    const result = await lease.query(
      `SELECT c.conversation_id,c.title,c.archived_at,c.project_ref FROM bff_conversation c
      WHERE c.tenant_id=$1 AND c.owner_id=$2 AND c.status='active' AND c.archived_at IS NOT NULL AND ${validParent}
      AND ($3::timestamptz IS NULL OR c.archived_at<$3 OR (c.archived_at=$3 AND c.conversation_id COLLATE "C">$4::text COLLATE "C"))
      ORDER BY c.archived_at DESC,c.conversation_id COLLATE "C" ASC LIMIT $5`,
      [query.tenantId, query.subjectId, query.position?.archivedAt ?? null, query.position?.sessionId ?? null, query.limit + 1],
    )
    const items = result.rows.slice(0, query.limit).map((row) => {
      if (typeof row.title !== "string" || (row.project_ref !== null && typeof row.project_ref !== "string")) throw new Error("ARCHIVE_ROW_INVALID")
      const current = state(row)
      if (current.archived_at === null) throw new Error("ARCHIVE_ROW_INVALID")
      return { session_id: current.session_id, title: row.title as string, archived_at: current.archived_at, project_ref: row.project_ref as string | null }
    })
    const last = result.rows.length > query.limit ? items.at(-1) : undefined
    await lease.query("COMMIT")
    clean = true
    return { items, nextPosition: last ? { archivedAt: last.archived_at, sessionId: last.session_id } : null }
  } finally {
    lease.release(!clean)
  }
}
export async function readArchiveState(pool: Pick<Pool, "connect">, query: ArchiveStateQuery): Promise<ArchiveState | null> {
  const lease = await ArchiveSqlLease.acquire(pool, query)
  let clean = false
  try {
    await lease.begin(true)
    const result = await lease.query(
      `SELECT c.conversation_id,c.archived_at FROM bff_conversation c WHERE c.tenant_id=$1 AND c.owner_id=$2 AND c.conversation_id=$3 AND c.status='active' AND ${validParent}`,
      [query.tenantId, query.subjectId, query.conversationId],
    )
    const output = result.rows.length === 0 ? null : state(result.rows[0]!)
    await lease.query("COMMIT")
    clean = true
    return output
  } finally {
    lease.release(!clean)
  }
}
export async function changeArchiveState(pool: Pick<Pool, "connect">, command: ArchiveStateCommand): Promise<ArchiveStateResult> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const lease = await ArchiveSqlLease.acquire(pool, command)
    let clean = false
    try {
      await lease.begin()
      const identity = [command.tenantId, command.subjectId, command.conversationId]
      const prior = await lease.query(
        "SELECT project_ref FROM bff_conversation WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3 AND status='active'",
        identity,
      )
      if (!prior.rows[0]) {
        await lease.query("ROLLBACK")
        clean = true
        return { kind: "not_found" }
      }
      const source = prior.rows[0].project_ref
      let lockedParentId: unknown = null
      if (source !== null) {
        const parent = await lease.query(
          "SELECT project_id FROM bff_project WHERE tenant_id=$1 AND owner_id=$2 AND deleted_at IS NULL AND (project_id=$3 OR slug=$3)",
          [command.tenantId, command.subjectId, source],
        )
        if (parent.rows.length === 0) {
          await lease.query("ROLLBACK")
          clean = true
          return { kind: "not_found" }
        }
        if (parent.rows.length !== 1) throw new Error("ARCHIVE_PARENT_AMBIGUOUS")
        lockedParentId = parent.rows[0]!.project_id
        const locked = await lease.query(
          "SELECT project_id FROM bff_project WHERE tenant_id=$1 AND owner_id=$2 AND project_id=$3 AND deleted_at IS NULL FOR UPDATE",
          [command.tenantId, command.subjectId, parent.rows[0]!.project_id],
        )
        if (locked.rows.length !== 1) {
          await lease.query("ROLLBACK")
          clean = true
          continue
        }
      }
      const locked = await lease.query(
        "SELECT conversation_id,project_ref,archived_at FROM bff_conversation WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3 AND status='active' FOR UPDATE",
        identity,
      )
      if (!locked.rows[0]) {
        await lease.query("ROLLBACK")
        clean = true
        return { kind: "not_found" }
      }
      if (locked.rows[0].project_ref !== source) {
        await lease.query("ROLLBACK")
        clean = true
        continue
      }
      // Existing Project rename changes name only; slug is immutable. Recheck the current parent before receipts.
      const visible = await lease.query(
        `SELECT c.conversation_id FROM bff_conversation c WHERE c.tenant_id=$1 AND c.owner_id=$2 AND c.conversation_id=$3 AND c.status='active' AND ${validParent}`,
        identity,
      )
      if (visible.rows.length !== 1) {
        await lease.query("ROLLBACK")
        clean = true
        return { kind: "not_found" }
      }
      if (source !== null) {
        const resolved = await lease.query(
          "SELECT project_id FROM bff_project WHERE tenant_id=$1 AND owner_id=$2 AND deleted_at IS NULL AND (project_id=$3 OR slug=$3)",
          [command.tenantId, command.subjectId, source],
        )
        if (resolved.rows.length > 1) throw new Error("ARCHIVE_PARENT_AMBIGUOUS")
        if (resolved.rows.length !== 1 || resolved.rows[0]!.project_id !== lockedParentId) {
          await lease.query("ROLLBACK")
          clean = true
          continue
        }
      }
      const priorReceipt = await lease.query("SELECT fingerprint,status,response_body FROM bff_idempotency_receipt WHERE scope=$1", [command.scope])
      if (priorReceipt.rows[0]) {
        const receipt = priorReceipt.rows[0]
        await lease.query("COMMIT")
        clean = true
        if (receipt.fingerprint !== command.fingerprint) return { kind: "conflict" }
        const body = receipt.response_body as { data?: ArchiveState }
        if (
          Number(receipt.status) !== 200 ||
          !body ||
          Object.keys(body).sort().join() !== "data" ||
          !body.data ||
          Object.keys(body.data).sort().join() !== "archived_at,session_id" ||
          body.data.session_id !== command.conversationId ||
          (body.data.archived_at !== null && (typeof body.data.archived_at !== "string" || instant(body.data.archived_at) !== body.data.archived_at))
        )
          throw new Error("ARCHIVE_RECEIPT_INVALID")
        return { kind: "changed", receipt: { data: body.data } }
      }
      let current = state(locked.rows[0])
      if ((command.action === "archive") !== (current.archived_at !== null)) {
        const updated = await lease.query(
          `UPDATE bff_conversation SET archived_at=${command.action === "archive" ? "CURRENT_TIMESTAMP(3)" : "NULL"},updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3 AND status='active' RETURNING conversation_id,archived_at`,
          identity,
        )
        current = state(updated.rows[0]!)
      }
      const receipt = { data: current }
      const saved = await lease.query(
        "INSERT INTO bff_idempotency_receipt(scope,fingerprint,status,response_body) VALUES($1,$2,200,$3::jsonb) ON CONFLICT(scope) DO NOTHING RETURNING scope",
        [command.scope, command.fingerprint, JSON.stringify(receipt)],
      )
      if (saved.rows.length !== 1) {
        await lease.query("ROLLBACK")
        clean = true
        continue
      }
      await lease.query("COMMIT")
      clean = true
      return { kind: "changed", receipt }
    } finally {
      lease.release(!clean)
    }
  }
  throw new Error("ARCHIVE_RETRY_EXHAUSTED")
}
