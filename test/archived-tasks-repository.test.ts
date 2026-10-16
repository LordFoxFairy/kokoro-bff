import assert from "node:assert/strict"
import test from "node:test"
import { EventEmitter } from "node:events"
import { listOwnedArchivedTasks, readArchiveState, changeArchiveState } from "../dist/infrastructure/postgres/archived-tasks.js"
const instant = "2026-10-15T00:00:00.000Z"
const identity = () => ({ tenantId: "tenant", subjectId: "owner", signal: new AbortController().signal, deadlineAt: performance.now() + 1000 })
function fixture(handler: (sql: string, values: unknown[]) => unknown[] = () => []) {
  const calls: Array<{ sql: string; values: unknown[] }> = [],
    releases: unknown[] = []
  const client = Object.assign(new EventEmitter(), {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      return { rows: handler(sql, values) }
    },
    release(value: unknown) {
      releases.push(value)
    },
  })
  return {
    calls,
    releases,
    pool: {
      async connect() {
        return client
      },
    } as never,
  }
}
test("archive list leases read-only owner filtered C ordered keyset and safe fields", async () => {
  const f = fixture((sql) =>
    sql.startsWith("SELECT c.conversation_id,c.title")
      ? [
          { conversation_id: "a", title: "\t", archived_at: new Date(instant), project_ref: null },
          { conversation_id: "😀", title: " x ", archived_at: new Date(instant), project_ref: null },
        ]
      : [],
  )
  const page = await listOwnedArchivedTasks(f.pool, { ...identity(), limit: 1, position: null })
  assert.deepEqual(page, {
    items: [{ session_id: "a", title: "\t", archived_at: instant, project_ref: null }],
    nextPosition: { archivedAt: instant, sessionId: "a" },
  })
  const sql = f.calls.find((c) => c.sql.startsWith("SELECT c.conversation_id,c.title"))!
  assert.deepEqual(sql.values, ["tenant", "owner", null, null, 2])
  for (const condition of [
    "c.status='active'",
    "c.archived_at IS NOT NULL",
    "c.project_ref IS NULL OR EXISTS",
    "p.owner_id=c.owner_id",
    "p.deleted_at IS NULL",
    'conversation_id COLLATE "C">$4::text COLLATE "C"',
    'ORDER BY c.archived_at DESC,c.conversation_id COLLATE "C" ASC',
  ])
    assert.ok(sql.sql.includes(condition), condition)
  assert.equal(f.calls[0]!.sql, "BEGIN READ ONLY")
  assert.equal(f.calls.at(-1)!.sql, "COMMIT")
  assert.deepEqual(f.releases, [false])
})
test("archive state is explicit null and foreign or deleted missing is not fabricated unarchived", async () => {
  const f = fixture((sql) => (sql.startsWith("SELECT c.conversation_id,c.archived_at") ? [{ conversation_id: "历史", archived_at: null }] : []))
  assert.deepEqual(await readArchiveState(f.pool, { ...identity(), conversationId: "历史" }), { session_id: "历史", archived_at: null })
  assert.equal(await readArchiveState(fixture().pool, { ...identity(), conversationId: "foreign" }), null)
})
function commandFixture(options: { archived?: string | null; receipt?: unknown; parent?: string | null; changedParent?: boolean; missing?: boolean } = {}) {
  let row = { conversation_id: "a", project_ref: options.parent ?? null, archived_at: options.archived ?? null }
  return fixture((sql) => {
    if (sql.startsWith("SELECT project_ref")) return options.missing ? [] : [{ project_ref: row.project_ref }]
    if (sql.startsWith("SELECT project_id")) return [{ project_id: "project-one" }]
    if (sql.startsWith("SELECT conversation_id,project_ref")) return [{ ...row, project_ref: options.changedParent ? "project-two" : row.project_ref }]
    if (sql.startsWith("SELECT c.conversation_id")) return [{ conversation_id: "a" }]
    if (sql.startsWith("SELECT fingerprint")) return options.receipt ? [options.receipt] : []
    if (sql.startsWith("UPDATE bff_conversation")) {
      row = { ...row, archived_at: sql.includes("archived_at=NULL") ? null : instant }
      return [row]
    }
    if (sql.startsWith("INSERT INTO")) return [{ scope: "scope" }]
    return []
  })
}
const command = () => ({ ...identity(), conversationId: "a", action: "archive" as const, scope: "scope", fingerprint: "fingerprint" })
test("archive command locks Project before Conversation and changes only organization timestamps plus receipt", async () => {
  const f = commandFixture({ parent: "project-one" })
  assert.deepEqual(await changeArchiveState(f.pool, command()), { kind: "changed", receipt: { data: { session_id: "a", archived_at: instant } } })
  assert.ok(
    f.calls.findIndex((c) => c.sql.includes("bff_project") && c.sql.includes("FOR UPDATE")) <
      f.calls.findIndex((c) => c.sql.includes("bff_conversation") && c.sql.includes("FOR UPDATE")),
  )
  const writes = f.calls.filter((c) => /^(UPDATE|INSERT|DELETE)/u.test(c.sql))
  assert.equal(writes.length, 2)
  assert.match(writes[0]!.sql, /SET archived_at=CURRENT_TIMESTAMP\(3\),updated_at=/u)
  assert.match(writes[1]!.sql, /bff_idempotency_receipt/u)
  assert.ok(!writes.some((c) => /bff_share|bff_agui|bff_agent/u.test(c.sql)))
})
test("same-state command preserves timestamps and historical replay never rewrites archive even after restore", async () => {
  const same = commandFixture({ archived: instant })
  await changeArchiveState(same.pool, command())
  assert.ok(!same.calls.some((c) => c.sql.startsWith("UPDATE")))
  const replay = commandFixture({
    archived: null,
    receipt: { fingerprint: "fingerprint", status: 200, response_body: { data: { archived_at: instant, session_id: "a" } } },
  })
  assert.deepEqual(await changeArchiveState(replay.pool, command()), { kind: "changed", receipt: { data: { archived_at: instant, session_id: "a" } } })
  assert.ok(!replay.calls.some((c) => /^(UPDATE|INSERT|DELETE)/u.test(c.sql)))
  assert.ok(replay.calls.findIndex((c) => c.sql.startsWith("SELECT c.conversation_id")) < replay.calls.findIndex((c) => c.sql.startsWith("SELECT fingerprint")))
})
test("archive conflict and deletion precedence never revive facts and move race retry is finite", async () => {
  const conflict = commandFixture({ receipt: { fingerprint: "different", status: 200, response_body: { data: { session_id: "a", archived_at: instant } } } })
  assert.deepEqual(await changeArchiveState(conflict.pool, command()), { kind: "conflict" })
  const missing = commandFixture({ missing: true, receipt: { fingerprint: "fingerprint" } })
  assert.deepEqual(await changeArchiveState(missing.pool, command()), { kind: "not_found" })
  assert.ok(!missing.calls.some((c) => c.sql.startsWith("SELECT fingerprint")))
  const moved = commandFixture({ parent: "project-one", changedParent: true })
  await assert.rejects(changeArchiveState(moved.pool, command()), /RETRY_EXHAUSTED/u)
  assert.equal(moved.calls.filter((c) => c.sql === "ROLLBACK").length, 4)
})
test("archive late pool acquisition is bounded and releases only late own client", async () => {
  let resolve!: (value: unknown) => void
  const releases: unknown[] = []
  const pool = {
    connect: () =>
      new Promise((r) => {
        resolve = r
      }),
  } as never
  await assert.rejects(readArchiveState(pool, { ...identity(), conversationId: "a", deadlineAt: performance.now() + 10 }))
  resolve({ release: (value: unknown) => releases.push(value) })
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(releases, [undefined])
})
test("archive cancelled in-flight SQL destroys exact lease once without subsequent COMMIT", async () => {
  const controller = new AbortController(),
    releases: unknown[] = [],
    calls: string[] = []
  const client = Object.assign(new EventEmitter(), {
    query(sql: string) {
      calls.push(sql)
      if (sql.startsWith("SELECT c.conversation")) {
        queueMicrotask(() => controller.abort())
        return new Promise(() => {})
      }
      return Promise.resolve({ rows: [] })
    },
    release(v: unknown) {
      releases.push(v)
    },
  })
  await assert.rejects(readArchiveState({ connect: async () => client } as never, { ...identity(), conversationId: "a", signal: controller.signal }))
  assert.deepEqual(releases, [true])
  assert.ok(!calls.includes("COMMIT"))
})
test("archive lease rechecks absolute clock immediately before microtask SQL dispatch, before timers run", async (t) => {
  const { ArchiveSqlLease } = await import("../dist/infrastructure/postgres/archive-sql-lease.js")
  let clock = 0
  t.mock.method(performance, "now", () => clock)
  const calls: string[] = [],
    releases: unknown[] = []
  const client = Object.assign(new EventEmitter(), {
    query(sql: string) {
      calls.push(sql)
      return Promise.resolve({ rows: [] })
    },
    release(value: unknown) {
      releases.push(value)
    },
  })
  const lease = await ArchiveSqlLease.acquire({ connect: async () => client } as never, {
    tenantId: "tenant",
    subjectId: "owner",
    signal: new AbortController().signal,
    deadlineAt: 10,
  })
  const pending = lease.query("COMMIT")
  clock = 11
  await assert.rejects(pending, /ARCHIVE_RETIRED/u)
  assert.deepEqual(calls, [], "no UPDATE/COMMIT may reach pg after the absolute deadline even before timeout callback")
  assert.deepEqual(releases, [true])
})
