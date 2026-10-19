import { request as httpRequest } from "node:http"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { Pool } from "pg"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { createBffServer } from "../dist/main.js"
import { PostgresBffRepositories } from "../dist/infrastructure/postgres/repositories.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
const pg = process.env.KOKORO_TEST_POSTGRES_URL,
  redis = process.env.KOKORO_TEST_REDIS_URL
const integration = pg && redis ? test : test.skip
async function fixture(t) {
  const tenant = `knowledge-${randomUUID()}`,
    actor = `owner-${randomUUID()}`
  const store = new PostgresBffRepositories(pg, redis)
  await store.ready()
  const admission = new SessionAdmissionDouble()
  admission.allow("owner", { namespace: tenant, userId: actor })
  admission.allow("other", { namespace: tenant, userId: "other" })
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: tenant,
    iamBaseUrl: null,
    sharedSecret: "web-secret",
    upstreamSecret: "bff-secret",
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1048576,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: pg,
    redisUrl: redis,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { system: null, capability: null, storage: null, scheduler: null, agents: null, billing: null },
  }
  const server = createBffServer(config, { businessStore: store, sessionAdmission: admission, readiness: async () => undefined })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const pool = new Pool({ connectionString: pg, options: "-c search_path=kokoro_bff" })
  t.after(async () => {
    await server.shutdown()
    await store.close()
    await pool.end()
  })
  const call = async (path, method = "GET", body, token = "owner", extra = {}) => {
    const response = await fetch(base + "/v1/preferences/" + path, {
      method,
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "web-secret",
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    })
    return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers }
  }
  const chunked = (path, method, body) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        base + "/v1/preferences/" + path,
        {
          method,
          headers: {
            "x-kokoro-service": "web-bff",
            "x-kokoro-internal-secret": "web-secret",
            authorization: "Bearer owner",
            "content-type": "application/json",
            "transfer-encoding": "chunked",
          },
        },
        (res) => {
          const chunks = []
          res.on("data", (c) => chunks.push(c))
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              body: res.statusCode === 204 ? null : Buffer.concat(chunks).length ? JSON.parse(Buffer.concat(chunks).toString()) : null,
            }),
          )
        },
      )
      req.once("error", reject)
      req.write(body.slice(0, 10))
      req.end(body.slice(10))
    })
  return { call, chunked, store, pool, tenant, actor }
}
integration("personal knowledge is caller scoped, CAS protected, searchable, and deletion cannot resurrect an ID", async (t) => {
  const f = await fixture(t),
    id = randomUUID(),
    path = `knowledge/${id}`
  assert.deepEqual((await f.call("knowledge")).body, { data: { items: [], max_items: 100 } })
  assert.deepEqual((await f.call("knowledge-usage")).body, { data: { enabled: false, revision: 0 } })
  const fields = { name: " 中文 🌿 ", when_to_use: "When preparing a report", content: "first\nSecond" }
  const created = await f.call(path, "PUT", { expected_revision: 0, ...fields })
  assert.equal(created.status, 201)
  assert.equal(created.headers.get("location"), `/v1/preferences/${path}`)
  assert.equal(created.body.data.revision, 1)
  assert.equal(created.body.data.content, fields.content)
  assert.equal((await f.call(path, "GET", undefined, "other")).status, 404)
  assert.equal((await f.call("knowledge?query=REPORT")).body.data.items.length, 1)
  assert.equal((await f.call("knowledge?query=%25")).body.data.items.length, 0)
  const race = await Promise.all(["left", "right"].map((content) => f.call(path, "PUT", { expected_revision: 1, ...fields, content })))
  assert.deepEqual(race.map((x) => x.status).sort(), [200, 409])
  const winner = (await f.call(path)).body.data
  assert.equal(winner.revision, 2)
  assert.equal((await f.call("knowledge-usage", "PUT", { expected_revision: 0, enabled: true })).status, 200)
  assert.equal((await f.call("knowledge-usage", "PUT", { expected_revision: 0, enabled: false })).status, 409)
  assert.equal((await f.call(path, "DELETE", { expected_revision: 2 })).status, 204)
  assert.equal((await f.call(path, "DELETE", { expected_revision: 2 })).status, 204)
  assert.equal((await f.call(path)).status, 404)
  assert.equal((await f.call(path, "PUT", { expected_revision: 0, ...fields })).status, 409)
  assert.equal((await f.call("knowledge")).body.data.items.length, 0)
  assert.deepEqual((await f.call("knowledge-usage")).body, { data: { enabled: true, revision: 1 } })
  const tombstone = await f.pool.query(
    "SELECT name,when_to_use,content,revision,deleted_at FROM bff_personal_knowledge WHERE tenant_id=$1 AND owner_id=$2 AND knowledge_id=$3",
    [f.tenant, f.actor, id],
  )
  assert.deepEqual([tombstone.rows[0].name, tombstone.rows[0].when_to_use, tombstone.rows[0].content], ["", "", ""])
  assert.ok(tombstone.rows[0].deleted_at instanceof Date)
})
integration("knowledge admission rejects foreign scopes and closed-input violations without writing", async (t) => {
  const f = await fixture(t),
    path = `knowledge/${randomUUID()}`,
    fields = { name: "n", when_to_use: "w", content: "c" }
  for (const body of [
    { expected_revision: 0, ...fields, tenant_id: "foreign" },
    { expected_revision: 0, ...fields, name: "\u2003" },
    { expected_revision: 0, ...fields, content: "🌿".repeat(2001) },
    '{"expected_revision":0,"expected_revision":0,"name":"n","when_to_use":"w","content":"c"}',
  ])
    assert.equal((await f.call(path, "PUT", body)).status, 400)
  for (const query of ["knowledge?query=x&query=y", "knowledge?owner_id=other", "knowledge-usage?query=x", "knowledge?="])
    assert.equal((await f.call(query)).status, 400, query)
  assert.equal((await f.call(path, "PUT", { expected_revision: 0, ...fields }, "owner", { "idempotency-key": "not-accepted" })).status, 400)
  assert.equal((await f.call(path, "GET", undefined, "missing")).status, 401)
  const count = await f.pool.query("SELECT count(*)::int AS count FROM bff_personal_knowledge WHERE tenant_id=$1", [f.tenant])
  assert.equal(count.rows[0].count, 0)
  const usageCount = await f.pool.query("SELECT count(*)::int AS count FROM bff_personal_knowledge_usage WHERE tenant_id=$1", [f.tenant])
  assert.equal(usageCount.rows[0].count, 0)
})
integration("knowledge capacity serializes concurrent creates, not updates or other callers", async (t) => {
  const f = await fixture(t),
    scope = { tenantId: f.tenant, subjectId: f.actor },
    repo = f.store.services.personalKnowledge,
    fields = { name: "n", when_to_use: "w", content: "c" }
  const options = () => ({ signal: new AbortController().signal, deadline: performance.now() + 5000 })
  const first = randomUUID()
  assert.equal((await repo.replace(scope, first, 0, fields, options())).kind, "ok")
  for (let n = 1; n < 99; n++) assert.equal((await repo.replace(scope, randomUUID(), 0, fields, options())).kind, "ok")
  const races = await Promise.all([randomUUID(), randomUUID()].map((id) => f.call(`knowledge/${id}`, "PUT", { expected_revision: 0, ...fields })))
  assert.deepEqual(races.map((x) => x.status).sort(), [201, 409])
  assert.equal(races.find((x) => x.status === 409).body.error.code, "knowledge_limit_exceeded")
  assert.equal((await f.call("knowledge")).body.data.items.length, 100)
  assert.equal((await f.call(`knowledge/${first}`, "PUT", { expected_revision: 1, ...fields, content: "updated at capacity" })).status, 200)
  assert.equal((await f.call(`knowledge/${randomUUID()}`, "PUT", { expected_revision: 0, ...fields }, "other")).status, 201)
  assert.equal((await f.call(`knowledge/${first}`, "DELETE", { expected_revision: 2 })).status, 204)
  assert.equal((await f.call(`knowledge/${randomUUID()}`, "PUT", { expected_revision: 0, ...fields })).status, 201)
})
integration("knowledge commit ACK loss recovers original identity and cancellation rolls back an inserted fact", async (t) => {
  const f = await fixture(t),
    scope = { tenantId: f.tenant, subjectId: f.actor },
    fields = { name: "n", when_to_use: "w", content: "c" }
  const { PostgresPersonalKnowledgeRepository } = await import("../dist/infrastructure/postgres/personal-knowledge-repository.js")
  const options = (signal) => ({ signal: signal ?? new AbortController().signal, deadline: performance.now() + 5000 })
  let loseCommit = true
  const withQuery = (intercept) => ({
    pool: {
      connect: async () => {
        const client = await f.pool.connect()
        return new Proxy(client, {
          get(target, key) {
            if (key === "query")
              return async (sql, values) => {
                const result = await target.query(sql, values)
                await intercept(sql)
                return result
              }
            const v = Reflect.get(target, key, target)
            return typeof v === "function" ? v.bind(target) : v
          },
        })
      },
    },
  })
  const repo = new PostgresPersonalKnowledgeRepository(
    withQuery(async (sql) => {
      if (sql === "COMMIT" && loseCommit) {
        loseCommit = false
        throw Error("simulated lost ACK")
      }
    }),
  )
  const id = randomUUID()
  assert.equal((await repo.replace(scope, id, 0, fields, options())).kind, "unknown")
  const confirmed = await f.store.services.personalKnowledge.get(scope, id, options())
  assert.equal(confirmed.kind, "ok")
  assert.equal(confirmed.value.revision, 1)
  assert.equal(confirmed.value.content, "c")
  assert.equal((await f.store.services.personalKnowledge.replace(scope, id, 0, fields, options())).kind, "conflict")
  const abort = new AbortController(),
    cancelledId = randomUUID()
  const cancelled = new PostgresPersonalKnowledgeRepository(
    withQuery(async (sql) => {
      if (sql.startsWith("INSERT INTO bff_personal_knowledge(")) abort.abort()
    }),
  )
  assert.equal((await cancelled.replace(scope, cancelledId, 0, fields, options(abort.signal))).kind, "unavailable")
  assert.equal((await f.store.services.personalKnowledge.get(scope, cancelledId, options())).kind, "not_found")
  assert.equal((await f.store.services.personalKnowledge.replace(scope, randomUUID(), 0, { ...fields, name: "" }, options())).kind, "unavailable")
})

