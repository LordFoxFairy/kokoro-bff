import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { spawn } from "node:child_process"
import { createServer as createRelayServer, connect as connectTcp } from "node:net"
import { fileURLToPath } from "node:url"

import { Client, Pool } from "pg"

import { createBffServer } from "../dist/main.js"
import { PostgresBffRepositories } from "../dist/infrastructure/postgres/repositories.js"
import { applyCanonicalSchema, loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const adminUrl = process.env.KOKORO_TEST_POSTGRES_ADMIN_URL
const redisUrl = process.env.KOKORO_TEST_REDIS_URL
const integrationTest = adminUrl && redisUrl ? test : test.skip
// Existing integration seam: no background owner calls or queue consumption.
const idleWorker = { start() {}, async stop() {} }

function bffConfig(postgresUrl, redisUrl, overrides = {}) {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: overrides.tenantId ?? "tenant_test",
    iamBaseUrl: null,
    sharedSecret: "web-secret",
    upstreamSecret: "bff-secret",
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1024 * 1024,
    agentEnabled: overrides.agentEnabled ?? false,
    schedulerServiceToken: "scheduler-secret",
    schedulerTargetUrl: overrides.schedulerTargetUrl,
    postgresUrl,
    redisUrl,
    agUi: {
      replayPageFrames: 128,
      replayPageBytes: 1024 * 1024,
      streamMaxFrames: 10_000,
      streamMaxBytes: 16 * 1024 * 1024,
      streamMaxDurationMs: 5 * 60 * 1000,
      maxConnectionsGlobal: 256,
      maxConnectionsPerTenant: 64,
      maxConnectionsPerSession: 8,
      ledgerPollBaseDelayMs: 1000,
      ledgerPollMaxDelayMs: 8000,
      ledgerPollJitterPercent: 20,
      replayCacheTtlMs: 25,
      projectorMaxConsumersPerCycle: 32,
      projectorSourcePageSize: 256,
      projectorMaxPagesPerConsumer: 8,
      projectorSourceMaxAttempts: 3,
      projectorLeaseDurationMs: 15_000,
      projectorLeaseSettlementReserveMs: 500,
      projectorPollIntervalMs: 1000,
      projectorErrorBackoffMs: 5000,
      projectorErrorBackoffMaxMs: 5 * 60 * 1000,
      projectorErrorBackoffJitterPercent: 20,
      retentionMs: 7 * 24 * 60 * 60 * 1000,
      gcIntervalMs: 15 * 60 * 1000,
      gcBatchSize: 100,
      cursorTombstoneRetentionMs: 30 * 24 * 60 * 60 * 1000,
    },
    upstreams: {
      system: null,
      model: null,
      capability: null,
      storage: null,
      scheduler: overrides.schedulerBase,
      agents: overrides.agentBase ?? null,
      billing: null,
    },
  }
}

