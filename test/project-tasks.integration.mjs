import "reflect-metadata"

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { Test } from "@nestjs/testing"
import { Pool } from "pg"

import { BFF_CONFIG, BFF_DATABASE, SESSION_ADMISSION } from "../dist/common/tokens.js"
import { loadConfig } from "../dist/config/runtime.js"
import { BffExpressAdapter } from "../dist/http/bff-express-adapter.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../dist/main.js"
import { ProjectsModule } from "../dist/modules/projects/projects.module.js"
import { fixtureSessionHeaders, SessionAdmissionDouble, TEST_WEB_ORIGIN } from "./doubles/session-admission.ts"

const revisionPattern = /^ptask_[A-Za-z0-9_-]{43}$/u
const revisionTime = ["2026-10-01T01:02:03.456Z", "2026-10-01T01:02:03.456Z", "2026-09-30T01:02:03.456Z"]

function localFixtureUrl(raw, kind) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    assert.fail(`a dedicated loopback ${kind} fixture URL is required`)
  }
  assert.ok(["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname) && parsed.hash === "", `only loopback ${kind} fixture is allowed`)
  if (kind === "PostgreSQL") {
    assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol))
    assert.match(parsed.pathname, /^\/kokoro_bff_project_tasks_[0-9a-f]{32}$/u, "an owned A-07 fixture database is required")
    assert.deepEqual(parsed.searchParams.getAll("schema"), ["kokoro_bff"])
    assert.ok([...parsed.searchParams.keys()].every((key) => ["schema", "sslmode", "connect_timeout", "application_name"].includes(key)))
  } else {
    assert.equal(parsed.protocol, "redis:")
    assert.equal(parsed.search, "")
    assert.match(parsed.pathname, /^\/(?:[1-9]|1[0-5])$/u, "an explicit nondefault test logical DB is required")
  }
  return parsed
}

function success(response, status) {
  assert.equal(response.status, status, `${response.method} ${response.operation} must return ${status}, got ${response.body?.error?.code ?? "no error code"}`)
  assert.deepEqual(Object.keys(response.body).sort(), ["data", "meta"])
  assert.deepEqual(response.body.meta, { request_id: response.requestId })
  return response.body.data
}

function taskReceipt(response, status, projectId, taskId) {
  const data = success(response, status)
  assert.deepEqual(Object.keys(data).sort(), ["id", "project_id", "revision"])
  assert.equal(data.project_id, projectId)
  assert.match(data.revision, revisionPattern)
  if (taskId === undefined) assert.match(data.id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u)
  else assert.equal(data.id, taskId)
  return data
}

function failure(response, status, code) {
  assert.equal(response.status, status, `${response.method} ${response.operation} expected ${code}`)
  assert.equal(response.body?.error?.code, code)
  assert.equal(Object.hasOwn(response.body, "data"), false)
}