integration("bounded chunked knowledge mutations follow the same JSON and CAS contract", async (t) => {
  const f = await fixture(t),
    id = randomUUID(),
    path = `knowledge/${id}`
  assert.equal((await f.chunked(path, "PUT", JSON.stringify({ expected_revision: 0, name: "n", when_to_use: "w", content: "c" }))).status, 201)
  assert.equal((await f.chunked(path, "DELETE", JSON.stringify({ expected_revision: 1 }))).status, 204)
  assert.equal(
    (await f.chunked(`knowledge/${randomUUID()}`, "PUT", JSON.stringify({ expected_revision: 0, name: "x".repeat(66000), when_to_use: "w", content: "c" })))
      .status,
    413,
  )
})
integration("knowledge cancellation retires a real SQL lock wait without inserting a fact", async (t) => {
  const f = await fixture(t),
    scope = { tenantId: f.tenant, subjectId: f.actor },
    id = randomUUID(),
    blocker = await f.pool.connect(),
    abort = new AbortController()
  try {
    await blocker.query("BEGIN")
    await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify(["personal-knowledge", f.tenant, f.actor])])
    const pending = f.store.services.personalKnowledge.replace(
      scope,
      id,
      0,
      { name: "n", when_to_use: "w", content: "c" },
      { signal: abort.signal, deadline: performance.now() + 5000 },
    )
    const until = performance.now() + 1500
    let blocked = false
    while (performance.now() < until) {
      const observed = await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'", [blocker.processID])
      if (observed.rowCount) {
        blocked = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.equal(blocked, true)
    abort.abort()
    const result = await Promise.race([
      pending,
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(Error("cancelled SQL wait did not retire")), 1000)
        timer.unref()
      }),
    ])
    assert.equal(result.kind, "unavailable")
    await blocker.query("ROLLBACK")
    const read = await f.store.services.personalKnowledge.get(scope, id, { signal: new AbortController().signal, deadline: performance.now() + 5000 })
    assert.equal(read.kind, "not_found")
  } finally {
    abort.abort()
    await blocker.query("ROLLBACK")
    blocker.release()
  }
})
