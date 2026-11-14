import assert from "node:assert/strict"
import { test } from "node:test"
import { EventEmitter } from "node:events"
import { createProjectGrantStore } from "../src/infrastructure/postgres/project-grants.js"
const scope = { tenantId: "tenant", subjectId: "owner" }
const request = () => ({
  signal: new AbortController().signal,
  deadlineAt: performance.now() + 1000,
})
function fixture(commitFailure = false) {
  const releases: boolean[] = [],
    calls: string[] = []
  const client = Object.assign(new EventEmitter(), {
    async query(sql: string) {
      calls.push(sql)
      if (sql === "COMMIT" && commitFailure) throw Error("wire lost")
      return { rows: [] }
    },
    release(destroy: boolean) {
      releases.push(destroy)
    },
  })
  const store = createProjectGrantStore({
    connect: async () => client,
  } as never)
  return { store, releases, calls }
}
test("Project grant reads release their own transaction and unknown COMMIT retires the connection", async () => {
  const f = fixture(),
    q = request()
  assert.equal(await f.store.access(scope, "missing", q.signal, q.deadlineAt), null)
  assert.deepEqual(f.releases, [false])
  const unknown = fixture(true)
  await assert.rejects(() => unknown.store.access(scope, "missing", q.signal, q.deadlineAt))
  assert.deepEqual(unknown.releases, [true])
  assert.equal(unknown.calls.at(-1), "COMMIT", "no rollback command is sent over an unknown COMMIT")
})
test("cancelled checkout never starts late SQL and destroys only its acquired late client", async () => {
  let resolve!: (client: unknown) => void,
    writes = 0,
    destroyed = false
  const store = createProjectGrantStore({
    connect: () =>
      new Promise((r) => {
        resolve = r
      }),
  } as never)
  const controller = new AbortController()
  const pending = store.access(scope, "project", controller.signal, performance.now() + 1000)
  controller.abort()
  await assert.rejects(() => pending)
  resolve({
    query: () => {
      writes++
    },
    release: (broken: boolean) => {
      destroyed = broken
    },
  })
  await new Promise((r) => setImmediate(r))
  assert.equal(writes, 0)
  assert.equal(destroyed, true)
})