async function ownerSnapshot(pool, declaredCollision) {
  assert.ok(declaredCollision === undefined || declaredCollision === "pk_bff_personalization")
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='kokoro_bff' ORDER BY tablename")).rows.map(({ tablename }) => tablename)
  assert.ok(tables.every((name) => /^bff_[a-z_]+$/u.test(name) || name === declaredCollision))
  const facts = {}
  for (const table of tables) {
    facts[table] = (await pool.query(`SELECT to_jsonb(fact) AS row FROM kokoro_bff.${table} fact ORDER BY to_jsonb(fact)::text`)).rows
  }
  const relations = (
    await pool.query(
      `SELECT c.oid::text, c.relname, c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity,
            c.relispartition, c.reloptions
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='kokoro_bff' ORDER BY c.relname`,
    )
  ).rows
  const columns = (
    await pool.query(
      `SELECT c.relname, a.attnum, a.attname, a.atttypid::text, a.atttypmod, a.attnotnull,
            a.attidentity, a.attgenerated, pg_get_expr(d.adbin,d.adrelid) AS default_expression
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
       LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname='kokoro_bff' ORDER BY c.relname,a.attnum`,
    )
  ).rows
  const constraints = (
    await pool.query(
      `SELECT c.relname, k.conname, k.contype, k.convalidated, k.condeferrable, k.condeferred,
            pg_get_constraintdef(k.oid) AS definition
       FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='kokoro_bff' ORDER BY c.relname,k.conname`,
    )
  ).rows
  const indexes = (await pool.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='kokoro_bff' ORDER BY tablename,indexname")).rows
  return { facts, catalog: { relations, columns, constraints, indexes } }
}

async function createOwnerFixture(t) {
  const name = `kokoro_bff_pe_${randomUUID().replaceAll("-", "")}`
  assert.match(name, /^kokoro_bff_pe_[a-f0-9]{32}$/u)
  const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000, query_timeout: 10000 })
  const target = new URL(adminUrl)
  target.pathname = `/${name}`
  target.search = ""
  target.searchParams.set("schema", "kokoro_bff")
  const databaseUrl = target.toString()
  const tenant = `pe_${randomUUID()}`
  const subject = "personalization_evolution_owner"
  const token = `fixture-${randomUUID()}`
  const admission = new SessionAdmissionDouble()
  admission.allow(token, { namespace: tenant, userId: subject })
  const extraCleanup = []
  let created = false
  let pool
  let store
  let server
  t.after(async () => {
    // Every cleanup is attempted; a failed cleanup is reported independently of the business assertion.
    const errors = []
    const cleanup = async (stage, action) => {
      try {
        await action()
      } catch (error) {
        const knownMessages = {
          "Query read timeout": "PG_QUERY_TIMEOUT",
          "Connection terminated unexpectedly": "PG_CONNECTION_LOST",
          "Connection terminated": "PG_CONNECTION_TERMINATED",
          "The client is closed": "CLIENT_ALREADY_CLOSED",
        }
        const code =
          typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(error.code)
            ? error.code
            : Object.hasOwn(knownMessages, error?.message)
              ? knownMessages[error.message]
              : "UNCLASSIFIED_CLEANUP_ERROR"
        const observation = Number.isInteger(error?.connectionCount) ? `; remaining_connections=${error.connectionCount}` : ""
        const safe = new Error(`R257 owned fixture cleanup failed: ${stage}; code=${code}${observation}`)
        errors.push(safe)
        t.diagnostic(safe.message)
      }
    }
    for (const { action, stage } of extraCleanup) await cleanup(stage, action)
    if (server) await cleanup("http", () => server.shutdown(1000))
    if (store) await cleanup("store", () => store.close())
    if (pool) await cleanup("pool", () => pool.end())
    if (created)
      await cleanup("database", async () => {
        const retirementDeadline = Date.now() + 2000
        let connectionCount
        try {
          await waitFor(async () => {
            const connections = await admin.query({
              text: "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1",
              values: [name],
              query_timeout: Math.max(1, retirementDeadline - Date.now()),
            })
            connectionCount = connections.rows[0].count
            return connectionCount === 0
          }, 2000)
        } catch (error) {
          if (error?.code === "FIXTURE_CONDITION_TIMEOUT") {
            throw Object.assign(new Error("owned backend retirement deadline"), { code: "OWNED_BACKEND_RETIREMENT_TIMEOUT", connectionCount })
          }
          throw error
        }
        await admin.query(`DROP DATABASE ${name}`)
      })
    await cleanup("admin", () => admin.end())
    if (errors.length) throw new AggregateError(errors, `R257 owned fixture cleanup incomplete: ${errors.map((error) => error.message).join(" | ")}`)
  })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name}`)
  created = true
  const canonical = await loadCanonicalSchema()
  await applyCanonicalSchema(databaseUrl, canonical)
  pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    options: "-c search_path=kokoro_bff -c timezone=UTC -c statement_timeout=10000",
  })
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, name)
  store = new PostgresBffRepositories(databaseUrl, redisUrl)
  // Only existing Redis PING readiness; this test never resets Redis or starts a service.
  await store.ready()
  server = createBffServer(bffConfig(databaseUrl, redisUrl, { tenantId: tenant }), {
    businessStore: store,
    sessionAdmission: admission,
    agentDispatchDispatcher: idleWorker,
    agentCancellationDispatcher: idleWorker,
    agUiProjector: idleWorker,
    scheduledTaskDispatcher: idleWorker,
    scheduledAgentDispatcher: idleWorker,
    scheduledAgentTerminalConsumer: idleWorker,
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const request = async (path, method = "GET", body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/${path}`, {
      method,
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "web-secret",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(method === "POST" ? { "idempotency-key": `pe-${randomUUID()}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(6000),
    })
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  const admitted = await request("me")
  assert.equal(admitted.status, 200, "ordinary current Session fixture must pass admission")
  assert.deepEqual(admitted.body.data, { user_id: subject, tenant_id: tenant, platform_admin: false })
  const healthy = await request("preferences/personalization")
  assert.equal(healthy.status, 200, "same real handler/store must work before the target table is removed")
  assert.deepEqual(healthy.body, { data: { personalization: null, revision: 0 } })
  const project = await request("projects", "POST", { name: "Evolution preserved project" })
  assert.equal(project.status, 200, "an existing business entry must persist the original project")
  assert.match(project.body.data.project.id, /^project_[a-f0-9-]{36}$/u)
  const populated = await ownerSnapshot(pool)
  assert.equal(populated.facts.bff_project.length, 1)
  assert.equal(populated.facts.bff_project[0].row.owner_id, subject)
  assert.ok(populated.facts.bff_idempotency_receipt.length > 0, "real Project creation must persist its receipt")
  assert.deepEqual(populated.facts.bff_personalization, [], "only this test's empty target may be removed")
  // Model an old owner only inside the database created above; never remove a normal/user table.
  await pool.query("DROP TABLE kokoro_bff.bff_personalization")
  assert.equal((await pool.query("SELECT to_regclass('kokoro_bff.bff_personalization') AS target")).rows[0].target, null)
  const legacy = await ownerSnapshot(pool)
  const oldFacts = { ...populated.facts }
  delete oldFacts.bff_personalization
  assert.deepEqual(legacy.facts, oldFacts, "constructing the old shape must retain every original owner row")
  await assert.rejects(applyCanonicalSchema(databaseUrl, canonical), /requires an empty kokoro_bff schema/u)
  assert.deepEqual(await ownerSnapshot(pool), legacy, "fresh refusal must leave original facts and catalog exact")
  await assert.rejects(store.ready(), /BFF owner schema is not installed or incomplete/u)
  assert.equal((await request("me")).status, 200, "missing target must not be confused with failed admission")
  const read = await request("preferences/personalization")
  assert.equal(read.headers.get("cache-control"), "no-store")
  assert.ok(read.headers.get("x-request-id"))
  if (read.status === 503) assert.equal(read.body.error.code, "personalization_unavailable")
  assert.deepEqual(await ownerSnapshot(pool), legacy, "failed read must neither create the table nor alter old facts")
  t.diagnostic(`old-owner HTTP result: status=${read.status}; code=${read.body.error?.code ?? "success"}; fresh refusal and facts/catalog protection passed`)
  assert.equal(read.status, 503, "without evolution the real handler must fail closed on the missing table")
  return {
    databaseUrl,
    pool,
    store,
    request,
    legacy,
    canonical,
    name,
    freshCatalog: populated.catalog,
    addCleanup: (action, stage = "owned auxiliary") => extraCleanup.unshift({ action, stage }),
  }
}

function cli(databaseUrl, mode, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/evolve-personalization-schema.mjs", import.meta.url)), mode], {
      env: { KOKORO_BFF_POSTGRES_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let killed = false
    const cancel = () => child.kill("SIGTERM")
    const timer = setTimeout(() => {
      killed = true
      child.kill("SIGKILL")
    }, 24000)
    signal?.addEventListener("abort", cancel, { once: true })
    child.stdout.on("data", (data) => {
      stdout += data
      if (stdout.length > 8192) {
        killed = true
        child.kill("SIGKILL")
      }
    })
    child.stderr.on("data", (data) => {
      stderr += data
      if (stderr.length > 8192) {
        killed = true
        child.kill("SIGKILL")
      }
    })
    child.once("error", () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", cancel)
      reject(new Error("evolution CLI spawn failed"))
    })
    child.once("close", (exitCode) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", cancel)
      try {
        assert.equal(killed, false, "operation must stop inside its own finite budget")
        assert.equal(stderr, "", "CLI must not leak raw PG/parser/credential diagnostics")
        assert.equal(stdout.includes(databaseUrl), false)
        const value = JSON.parse(stdout)
        assert.equal(value.operation, "personalization_schema_evolution")
        assert.match(value.request_id, /^[a-f0-9-]{36}$/u)
        assert.deepEqual(Object.keys(value).sort(), ["cleanup", "code", "duration_ms", "operation", "request_id", "state"].sort())
        assert.ok(value.duration_ms >= 0 && value.duration_ms < 22000)
        resolve({ exitCode, ...value })
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function waitFor(predicate, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw Object.assign(new Error("R257 owned fixture condition deadline"), { code: "FIXTURE_CONDITION_TIMEOUT" })
}

integrationTest("R257 personalization evolution populated owner requires a safe path to the ordinary HTTP read", { timeout: 60000 }, async (t) => {
  const f = await createOwnerFixture(t)
  assert.equal((await cli(f.databaseUrl, "check")).state, "legacy")
  assert.deepEqual(await ownerSnapshot(f.pool), f.legacy, "check is zero DDL and zero data write")
  const applied = await cli(f.databaseUrl, "apply")
  assert.equal(applied.exitCode, 0)
  assert.equal(applied.state, "applied")
  assert.equal((await cli(f.databaseUrl, "check")).state, "current")
  await f.store.ready()
  const read = await f.request("preferences/personalization")
  assert.equal(read.status, 200, "populated BFF owner needs a safe evolution path before ordinary personalization can read")
  assert.deepEqual(read.body, { data: { personalization: null, revision: 0 } })
  const evolved = await ownerSnapshot(f.pool)
  const targetCatalog = (catalog) => ({
    relations: catalog.relations.filter((row) => ["bff_personalization", "pk_bff_personalization"].includes(row.relname)).map(({ oid: _oid, ...row }) => row),
    columns: catalog.columns.filter((row) => ["bff_personalization", "pk_bff_personalization"].includes(row.relname)),
    constraints: catalog.constraints.filter((row) => row.relname === "bff_personalization"),
    indexes: catalog.indexes.filter((row) => row.tablename === "bff_personalization"),
  })
  assert.deepEqual(targetCatalog(evolved.catalog), targetCatalog(f.freshCatalog), "evolved target must be semantically identical to fresh canonical")
  const oldFacts = { ...evolved.facts }
  delete oldFacts.bff_personalization
  assert.deepEqual(oldFacts, f.legacy.facts)
  const fields = { nickname: "Preserved nickname", occupation: "Test", about: "Synthetic", instructions: "No model execution" }
  const saved = await f.request("preferences/personalization", "PUT", { expected_revision: 0, ...fields })
  assert.equal(saved.status, 200)
  const before = await ownerSnapshot(f.pool)
  assert.equal((await cli(f.databaseUrl, "apply")).state, "already_current")
  assert.deepEqual(await ownerSnapshot(f.pool), before, "current replay preserves saved content, revision and catalog")
  assert.deepEqual((await f.request("preferences/personalization")).body, saved.body)
})

integrationTest("R257 personalization evolution serializes concurrent apply without touching old facts", { timeout: 60000 }, async (t) => {
  const f = await createOwnerFixture(t)
  const results = await Promise.all([cli(f.databaseUrl, "apply"), cli(f.databaseUrl, "apply")])
  assert.deepEqual(results.map((r) => r.state).sort(), ["already_current", "applied"])
  assert.ok(results.every((r) => r.exitCode === 0))
  const after = await ownerSnapshot(f.pool)
  delete after.facts.bff_personalization
  assert.deepEqual(after.facts, f.legacy.facts)
})

integrationTest("R257 personalization evolution rejects semantic target drift and name collisions without repair", { timeout: 60000 }, async (t) => {
  const f = await createOwnerFixture(t)
  const { extractPersonalizationCreate } = await import("../scripts/personalization-schema-catalog.mjs")
  const create = extractPersonalizationCreate(f.canonical)
  const mutations = [
    "ALTER TABLE kokoro_bff.bff_personalization ALTER COLUMN nickname DROP NOT NULL",
    "ALTER TABLE kokoro_bff.bff_personalization ALTER COLUMN nickname SET DEFAULT ''",
    "ALTER TABLE kokoro_bff.bff_personalization ALTER COLUMN created_at TYPE timestamptz(6)",
    "ALTER TABLE kokoro_bff.bff_personalization ADD COLUMN extra text",
    "ALTER TABLE kokoro_bff.bff_personalization DROP CONSTRAINT ck_bff_personalization_about",
    "ALTER TABLE kokoro_bff.bff_personalization ADD CONSTRAINT ck_extra CHECK (nickname <> 'forbidden')",
    "ALTER TABLE kokoro_bff.bff_personalization ENABLE ROW LEVEL SECURITY",
    "CREATE INDEX ix_extra_personalization ON kokoro_bff.bff_personalization(nickname)",
    "ALTER TABLE kokoro_bff.bff_personalization DROP COLUMN instructions",
    "ALTER TABLE kokoro_bff.bff_personalization DROP CONSTRAINT ck_bff_personalization_scope; ALTER TABLE kokoro_bff.bff_personalization ADD CONSTRAINT ck_bff_personalization_scope CHECK (tenant_id <> ' ' AND owner_id <> '')",
    "ALTER TABLE kokoro_bff.bff_personalization DROP CONSTRAINT ck_bff_personalization_about; ALTER TABLE kokoro_bff.bff_personalization ADD CONSTRAINT ck_bff_personalization_about CHECK (char_length(about)<=2000) NOT VALID",
    "CREATE TRIGGER pe_changed BEFORE UPDATE ON kokoro_bff.bff_personalization FOR EACH ROW EXECUTE FUNCTION pg_catalog.suppress_redundant_updates_trigger()",
    "ALTER TABLE kokoro_bff.bff_personalization DROP CONSTRAINT pk_bff_personalization; ALTER TABLE kokoro_bff.bff_personalization ADD CONSTRAINT pk_bff_personalization PRIMARY KEY (owner_id,tenant_id)",
  ]
  for (const mutation of mutations) {
    await f.pool.query(create)
    await f.pool.query(mutation)
    const before = await ownerSnapshot(f.pool)
    for (const mode of ["check", "apply"]) {
      const result = await cli(f.databaseUrl, mode)
      assert.equal(result.exitCode, 2)
      assert.equal(result.state, "invalid_schema", mutation)
      assert.deepEqual(await ownerSnapshot(f.pool), before)
    }
    await f.pool.query("DROP TABLE kokoro_bff.bff_personalization")
  }
  for (const [createCollision, dropCollision, declaredCollision] of [
    ["CREATE VIEW kokoro_bff.bff_personalization AS SELECT 1 AS id", "DROP VIEW kokoro_bff.bff_personalization"],
    ["CREATE TYPE kokoro_bff.bff_personalization AS (id integer)", "DROP TYPE kokoro_bff.bff_personalization"],
    ["CREATE TABLE kokoro_bff.pk_bff_personalization (id integer)", "DROP TABLE kokoro_bff.pk_bff_personalization", "pk_bff_personalization"],
  ]) {
    await f.pool.query(createCollision)
    const before = await ownerSnapshot(f.pool, declaredCollision)
    if (declaredCollision) assert.ok(Object.hasOwn(before.facts, declaredCollision), "the exact collision remains in the snapshot")
    assert.equal((await cli(f.databaseUrl, "apply")).state, "invalid_schema")
    assert.deepEqual(await ownerSnapshot(f.pool, declaredCollision), before)
    await f.pool.query(dropCollision)
  }
  assert.deepEqual(await ownerSnapshot(f.pool), f.legacy)
})

integrationTest("R257 personalization evolution bounds owner and relation locks and aborts its exact backend", { timeout: 60000 }, async (t) => {
  const f = await createOwnerFixture(t)
  const lock = new Client({ connectionString: f.databaseUrl, connectionTimeoutMillis: 5000 })
  await lock.connect()
  try {
    await lock.query("BEGIN")
    await lock.query("SELECT pg_advisory_xact_lock(hashtext(current_database()),hashtext('kokoro_bff'))")
    const blocked = await cli(f.databaseUrl, "apply")
    assert.equal(blocked.exitCode, 3)
    assert.equal(blocked.state, "unavailable")
    assert.ok(blocked.duration_ms < 6000)
    const abort = new AbortController()
    const pending = cli(f.databaseUrl, "apply", abort.signal)
    await waitFor(
      async () =>
        (
          await f.pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='kokoro-bff-personalization-evolution' AND wait_event='advisory'",
          )
        ).rowCount > 0,
    )
    abort.abort()
    assert.equal((await pending).state, "unavailable")
    await waitFor(
      async () =>
        (await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='kokoro-bff-personalization-evolution'"))
          .rowCount === 0,
    )
    assert.deepEqual(await ownerSnapshot(f.pool), f.legacy)
    await lock.query("ROLLBACK")
    assert.equal((await cli(f.databaseUrl, "apply")).state, "applied")
    const before = await ownerSnapshot(f.pool)
    await lock.query("BEGIN")
    await lock.query("LOCK TABLE kokoro_bff.bff_personalization IN ACCESS EXCLUSIVE MODE")
    const relationBlocked = await cli(f.databaseUrl, "check")
    assert.equal(relationBlocked.exitCode, 3)
    assert.ok(relationBlocked.duration_ms < 6000)
    await lock.query("ROLLBACK")
    assert.deepEqual(await ownerSnapshot(f.pool), before)
  } finally {
    await lock.query("ROLLBACK").catch(() => undefined)
    await lock.end()
  }
})

async function commitAckRelay(t, databaseUrl) {
  const target = new URL(databaseUrl)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname), "TCP fixture requires Root's local isolated PostgreSQL")
  // Freeze the actual PostgreSQL address before deriving the downstream relay URL.
  const upstreamAddress = Object.freeze({ host: target.hostname.replace(/^\[|\]$/gu, ""), port: Number(target.port || 5432) })
  const sockets = new Set()
  const protocol = { startupFrames: 0, startupVersion: null, queryFrames: 0, frontendBytes: 0, upstreamBytes: 0, upstreamConnected: 0, invalidFrames: 0 }
  const socketErrors = new Set()
  let commitSeen = false
  let blockedBytes = 0
  let connections = 0
  const relay = createRelayServer((downstream) => {
    connections += 1
    const upstream = connectTcp(upstreamAddress)
    upstream.once("connect", () => {
      protocol.upstreamConnected += 1
    })
    sockets.add(downstream)
    sockets.add(upstream)
    let startup = true
    let buffer = Buffer.alloc(0)
    let suppress = false
    const retire = () => {
      downstream.destroy()
      upstream.destroy()
    }
    for (const socket of [downstream, upstream]) {
      socket.on("error", (error) => {
        if (typeof error.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(error.code)) socketErrors.add(error.code)
        retire()
      })
      socket.on("close", () => {
        sockets.delete(socket)
        retire()
      })
    }
    downstream.on("data", (data) => {
      protocol.frontendBytes += data.length
      buffer = Buffer.concat([buffer, data])
      for (;;) {
        const header = startup ? 4 : 5
        if (buffer.length < header) break
        const length = buffer.readUInt32BE(startup ? 0 : 1) + (startup ? 0 : 1)
        if (length < header || length > 1024 * 1024) {
          protocol.invalidFrames += 1
          retire()
          return
        }
        if (buffer.length < length) break
        if (startup) {
          protocol.startupFrames += 1
          protocol.startupVersion = length >= 8 ? buffer.readUInt32BE(4) : null
        } else if (buffer[0] === 81) protocol.queryFrames += 1
        if (!startup && buffer[0] === 81 && buffer.subarray(5, length - 1).toString("utf8") === "COMMIT") {
          suppress = true
          commitSeen = true
        }
        startup = false
        buffer = buffer.subarray(length)
      }
      // Detect COMMIT before forwarding it; no ACK byte can race past the suppression switch.
      if (!upstream.write(data)) {
        downstream.pause()
        upstream.once("drain", () => downstream.resume())
      }
    })
    upstream.on("data", (data) => {
      protocol.upstreamBytes += data.length
      if (suppress) {
        blockedBytes += data.length
        return
      }
      if (!downstream.write(data)) {
        upstream.pause()
        downstream.once("drain", () => upstream.resume())
      }
    })
  })
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve, reject) => relay.close((error) => (error ? reject(error) : resolve())))
  }, "ack relay")
  await new Promise((resolve, reject) => {
    relay.once("error", reject)
    relay.listen(0, "127.0.0.1", resolve)
  })
  const address = relay.address()
  assert.ok(address && typeof address !== "string")
  assert.notEqual(address.port, upstreamAddress.port, "relay must not connect recursively to itself")
  const downstreamUrl = new URL(databaseUrl)
  downstreamUrl.hostname = "127.0.0.1"
  downstreamUrl.port = String(address.port)
  downstreamUrl.searchParams.set("sslmode", "disable")
  return {
    url: downstreamUrl.toString(),
    observed: () => ({ commitSeen, blockedBytes, connections, sockets: sockets.size, ...protocol, socketErrors: [...socketErrors].sort() }),
  }
}

integrationTest(
  "R257 personalization evolution real TCP lost COMMIT ACK stays unknown and reconciles on a new same-lock check",
  { timeout: 60000 },
  async (t) => {
    const f = await createOwnerFixture(t)
    const relay = await commitAckRelay({ after: f.addCleanup }, f.databaseUrl)
    const { evolvePersonalizationSchema } = await import("../scripts/personalization-schema-evolution.mjs")
    let settled = false
    let terminal
    // A shorter internal budget keeps the integration finite; CLI's default remains 20s.
    const pending = evolvePersonalizationSchema({ mode: "apply", databaseUrl: relay.url, timeoutMs: 4000 }).then((result) => {
      terminal = { state: result.state, code: result.code, cleanup: result.cleanup, duration_ms: result.duration_ms }
      settled = true
      return result
    })
    f.addCleanup(async () => {
      await pending
    }, "ack operation")
    try {
      await waitFor(() => relay.observed().commitSeen && relay.observed().blockedBytes > 0)
    } catch (error) {
      t.diagnostic(`ACK barrier not reached: ${JSON.stringify({ terminal: terminal ?? { state: "pending" }, relay: relay.observed() })}`)
      throw error
    }
    await waitFor(async () => (await f.pool.query("SELECT to_regclass('kokoro_bff.bff_personalization') IS NOT NULL AS present")).rows[0].present)
    assert.equal(settled, false, "independent observer sees committed table while same TCP client has not received ACK")
    const unknown = await pending
    assert.equal(unknown.state, "unknown")
    assert.equal(unknown.code, "commit_unknown")
    assert.ok(unknown.duration_ms < 5000)
    await waitFor(() => relay.observed().sockets === 0)
    assert.equal(relay.observed().connections, 1, "unknown must not auto-reconnect/reapply")
    const lock = new Client({ connectionString: f.databaseUrl, connectionTimeoutMillis: 5000 })
    await lock.connect()
    try {
      await lock.query("BEGIN")
      await lock.query("SELECT pg_advisory_xact_lock(hashtext(current_database()),hashtext('kokoro_bff'))")
      assert.equal((await cli(f.databaseUrl, "check")).state, "unavailable", "reconciliation must take the same owner lock")
      await lock.query("ROLLBACK")
      const current = await cli(f.databaseUrl, "check")
      assert.equal(current.exitCode, 0)
      assert.equal(current.state, "current", "current proves present schema, not receipt/cause of the earlier operation")
      const after = await ownerSnapshot(f.pool)
      delete after.facts.bff_personalization
      assert.deepEqual(after.facts, f.legacy.facts)
    } finally {
      await lock.query("ROLLBACK").catch(() => undefined)
      await lock.end()
    }
  },
)

integrationTest("R257 personalization evolution a silent TCP startup uses one budget and retires its only socket", { timeout: 60000 }, async (t) => {
  const f = await createOwnerFixture(t)
  const sockets = new Set()
  let connections = 0
  const silent = createRelayServer((socket) => {
    connections += 1
    sockets.add(socket)
    socket.on("data", () => undefined)
    socket.on("error", () => undefined)
    socket.on("close", () => sockets.delete(socket))
  })
  f.addCleanup(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve, reject) => silent.close((error) => (error ? reject(error) : resolve())))
  }, "silent relay")
  await new Promise((resolve, reject) => {
    silent.once("error", reject)
    silent.listen(0, "127.0.0.1", resolve)
  })
  const address = silent.address()
  assert.ok(address && typeof address !== "string")
  const url = new URL(f.databaseUrl)
  url.hostname = "127.0.0.1"
  url.port = String(address.port)
  url.searchParams.set("sslmode", "disable")
  const { evolvePersonalizationSchema } = await import("../scripts/personalization-schema-evolution.mjs")
  const result = await evolvePersonalizationSchema({ mode: "apply", databaseUrl: url.toString(), timeoutMs: 1000 })
  assert.equal(result.state, "unavailable")
  assert.ok(result.duration_ms < 2000)
  await waitFor(() => sockets.size === 0)
  assert.equal(connections, 1)
  assert.deepEqual(await ownerSnapshot(f.pool), f.legacy)
})
