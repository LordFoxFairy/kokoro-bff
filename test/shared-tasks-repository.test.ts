import assert from "node:assert/strict"
import test from "node:test"
import { listOwnedSharedTasks } from "../dist/infrastructure/postgres/shared-tasks.js"
const row = (id: string) => ({ conversation_id: id, title: "title", shared_at: new Date("2026-10-01T00:00:00.000Z"), expires_at: null })
function fixture(rows = [row("a"), row("b")]) {
  const calls: Array<{ sql: string; values?: unknown[] }> = []
  const releases: unknown[] = []
  const client = {
    on() {},
    removeListener() {},
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, ...(values ? { values } : {}) })
      return { rows: sql.startsWith("SELECT c.conversation") ? rows : [] }
    },
    release(value?: unknown) {
      releases.push(value)
    },
  }
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
test("shared query leases one read-only transaction and uses bound owner, keyset and all parent guards", async () => {
  const f = fixture()
  const signal = new AbortController().signal
  const page = await listOwnedSharedTasks(f.pool, "tenant", "owner", 1, null, signal, performance.now() + 1000)
  assert.deepEqual(page.nextPosition, { sharedAt: "2026-10-01T00:00:00.000Z", sessionId: "a" })
  assert.equal(page.items.length, 1)
  const query = f.calls.find((x) => x.sql.startsWith("SELECT c.conversation"))!
  assert.deepEqual(query.values, ["tenant", "owner", null, null, 2])
  for (const condition of [
    "c.owner_id=$2",
    "s.tenant_id=$1",
    "c.status='active'",
    "s.resource_kind='conversation'",
    "s.revoked_at IS NULL",
    "statement_timestamp()",
    "c.project_ref IS NULL OR EXISTS",
    "p.owner_id=c.owner_id",
    "p.deleted_at IS NULL",
    'ORDER BY s.created_at DESC,c.conversation_id COLLATE "C" ASC',
  ])
    assert.ok(query.sql.includes(condition), condition)
  assert.ok(!query.sql.split("FROM")[0]!.includes("share_id"))
  assert.ok(!query.sql.split("FROM")[0]!.includes("url"))
  assert.equal(f.calls[0]!.sql, "BEGIN READ ONLY")
  assert.equal(f.calls.at(-1)!.sql, "COMMIT")
  assert.deepEqual(f.releases, [false])
})
test("shared query respects anchor parameters and terminal empty page", async () => {
  const f = fixture([])
  const position = { sharedAt: "2026-10-01T00:00:00.000Z", sessionId: "z" }
  assert.deepEqual(await listOwnedSharedTasks(f.pool, "tenant", "owner", 20, position, new AbortController().signal, performance.now() + 1000), {
    items: [],
    nextPosition: null,
  })
  assert.deepEqual(f.calls[2]!.values, ["tenant", "owner", position.sharedAt, "z", 21])
})
test("shared query late acquisition releases only late client after bounded rejection", async () => {
  let resolve!: (v: unknown) => void
  const released: unknown[] = []
  const pool = {
    connect: () =>
      new Promise((r) => {
        resolve = r
      }),
  } as never
  await assert.rejects(listOwnedSharedTasks(pool, "tenant", "owner", 20, null, new AbortController().signal, performance.now() + 15))
  resolve({ release: (v: unknown) => released.push(v) })
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(released, [undefined])
})
test("shared query abort destroys exact active lease without COMMIT or pool shutdown", async () => {
  const controller = new AbortController()
  const releases: unknown[] = []
  const calls: string[] = []
  const client = {
    on() {},
    removeListener() {},
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
  }
  await assert.rejects(listOwnedSharedTasks({ connect: async () => client } as never, "tenant", "owner", 20, null, controller.signal, performance.now() + 1000))
  assert.deepEqual(releases, [true])
  assert.ok(!calls.includes("COMMIT"))
})
test("shared malformed row destroys contaminated lease rather than returning false empty page", async () => {
  const f = fixture([{ ...row("a"), shared_at: new Date(NaN) }])
  await assert.rejects(listOwnedSharedTasks(f.pool, "tenant", "owner", 20, null, new AbortController().signal, performance.now() + 1000))
  assert.deepEqual(f.releases, [true])
})

test("shared repository preserves SQL btrim-valid historical titles including tab and outer spaces", async () => {
  for (const title of ["\t", ` ${"x".repeat(200)} `]) {
    const f = fixture([{ ...row("a"), title }])
    const page = await listOwnedSharedTasks(f.pool, "tenant", "owner", 20, null, new AbortController().signal, performance.now() + 1000)
    assert.equal(page.items[0]!.title, title)
  }
})
