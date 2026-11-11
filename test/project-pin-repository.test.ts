import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import { listProjectPins, setProjectPin } from "../src/infrastructure/postgres/project-pin.ts"
const scope = { tenantId: "tenant", subjectId: "subject", projectId: "project" }
const query = () => ({ ...scope, signal: new AbortController().signal, deadlineAt: performance.now() + 1000 })
function fixture({ found = true, commitFailure = false } = {}) {
  let current: Date | null = null
  const calls: Array<{ sql: string; values?: unknown[] }> = [],
    releases: unknown[] = []
  const client = Object.assign(new EventEmitter(), {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, ...(values ? { values } : {}) })
      if (sql.startsWith("SELECT project_id FROM bff_project")) return { rows: found ? [{ project_id: "project" }] : [] }
      if (sql.startsWith("INSERT INTO bff_project_pin")) current ??= new Date("2026-10-27T00:00:00.000Z")
      if (sql.startsWith("DELETE FROM bff_project_pin")) current = null
      if (sql.startsWith("SELECT project_id,pinned_at")) return { rows: current ? [{ project_id: "project", pinned_at: current }] : [] }
      if (sql.startsWith("SELECT p.project_id")) return { rows: found ? [{ project_id: "project", pinned_at: current }] : [] }
      if (sql === "COMMIT" && commitFailure) throw new Error("wire lost")
      return { rows: [] }
    },
    release(broken?: unknown) {
      assert.ok(client.listenerCount("error") > 0, "leased error guard survives release")
      releases.push(broken)
    },
  })
  return { database: { pool: { connect: async () => client } } as never, calls, releases }
}
test("pin state is naturally idempotent, keeps the first timestamp, and never updates Project metadata", async () => {
  const f = fixture()
  const first = await setProjectPin(f.database, { ...query(), isPinned: true })
  assert.deepEqual(await setProjectPin(f.database, { ...query(), isPinned: true }), first)
  assert.deepEqual(await listProjectPins(f.database, { ...query(), limit: 1, position: null }), {
    items: [{ projectId: "project", pinnedAt: first!.pinnedAt }],
    nextPosition: null,
  })
  assert.deepEqual(await setProjectPin(f.database, { ...query(), isPinned: false }), { projectId: "project", isPinned: false, pinnedAt: null })
  assert.deepEqual(await listProjectPins(f.database, { ...query(), limit: 1, position: null }), { items: [], nextPosition: null })
  assert.ok(f.calls.every((c) => !c.sql.startsWith("UPDATE bff_project") && !c.sql.includes("receipt")))
  assert.ok(
    f.calls
      .filter((c) => c.sql.startsWith("SELECT project_id FROM bff_project"))
      .every((c) => c.sql.endsWith("FOR UPDATE") && JSON.stringify(c.values) === JSON.stringify(["tenant", "subject", "project"])),
  )
  assert.ok(f.releases.every((value) => value === false))
})
test("invisible parent is distinct from accessible unpinned; unknown COMMIT retires the connection", async () => {
  const f = fixture({ found: false })
  assert.equal(await setProjectPin(f.database, { ...query(), isPinned: false }), null)
  assert.equal(await listProjectPins(f.database, { ...query(), limit: 1, position: null }), null)
  assert.ok(f.calls.every((c) => !c.sql.startsWith("INSERT") && !c.sql.startsWith("DELETE")))
  const unknown = fixture({ commitFailure: true })
  await assert.rejects(() => setProjectPin(unknown.database, { ...query(), isPinned: true }), /COMMIT_UNKNOWN/)
  assert.deepEqual(unknown.releases, [true])
})
test("a timed out lease acquisition cannot start late SQL and only releases its own late client", async () => {
  let resolve!: (client: unknown) => void
  let writes = 0,
    released = 0
  const database = {
    pool: {
      connect: () =>
        new Promise((r) => {
          resolve = r
        }),
    },
  } as never
  await assert.rejects(() => setProjectPin(database, { ...query(), isPinned: true, deadlineAt: performance.now() + 10 }))
  resolve({
    query: () => {
      writes++
    },
    release: () => {
      released++
    },
  })
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(writes, 0)
  assert.equal(released, 1)
})
