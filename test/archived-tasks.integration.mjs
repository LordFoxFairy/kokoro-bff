import assert from "node:assert/strict"
import { randomUUID, createHash } from "node:crypto"
import { test } from "node:test"
import { Pool } from "pg"
import { createBffServer } from "../dist/bootstrap/server.js"
import { PostgresBffRepositories } from "../dist/infrastructure/postgres/repositories.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL,
  redisUrl = process.env.KOKORO_TEST_REDIS_URL
const integrationTest = postgresUrl && redisUrl ? test : test.skip
const idleWorker = { start() {}, async stop() {} }
function config(tenantId = "tenant_test") {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId,
    iamBaseUrl: null,
    sharedSecret: "web-secret",
    upstreamSecret: "bff-secret",
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1024 * 1024,
    agentEnabled: false,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    postgresUrl,
    redisUrl,
    agUi: {
      replayPageFrames: 128,
      replayPageBytes: 1024 * 1024,
      streamMaxFrames: 1000,
      streamMaxBytes: 1024 * 1024,
      streamMaxDurationMs: 1000,
      maxConnectionsGlobal: 32,
      maxConnectionsPerTenant: 16,
      maxConnectionsPerSession: 4,
      ledgerPollBaseDelayMs: 100,
      ledgerPollMaxDelayMs: 200,
      ledgerPollJitterPercent: 0,
      replayCacheTtlMs: 1,
      projectorMaxConsumersPerCycle: 32,
      projectorSourcePageSize: 256,
      projectorMaxPagesPerConsumer: 8,
      projectorSourceMaxAttempts: 3,
      projectorLeaseDurationMs: 15_000,
      projectorLeaseSettlementReserveMs: 500,
      projectorPollIntervalMs: 100,
      projectorErrorBackoffMs: 200,
      projectorErrorBackoffMaxMs: 5000,
      projectorErrorBackoffJitterPercent: 20,
      retentionMs: 7 * 24 * 60 * 60 * 1000,
      gcIntervalMs: 15 * 60 * 1000,
      gcBatchSize: 100,
      cursorTombstoneRetentionMs: 30 * 24 * 60 * 60 * 1000,
    },
    upstreams: { agents: null, system: null, model: null, capability: null, storage: null, scheduler: null, billing: null },
  }
}
async function fixture(t, timeout = 5000) {
  const suffix = randomUUID().replaceAll("-", ""),
    tenant = `set47_${suffix}`,
    subject = `owner_${suffix}`
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const admission = new SessionAdmissionDouble(),
    scopes = new Set()
  const headers = (user = subject) => {
    const token = `set47_${user}`
    admission.allow(token, { namespace: tenant, userId: user })
    return { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "web-secret", authorization: `Bearer ${token}` }
  }
  const store = new PostgresBffRepositories(postgresUrl, redisUrl)
  await store.ready()
  const cfg = config(tenant)
  cfg.agentEnabled = true
  cfg.upstreams.agents = "http://127.0.0.1:9"
  cfg.upstreamTimeoutMs = timeout
  const server = createBffServer(cfg, {
    businessStore: store,
    sessionAdmission: admission,
    agentDispatchDispatcher: idleWorker,
    agentCancellationDispatcher: idleWorker,
    agUiProjector: idleWorker,
    scheduledTaskDispatcher: idleWorker,
    scheduledAgentDispatcher: idleWorker,
    scheduledAgentTerminalConsumer: idleWorker,
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const json = async (path, options = {}) => {
    const response = await fetch(base + path, { ...options, headers: { ...headers(), ...options.headers } })
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  const command = async (id, action, key = randomUUID(), user = subject) => {
    scopes.add(
      `archive-state:v1:${createHash("sha256")
        .update(JSON.stringify([tenant, user, key]))
        .digest("hex")}`,
    )
    return json(`/v1/sessions/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      headers: { ...headers(user), "content-type": "application/json", "idempotency-key": key },
      body: "{}",
    })
  }
  const create = async () => {
    const id = `conv_${randomUUID()}`
    const result = await json(`/v1/sessions/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ content: "SET47 owned task" }),
    })
    assert.equal(result.status, 202)
    return id
  }
  const facts = async () => {
    const output = {}
    for (const table of ["bff_share", "bff_message", "bff_agent_dispatch_outbox", "bff_agui_stream"]) {
      output[table] = (
        await pool.query(`SELECT row_to_json(t) AS fact FROM ${table} t WHERE tenant_id=$1 ORDER BY row_to_json(t)::text COLLATE "C"`, [tenant])
      ).rows
    }
    return output
  }
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await store.close()
    for (const scope of scopes) await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope=$1", [scope])
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant])
    for (const table of [
      "bff_agent_cancellation_outbox",
      "bff_share",
      "bff_agui_event",
      "bff_agui_stream",
      "bff_agent_dispatch_outbox",
      "bff_message",
      "bff_conversation",
      "bff_project_scope_release_outbox",
      "bff_project_deletion",
      "bff_project",
    ])
      await pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant])
    await pool.end()
  })
  return { tenant, subject, pool, headers, json, command, create, facts, base }
}
integrationTest(
  "SET47 real HTTP archives queued Run and shared task without cancelling or revoking; replay, restore and deletion are authoritative",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t),
      id = await f.create()
    const share = await f.json(`/v1/sessions/${id}/share`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
      body: "{}",
    })
    assert.equal(share.status, 200)
    const before = await f.facts(),
      key = randomUUID()
    assert.equal((await f.json(`/v1/sessions/${id}/archive`)).body.data.archived_at, null)
    const archived = await f.command(id, "archive", key)
    assert.equal(archived.status, 200)
    assert.ok(archived.body.data.archived_at)
    assert.deepEqual(await f.facts(), before, "archive must not change Share, Run dispatch, Message or stream facts")
    assert.equal((await f.json(`/v1/sessions/${id}/archive`)).body.data.archived_at, archived.body.data.archived_at)
    const ordinary = await f.json("/v1/sessions")
    assert.equal(ordinary.status, 200)
    assert.ok(!JSON.stringify(ordinary.body).includes(id))
    const listed = await f.json("/v1/account/archived-tasks")
    assert.equal(listed.status, 200)
    assert.equal(listed.body.data.items[0].session_id, id)
    assert.deepEqual(Object.keys(listed.body.data.items[0]).sort(), ["archived_at", "project_ref", "session_id", "title"])
    assert.equal((await f.json("/v1/account/shared-tasks")).body.data.items[0].session_id, id)
    const foreign = await f.command(id, "restore", randomUUID(), "foreign")
    assert.equal(foreign.status, 404)
    assert.equal((await f.json(`/v1/sessions/${id}/archive`, { headers: f.headers("foreign") })).status, 404)
    const timestamp = (await f.pool.query("SELECT archived_at,updated_at FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [f.tenant, id]))
      .rows[0]
    assert.equal((await f.command(id, "archive")).status, 200)
    assert.deepEqual(
      (await f.pool.query("SELECT archived_at,updated_at FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [f.tenant, id])).rows[0],
      timestamp,
      "fresh same state preserves both timestamps",
    )
    assert.equal((await f.command(id, "restore", key)).status, 409, "archive and restore share idempotency scope")
    assert.equal((await f.command(id, "restore")).body.data.archived_at, null)
    const replay = await f.command(id, "archive", key)
    assert.deepEqual(replay.body, archived.body)
    assert.equal((await f.json(`/v1/sessions/${id}/archive`)).body.data.archived_at, null, "historical receipt replay never rearchives")
    assert.deepEqual(await f.facts(), before)
    const deleted = await f.json(`/v1/sessions/${id}`, { method: "DELETE", headers: { "idempotency-key": randomUUID() } })
    assert.ok([200, 202].includes(deleted.status))
    assert.equal((await f.command(id, "archive", key)).status, 404)
    assert.equal((await f.command(id, "restore")).status, 404)
    assert.equal((await f.json(`/v1/sessions/${id}/archive`)).status, 404)
  },
)
integrationTest(
  "SET47 same millisecond historical Unicode C keyset is complete and invalid parent cannot list read or mutate",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t),
      ids = []
    for (const legacy of ["a", "A", "\ue000", "😀"]) {
      const created = await f.create()
      // Explicit owner integrity fixture for legacy IDs, only after canonical HTTP created the fact.
      const id = `${legacy}_${randomUUID()}`
      await f.pool.query("UPDATE bff_conversation SET conversation_id=$3,title=$4 WHERE tenant_id=$1 AND conversation_id=$2", [f.tenant, created, id, "\t"])
      ids.push(id)
      assert.equal((await f.command(id, "archive")).status, 200)
    }
    await f.pool.query("UPDATE bff_conversation SET archived_at='2026-10-15T00:00:00.000Z' WHERE tenant_id=$1", [f.tenant])
    let cursor = null
    const found = []
    do {
      const result = await f.json(`/v1/account/archived-tasks?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
      assert.equal(result.status, 200)
      found.push(...result.body.data.items.map((x) => x.session_id))
      cursor = result.body.data.next_cursor
    } while (cursor)
    assert.deepEqual(
      found,
      [...ids].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
    )
    const victim = ids[0]
    await f.pool.query("UPDATE bff_conversation SET project_ref='' WHERE tenant_id=$1 AND conversation_id=$2", [f.tenant, victim])
    assert.equal((await f.command(victim, "restore")).status, 404)
    assert.equal((await f.json(`/v1/sessions/${encodeURIComponent(victim)}/archive`)).status, 404)
    assert.ok(!(await f.json("/v1/account/archived-tasks")).body.data.items.some((x) => x.session_id === victim))
  },
)
integrationTest(
  "SET47 real concurrent same-key archive has one receipt; locked command deadline rolls back and same pool recovers",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t, 300),
      id = await f.create(),
      key = randomUUID()
    const responses = await Promise.all([f.command(id, "archive", key), f.command(id, "archive", key)])
    assert.ok(responses.every((x) => x.status === 200))
    assert.deepEqual(responses[0].body, responses[1].body)
    const blocker = await f.pool.connect()
    try {
      await blocker.query("BEGIN")
      await blocker.query("SELECT conversation_id FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2 FOR UPDATE", [f.tenant, id])
      const start = performance.now(),
        blocked = await f.command(id, "restore")
      assert.equal(blocked.status, 503)
      assert.ok(performance.now() - start < 2000)
    } finally {
      await blocker.query("ROLLBACK")
      blocker.release()
    }
    assert.equal((await f.json(`/v1/sessions/${id}/archive`)).body.data.archived_at, responses[0].body.data.archived_at)
    assert.equal((await f.command(id, "restore")).status, 200)
    const race = await Promise.all([f.command(id, "archive"), f.json(`/v1/sessions/${id}`, { method: "DELETE", headers: { "idempotency-key": randomUUID() } })])
    assert.ok([200, 404].includes(race[0].status))
    assert.ok([200, 202].includes(race[1].status))
    assert.equal((await f.json(`/v1/sessions/${id}/archive`)).status, 404)
  },
)
integrationTest("SET47 archive and Move serialize without implicit restore and Project deletion includes archived children", { timeout: 30000 }, async (t) => {
  const f = await fixture(t),
    id = await f.create()
  const project = await f.json("/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
    body: JSON.stringify({ name: "SET47 owned parent", description: "" }),
  })
  assert.equal(project.status, 200)
  const projectId = project.body.data.project.id
  assert.equal(typeof projectId, "string")
  const move = () =>
    f.json(`/v1/sessions/${id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ target_project_id: projectId }),
    })
  const [archived, moved] = await Promise.all([f.command(id, "archive"), move()])
  assert.equal(archived.status, 200)
  assert.equal(moved.status, 200)
  const owner = (await f.pool.query("SELECT project_ref,archived_at,status FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [f.tenant, id]))
    .rows[0]
  assert.equal(owner.project_ref, projectId)
  assert.ok(owner.archived_at)
  assert.equal(owner.status, "active")
  assert.equal((await f.json(`/v1/sessions/${id}/archive`)).body.data.archived_at, owner.archived_at.toISOString())
  const [restored, deleted] = await Promise.all([
    f.command(id, "restore"),
    f.json(`/v1/projects/${projectId}`, { method: "DELETE", headers: { "idempotency-key": randomUUID() } }),
  ])
  assert.ok([200, 404].includes(restored.status))
  assert.equal(deleted.status, 202)
  assert.equal((await f.json(`/v1/sessions/${id}/archive`)).status, 404)
  const tombstone = (await f.pool.query("SELECT status,deleted_at FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [f.tenant, id])).rows[0]
  assert.equal(tombstone.status, "deleted")
  assert.ok(tombstone.deleted_at)
  assert.equal((await f.command(id, "restore")).status, 404)
})