test("A-07 real Nest Projects and PG preserve legacy task reads, durable replay, CAS/ABA, and parent ownership", { timeout: 30_000 }, async (t) => {
  const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
  const redisUrl = process.env.KOKORO_TEST_REDIS_URL
  const target = localFixtureUrl(postgresUrl, "PostgreSQL")
  localFixtureUrl(redisUrl, "Redis")
  const tenant = `a07_${randomUUID()}`
  const projectId = `project_${randomUUID()}`
  const slug = `fixture-${randomUUID()}`
  const owner = `owner_${randomUUID()}`
  const secret = "a07-fixture-web-secret"
  const admissions = new SessionAdmissionDouble({
    "a07-owner": { namespace: tenant, userId: owner },
    "a07-other-owner": { namespace: tenant, userId: `other_${randomUUID()}` },
    "a07-other-tenant": { namespace: `${tenant}_other`, userId: owner },
  })
  const config = loadConfig({
    KOKORO_BFF_POSTGRES_URL: postgresUrl,
    KOKORO_BFF_REDIS_URL: redisUrl,
    KOKORO_BFF_SHARED_SECRET: secret,
    KOKORO_IAM_WEB_ORIGIN: TEST_WEB_ORIGIN,
    KOKORO_TENANT_ID: tenant,
    KOKORO_AGENT_ENABLED: "false",
  })
  const observer = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 2 })
  let app
  // Root owns database allocation/reclamation; this test never truncates or drops.
  t.after(async () => {
    try {
      await app?.close()
    } finally {
      await observer.end()
    }
  })
  const owned = await observer.query("SELECT current_database() AS database, current_schema() AS schema")
  assert.deepEqual(owned.rows, [{ database: target.pathname.slice(1), schema: "kokoro_bff" }])
  const module = await Test.createTestingModule({ imports: [ProjectsModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(SESSION_ADMISSION)
    .useValue(admissions)
    .compile()
  app = module.createNestApplication(new BffExpressAdapter(), { ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  await app.get(BFF_DATABASE).ready()
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()

  const collection = `/v1/projects/${projectId}/tasks`
  const slugCollection = `/v1/projects/${slug}/tasks`
  const parent = `/v1/projects/${projectId}`
  let serial = 0
  const call = async (path, { method = "GET", body, key, revision, session = "a07-owner" } = {}) => {
    const requestId = `a07-request-${++serial}`
    const response = await fetch(base + path, {
      method,
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": secret,
        "x-request-id": requestId,
        ...fixtureSessionHeaders(session),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(key === undefined ? {} : { "idempotency-key": key }),
        ...(revision === undefined ? {} : { "if-match": `"${revision}"` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(6000),
    })
    const text = await response.text()
    return {
      status: response.status,
      body: text === "" ? null : JSON.parse(text),
      location: response.headers.get("location"),
      method,
      operation: path === parent ? "project" : "tasks",
      requestId,
    }
  }
  const list = async (path = collection) => {
    const data = success(await call(path), 200)
    assert.deepEqual(Object.keys(data), ["tasks"])
    assert.ok(Array.isArray(data.tasks))
    return data.tasks
  }
  const count = async () =>
    (await observer.query("SELECT count(*)::int AS n FROM bff_project_task WHERE tenant_id=$1 AND project_id=$2", [tenant, projectId])).rows[0].n

  await observer.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,$3,'A-07 fixture',$4)", [projectId, tenant, owner, slug])
  const oldId = (suffix) => `task_${projectId.slice(8)}_${suffix}`
  const legacy = [
    { id: oldId("a"), project_id: projectId, title: "Old task A", status: "done", updated_at: revisionTime[0] },
    { id: oldId("b"), project_id: projectId, title: "Old task B", status: "todo", updated_at: revisionTime[1] },
    { id: oldId("c"), project_id: projectId, title: "Old task C", status: "in_progress", updated_at: revisionTime[2] },
  ]
  for (const item of [legacy[1], legacy[2], legacy[0]]) {
    await observer.query("INSERT INTO bff_project_task(task_id,tenant_id,project_id,title,status,updated_at) VALUES($1,$2,$3,$4,$5,$6)", [
      item.id,
      tenant,
      projectId,
      item.title,
      item.status,
      item.updated_at,
    ])
  }

  const create = { method: "POST", key: "a07-create", body: { title: "New task" } }
  const first = await call(collection, create)
  const initial = taskReceipt(first, 201, projectId)
  const member = `${collection}/${initial.id}`
  assert.equal(first.location, member)
  const replay = await call(collection, create)
  assert.deepEqual(taskReceipt(replay, 201, projectId, initial.id), initial)
  assert.equal(replay.location, member)
  failure(await call(collection, { ...create, body: { title: "Different" } }), 409, "idempotency_conflict")
  assert.equal(await count(), 4)

  const fromCanonical = await list()
  assert.deepEqual(await list(slugCollection), fromCanonical)
  const [created, ...old] = fromCanonical
  assert.deepEqual(
    { id: created.id, project_id: created.project_id, title: created.title, status: created.status, revision: created.revision },
    { ...initial, title: "New task", status: "todo" },
  )
  assert.deepEqual(
    old.map(({ revision, ...projection }) => (assert.match(revision, revisionPattern), projection)),
    legacy,
  )
  assert.equal(new Set(fromCanonical.map(({ revision }) => revision)).size, 4)

  const changes = [
    { method: "PATCH", key: "a07-left", revision: initial.revision, body: { title: "First contender", status: "in_progress" } },
    { method: "PATCH", key: "a07-right", revision: initial.revision, body: { title: "Second contender", status: "done" } },
  ]
  const competing = await Promise.all(changes.map((options) => call(member, options)))
  assert.deepEqual(competing.map(({ status }) => status).sort(), [200, 412])
  const winning = competing.findIndex(({ status }) => status === 200)
  const winner = taskReceipt(competing[winning], 200, projectId, initial.id)
  failure(competing[1 - winning], 412, "project_task_precondition_failed")
  assert.notEqual(winner.revision, initial.revision)
  const readTask = async () => (await list()).find(({ id }) => id === initial.id)
  const won = await readTask()
  assert.deepEqual({ title: won.title, status: won.status, revision: won.revision }, { ...changes[winning].body, revision: winner.revision })

  const undo = { method: "PATCH", key: "a07-aba", revision: winner.revision, body: { title: created.title, status: created.status } }
  const restored = taskReceipt(await call(member, undo), 200, projectId, initial.id)
  assert.notEqual(restored.revision, initial.revision, "an effective ABA write must never revive an obsolete version")
  assert.notEqual(restored.revision, winner.revision)
  failure(await call(member, { ...changes[1 - winning], key: "a07-stale-after-aba" }), 412, "project_task_precondition_failed")
  assert.deepEqual(
    taskReceipt(await call(member, changes[winning]), 200, projectId, initial.id),
    winner,
    "exact replay returns the original ACK, not current state",
  )
  assert.deepEqual(
    taskReceipt(await call(member, { ...undo, key: "a07-noop", revision: restored.revision }), 200, projectId, initial.id),
    restored,
    "same representation preserves revision",
  )
  const afterAba = await readTask()
  assert.deepEqual({ title: afterAba.title, status: afterAba.status, revision: afterAba.revision }, { ...undo.body, revision: restored.revision })

  failure(await call(collection, { session: "a07-other-owner" }), 404, "project_not_found")
  failure(await call(collection, { ...create, session: "a07-other-owner" }), 404, "project_not_found")
  failure(await call(member, { ...undo, session: "a07-other-owner" }), 404, "project_not_found")
  failure(await call(collection, { ...create, session: "a07-other-tenant" }), 403, "product_tenant_forbidden")

  const erase = { method: "DELETE", key: "a07-delete", revision: restored.revision }
  for (const result of [await call(member, erase), await call(member, erase)]) {
    assert.equal(result.status, 204)
    assert.equal(result.body, null)
  }
  assert.equal((await call(member, { ...erase, key: "a07-missing" })).status, 404)
  assert.equal(await count(), 3)

  // Seed old-format rows in one statement, never send 197 HTTP mutations just
  // to reach the production cap. The existing creation receipt remains valid.
  await observer.query(
    "INSERT INTO bff_project_task(task_id,tenant_id,project_id,title,status,updated_at) SELECT $3 || n::text,$1,$2,'Cap fixture','todo',$4 FROM generate_series(1,197) n",
    [tenant, projectId, oldId("cap_"), revisionTime[2]],
  )
  assert.equal(await count(), 200)
  failure(await call(collection, { ...create, key: "a07-over-cap" }), 409, "project_task_limit_reached")
  assert.deepEqual(taskReceipt(await call(collection, create), 201, projectId, initial.id), initial)
  assert.equal(await count(), 200)

  // The public parent Delete uses the same real owner transaction; no fixture
  // SQL deletes or tombstones the Project or its task rows.
  assert.equal((await call(parent, { method: "DELETE", key: "a07-parent-delete" })).status, 202)
  assert.equal(
    (await observer.query("SELECT deleted_at IS NOT NULL AS tombstone FROM bff_project WHERE tenant_id=$1 AND project_id=$2", [tenant, projectId])).rows[0]
      .tombstone,
    true,
  )
  assert.equal(await count(), 0)
  failure(await call(slugCollection), 404, "project_not_found")
  failure(await call(collection, create), 404, "project_not_found")
  failure(await call(member, changes[winning]), 404, "project_not_found")
  failure(await call(member, erase), 404, "project_not_found")
})
