import assert from "node:assert/strict"
import test from "node:test"
import { EventEmitter } from "node:events"
import { PostgresScheduledTaskRunsReader } from "../src/infrastructure/postgres/scheduled-task-runs.ts"
const query = () => ({
  tenantId: "t",
  subjectId: "s",
  taskId: null,
  limit: 20,
  position: null,
  signal: new AbortController().signal,
  deadlineAt: performance.now() + 1000,
})
function fixture(handler: (sql: string, values: unknown[]) => unknown = () => ({ rows: [] })) {
  const calls: { sql: string; values: unknown[] }[] = [],
    releases: unknown[] = []
  const client = Object.assign(new EventEmitter(), {
    query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      return Promise.resolve(handler(sql, values))
    },
    release(value?: unknown) {
      releases.push(value)
    },
  })
  return { client, calls, releases, pool: { connect: async () => client } as never }
}
test("repository uses read-only bounded lease and one SQL statement with qualifier before L+1", async () => {
  const f = fixture((sql) => ({ rows: sql.startsWith("WITH eligible") ? [{ snapshot: JSON.stringify({ taskExists: true, rows: [] }) }] : [] }))
  const result = await new PostgresScheduledTaskRunsReader(f.pool).readSnapshot(query())
  assert.deepEqual(result, { taskExists: true, rows: [] })
  const sql = f.calls.find((c) => c.sql.startsWith("WITH eligible"))!
  for (const required of [
    "t.owner_id=$2",
    "p.owner_id=t.owner_id",
    "p.deleted_at IS NULL",
    "JOIN eligible",
    "t.owner_id=d.subject_id",
    'COLLATE "C" DESC LIMIT $6',
    "e.source_run_id=c.run_id",
    "LIMIT 2",
    "octet_length(x.source_payload::text)<=65536",
    "octet_length(snapshot::text)<=1048576",
  ])
    assert.ok(sql.sql.includes(required), required)
  assert.deepEqual(sql.values, ["t", "s", null, null, null, 21])
  assert.equal(f.calls[0]!.sql, "BEGIN READ ONLY")
  assert.equal(f.calls.at(-1)!.sql, "COMMIT")
  assert.deepEqual(f.releases, [false])
  assert.ok(!/FOR UPDATE|UPDATE |INSERT |DELETE /u.test(sql.sql))
})
test("repository size marker or malformed page never commits", async () => {
  for (const snapshot of [null, "{", "x".repeat(1048577)]) {
    const f = fixture((sql) => ({ rows: sql.startsWith("WITH eligible") ? [{ snapshot }] : [] }))
    await assert.rejects(new PostgresScheduledTaskRunsReader(f.pool).readSnapshot(query()))
    assert.ok(!f.calls.some((c) => c.sql === "COMMIT"))
    assert.deepEqual(f.releases, [true])
  }
})
test("late pool checkout returns exact lease once and issues zero SQL", async () => {
  let resolve!: (client: unknown) => void
  const f = fixture(),
    reader = new PostgresScheduledTaskRunsReader({
      connect: () =>
        new Promise((r) => {
          resolve = r
        }),
    } as never)
  await assert.rejects(reader.readSnapshot({ ...query(), deadlineAt: performance.now() + 15 }))
  resolve(f.client)
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(f.releases, [undefined])
  assert.deepEqual(f.calls, [])
})
test("noncooperative SQL abort destroys exact lease once and absorbs late success", async () => {
  let resolve!: (value: unknown) => void
  const c = new AbortController(),
    f = fixture((sql) =>
      sql.startsWith("WITH eligible")
        ? new Promise((r) => {
            resolve = r
            queueMicrotask(() => c.abort())
          })
        : { rows: [] },
    )
  await assert.rejects(new PostgresScheduledTaskRunsReader(f.pool).readSnapshot({ ...query(), signal: c.signal }))
  resolve({ rows: [{ snapshot: '{"taskExists":true,"rows":[]}' }] })
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(f.releases, [true])
  assert.equal(f.client.listenerCount("error"), 0)
  assert.ok(!f.calls.some((c) => c.sql === "COMMIT"))
})
test("deadline-first acquisition never calls pool", async () => {
  let calls = 0
  const pool = {
    connect: async () => {
      calls++
      throw Error("must not run")
    },
  } as never
  await assert.rejects(new PostgresScheduledTaskRunsReader(pool).readSnapshot({ ...query(), deadlineAt: performance.now() - 1 }))
  assert.equal(calls, 0)
})
