import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import { findActiveResourceProjectId } from "../src/infrastructure/postgres/project-resource-access.ts"

const scope = { tenantId: "tenant", subjectId: "owner" }
const projectId = "project_35ce205c-26e7-4532-b94f-de2d0a2c113d"
function fixture(queryHook = () => undefined) {
  const calls = [],
    releases = []
  const client = Object.assign(new EventEmitter(), {
    async query(text, values) {
      calls.push({ text, values })
      return (await queryHook(text, values)) ?? { rows: text.startsWith("SELECT project_id") ? [{ project_id: projectId }] : [] }
    },
    release(destroy) {
      releases.push(destroy === true)
    },
  })
  return {
    client,
    calls,
    releases,
    database: {
      pool: {
        async connect() {
          return client
        },
      },
    },
  }
}

test("resource access uses only current owner/tenant/active ID or slug and closes its read transaction", async () => {
  const f = fixture(),
    signal = new AbortController().signal
  assert.equal(await findActiveResourceProjectId(f.database, scope, "slug", signal, performance.now() + 2000), projectId)
  assert.equal(f.calls[0].text, "BEGIN READ ONLY")
  const settings = f.calls[1]
  assert.match(settings.text, /client_connection_check_interval','100ms'/u)
  assert.ok(Number.parseInt(settings.values[0]) <= 1000)
  assert.ok(Number.parseInt(settings.values[1]) <= 2000)
  assert.match(f.calls[2].text, /tenant_id=\$1 AND owner_id=\$2 AND deleted_at IS NULL AND \(project_id=\$3 OR slug=\$3\)/u)
  assert.deepEqual(f.calls[2].values, ["tenant", "owner", "slug"])
  assert.equal(f.calls[3].text, "COMMIT")
  assert.deepEqual(f.releases, [false])
  assert.equal(f.client.listenerCount("error"), 0)
  const empty = fixture((text) => (text.startsWith("SELECT project_id") ? { rows: [] } : undefined))
  assert.equal(await findActiveResourceProjectId(empty.database, scope, "other", signal, performance.now() + 1000), null)
  assert.deepEqual(empty.releases, [false])
})

test("resource access cancels pending checkout and releases a late lease once with no SQL", async () => {
  let acquire,
    starts = 0
  const f = fixture(),
    controller = new AbortController()
  f.database.pool.connect = () => {
    starts++
    return new Promise((resolve) => {
      acquire = resolve
    })
  }
  const work = findActiveResourceProjectId(f.database, scope, projectId, controller.signal, performance.now() + 1000)
  controller.abort()
  await assert.rejects(work)
  assert.equal(starts, 1)
  assert.deepEqual(f.calls, [])
  acquire(f.client)
  await new Promise(setImmediate)
  assert.deepEqual(f.releases, [false])
  assert.deepEqual(f.calls, [])
})

for (const interruption of ["abort", "deadline", "connection-error"])
  test(`resource access ${interruption} destroys exactly the leased client without guessed rollback`, async () => {
    let entered, settle
    const ready = new Promise((resolve) => {
      entered = resolve
    })
    const pending = new Promise((resolve) => {
      settle = resolve
    })
    const f = fixture((text) => {
        if (text.startsWith("SELECT project_id")) {
          entered()
          return pending
        }
      }),
      controller = new AbortController()
    const work = findActiveResourceProjectId(f.database, scope, projectId, controller.signal, performance.now() + (interruption === "deadline" ? 100 : 1000))
    await ready
    if (interruption === "abort") controller.abort()
    if (interruption === "connection-error") f.client.emit("error", Error("private connection"))
    await assert.rejects(work)
    assert.deepEqual(f.releases, [true])
    assert.equal(f.client.listenerCount("error"), 0)
    assert.equal(f.calls.length, 3)
    settle({ rows: [{ project_id: projectId }] })
    await new Promise(setImmediate)
    assert.equal(f.calls.length, 3)
    assert.deepEqual(f.releases, [true])
  })

test("resource access pre-abort and checkout failure never start SQL or release another lease", async () => {
  const f = fixture(),
    controller = new AbortController()
  controller.abort()
  let starts = 0
  f.database.pool.connect = async () => {
    starts++
    throw Error("private PG failure")
  }
  await assert.rejects(findActiveResourceProjectId(f.database, scope, projectId, controller.signal, performance.now() + 1000))
  assert.equal(starts, 0)
  await assert.rejects(findActiveResourceProjectId(f.database, scope, projectId, new AbortController().signal, performance.now() + 1000))
  assert.equal(starts, 1)
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.releases, [])
})

test("resource access checkout deadline returns before a late lease and releases it once without SQL or listeners", async () => {
  let acquire,
    starts = 0
  const f = fixture(),
    controller = new AbortController()
  f.database.pool.connect = () => {
    starts++
    return new Promise((resolve) => {
      acquire = resolve
    })
  }
  const started = performance.now(),
    deadline = started + 50
  await assert.rejects(findActiveResourceProjectId(f.database, scope, projectId, controller.signal, deadline), /ASSET_DOWNLOAD_INTERRUPTED/u)
  assert.ok(performance.now() - started < 800)
  assert.equal(controller.signal.aborted, false, "the unchanged absolute deadline retires the caller")
  assert.equal(starts, 1)
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.releases, [])
  acquire(f.client)
  await new Promise(setImmediate)
  assert.deepEqual(f.releases, [false])
  assert.deepEqual(f.calls, [])
  assert.equal(f.client.listenerCount("error"), 0)
})
