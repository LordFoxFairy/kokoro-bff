import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { performance } from "node:perf_hooks"
import { test } from "node:test"

import { Pool } from "pg"
import { createClient } from "redis"

import { createBffServer } from "../dist/main.js"
import { PostgresBffRepositories } from "../dist/infrastructure/postgres/repositories.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const redisUrl = process.env.KOKORO_TEST_REDIS_URL
const integrationTest = postgresUrl && redisUrl ? test : test.skip
const sessionAdmission = new SessionAdmissionDouble()

const idleWorker = { start() {}, async stop() {} }

function auth(namespace, principal = "chat_integration_user") {
  const token = `session-${namespace}-${principal}`
  sessionAdmission.allow(token, { namespace, userId: principal })
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "web-secret",
    authorization: `Bearer ${token}`,
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  if (server.listening) await new Promise((resolve) => server.close(() => resolve()))
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("condition was not met before timeout")
}

async function blockedPgQueries(pool, blockerPid, pattern, count = 1) {
  return waitFor(async () => {
    const blocked = await pool.query(
      `SELECT activity.pid, activity.query
         FROM pg_stat_activity AS activity
        WHERE activity.datname = current_database()
          AND activity.pid <> $1
          AND $1 = ANY(pg_blocking_pids(activity.pid))`,
      [blockerPid],
    )
    const matching = blocked.rows.filter((row) => pattern.test(row.query))
    return matching.length === count ? matching : null
  })
}

async function blockedPgQueriesThroughQueue(pool, ownerBlockerPid, pattern, count) {
  return waitFor(async () => {
    const activity = await pool.query(
      `SELECT pid,query,pg_blocking_pids(pid) AS blockers
         FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'`,
    )
    const byPid = new Map(activity.rows.map((row) => [row.pid, row]))
    const reachesOwnedBlocker = (startPid) => {
      const visited = new Set([startPid])
      let frontier = [startPid]
      for (let depth = 0; depth < 8 && frontier.length > 0; depth += 1) {
        const next = []
        for (const pid of frontier) {
          for (const blockerPid of byPid.get(pid)?.blockers ?? []) {
            if (blockerPid === ownerBlockerPid) return true
            if (!visited.has(blockerPid) && byPid.has(blockerPid)) {
              visited.add(blockerPid)
              next.push(blockerPid)
            }
          }
        }
        frontier = next
      }
      return false
    }
    const matching = activity.rows.filter((row) => row.pid !== ownerBlockerPid && pattern.test(row.query) && reachesOwnedBlocker(row.pid))
    return matching.length === count && new Set(matching.map((row) => row.pid)).size === count ? matching : null
  })
}

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

integrationTest("paginates Conversation ties completely through the production HTTP chain", { timeout: 30_000 }, async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const suffix = `${Date.now()}_${randomUUID()}`
  const tenant = `chat_page_${suffix}`
  const otherTenant = `${tenant}_other`
  const subject = `subject_${suffix}`
  const otherSubject = `${subject}_other`
  const projectId = `project_${suffix}`
  const projectBId = `project_b_${suffix}`
  const emptyProjectId = `project_empty_${suffix}`
  const otherProjectId = `project_other_${suffix}`
  const expected = ["newer", "tie_a", "tie_b", "tie_c", "older"].map((name) => `conversation_${name}_${suffix}`)
  const projectBConversation = `conversation_project_b_${suffix}`
  const directTieConversation = `conversation_direct_tie_${suffix}`
  const unassignedConversation = `conversation_unassigned_${suffix}`
  const otherSubjectDirectConversation = `conversation_other_subject_direct_${suffix}`
  const otherTenantDirectConversation = `conversation_other_tenant_direct_${suffix}`
  const deletedDirectConversation = `conversation_deleted_direct_${suffix}`
  const directExpected = [directTieConversation, unassignedConversation]
  const ownerWideExpected = [
    expected[0],
    directTieConversation,
    expected[1],
    expected[2],
    expected[3],
    expected[4],
    projectBConversation,
    unassignedConversation,
  ]
  let bff
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_project (project_id, tenant_id, owner_id, name, slug)
       VALUES
         ($1, $2, $3, 'Paging project', $4),
         ($5, $2, $3, 'Project B', $6),
         ($7, $2, $3, 'Empty project', $8),
         ($9, $2, $10, 'Other project', $11)`,
      [
        projectId,
        tenant,
        subject,
        `paging-${suffix}`,
        projectBId,
        `paging-b-${suffix}`,
        emptyProjectId,
        `paging-empty-${suffix}`,
        otherProjectId,
        otherSubject,
        `other-${suffix}`,
      ],
    )
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, project_ref, title, status, created_at, updated_at, deleted_at)
       VALUES
         ($1, $6, $7, $8, 'newer', 'active', '2026-10-01T12:00:01.000Z', '2026-10-01T12:00:01.000Z', NULL),
         ($3, $6, $7, $8, 'tie b', 'active', '2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z', NULL),
         ($4, $6, $7, $8, 'tie c', 'active', '2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z', NULL),
         ($2, $6, $7, $8, 'tie a', 'active', '2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z', NULL),
         ($5, $6, $7, $8, 'older', 'active', '2026-10-01T11:59:59.000Z', '2026-10-01T11:59:59.000Z', NULL)`,
      [...expected, tenant, subject, projectId],
    )
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, project_ref, title, status, deleted_at)
       VALUES
         ($1, $5, $6, $7, 'deleted', 'deleted', CURRENT_TIMESTAMP(3)),
         ($2, $5, $8, $7, 'other subject', 'active', NULL),
         ($3, $9, $6, $7, 'other tenant', 'active', NULL),
         ($4, $5, $6, $10, 'unowned project', 'active', NULL),
         ($11, $5, $6, $12, 'project b', 'active', NULL),
         ($13, $5, $6, NULL, 'unassigned', 'active', NULL)`,
      [
        `conversation_deleted_${suffix}`,
        `conversation_other_subject_${suffix}`,
        `conversation_other_tenant_${suffix}`,
        `conversation_unowned_project_${suffix}`,
        tenant,
        subject,
        projectId,
        otherSubject,
        otherTenant,
        otherProjectId,
        projectBConversation,
        projectBId,
        unassignedConversation,
      ],
    )
    await pool.query(
      `UPDATE bff_conversation
          SET created_at = CASE conversation_id WHEN $1 THEN '2026-10-01T11:59:58.000Z'::timestamptz ELSE '2026-10-01T11:59:57.000Z'::timestamptz END,
              updated_at = CASE conversation_id WHEN $1 THEN '2026-10-01T11:59:58.000Z'::timestamptz ELSE '2026-10-01T11:59:57.000Z'::timestamptz END
        WHERE conversation_id IN ($1, $2)`,
      [projectBConversation, unassignedConversation],
    )
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, project_ref, title, status, created_at, updated_at, deleted_at)
       VALUES
         ($1, $5, $6, NULL, 'direct tie', 'active', '2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z', NULL),
         ($2, $5, $7, NULL, 'other subject direct', 'active', '2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z', NULL),
         ($3, $8, $6, NULL, 'other tenant direct', 'active', '2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z', NULL),
         ($4, $5, $6, NULL, 'deleted direct', 'deleted', '2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z')`,
      [
        directTieConversation,
        otherSubjectDirectConversation,
        otherTenantDirectConversation,
        deletedDirectConversation,
        tenant,
        subject,
        otherSubject,
        otherTenant,
      ],
    )
    bff = createBffServer(config(tenant), { sessionAdmission })
    const base = await listen(bff)

    for (const limit of [1, 2]) {
      const seen = []
      const seenCursors = new Set()
      let cursor = null
      do {
        assert.ok(seenCursors.size <= expected.length, "Conversation pagination exceeded the bounded static result set")
        const query = new URLSearchParams({ project_ref: projectId, limit: String(limit) })
        if (cursor !== null) query.set("cursor", cursor)
        const response = await fetch(`${base}/v1/sessions?${query}`, { headers: auth(tenant, subject), signal: AbortSignal.timeout(5000) })
        assert.equal(response.status, 200)
        const body = await response.json()
        seen.push(...body.data.sessions.map((session) => session.session_id))
        cursor = body.data.next_cursor
        if (cursor !== null) {
          assert.equal(seenCursors.has(cursor), false, "Conversation pagination repeated a cursor")
          seenCursors.add(cursor)
        }
      } while (cursor !== null)

      assert.deepEqual(seen, expected)
      assert.equal(new Set(seen).size, expected.length)
      assert.equal(cursor, null)
    }

    const projectB = await fetch(`${base}/v1/sessions?project_ref=${encodeURIComponent(projectBId)}&limit=2`, {
      headers: auth(tenant, subject),
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(projectB.status, 200)
    assert.deepEqual((await projectB.json()).data, {
      sessions: [{ session_id: projectBConversation, title: "project b", updated_at: "2026-10-01T11:59:58.000Z" }],
      next_cursor: null,
    })
    const emptyProject = await fetch(`${base}/v1/sessions?project_ref=${encodeURIComponent(emptyProjectId)}&limit=1`, {
      headers: auth(tenant, subject),
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(emptyProject.status, 200)
    assert.deepEqual((await emptyProject.json()).data, { sessions: [], next_cursor: null })

    const ownerWide = await fetch(`${base}/v1/sessions?limit=100`, { headers: auth(tenant, subject), signal: AbortSignal.timeout(5000) })
    assert.equal(ownerWide.status, 200)
    assert.deepEqual(
      (await ownerWide.json()).data.sessions.map((session) => session.session_id),
      ownerWideExpected,
    )
    const ownerWideEmptyScope = await fetch(`${base}/v1/sessions?scope=&limit=100`, { headers: auth(tenant, subject), signal: AbortSignal.timeout(5000) })
    assert.equal(ownerWideEmptyScope.status, 200)
    assert.deepEqual(
      (await ownerWideEmptyScope.json()).data.sessions.map((session) => session.session_id),
      ownerWideExpected,
    )

    const collectDirect = async (principal, limit) => {
      const seen = []
      const seenCursors = new Set()
      let cursor = null
      do {
        const query = new URLSearchParams({ scope: "direct", limit: String(limit) })
        if (cursor !== null) query.set("cursor", cursor)
        const response = await fetch(`${base}/v1/sessions?${query}`, { headers: auth(tenant, principal), signal: AbortSignal.timeout(5000) })
        assert.equal(response.status, 200)
        const body = await response.json()
        seen.push(...body.data.sessions.map((session) => session.session_id))
        cursor = body.data.next_cursor
        if (cursor !== null) {
          assert.equal(seenCursors.has(cursor), false, "Direct Conversation pagination repeated a cursor")
          seenCursors.add(cursor)
        }
      } while (cursor !== null)
      return { seen, unique: new Set(seen).size, finalCursor: cursor }
    }
    const conflict = await fetch(`${base}/v1/sessions?scope=direct&project_ref=${encodeURIComponent(projectId)}`, {
      headers: auth(tenant, subject),
      signal: AbortSignal.timeout(5000),
    })
    const conflictBody = await conflict.json()
    const directEvidence = {
      limit1: await collectDirect(subject, 1),
      limit2: await collectDirect(subject, 2),
      otherSubject: await collectDirect(otherSubject, 1),
      conflict: { status: conflict.status, code: conflictBody.error?.code ?? null },
    }
    assert.deepEqual(directEvidence, {
      limit1: { seen: directExpected, unique: directExpected.length, finalCursor: null },
      limit2: { seen: directExpected, unique: directExpected.length, finalCursor: null },
      otherSubject: { seen: [otherSubjectDirectConversation], unique: 1, finalCursor: null },
      conflict: { status: 400, code: "invalid_scope" },
    })
  } finally {
    if (bff) await close(bff)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id IN ($1, $2)", [tenant, otherTenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_project WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("R207 Message admission bounds a Project lock wait and leaves zero command facts", { timeout: 30_000 }, async () => {
  const suffix = randomUUID()
  const tenant = `r207_message_deadline_${suffix}`
  const subject = `r207_owner_${suffix}`
  const projectId = `project_${randomUUID()}`
  const blockedConversation = `conv_${randomUUID()}`
  const healthyConversation = `conv_${randomUUID()}`
  const blockedKey = `r207-blocked-${suffix}`
  const healthyKey = `r207-healthy-${suffix}`
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  let bff = null
  let blocker = null
  let safetyTimer = null
  let safetyOperation = null
  let safetyError = null
  let testError = null
  let primaryObservation = null
  const pending = []

  const releaseBlocker = async () => {
    if (blocker === null) return
    const owned = blocker
    blocker = null
    try {
      await owned.query("ROLLBACK")
    } finally {
      owned.release()
    }
  }

  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug)
       VALUES ($1,$2,$3,'R207 deadline',$4)`,
      [projectId, tenant, subject, `r207-deadline-${suffix}`],
    )
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title)
       VALUES ($1,$3,$4,$5,'R207 blocked'),($2,$3,$4,$5,'R207 healthy')`,
      [blockedConversation, healthyConversation, tenant, subject, projectId],
    )

    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const runtimeConfig = config(tenant)
    runtimeConfig.agentEnabled = true
    runtimeConfig.upstreams.agents = "http://127.0.0.1:9"
    bff = createBffServer(runtimeConfig, {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
    })
    const base = await listen(bff)
    const identity = auth(tenant, subject)
    const sendMessage = async (conversationId, key, content) => {
      const response = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
        method: "POST",
        headers: { ...identity, "idempotency-key": key, "content-type": "application/json" },
        body: JSON.stringify({ content, model: "r207-model", project_ref: projectId }),
        signal: AbortSignal.timeout(12_000),
      })
      return { response, body: await response.json() }
    }
    const tenantFacts = async (table) =>
      (await pool.query(`SELECT to_jsonb(owned) AS fact FROM ${table} AS owned WHERE tenant_id=$1 ORDER BY to_jsonb(owned)::text`, [tenant])).rows.map(
        ({ fact }) => fact,
      )
    const facts = async () => ({
      projects: await tenantFacts("bff_project"),
      conversations: await tenantFacts("bff_conversation"),
      messages: await tenantFacts("bff_message"),
      dispatches: await tenantFacts("bff_agent_dispatch_outbox"),
      cancellations: await tenantFacts("bff_agent_cancellation_outbox"),
      streams: await tenantFacts("bff_agui_stream"),
      events: await tenantFacts("bff_agui_event"),
      receipts: (
        await pool.query(
          `SELECT to_jsonb(owned) AS fact
             FROM bff_idempotency_receipt AS owned
            WHERE position($1 in scope)>0
            ORDER BY to_jsonb(owned)::text`,
          [tenant],
        )
      ).rows.map(({ fact }) => fact),
    })
    const before = await facts()

    blocker = await pool.connect()
    await blocker.query("BEGIN")
    await blocker.query(
      `SELECT project_id FROM bff_project
        WHERE tenant_id=$1 AND owner_id=$2 AND project_id=$3
        FOR UPDATE`,
      [tenant, subject, projectId],
    )
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid

    const startedAt = performance.now()
    const blockedRequest = sendMessage(blockedConversation, blockedKey, "R207 blocked command")
    pending.push(blockedRequest)
    safetyTimer = setTimeout(() => {
      safetyOperation = releaseBlocker().catch((error) => {
        safetyError = error
      })
    }, 5200)
    await blockedPgQueries(pool, blockerPid, /FROM bff_project[\s\S]*FOR SHARE/u, 1)

    const blockedResult = await blockedRequest
    const elapsedMs = performance.now() - startedAt
    assert.equal(blockedResult.response.status, 503, JSON.stringify(blockedResult.body))
    assert.equal(blockedResult.body.error?.code, "business_store_unavailable")
    assert.ok(elapsedMs < 4900, `Message admission took ${elapsedMs.toFixed(1)}ms`)
    assert.equal(blockedResult.response.headers.get("cache-control"), "no-store")
    assert.ok(blockedResult.response.headers.get("x-request-id"))
    assert.equal(Object.hasOwn(blockedResult.body.error ?? {}, "request_id"), false)
    assert.deepEqual(await facts(), before)

    clearTimeout(safetyTimer)
    safetyTimer = null
    await releaseBlocker()
    if (safetyOperation !== null) await safetyOperation
    if (safetyError !== null) throw safetyError
    assert.deepEqual(await facts(), before)

    const healthy = await sendMessage(healthyConversation, healthyKey, "R207 reusable pool")
    assert.equal(healthy.response.status, 202, JSON.stringify(healthy.body))
    assert.ok(healthy.response.headers.get("x-request-id"))
    const healthyFacts = await facts()
    assert.equal(healthyFacts.messages.filter(({ conversation_id }) => conversation_id === healthyConversation).length, 2)
    assert.equal(healthyFacts.dispatches.filter(({ conversation_id }) => conversation_id === healthyConversation).length, 1)
  } catch (error) {
    testError = error
    const scalar = (value) => (["string", "number", "boolean"].includes(typeof value) || value === null ? value : null)
    primaryObservation = {
      name: error instanceof Error ? error.name : typeof error,
      code: typeof error === "object" && error !== null && "code" in error ? scalar(error.code) : null,
      actual: typeof error === "object" && error !== null && "actual" in error ? scalar(error.actual) : null,
      expected: typeof error === "object" && error !== null && "expected" in error ? scalar(error.expected) : null,
    }
    process.stderr.write(`# R207_PRIMARY ${JSON.stringify(primaryObservation)}\n`)
  } finally {
    const cleanupErrors = []
    const cleanup = async (operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (safetyTimer !== null) clearTimeout(safetyTimer)
    await cleanup(releaseBlocker)
    if (safetyOperation !== null) await cleanup(() => safetyOperation)
    if (safetyError !== null) cleanupErrors.push(safetyError)
    const settled = await Promise.allSettled(pending)
    cleanupErrors.push(...settled.filter(({ status, reason }) => status === "rejected" && reason !== testError).map(({ reason }) => reason))
    if (bff !== null) await cleanup(() => close(bff))
    if (store !== null) await cleanup(() => store.close())
    await cleanup(() => pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant]))
    for (const table of ["bff_agent_cancellation_outbox", "bff_share", "bff_agui_event", "bff_agui_stream", "bff_agent_dispatch_outbox", "bff_message"]) {
      await cleanup(() => pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]))
    }
    await cleanup(() => pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.end())
    if (testError !== null || cleanupErrors.length > 0) {
      throw new AggregateError(testError === null ? cleanupErrors : [testError, ...cleanupErrors], `R207 Message deadline or cleanup failed ${JSON.stringify(primaryObservation)}`, {
        cause: testError ?? cleanupErrors[0],
      })
    }
  }
})

integrationTest("R209 Message cumulative SQL shares one absolute admission deadline", { timeout: 30_000 }, async () => {
  const suffix = randomUUID()
  const sqlSuffix = suffix.replaceAll("-", "")
  const tenant = `r209_message_deadline_${suffix}`
  const subject = `r209_owner_${suffix}`
  const projectId = `project_${randomUUID()}`
  const blockedConversation = `conv_${randomUUID()}`
  const healthyConversation = `conv_${randomUUID()}`
  const outboxFunction = `r209_outbox_sleep_${sqlSuffix}`
  const outboxTrigger = `r209_outbox_sleep_trigger_${sqlSuffix}`
  const messageFunction = `r209_message_sleep_${sqlSuffix}`
  const messageTrigger = `r209_message_sleep_trigger_${sqlSuffix}`
  const outboxMarker = `r209:${sqlSuffix}:outbox`
  const messageMarker = `r209:${sqlSuffix}:message`
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  let bff = null
  let testError = null
  let phase = "setup"
  let observedOutboxPid = false
  let observedMessagePid = false
  let httpElapsedMs = null
  let poolBaseline = null
  let poolCurrent = null
  const pending = []
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug)
       VALUES ($1,$2,$3,'R209 deadline',$4)`,
      [projectId, tenant, subject, `r209-deadline-${suffix}`],
    )
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title)
       VALUES ($1,$3,$4,$5,'R209 blocked'),($2,$3,$4,$5,'R209 healthy')`,
      [blockedConversation, healthyConversation, tenant, subject, projectId],
    )
    await pool.query(
      `CREATE FUNCTION ${outboxFunction}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.tenant_id = '${tenant}' THEN
           PERFORM set_config('application_name','${outboxMarker}',true);
           PERFORM pg_sleep(3.0);
         END IF;
         RETURN NEW;
       END $$`,
    )
    await pool.query(
      `CREATE TRIGGER ${outboxTrigger} BEFORE INSERT ON bff_agent_dispatch_outbox
       FOR EACH ROW EXECUTE FUNCTION ${outboxFunction}()`,
    )
    await pool.query(
      `CREATE FUNCTION ${messageFunction}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.tenant_id = '${tenant}' AND NEW.role = 'user' THEN
           PERFORM set_config('application_name','${messageMarker}',true);
           PERFORM pg_sleep(3.0);
         END IF;
         RETURN NEW;
       END $$`,
    )
    await pool.query(
      `CREATE TRIGGER ${messageTrigger} BEFORE INSERT ON bff_message
       FOR EACH ROW EXECUTE FUNCTION ${messageFunction}()`,
    )

    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const runtimeConfig = config(tenant)
    runtimeConfig.agentEnabled = true
    runtimeConfig.upstreams.agents = "http://127.0.0.1:9"
    bff = createBffServer(runtimeConfig, {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
      scheduledAgentDispatcher: idleWorker,
      scheduledAgentTerminalConsumer: idleWorker,
    })
    const base = await listen(bff)
    const identity = auth(tenant, subject)
    const warmup = await fetch(`${base}/v1/sessions?scope=direct`, { headers: identity })
    assert.equal(warmup.status, 200)
    await warmup.json()
    const sendMessage = async (conversationId, key, content) => {
      const response = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
        method: "POST",
        headers: { ...identity, "idempotency-key": key, "content-type": "application/json" },
        body: JSON.stringify({ content, model: "r209-model", project_ref: projectId }),
        signal: AbortSignal.timeout(12_000),
      })
      return { response, body: await response.json() }
    }
    const tenantFacts = async (table) =>
      (await pool.query(`SELECT to_jsonb(owned) AS fact FROM ${table} AS owned WHERE tenant_id=$1 ORDER BY to_jsonb(owned)::text`, [tenant])).rows.map(
        ({ fact }) => fact,
      )
    const facts = async () => ({
      projects: await tenantFacts("bff_project"),
      conversations: await tenantFacts("bff_conversation"),
      messages: await tenantFacts("bff_message"),
      dispatches: await tenantFacts("bff_agent_dispatch_outbox"),
      cancellations: await tenantFacts("bff_agent_cancellation_outbox"),
      streams: await tenantFacts("bff_agui_stream"),
      events: await tenantFacts("bff_agui_event"),
      receipts: (
        await pool.query(
          `SELECT to_jsonb(owned) AS fact FROM bff_idempotency_receipt AS owned
            WHERE position($1 in scope)>0 ORDER BY to_jsonb(owned)::text`,
          [tenant],
        )
      ).rows.map(({ fact }) => fact),
    })
    const sleepingBackend = async (marker) =>
      waitFor(async () => {
        const result = await pool.query(
          `SELECT pid FROM pg_stat_activity
            WHERE datname=current_database() AND application_name=$1
              AND wait_event_type='Timeout' AND wait_event='PgSleep'`,
          [marker],
        )
        return result.rows.length === 1 ? result.rows[0].pid : null
      })
    const backendFinished = async (pid) =>
      waitFor(async () => {
        const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid=$1", [pid])
        return result.rows.length === 0
      })
    const repositoryPoolCounts = () => {
      const repositoryPool = store.database.pool
      return { totalCount: repositoryPool.totalCount, idleCount: repositoryPool.idleCount, waitingCount: repositoryPool.waitingCount }
    }
    await waitFor(() => {
      const current = repositoryPoolCounts()
      poolCurrent = current
      return current.waitingCount === 0 && current.idleCount === current.totalCount
    })
    const before = await facts()
    const poolBefore = repositoryPoolCounts()
    poolBaseline = poolBefore
    poolCurrent = poolBefore
    const startedAt = performance.now()
    const blockedRequest = sendMessage(blockedConversation, `r209-blocked-${suffix}`, "R209 cumulative deadline")
    pending.push(blockedRequest)
    phase = "outbox-marker"
    const outboxPid = await sleepingBackend(outboxMarker)
    observedOutboxPid = true
    phase = "message-marker"
    const messagePid = await sleepingBackend(messageMarker)
    observedMessagePid = true
    assert.equal(messagePid, outboxPid)
    phase = "HTTP-return"
    const blockedResult = await blockedRequest
    httpElapsedMs = performance.now() - startedAt
    poolCurrent = repositoryPoolCounts()
    assert.equal(blockedResult.response.status, 503, JSON.stringify(blockedResult.body))
    assert.equal(blockedResult.body.error?.code, "business_store_unavailable")
    assert.ok(httpElapsedMs < 4900, `Message admission HTTP took ${httpElapsedMs.toFixed(1)}ms`)
    assert.equal(blockedResult.response.headers.get("cache-control"), "no-store")
    assert.ok(blockedResult.response.headers.get("x-request-id"))
    phase = "after-response-facts"
    assert.deepEqual(await facts(), before)
    phase = "backend-disappear"
    await backendFinished(outboxPid)
    poolCurrent = repositoryPoolCounts()
    phase = "after-backend-facts"
    assert.deepEqual(await facts(), before)

    await pool.query(`DROP TRIGGER ${outboxTrigger} ON bff_agent_dispatch_outbox`)
    await pool.query(`DROP FUNCTION ${outboxFunction}()`)
    await pool.query(`DROP TRIGGER ${messageTrigger} ON bff_message`)
    await pool.query(`DROP FUNCTION ${messageFunction}()`)
    phase = "healthy-response"
    const healthy = await sendMessage(healthyConversation, `r209-healthy-${suffix}`, "R209 pool reusable")
    poolCurrent = repositoryPoolCounts()
    assert.equal(healthy.response.status, 202, JSON.stringify(healthy.body))
    assert.ok(healthy.response.headers.get("x-request-id"))
    const healthyFacts = await facts()
    assert.equal(healthyFacts.messages.filter(({ conversation_id }) => conversation_id === healthyConversation).length, 2)
    assert.equal(healthyFacts.dispatches.filter(({ conversation_id }) => conversation_id === healthyConversation).length, 1)
    phase = "pool-baseline"
    await waitFor(() => {
      const current = repositoryPoolCounts()
      poolCurrent = current
      return current.waitingCount === 0 && current.idleCount === current.totalCount
    })
    poolCurrent = repositoryPoolCounts()
    assert.deepEqual(repositoryPoolCounts(), poolBefore)
  } catch (error) {
    testError = error
    const scalar = (value) => (["string", "number", "boolean"].includes(typeof value) || value === null ? value : null)
    process.stderr.write(
      `# R209_PRIMARY ${JSON.stringify({
        name: error instanceof Error ? error.name : typeof error,
        code: typeof error === "object" && error !== null && "code" in error ? scalar(error.code) : null,
        actual: typeof error === "object" && error !== null && "actual" in error ? scalar(error.actual) : null,
        expected: typeof error === "object" && error !== null && "expected" in error ? scalar(error.expected) : null,
        message: error instanceof Error && error.message === "condition was not met before timeout" ? error.message : null,
        phase,
        http_elapsed_ms: httpElapsedMs,
        pool_baseline: poolBaseline,
        pool_current: poolCurrent,
        observed_outbox_pid: observedOutboxPid,
        observed_message_pid: observedMessagePid,
      })}\n`,
    )
  } finally {
    const cleanupErrors = []
    const cleanup = async (operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    const settled = await Promise.allSettled(pending)
    cleanupErrors.push(...settled.filter(({ status, reason }) => status === "rejected" && reason !== testError).map(({ reason }) => reason))
    if (bff !== null) await cleanup(() => close(bff))
    if (store !== null) await cleanup(() => store.close())
    await cleanup(() => pool.query(`DROP TRIGGER IF EXISTS ${outboxTrigger} ON bff_agent_dispatch_outbox`))
    await cleanup(() => pool.query(`DROP FUNCTION IF EXISTS ${outboxFunction}()`))
    await cleanup(() => pool.query(`DROP TRIGGER IF EXISTS ${messageTrigger} ON bff_message`))
    await cleanup(() => pool.query(`DROP FUNCTION IF EXISTS ${messageFunction}()`))
    await cleanup(() => pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant]))
    for (const table of ["bff_agent_cancellation_outbox", "bff_share", "bff_agui_event", "bff_agui_stream", "bff_agent_dispatch_outbox", "bff_message"]) {
      await cleanup(() => pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]))
    }
    await cleanup(() => pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.end())
    if (testError !== null || cleanupErrors.length > 0) {
      throw new AggregateError(testError === null ? cleanupErrors : [testError, ...cleanupErrors], "R209 cumulative deadline or cleanup failed", {
        cause: testError ?? cleanupErrors[0],
      })
    }
  }
})

integrationTest("R211 Message HTTP pool saturation keeps one absolute deadline and releases a late Client", { timeout: 20_000 }, async () => {
  const suffix = randomUUID()
  const tenant = `r211_message_pool_${suffix}`
  const subject = `r211_owner_${suffix}`
  const projectId = `project_${randomUUID()}`
  const conversationId = `conv_${randomUUID()}`
  const key = `r211-pool-${suffix}`
  const content = "R211 bounded pool admission"
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const held = []
  let store = null
  let bff = null
  let pendingRequest = null
  let releaseOne = null
  let testError = null
  let phase = "setup"
  let httpElapsedMs = null
  let observedStatus = null
  let observedCode = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query("INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$2,$3,'R211 pool',$4)", [
      projectId,
      tenant,
      subject,
      `r211-pool-${suffix}`,
    ])
    await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title) VALUES ($1,$2,$3,$4,'R211 pool')", [
      conversationId,
      tenant,
      subject,
      projectId,
    ])

    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const runtimeConfig = config(tenant)
    runtimeConfig.agentEnabled = true
    runtimeConfig.upstreams.agents = "http://127.0.0.1:9"
    bff = createBffServer(runtimeConfig, {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
      scheduledAgentDispatcher: idleWorker,
      scheduledAgentTerminalConsumer: idleWorker,
    })
    const base = await listen(bff)
    const identity = auth(tenant, subject)
    const warmup = await fetch(`${base}/v1/sessions?scope=direct`, { headers: identity })
    assert.equal(warmup.status, 200)
    await warmup.json()

    const ownerPool = store.database.pool
    assert.equal(ownerPool.options.max, 10, "this case saturates the real BFF owner Pool")
    for (let index = 0; index < ownerPool.options.max; index += 1) held.push(await ownerPool.connect())
    for (const client of held.splice(0)) client.release()
    await waitFor(() => ownerPool.totalCount === 10 && ownerPool.idleCount === 10 && ownerPool.waitingCount === 0)
    const poolBaseline = { totalCount: ownerPool.totalCount, idleCount: ownerPool.idleCount, waitingCount: ownerPool.waitingCount }
    assert.deepEqual(poolBaseline, { totalCount: 10, idleCount: 10, waitingCount: 0 })
    for (let index = 0; index < ownerPool.options.max; index += 1) held.push(await ownerPool.connect())
    assert.deepEqual(
      { totalCount: ownerPool.totalCount, idleCount: ownerPool.idleCount, waitingCount: ownerPool.waitingCount },
      { totalCount: 10, idleCount: 0, waitingCount: 0 },
    )

    const tenantFacts = async (table) =>
      (await pool.query(`SELECT to_jsonb(owned) AS fact FROM ${table} AS owned WHERE tenant_id=$1 ORDER BY to_jsonb(owned)::text`, [tenant])).rows.map(
        ({ fact }) => fact,
      )
    const facts = async () => ({
      projects: await tenantFacts("bff_project"),
      conversations: await tenantFacts("bff_conversation"),
      messages: await tenantFacts("bff_message"),
      dispatches: await tenantFacts("bff_agent_dispatch_outbox"),
      cancellations: await tenantFacts("bff_agent_cancellation_outbox"),
      streams: await tenantFacts("bff_agui_stream"),
      events: await tenantFacts("bff_agui_event"),
      receipts: (
        await pool.query(
          `SELECT to_jsonb(owned) AS fact FROM bff_idempotency_receipt AS owned
            WHERE position($1 in scope)>0 ORDER BY to_jsonb(owned)::text`,
          [tenant],
        )
      ).rows.map(({ fact }) => fact),
    })
    const before = await facts()
    const sendMessage = async () => {
      const response = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
        method: "POST",
        headers: { ...identity, "idempotency-key": key, "content-type": "application/json" },
        body: JSON.stringify({ content, model: "r211-model", project_ref: projectId }),
        signal: AbortSignal.timeout(12_000),
      })
      return { response, body: await response.json() }
    }
    const startedAt = performance.now()
    pendingRequest = sendMessage()
    phase = "pool-waiter"
    await waitFor(() => ownerPool.waitingCount >= 1, 1500)
    releaseOne = new Promise((resolve) => {
      setTimeout(() => {
        held.shift()?.release()
        resolve()
      }, Math.max(1, 5200 - (performance.now() - startedAt)))
    })
    phase = "HTTP-return"
    const bounded = await pendingRequest
    const elapsed = performance.now() - startedAt
    httpElapsedMs = elapsed
    observedStatus = bounded.response.status
    observedCode = bounded.body.error?.code ?? null
    assert.ok(elapsed < 4900, `Message admission HTTP took ${elapsed.toFixed(1)}ms`)
    assert.equal(bounded.response.status, 503, JSON.stringify(bounded.body))
    assert.equal(bounded.body.error?.code, "business_store_unavailable")
    assert.equal(bounded.response.headers.get("cache-control"), "no-store")
    assert.ok(bounded.response.headers.get("x-request-id"))
    assert.deepEqual(await facts(), before)
    assert.ok(ownerPool.waitingCount >= 1, "the timed-out HTTP acquire remains queued until the real Pool returns its late Client")

    phase = "late-acquire"
    await releaseOne
    await waitFor(() => ownerPool.waitingCount === 0 && ownerPool.totalCount === 10 && ownerPool.idleCount === 1)
    assert.deepEqual(await facts(), before)
    for (const client of held.splice(0)) client.release()
    phase = "pool-baseline"
    await waitFor(() => ownerPool.totalCount === 10 && ownerPool.idleCount === 10 && ownerPool.waitingCount === 0)
    assert.deepEqual({ totalCount: ownerPool.totalCount, idleCount: ownerPool.idleCount, waitingCount: ownerPool.waitingCount }, poolBaseline)

    phase = "healthy-response"
    const healthy = await sendMessage()
    assert.equal(healthy.response.status, 202, JSON.stringify(healthy.body))
    const after = await facts()
    assert.equal(after.messages.length, 2)
    assert.equal(after.dispatches.length, 1)
    assert.deepEqual(after.receipts, before.receipts)
    const dispatch = after.dispatches[0]
    assert.equal(dispatch.conversation_id, conversationId)
    assert.equal(dispatch.idempotency_key, key)
    assert.match(dispatch.request_digest, /^[0-9a-f]{64}$/u)
    assert.equal(dispatch.run_id, healthy.body.data.run_id)
    assert.equal(dispatch.user_message_id, healthy.body.data.user_message_id)
    assert.equal(dispatch.assistant_message_id, healthy.body.data.assistant_message_id)
    assert.equal(dispatch.payload.launch.session_id, conversationId)
    assert.equal(dispatch.payload.launch.run_id, healthy.body.data.run_id)
    assert.equal(dispatch.payload.launch.message_id, healthy.body.data.user_message_id)
    assert.equal(dispatch.payload.launch.content, content)
    const messageIdentityByRole = Object.fromEntries(after.messages.map(({ message_id, run_id, role }) => [role, { message_id, run_id }]))
    assert.deepEqual(messageIdentityByRole, {
      user: { message_id: healthy.body.data.user_message_id, run_id: healthy.body.data.run_id },
      assistant: { message_id: healthy.body.data.assistant_message_id, run_id: healthy.body.data.run_id },
    })

    phase = "healthy-replay"
    const replay = await sendMessage()
    assert.equal(replay.response.status, 202, JSON.stringify(replay.body))
    assert.deepEqual(replay.body.data, healthy.body.data)
    assert.deepEqual(await facts(), after)
  } catch (error) {
    testError = error
    process.stderr.write(
      `# R211_PRIMARY ${JSON.stringify({
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : null,
        phase,
        http_elapsed_ms: httpElapsedMs,
        status: observedStatus,
        code: observedCode,
      })}\n`,
    )
  } finally {
    const cleanupErrors = []
    const cleanup = async (operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    for (const client of held.splice(0)) client.release()
    if (releaseOne !== null) await releaseOne
    if (pendingRequest !== null) await pendingRequest.catch((error) => cleanupErrors.push(error))
    if (bff !== null) await cleanup(() => close(bff))
    if (store !== null) await cleanup(() => store.close())
    await cleanup(() => pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant]))
    for (const table of ["bff_agent_cancellation_outbox", "bff_share", "bff_agui_event", "bff_agui_stream", "bff_agent_dispatch_outbox", "bff_message"]) {
      await cleanup(() => pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]))
    }
    await cleanup(() => pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.end())
    if (testError !== null || cleanupErrors.length > 0) {
      throw new AggregateError(testError === null ? cleanupErrors : [testError, ...cleanupErrors], "R211 Message pool deadline or cleanup failed", {
        cause: testError ?? cleanupErrors[0],
      })
    }
  }
})

integrationTest("R215 Message rolls back real mid-transaction SQL faults and a terminated backend", { timeout: 30_000 }, async () => {
  const suffix = randomUUID()
  const sqlSuffix = suffix.replaceAll("-", "")
  const tenant = `r215_message_fault_${suffix}`
  const subject = `r215_owner_${suffix}`
  const projectId = `project_${randomUUID()}`
  const sqlConversation = `conv_${randomUUID()}`
  const disconnectConversation = `conv_${randomUUID()}`
  const sqlKey = `r215-sql-${suffix}`
  const disconnectKey = `r215-disconnect-${suffix}`
  const sqlFunction = `r215_message_fault_${sqlSuffix}`
  const sqlTrigger = `r215_message_fault_trigger_${sqlSuffix}`
  const disconnectFunction = `r215_disconnect_${sqlSuffix}`
  const disconnectTrigger = `r215_disconnect_trigger_${sqlSuffix}`
  const disconnectMarker = `r215:${sqlSuffix}:disconnect`
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  let bff = null
  let restoreClientObserver = () => {}
  let testError = null
  let phase = "setup"
  let httpElapsedMs = null
  let brokenPid = null
  let brokenClient = null
  let leaseErrorListener = null
  const brokenReleases = []
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query("INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$2,$3,'R215 fault',$4)", [
      projectId,
      tenant,
      subject,
      `r215-fault-${suffix}`,
    ])
    await pool.query(
      "INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title) VALUES ($1,$3,$4,$5,'R215 SQL'),($2,$3,$4,$5,'R215 disconnect')",
      [sqlConversation, disconnectConversation, tenant, subject, projectId],
    )
    await pool.query(
      `CREATE FUNCTION ${sqlFunction}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='${tenant}' AND NEW.conversation_id='${sqlConversation}' AND NEW.role='user' THEN RAISE EXCEPTION 'R215_MESSAGE_SQL_FAULT' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$`,
    )
    await pool.query(`CREATE TRIGGER ${sqlTrigger} BEFORE INSERT ON bff_message FOR EACH ROW EXECUTE FUNCTION ${sqlFunction}()`)

    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const runtimeConfig = config(tenant)
    runtimeConfig.agentEnabled = true
    runtimeConfig.upstreams.agents = "http://127.0.0.1:9"
    bff = createBffServer(runtimeConfig, {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
      scheduledAgentDispatcher: idleWorker,
      scheduledAgentTerminalConsumer: idleWorker,
    })
    const base = await listen(bff)
    const identity = auth(tenant, subject)
    const warmup = await fetch(`${base}/v1/sessions?scope=direct`, {
      headers: identity,
    })
    assert.equal(warmup.status, 200)
    await warmup.json()
    const tenantFacts = async (table) =>
      (await pool.query(`SELECT to_jsonb(owned) AS fact FROM ${table} AS owned WHERE tenant_id=$1 ORDER BY to_jsonb(owned)::text`, [tenant])).rows.map(
        ({ fact }) => fact,
      )
    const facts = async () => ({
      projects: await tenantFacts("bff_project"),
      conversations: await tenantFacts("bff_conversation"),
      messages: await tenantFacts("bff_message"),
      dispatches: await tenantFacts("bff_agent_dispatch_outbox"),
      cancellations: await tenantFacts("bff_agent_cancellation_outbox"),
      streams: await tenantFacts("bff_agui_stream"),
      events: await tenantFacts("bff_agui_event"),
      receipts: (
        await pool.query("SELECT to_jsonb(owned) AS fact FROM bff_idempotency_receipt AS owned WHERE position($1 in scope)>0 ORDER BY to_jsonb(owned)::text", [
          tenant,
        ])
      ).rows.map(({ fact }) => fact),
    })
    const sendMessage = async (conversationId, key, content) => {
      const startedAt = performance.now()
      const response = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
        method: "POST",
        headers: {
          ...identity,
          "idempotency-key": key,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          content,
          model: "r215-model",
          project_ref: projectId,
        }),
        signal: AbortSignal.timeout(12_000),
      })
      return {
        response,
        body: await response.json(),
        elapsedMs: performance.now() - startedAt,
      }
    }
    const before = await facts()

    phase = "sql-fault"
    const failedSql = await sendMessage(sqlConversation, sqlKey, "R215 SQL rollback")
    httpElapsedMs = failedSql.elapsedMs
    assert.equal(failedSql.response.status, 503, JSON.stringify(failedSql.body))
    assert.equal(failedSql.body.error?.code, "business_store_unavailable")
    assert.ok(failedSql.elapsedMs < 4900)
    assert.equal(failedSql.response.headers.get("cache-control"), "no-store")
    assert.ok(failedSql.response.headers.get("x-request-id"))
    assert.deepEqual(await facts(), before)
    await pool.query(`DROP TRIGGER ${sqlTrigger} ON bff_message`)
    await pool.query(`DROP FUNCTION ${sqlFunction}()`)
    const recoveredSql = await sendMessage(sqlConversation, sqlKey, "R215 SQL rollback")
    assert.equal(recoveredSql.response.status, 202, JSON.stringify(recoveredSql.body))
    const afterSql = await facts()
    assert.equal(afterSql.messages.filter(({ conversation_id }) => conversation_id === sqlConversation).length, 2)
    assert.equal(afterSql.dispatches.filter(({ conversation_id }) => conversation_id === sqlConversation).length, 1)

    await pool.query(
      `CREATE FUNCTION ${disconnectFunction}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='${tenant}' AND NEW.conversation_id='${disconnectConversation}' AND NEW.role='user' THEN PERFORM set_config('application_name','${disconnectMarker}',true); PERFORM pg_sleep(10); END IF; RETURN NEW; END $$`,
    )
    await pool.query(`CREATE TRIGGER ${disconnectTrigger} BEFORE INSERT ON bff_message FOR EACH ROW EXECUTE FUNCTION ${disconnectFunction}()`)
    const ownerPool = store.database.pool
    const originalConnect = ownerPool.connect
    const observedClients = new Map()
    ownerPool.connect = async function (...args) {
      const client = await originalConnect.apply(this, args)
      const checkoutRelease = client.release
      observedClients.set(client, checkoutRelease)
      client.release = function (destroy) {
        if (brokenPid !== null && this.processID === brokenPid) brokenReleases.push(destroy === true)
        return checkoutRelease.call(this, destroy)
      }
      return client
    }
    restoreClientObserver = () => {
      ownerPool.connect = originalConnect
      for (const [client, release] of observedClients) client.release = release
    }
    phase = "disconnect-marker"
    const pendingDisconnect = sendMessage(disconnectConversation, disconnectKey, "R215 backend disconnect")
    brokenPid = await waitFor(async () => {
      const result = await pool.query(
        "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Timeout' AND wait_event='PgSleep'",
        [disconnectMarker],
      )
      return result.rows.length === 1 ? result.rows[0].pid : null
    })
    brokenClient = [...observedClients.keys()].find((client) => client.processID === brokenPid) ?? null
    assert.notEqual(brokenClient, null, "the scoped sleeping backend must belong to the exact checked-out Message client")
    const leaseErrorListeners = brokenClient.listeners("error")
    assert.equal(leaseErrorListeners.length, 1, "the checked-out Message lease must own exactly one production error listener")
    leaseErrorListener = leaseErrorListeners[0]
    assert.equal((await pool.query("SELECT pg_terminate_backend($1) AS terminated", [brokenPid])).rows[0].terminated, true)
    phase = "disconnect-response"
    const disconnected = await pendingDisconnect
    httpElapsedMs = disconnected.elapsedMs
    assert.equal(disconnected.response.status, 503, JSON.stringify(disconnected.body))
    assert.equal(disconnected.body.error?.code, "business_store_unavailable")
    assert.ok(disconnected.elapsedMs < 4900)
    assert.equal(disconnected.response.headers.get("cache-control"), "no-store")
    assert.ok(disconnected.response.headers.get("x-request-id"))
    await waitFor(async () => (await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid=$1", [brokenPid])).rows[0].count === 0)
    assert.deepEqual(brokenReleases, [true])
    assert.equal(brokenClient.listeners("error").includes(leaseErrorListener), false, "the Message lease listener must not remain on the destroyed client")
    assert.deepEqual(await facts(), afterSql)
    await pool.query(`DROP TRIGGER ${disconnectTrigger} ON bff_message`)
    await pool.query(`DROP FUNCTION ${disconnectFunction}()`)
    restoreClientObserver()
    const replacement = await ownerPool.connect()
    try {
      assert.notEqual((await replacement.query("SELECT pg_backend_pid()::int AS pid")).rows[0].pid, brokenPid)
    } finally {
      replacement.release()
    }
    const recoveredDisconnect = await sendMessage(disconnectConversation, disconnectKey, "R215 backend disconnect")
    assert.equal(recoveredDisconnect.response.status, 202, JSON.stringify(recoveredDisconnect.body))
    const finalFacts = await facts()
    assert.equal(finalFacts.messages.filter(({ conversation_id }) => conversation_id === disconnectConversation).length, 2)
    assert.equal(finalFacts.dispatches.filter(({ conversation_id }) => conversation_id === disconnectConversation).length, 1)
  } catch (error) {
    testError = error
    process.stderr.write(
      `# R215_M1_PRIMARY ${JSON.stringify({ name: error instanceof Error ? error.name : typeof error, message: error instanceof Error ? error.message : null, phase, http_elapsed_ms: httpElapsedMs, broken_pid_observed: brokenPid !== null, broken_client_observed: brokenClient !== null, lease_listener_observed: leaseErrorListener !== null })}\n`,
    )
  } finally {
    const cleanupErrors = []
    const cleanup = async (operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    restoreClientObserver()
    if (bff !== null) await cleanup(() => close(bff))
    if (store !== null) await cleanup(() => store.close())
    await cleanup(() => pool.query(`DROP TRIGGER IF EXISTS ${sqlTrigger} ON bff_message`))
    await cleanup(() => pool.query(`DROP FUNCTION IF EXISTS ${sqlFunction}()`))
    await cleanup(() => pool.query(`DROP TRIGGER IF EXISTS ${disconnectTrigger} ON bff_message`))
    await cleanup(() => pool.query(`DROP FUNCTION IF EXISTS ${disconnectFunction}()`))
    await cleanup(() => pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant]))
    for (const table of ["bff_agent_cancellation_outbox", "bff_share", "bff_agui_event", "bff_agui_stream", "bff_agent_dispatch_outbox", "bff_message"])
      await cleanup(() => pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]))
    await cleanup(() => pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.end())
    if (testError !== null || cleanupErrors.length > 0)
      throw new AggregateError(testError === null ? cleanupErrors : [testError, ...cleanupErrors], "R215 M1 fault matrix or cleanup failed", {
        cause: testError ?? cleanupErrors[0],
      })
  }
})

integrationTest("R215 Message destroys the exact client after a real COMMIT ACK loss and replays canonical facts", { timeout: 20_000 }, async () => {
  const suffix = randomUUID()
  const tenant = `r215_message_commit_${suffix}`
  const subject = `r215_owner_${suffix}`
  const projectId = `project_${randomUUID()}`
  const conversationId = `conv_${randomUUID()}`
  const key = `r215-commit-${suffix}`
  const content = "R215 COMMIT acknowledgement loss"
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  let bff = null
  let restoreFixture = () => {}
  let testError = null
  let phase = "setup"
  let brokenPid = null
  let droppedAck = false
  const commitReleases = []
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query("INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$2,$3,'R215 commit',$4)", [
      projectId,
      tenant,
      subject,
      `r215-commit-${suffix}`,
    ])
    await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title) VALUES ($1,$2,$3,$4,'R215 commit')", [
      conversationId,
      tenant,
      subject,
      projectId,
    ])
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const ownerPool = store.database.pool
    const originalConnect = ownerPool.connect
    const patched = new Map()
    let insertedDispatch = false
    ownerPool.connect = async function (...args) {
      const client = await originalConnect.apply(this, args)
      if (!patched.has(client))
        patched.set(client, {
          query: client.query,
          release: null,
          error: null,
        })
      const state = patched.get(client)
      client.query = async function (...queryArgs) {
        const result = await state.query.apply(this, queryArgs)
        const sql = queryArgs[0]
        if (typeof sql === "string" && sql.includes("INSERT INTO bff_agent_dispatch_outbox") && queryArgs[1]?.[1] === tenant && result.rowCount === 1)
          insertedDispatch = true
        if (insertedDispatch && !droppedAck && sql === "COMMIT") {
          assert.equal(result.command, "COMMIT")
          brokenPid = this.processID
          droppedAck = true
          state.error = () => undefined
          this.on("error", state.error)
          this.connection.stream.destroy()
          throw new Error("R215_MESSAGE_COMMIT_ACK_LOST")
        }
        return result
      }
      const checkoutRelease = client.release
      state.release = checkoutRelease
      client.release = function (destroy) {
        if (droppedAck && this.processID === brokenPid) commitReleases.push(destroy === true)
        return checkoutRelease.call(this, destroy)
      }
      return client
    }
    restoreFixture = () => {
      ownerPool.connect = originalConnect
      for (const [client, state] of patched) {
        client.query = state.query
        if (state.release !== null) client.release = state.release
        if (state.error !== null) client.removeListener("error", state.error)
      }
    }
    const runtimeConfig = config(tenant)
    runtimeConfig.agentEnabled = true
    runtimeConfig.upstreams.agents = "http://127.0.0.1:9"
    bff = createBffServer(runtimeConfig, {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
      scheduledAgentDispatcher: idleWorker,
      scheduledAgentTerminalConsumer: idleWorker,
    })
    const base = await listen(bff)
    const identity = auth(tenant, subject)
    const tenantFacts = async (table) =>
      (await pool.query(`SELECT to_jsonb(owned) AS fact FROM ${table} AS owned WHERE tenant_id=$1 ORDER BY to_jsonb(owned)::text`, [tenant])).rows.map(
        ({ fact }) => fact,
      )
    const facts = async () => ({
      projects: await tenantFacts("bff_project"),
      conversations: await tenantFacts("bff_conversation"),
      messages: await tenantFacts("bff_message"),
      dispatches: await tenantFacts("bff_agent_dispatch_outbox"),
      cancellations: await tenantFacts("bff_agent_cancellation_outbox"),
      streams: await tenantFacts("bff_agui_stream"),
      events: await tenantFacts("bff_agui_event"),
      receipts: (
        await pool.query("SELECT to_jsonb(owned) AS fact FROM bff_idempotency_receipt AS owned WHERE position($1 in scope)>0 ORDER BY to_jsonb(owned)::text", [
          tenant,
        ])
      ).rows.map(({ fact }) => fact),
    })
    const send = async () => {
      const response = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
        method: "POST",
        headers: {
          ...identity,
          "idempotency-key": key,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          content,
          model: "r215-model",
          project_ref: projectId,
        }),
        signal: AbortSignal.timeout(12_000),
      })
      return { response, body: await response.json() }
    }
    const before = await facts()
    phase = "commit-ack-loss"
    const unknown = await send()
    assert.equal(droppedAck, true)
    assert.equal(unknown.response.status, 503, JSON.stringify(unknown.body))
    assert.equal(unknown.body.error?.code, "business_store_unavailable")
    assert.equal(unknown.response.headers.get("cache-control"), "no-store")
    assert.ok(unknown.response.headers.get("x-request-id"))
    const committed = await facts()
    assert.equal(committed.dispatches.length, before.dispatches.length + 1)
    assert.equal(committed.messages.length, before.messages.length + 2)
    assert.equal(committed.streams.length, before.streams.length + 1)
    assert.deepEqual(committed.receipts, before.receipts)
    await waitFor(async () => (await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid=$1", [brokenPid])).rows[0].count === 0)
    assert.deepEqual(commitReleases, [true])
    restoreFixture()
    const replacement = await ownerPool.connect()
    try {
      assert.notEqual((await replacement.query("SELECT pg_backend_pid()::int AS pid")).rows[0].pid, brokenPid)
    } finally {
      replacement.release()
    }
    phase = "canonical-replay"
    const replay = await send()
    assert.equal(replay.response.status, 202, JSON.stringify(replay.body))
    const dispatch = committed.dispatches.at(-1)
    assert.deepEqual(replay.body.data, {
      run_id: dispatch.run_id,
      user_message_id: dispatch.user_message_id,
      assistant_message_id: dispatch.assistant_message_id,
    })
    assert.deepEqual(await facts(), committed)
  } catch (error) {
    testError = error
    process.stderr.write(
      `# R215_M2_PRIMARY ${JSON.stringify({ name: error instanceof Error ? error.name : typeof error, message: error instanceof Error ? error.message : null, phase, dropped_ack: droppedAck, broken_pid_observed: brokenPid !== null })}\n`,
    )
  } finally {
    const cleanupErrors = []
    const cleanup = async (operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    restoreFixture()
    if (bff !== null) await cleanup(() => close(bff))
    if (store !== null) await cleanup(() => store.close())
    await cleanup(() => pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant]))
    for (const table of ["bff_agent_cancellation_outbox", "bff_share", "bff_agui_event", "bff_agui_stream", "bff_agent_dispatch_outbox", "bff_message"])
      await cleanup(() => pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]))
    await cleanup(() => pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.end())
    if (testError !== null || cleanupErrors.length > 0)
      throw new AggregateError(testError === null ? cleanupErrors : [testError, ...cleanupErrors], "R215 M2 COMMIT matrix or cleanup failed", {
        cause: testError ?? cleanupErrors[0],
      })
  }
})

integrationTest("R215 Message scope churn shares one deadline across four real attempts", { timeout: 20_000 }, async () => {
  const suffix = randomUUID()
  const tenant = `r215_message_scope_${suffix}`
  const subject = `r215_owner_${suffix}`
  const projectP = `project_p_${randomUUID()}`
  const projectQ = `project_q_${randomUUID()}`
  const conversationId = `conv_${randomUUID()}`
  const key = `r215-scope-${suffix}`
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let coordinator = null
  let store = null
  let bff = null
  let restoreFixture = () => {}
  let testError = null
  let phase = "setup"
  let httpElapsedMs = null
  let churnStarted = 0
  let churnFinished = 0
  let scopeStartedAt = null
  const churnStartElapsedMs = []
  const lateChurns = []
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query("INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$3,$4,'R215 P',$5),($2,$3,$4,'R215 Q',$6)", [
      projectP,
      projectQ,
      tenant,
      subject,
      `r215-p-${suffix}`,
      `r215-q-${suffix}`,
    ])
    await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title) VALUES ($1,$2,$3,$4,'R215 scope')", [
      conversationId,
      tenant,
      subject,
      projectP,
    ])
    coordinator = await pool.connect()
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const ownerPool = store.database.pool
    const originalConnect = ownerPool.connect
    const patched = new Map()
    ownerPool.connect = async function (...args) {
      const client = await originalConnect.apply(this, args)
      if (!patched.has(client)) {
        const originalQuery = client.query
        patched.set(client, originalQuery)
        client.query = async function (...queryArgs) {
          const result = await originalQuery.apply(this, queryArgs)
          const sql = queryArgs[0]
          if (
            typeof sql === "string" &&
            sql.includes("SELECT project_ref FROM bff_conversation") &&
            !sql.includes("FOR UPDATE") &&
            queryArgs[1]?.[0] === tenant &&
            queryArgs[1]?.[1] === conversationId &&
            churnStarted < 4
          ) {
            const attempt = ++churnStarted
            churnStartElapsedMs.push(scopeStartedAt === null ? null : performance.now() - scopeStartedAt)
            const operation = (async () => {
              await coordinator.query("SELECT pg_sleep(1.18)")
              const nextProject = attempt % 2 === 1 ? projectQ : projectP
              await coordinator.query("UPDATE bff_conversation SET project_ref=$1 WHERE tenant_id=$2 AND conversation_id=$3", [
                nextProject,
                tenant,
                conversationId,
              ])
              churnFinished += 1
            })()
            lateChurns.push(operation)
            await operation
          }
          return result
        }
      }
      return client
    }
    restoreFixture = () => {
      ownerPool.connect = originalConnect
      for (const [client, query] of patched) client.query = query
    }
    const runtimeConfig = config(tenant)
    runtimeConfig.agentEnabled = true
    runtimeConfig.upstreams.agents = "http://127.0.0.1:9"
    bff = createBffServer(runtimeConfig, {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
      scheduledAgentDispatcher: idleWorker,
      scheduledAgentTerminalConsumer: idleWorker,
    })
    const base = await listen(bff)
    const identity = auth(tenant, subject)
    const tenantFacts = async (table) =>
      (await pool.query(`SELECT to_jsonb(owned) AS fact FROM ${table} AS owned WHERE tenant_id=$1 ORDER BY to_jsonb(owned)::text`, [tenant])).rows.map(
        ({ fact }) => fact,
      )
    const facts = async () => ({
      projects: await tenantFacts("bff_project"),
      conversations: await tenantFacts("bff_conversation"),
      messages: await tenantFacts("bff_message"),
      dispatches: await tenantFacts("bff_agent_dispatch_outbox"),
      cancellations: await tenantFacts("bff_agent_cancellation_outbox"),
      streams: await tenantFacts("bff_agui_stream"),
      events: await tenantFacts("bff_agui_event"),
      receipts: (
        await pool.query("SELECT to_jsonb(owned) AS fact FROM bff_idempotency_receipt AS owned WHERE position($1 in scope)>0 ORDER BY to_jsonb(owned)::text", [
          tenant,
        ])
      ).rows.map(({ fact }) => fact),
    })
    const send = async () => {
      const started = performance.now()
      const response = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
        method: "POST",
        headers: {
          ...identity,
          "idempotency-key": key,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          selected_skill_source_refs: [],
          content: "R215 scope churn",
          model: "r215-model",
          project_ref: projectP,
        }),
        signal: AbortSignal.timeout(12_000),
      })
      return {
        response,
        body: await response.json(),
        elapsedMs: performance.now() - started,
      }
    }
    const before = await facts()
    phase = "four-scope-attempts"
    scopeStartedAt = performance.now()
    const failed = await send()
    httpElapsedMs = failed.elapsedMs
    assert.equal(failed.response.status, 503, JSON.stringify(failed.body))
    assert.equal(failed.body.error?.code, "business_store_unavailable")
    assert.ok(failed.elapsedMs < 4900)
    assert.equal(failed.response.headers.get("cache-control"), "no-store")
    assert.ok(failed.response.headers.get("x-request-id"))
    assert.equal(churnStarted, 4)
    assert.ok(churnStartElapsedMs[3] < 3700, `the fourth real scope attempt started after ${churnStartElapsedMs[3]?.toFixed(1)}ms`)
    phase = "late-fourth-churn"
    await Promise.allSettled(lateChurns)
    assert.equal(churnFinished, 4)
    const during = await facts()
    assert.deepEqual(during.messages, before.messages)
    assert.deepEqual(during.dispatches, before.dispatches)
    assert.deepEqual(during.streams, before.streams)
    assert.deepEqual(during.events, before.events)
    assert.deepEqual(during.receipts, before.receipts)
    await pool.query("UPDATE bff_conversation SET project_ref=$1 WHERE tenant_id=$2 AND conversation_id=$3", [projectP, tenant, conversationId])
    assert.deepEqual(await facts(), before)
    restoreFixture()
    phase = "scope-recovery"
    const recovered = await send()
    assert.equal(recovered.response.status, 202, JSON.stringify(recovered.body))
    const after = await facts()
    assert.equal(after.messages.length, before.messages.length + 2)
    assert.equal(after.dispatches.length, before.dispatches.length + 1)
  } catch (error) {
    testError = error
    process.stderr.write(
      `# R215_M3_PRIMARY ${JSON.stringify({ name: error instanceof Error ? error.name : typeof error, message: error instanceof Error ? error.message : null, phase, http_elapsed_ms: httpElapsedMs, churn_started: churnStarted, churn_finished: churnFinished, churn_start_elapsed_ms: churnStartElapsedMs })}\n`,
    )
  } finally {
    const cleanupErrors = []
    const cleanup = async (operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    await Promise.allSettled(lateChurns)
    restoreFixture()
    if (coordinator !== null) coordinator.release()
    if (bff !== null) await cleanup(() => close(bff))
    if (store !== null) await cleanup(() => store.close())
    await cleanup(() => pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant]))
    for (const table of ["bff_agent_cancellation_outbox", "bff_share", "bff_agui_event", "bff_agui_stream", "bff_agent_dispatch_outbox", "bff_message"])
      await cleanup(() => pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]))
    await cleanup(() => pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.end())
    if (testError !== null || cleanupErrors.length > 0)
      throw new AggregateError(testError === null ? cleanupErrors : [testError, ...cleanupErrors], "R215 M3 scope matrix or cleanup failed", {
        cause: testError ?? cleanupErrors[0],
      })
  }
})

integrationTest("R215 Message notification faults never reverse a committed canonical receipt", { timeout: 20_000 }, async () => {
  const suffix = randomUUID()
  const tenant = `r215_message_notify_${suffix}`
  const subject = `r215_owner_${suffix}`
  const projectId = `project_${randomUUID()}`
  const throwConversation = `conv_${randomUUID()}`
  const lateConversation = `conv_${randomUUID()}`
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  let bff = null
  let restoreNotify = () => {}
  let testError = null
  let phase = "setup"
  const lateOperations = []
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query("INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$2,$3,'R215 notify',$4)", [
      projectId,
      tenant,
      subject,
      `r215-notify-${suffix}`,
    ])
    await pool.query(
      "INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title) VALUES ($1,$3,$4,$5,'R215 throw'),($2,$3,$4,$5,'R215 late')",
      [throwConversation, lateConversation, tenant, subject, projectId],
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const originalNotify = store.database.notifyAgUiProjection.bind(store.database)
    let mode = "throw"
    let notified = 0
    store.database.notifyAgUiProjection = async (...args) => {
      await originalNotify(...args)
      notified += 1
      if (mode === "throw") throw new Error("R215_NOTIFY_ACK_LOST")
      const late = new Promise((resolve) => setTimeout(resolve, 100))
      lateOperations.push(late)
      await late
    }
    restoreNotify = () => {
      store.database.notifyAgUiProjection = originalNotify
    }
    const runtimeConfig = config(tenant)
    runtimeConfig.agentEnabled = true
    runtimeConfig.upstreams.agents = "http://127.0.0.1:9"
    bff = createBffServer(runtimeConfig, {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
      scheduledAgentDispatcher: idleWorker,
      scheduledAgentTerminalConsumer: idleWorker,
    })
    const base = await listen(bff)
    const identity = auth(tenant, subject)
    const tenantFacts = async (table) =>
      (await pool.query(`SELECT to_jsonb(owned) AS fact FROM ${table} AS owned WHERE tenant_id=$1 ORDER BY to_jsonb(owned)::text`, [tenant])).rows.map(
        ({ fact }) => fact,
      )
    const facts = async () => ({
      projects: await tenantFacts("bff_project"),
      conversations: await tenantFacts("bff_conversation"),
      messages: await tenantFacts("bff_message"),
      dispatches: await tenantFacts("bff_agent_dispatch_outbox"),
      cancellations: await tenantFacts("bff_agent_cancellation_outbox"),
      streams: await tenantFacts("bff_agui_stream"),
      events: await tenantFacts("bff_agui_event"),
      receipts: (
        await pool.query("SELECT to_jsonb(owned) AS fact FROM bff_idempotency_receipt AS owned WHERE position($1 in scope)>0 ORDER BY to_jsonb(owned)::text", [
          tenant,
        ])
      ).rows.map(({ fact }) => fact),
    })
    const send = async (conversationId, key, content) => {
      const response = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
        method: "POST",
        headers: {
          ...identity,
          "idempotency-key": key,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          content,
          model: "r215-model",
          project_ref: projectId,
        }),
        signal: AbortSignal.timeout(12_000),
      })
      return { response, body: await response.json() }
    }
    const before = await facts()
    for (const scenario of [
      {
        nextMode: "throw",
        conversationId: throwConversation,
        key: `r215-notify-throw-${suffix}`,
      },
      {
        nextMode: "late",
        conversationId: lateConversation,
        key: `r215-notify-late-${suffix}`,
      },
    ]) {
      mode = scenario.nextMode
      phase = `notify-${mode}`
      const first = await send(scenario.conversationId, scenario.key, `R215 notify ${mode}`)
      assert.equal(first.response.status, 202, JSON.stringify(first.body))
      assert.ok(first.response.headers.get("x-request-id"))
      const committed = await facts()
      assert.deepEqual(committed.receipts, before.receipts)
      await Promise.allSettled(lateOperations)
      phase = `notify-${mode}-replay`
      const replay = await send(scenario.conversationId, scenario.key, `R215 notify ${mode}`)
      assert.equal(replay.response.status, 202, JSON.stringify(replay.body))
      assert.deepEqual(replay.body.data, first.body.data)
      assert.deepEqual(await facts(), committed)
    }
    assert.equal(notified, 2, "only the two newly committed turns notify; canonical replays do not")
    const after = await facts()
    assert.equal(after.messages.length, before.messages.length + 4)
    assert.equal(after.dispatches.length, before.dispatches.length + 2)
    assert.deepEqual(after.receipts, before.receipts)
  } catch (error) {
    testError = error
    process.stderr.write(
      `# R215_M4_PRIMARY ${JSON.stringify({ name: error instanceof Error ? error.name : typeof error, message: error instanceof Error ? error.message : null, phase })}\n`,
    )
  } finally {
    const cleanupErrors = []
    const cleanup = async (operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    await Promise.allSettled(lateOperations)
    restoreNotify()
    if (bff !== null) await cleanup(() => close(bff))
    if (store !== null) await cleanup(() => store.close())
    await cleanup(() => pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant]))
    for (const table of ["bff_agent_cancellation_outbox", "bff_share", "bff_agui_event", "bff_agui_stream", "bff_agent_dispatch_outbox", "bff_message"])
      await cleanup(() => pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]))
    await cleanup(() => pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.end())
    if (testError !== null || cleanupErrors.length > 0)
      throw new AggregateError(testError === null ? cleanupErrors : [testError, ...cleanupErrors], "R215 M4 notification matrix or cleanup failed", {
        cause: testError ?? cleanupErrors[0],
      })
  }
})

integrationTest("creates a Web-local first Conversation with its turn and Agent command atomically", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const tenant = `chat_first_${Date.now()}`
  const conversationId = `conv_${randomUUID()}`
  const titleSource = "  🌟 First message creates a private conversation with a useful title  "
  let store
  let bff
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const runtimeConfig = {
      ...config(tenant),
      agentEnabled: true,
      upstreams: { ...config(tenant).upstreams, agents: "http://127.0.0.1:9" },
    }
    bff = createBffServer(runtimeConfig, {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
    })
    const base = await listen(bff)
    const send = (key, content, id = conversationId, body = {}) =>
      fetch(`${base}/v1/sessions/${id}/messages`, {
        method: "POST",
        headers: { ...auth(tenant, "first_user"), "idempotency-key": key, "content-type": "application/json" },
        body: JSON.stringify({ content, ...body }),
      })
    const response = await send("first-turn", titleSource)
    assert.equal(response.status, 202)
    const receipt = (await response.json()).data
    const conversation = await pool.query("SELECT tenant_id, owner_id, status, title FROM bff_conversation WHERE conversation_id = $1", [conversationId])
    assert.deepEqual(conversation.rows, [
      {
        tenant_id: tenant,
        owner_id: "first_user",
        status: "active",
        title: "🌟 First message creates …",
      },
    ])
    const messages = await pool.query(
      "SELECT message_id, role, status, content FROM bff_message WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY message_seq",
      [tenant, conversationId],
    )
    assert.deepEqual(messages.rows, [
      { message_id: receipt.user_message_id, role: "user", status: "completed", content: titleSource.trim() },
      { message_id: receipt.assistant_message_id, role: "assistant", status: "pending", content: "" },
    ])
    const outbox = await pool.query("SELECT run_id, status FROM bff_agent_dispatch_outbox WHERE tenant_id = $1 AND conversation_id = $2", [
      tenant,
      conversationId,
    ])
    assert.deepEqual(outbox.rows, [{ run_id: receipt.run_id, status: "pending" }])
    const consumer = await pool.query("SELECT expected_run_id, consumer_subject_id FROM bff_agui_stream WHERE tenant_id = $1 AND session_id = $2", [
      tenant,
      conversationId,
    ])
    assert.deepEqual(consumer.rows, [{ expected_run_id: null, consumer_subject_id: "first_user" }])

    const replay = await send("first-turn", titleSource)
    assert.equal(replay.status, 202)
    assert.deepEqual((await replay.json()).data, receipt)
    const changed = await send("first-turn", "Changed content")
    assert.equal(changed.status, 409)
    assert.equal((await changed.json()).error.code, "idempotency_conflict")

    const foreignId = `conv_${randomUUID()}`
    await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, $4)", [
      foreignId,
      `${tenant}_foreign`,
      "other_user",
      "Foreign",
    ])
    const foreign = await send("foreign-turn", "Must not touch foreign", foreignId)
    assert.equal(foreign.status, 404)
    assert.equal((await foreign.json()).error.code, "session_not_found")
    const otherOwnerId = `conv_${randomUUID()}`
    await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, $4)", [
      otherOwnerId,
      tenant,
      "other_user",
      "Same tenant, other owner",
    ])
    const otherOwner = await send("other-owner-turn", "Must not touch other user", otherOwnerId)
    assert.equal(otherOwner.status, 404)
    assert.equal((await otherOwner.json()).error.code, "session_not_found")
    const deletedId = `conv_${randomUUID()}`
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title, status, deleted_at)
       VALUES ($1, $2, $3, $4, 'deleted', CURRENT_TIMESTAMP(3))`,
      [deletedId, tenant, "first_user", "Deleted"],
    )
    const deleted = await send("deleted-turn", "Must not revive deleted", deletedId)
    assert.equal(deleted.status, 404)
    assert.equal((await deleted.json()).error.code, "session_not_found")
    const oldFormat = await send("old-format-turn", "Must not create legacy ID", `session_${randomUUID()}`)
    assert.equal(oldFormat.status, 404)
    assert.equal((await oldFormat.json()).error.code, "session_not_found")
    const absentProjectId = `conv_${randomUUID()}`
    const absentProject = await send("project-absent", "No project access", absentProjectId, { project_ref: "not_a_project" })
    assert.equal(absentProject.status, 404)
    assert.equal((await absentProject.json()).error.code, "project_not_found")
    const absentRows = await pool.query("SELECT conversation_id FROM bff_conversation WHERE conversation_id = $1", [absentProjectId])
    assert.equal(absentRows.rowCount, 0)
    const absentProjectFacts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2) AS messages,
         (SELECT count(*)::int FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2) AS dispatches,
         (SELECT count(*)::int FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2) AS streams,
         (SELECT count(*)::int FROM bff_idempotency_receipt WHERE position($1 in scope)>0) AS receipts`,
      [tenant, absentProjectId],
    )
    assert.deepEqual(absentProjectFacts.rows, [{ messages: 0, dispatches: 0, streams: 0, receipts: 0 }])

    const projectId = `project_${randomUUID()}`
    await pool.query("INSERT INTO bff_project (project_id, tenant_id, owner_id, name, slug) VALUES ($1, $2, $3, $4, $5)", [
      projectId,
      tenant,
      "first_user",
      "Owned project",
      `owned-${randomUUID()}`,
    ])
    const projectConversationId = `conv_${randomUUID()}`
    assert.equal((await send("project-first", "Project first turn", projectConversationId, { project_ref: projectId })).status, 202)
    const projectConversation = await pool.query("SELECT project_ref FROM bff_conversation WHERE conversation_id = $1", [projectConversationId])
    assert.equal(projectConversation.rows[0].project_ref, projectId)

    const foreignProjectId = `project_${randomUUID()}`
    await pool.query("INSERT INTO bff_project (project_id, tenant_id, owner_id, name, slug) VALUES ($1, $2, $3, $4, $5)", [
      foreignProjectId,
      `${tenant}_foreign`,
      "other_user",
      "Foreign project",
      `foreign-${randomUUID()}`,
    ])
    const foreignProjectConversationId = `conv_${randomUUID()}`
    assert.equal((await send("project-foreign", "Not my project", foreignProjectConversationId, { project_ref: foreignProjectId })).status, 404)
    const foreignProjectConversation = await pool.query("SELECT conversation_id FROM bff_conversation WHERE conversation_id = $1", [
      foreignProjectConversationId,
    ])
    assert.equal(foreignProjectConversation.rowCount, 0)

    const concurrentId = `conv_${randomUUID()}`
    const [parallelOne, parallelTwo] = await Promise.all([
      send("parallel-one", "First concurrent turn", concurrentId),
      send("parallel-two", "Second concurrent turn", concurrentId),
    ])
    assert.equal(parallelOne.status, 202)
    assert.equal(parallelTwo.status, 202)
    const concurrentRows = await pool.query("SELECT conversation_id, owner_id FROM bff_conversation WHERE conversation_id = $1", [concurrentId])
    assert.deepEqual(concurrentRows.rows, [{ conversation_id: concurrentId, owner_id: "first_user" }])
    const concurrentMessages = await pool.query("SELECT message_seq FROM bff_message WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY message_seq", [
      tenant,
      concurrentId,
    ])
    assert.deepEqual(
      concurrentMessages.rows.map((row) => Number(row.message_seq)),
      [1, 2, 3, 4],
    )

    const sameKeyId = `conv_${randomUUID()}`
    const [duplicateOne, duplicateTwo] = await Promise.all([
      send("parallel-same-key", "Same first turn", sameKeyId),
      send("parallel-same-key", "Same first turn", sameKeyId),
    ])
    assert.equal(duplicateOne.status, 202)
    assert.equal(duplicateTwo.status, 202)
    assert.deepEqual((await duplicateOne.json()).data, (await duplicateTwo.json()).data)
    const sameKeyMessages = await pool.query("SELECT message_seq FROM bff_message WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY message_seq", [
      tenant,
      sameKeyId,
    ])
    assert.deepEqual(
      sameKeyMessages.rows.map((row) => Number(row.message_seq)),
      [1, 2],
    )

    const selectedId = `conv_${randomUUID()}`
    const selectedBody = { selected_skill_source_refs: ["skill:b", "skill:a"] }
    const selectedResponse = await send("selected-turn", "Selected", selectedId, selectedBody)
    assert.equal(selectedResponse.status, 202)
    const selectedReceipt = (await selectedResponse.json()).data
    const selectedReplay = await send("selected-turn", "Selected", selectedId, selectedBody)
    assert.deepEqual((await selectedReplay.json()).data, selectedReceipt)
    for (const refs of [["skill:a", "skill:b"], ["skill:c"], []]) {
      const changedSelection = await send("selected-turn", "Selected", selectedId, { selected_skill_source_refs: refs })
      assert.equal(changedSelection.status, 409)
    }
    const persistedSelection = await pool.query("SELECT payload FROM bff_agent_dispatch_outbox WHERE tenant_id = $1 AND conversation_id = $2", [
      tenant,
      selectedId,
    ])
    assert.equal(persistedSelection.rows[0].payload.schema_version, 3)
    assert.deepEqual(persistedSelection.rows[0].payload.launch.selected_skill_source_refs, selectedBody.selected_skill_source_refs)
    const explicitEmptyReplay = await send("first-turn", titleSource, conversationId, { selected_skill_source_refs: [] })
    assert.equal(explicitEmptyReplay.status, 409)
    assert.equal((await explicitEmptyReplay.json()).error.code, "idempotency_conflict")

    const rollbackId = `conv_${randomUUID()}`
    const rollbackRunId = `run_${randomUUID()}`
    await assert.rejects(
      store.agentDispatchOutbox.commitChatTurn({
        outboxId: `rollback_${randomUUID()}`,
        tenantId: tenant,
        conversationId: rollbackId,
        subjectId: "first_user",
        actorId: "first_user",
        requestId: "rollback-request",
        idempotencyKey: "rollback-key",
        requestDigest: "a".repeat(64),
        runId: rollbackRunId,
        userMessageId: receipt.user_message_id,
        assistantMessageId: `assistant_${randomUUID()}`,
        identityAssertionRef: "bff:rollback",
        content: "Rollback this first turn",
        payload: {
          schema_version: 3,
          launch: {
            request_id: "rollback-request",
            run_id: rollbackRunId,
            session_id: rollbackId,
            feature_key: "chat",
            message_id: receipt.user_message_id,
            content: "Rollback this first turn",
            project_ref: null,
            selected_skill_source_refs: [],
            trace: { source: "kokoro-bff" },
          },
        },
      }),
      { code: "23505" },
    )
    const rolledBack = await pool.query("SELECT conversation_id FROM bff_conversation WHERE conversation_id = $1", [rollbackId])
    assert.equal(rolledBack.rowCount, 0)

    const existingId = `session_${randomUUID()}`
    await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, $4)", [
      existingId,
      tenant,
      "first_user",
      "Existing",
    ])
    assert.equal((await send("existing-turn", "Continue existing", existingId)).status, 202)
    const existing = await pool.query("SELECT title FROM bff_conversation WHERE conversation_id = $1", [existingId])
    assert.equal(existing.rows[0].title, "Existing")
  } finally {
    if (bff) await close(bff)
    if (store) await store.close()
    await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_run_interaction WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_stream WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_message WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id IN ($1, $2)", [tenant, `${tenant}_foreign`]).catch(() => undefined)
    await pool.query("DELETE FROM bff_project WHERE tenant_id IN ($1, $2)", [tenant, `${tenant}_foreign`]).catch(() => undefined)
    await pool.end()
  }
})

test("does not return Share metadata when it is revoked between lookup and message read", async () => {
  const shared = {
    share: { shareId: "share_raced" },
    conversation: {
      tenantId: "tenant_raced",
      conversationId: "conversation_raced",
      title: "Private title",
      ownerId: "owner_raced",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
  }
  const businessStore = {
    services: { publicShares: { findActiveShare: async () => shared, listMessages: async () => null } },
  }
  const bff = createBffServer(config(), { businessStore, readiness: async () => undefined })
  try {
    const base = await listen(bff)
    const response = await fetch(`${base}/v1/shared/share_raced`, {
      headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "web-secret" },
    })
    assert.equal(response.status, 404)
    assert.equal((await response.json()).error.code, "share_not_found")
  } finally {
    await close(bff)
  }
})

integrationTest("serves tenant-scoped Chat facts from BFF PostgreSQL and revokes expired shares before replacement", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const redis = createClient({ url: redisUrl })
  const tenant = `chat_facts_${Date.now()}`
  const otherTenant = `${tenant}_other`
  const conversationId = `conversation_${Date.now()}`
  const projectId = `project_${Date.now()}`
  let bff
  try {
    await pool.query("DROP TABLE IF EXISTS bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_project (project_id, tenant_id, owner_id, name, slug)
       VALUES ($1, $2, $3, $4, $5)`,
      [projectId, tenant, "chat_user", "Private Chat project", `private-chat-${Date.now()}`],
    )
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, project_ref, title)
       VALUES ($1, $2, $3, $4, $5)`,
      [conversationId, tenant, "chat_user", projectId, "Canonical Chat facts"],
    )
    await pool.query(
      `INSERT INTO bff_message (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq)
       VALUES ($1, $2, $3, $4, 'user', $5, 'completed', $6)`,
      [`message_${Date.now()}`, tenant, conversationId, "run_opaque", "Persisted in BFF", "9223372036854775806"],
    )
    await pool.query(
      `INSERT INTO bff_message
         (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq,
          agent_failure_code, agent_failure_retryable)
       VALUES ($1, $2, $3, $4, 'assistant', $5, 'failed', $6, 'model_unavailable', TRUE)`,
      [`message_${Date.now()}_second`, tenant, conversationId, "run_opaque", "Second high sequence", "9223372036854775807"],
    )
    await redis.connect()
    bff = createBffServer(config(tenant), { sessionAdmission })
    const base = await listen(bff)

    const listed = await fetch(`${base}/v1/sessions`, { headers: auth(tenant, "chat_user") })
    assert.equal(listed.status, 200)
    assert.equal((await listed.json()).data.sessions[0].session_id, conversationId)

    let directSnapshotBody
    for (const query of ["scope=direct", "scope="]) {
      const scoped = await fetch(`${base}/v1/sessions/${conversationId}?${query}`, { headers: auth(tenant, "chat_user") })
      assert.equal(scoped.status, 200)
      const body = await scoped.json()
      if (query === "scope=direct") directSnapshotBody = body
    }
    assert.deepEqual(directSnapshotBody.data.messages.at(-1).failure, { source: "agent", code: "model_unavailable", retryable: true })
    assert.equal(Object.hasOwn(directSnapshotBody.data.messages[0], "failure"), false)
    const invalidScope = await fetch(`${base}/v1/sessions/${conversationId}?scope=team`, { headers: auth(tenant, "chat_user") })
    assert.equal(invalidScope.status, 400)
    assert.equal((await invalidScope.json()).error.code, "invalid_scope")

    const otherRead = await fetch(`${base}/v1/sessions/${conversationId}`, { headers: auth(otherTenant) })
    assert.equal(otherRead.status, 403)

    const messages = await fetch(`${base}/v1/sessions/${conversationId}/messages`, { headers: auth(tenant, "chat_user") })
    assert.equal(messages.status, 200)
    const messagesBody = await messages.json()
    assert.equal(messagesBody.data.messages[0].content, "Persisted in BFF")
    assert.equal(Object.hasOwn(messagesBody.data.messages[0], "failure"), false)
    assert.deepEqual(messagesBody.data.messages[1].failure, { source: "agent", code: "model_unavailable", retryable: true })

    const firstMessagePage = await fetch(`${base}/v1/sessions/${conversationId}/messages?limit=1`, { headers: auth(tenant, "chat_user") })
    const firstMessagePageBody = await firstMessagePage.json()
    assert.equal(firstMessagePageBody.data.messages[0].content, "Persisted in BFF")
    const secondMessagePage = await fetch(
      `${base}/v1/sessions/${conversationId}/messages?limit=1&cursor=${encodeURIComponent(firstMessagePageBody.data.next_cursor)}`,
      { headers: auth(tenant, "chat_user") },
    )
    const secondMessagePageBody = await secondMessagePage.json()
    assert.equal(secondMessagePageBody.data.messages[0].content, "Second high sequence")
    assert.deepEqual(secondMessagePageBody.data.messages[0].failure, { source: "agent", code: "model_unavailable", retryable: true })
    assert.equal(secondMessagePageBody.data.next_cursor, null)

    const disabledAdmission = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
      method: "POST",
      headers: { ...auth(tenant, "chat_user"), "content-type": "application/json", "idempotency-key": "disabled-admission" },
      body: JSON.stringify({ content: "Agent is disabled" }),
    })
    assert.equal(disabledAdmission.status, 503)

    const shared = await fetch(`${base}/v1/sessions/${conversationId}/share`, {
      method: "POST",
      headers: { ...auth(tenant, "chat_user"), "idempotency-key": "chat-share-integration" },
    })
    assert.equal(shared.status, 200)
    const shareId = (await shared.json()).data.share_id

    const publicShare = await fetch(`${base}/v1/shared/${shareId}`, {
      headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "web-secret" },
    })
    assert.equal(publicShare.status, 200)
    const publicShareBody = await publicShare.json()
    assert.equal(publicShareBody.data.session.session_id, conversationId)
    assert.deepEqual(publicShareBody.data.messages.at(-1).failure, { source: "agent", code: "model_unavailable", retryable: true })

    const otherSubject = "other_chat_user"
    const factsBeforeDeniedAccess = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM bff_message WHERE tenant_id = $1 AND conversation_id = $2) AS messages,
         (SELECT count(*)::int FROM bff_agent_dispatch_outbox WHERE tenant_id = $1 AND conversation_id = $2) AS dispatches,
         (SELECT count(*)::int FROM bff_idempotency_receipt) AS receipts`,
      [tenant, conversationId],
    )
    const ownerMatrix = [
      await fetch(`${base}/v1/sessions`, { headers: auth(tenant, otherSubject) }),
      await fetch(`${base}/v1/sessions/${conversationId}`, { headers: auth(tenant, otherSubject) }),
      await fetch(`${base}/v1/sessions/${conversationId}/messages`, { headers: auth(tenant, otherSubject) }),
      await fetch(`${base}/v1/sessions/${conversationId}/title`, {
        method: "PATCH",
        headers: { ...auth(tenant, otherSubject), "content-type": "application/json", "idempotency-key": "shared-owner-key" },
        body: JSON.stringify({ title: "Other subject title" }),
      }),
      await fetch(`${base}/v1/sessions/${conversationId}`, {
        method: "DELETE",
        headers: { ...auth(tenant, otherSubject), "idempotency-key": "other-subject-delete" },
      }),
      await fetch(`${base}/v1/sessions/${conversationId}/share`, {
        method: "POST",
        headers: { ...auth(tenant, otherSubject), "idempotency-key": "other-subject-share" },
      }),
      await fetch(`${base}/v1/sessions/${conversationId}/share`, {
        method: "DELETE",
        headers: { ...auth(tenant, otherSubject), "idempotency-key": "other-subject-revoke" },
      }),
      await fetch(`${base}/v1/sessions/${conversationId}/events`, { headers: auth(tenant, otherSubject) }),
      await fetch(`${base}/v1/sessions/${conversationId}/runs/run_private/control`, {
        method: "POST",
        headers: { ...auth(tenant, otherSubject), "content-type": "application/json", "idempotency-key": "other-subject-control" },
        body: JSON.stringify({ kind: "run.cancel" }),
      }),
    ]
    assert.deepEqual((await ownerMatrix[0].json()).data.sessions, [])
    for (const response of ownerMatrix.slice(1)) assert.equal(response.status, 404)
    const factsAfterDeniedAccess = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM bff_message WHERE tenant_id = $1 AND conversation_id = $2) AS messages,
         (SELECT count(*)::int FROM bff_agent_dispatch_outbox WHERE tenant_id = $1 AND conversation_id = $2) AS dispatches,
         (SELECT count(*)::int FROM bff_idempotency_receipt) AS receipts`,
      [tenant, conversationId],
    )
    assert.deepEqual(factsAfterDeniedAccess.rows, factsBeforeDeniedAccess.rows)

    const ownerSameKey = await fetch(`${base}/v1/sessions/${conversationId}/title`, {
      method: "PATCH",
      headers: { ...auth(tenant, "chat_user"), "content-type": "application/json", "idempotency-key": "shared-owner-key" },
      body: JSON.stringify({ title: "  Owner title  " }),
    })
    assert.equal(ownerSameKey.status, 200)
    const ownerSemanticReplay = await fetch(`${base}/v1/sessions/${conversationId}/title`, {
      method: "PATCH",
      headers: { ...auth(tenant, "chat_user"), "content-type": "application/json", "idempotency-key": "shared-owner-key" },
      body: JSON.stringify({ title: "Owner title" }),
    })
    assert.equal(ownerSemanticReplay.status, 200)

    const queryDrift = await fetch(`${base}/v1/sessions/${conversationId}/title?project_ref=other-project`, {
      method: "PATCH",
      headers: { ...auth(tenant, "chat_user"), "content-type": "application/json", "idempotency-key": "shared-owner-key" },
      body: JSON.stringify({ title: "Owner title" }),
    })
    assert.equal(queryDrift.status, 404)

    await pool.query(
      `UPDATE bff_share
          SET created_at = CURRENT_TIMESTAMP(3) - INTERVAL '2 seconds',
              expires_at = CURRENT_TIMESTAMP(3) - INTERVAL '1 second'
        WHERE share_id = $1`,
      [shareId],
    )
    const replacement = await fetch(`${base}/v1/sessions/${conversationId}/share`, {
      method: "POST",
      headers: { ...auth(tenant, "chat_user"), "idempotency-key": "chat-share-replacement-integration" },
    })
    assert.equal(replacement.status, 200)
    const replacementId = (await replacement.json()).data.share_id
    assert.notEqual(replacementId, shareId)
    const retainedExpired = await pool.query("SELECT revoked_at FROM bff_share WHERE share_id = $1", [shareId])
    assert.ok(retainedExpired.rows[0].revoked_at)

    const crossTenantTitle = await fetch(`${base}/v1/sessions/${conversationId}/title`, {
      method: "PATCH",
      headers: { ...auth(otherTenant), "content-type": "application/json", "idempotency-key": "chat-cross-tenant-title" },
      body: JSON.stringify({ title: "Should not cross tenant" }),
    })
    assert.equal(crossTenantTitle.status, 403)

    const revoked = await fetch(`${base}/v1/sessions/${conversationId}/share`, {
      method: "DELETE",
      headers: { ...auth(tenant, "chat_user"), "idempotency-key": "chat-revoke-integration" },
    })
    assert.equal(revoked.status, 200)
    const afterRevoke = await fetch(`${base}/v1/shared/${replacementId}`, {
      headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "web-secret" },
    })
    assert.equal(afterRevoke.status, 404)
    const retainedReplacement = await pool.query("SELECT revoked_at FROM bff_share WHERE share_id = $1", [replacementId])
    assert.ok(retainedReplacement.rows[0].revoked_at)
  } finally {
    if (bff) await close(bff)
    await pool.query("DELETE FROM bff_share WHERE tenant_id IN ($1, $2)", [tenant, otherTenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_message WHERE tenant_id IN ($1, $2)", [tenant, otherTenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id IN ($1, $2)", [tenant, otherTenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_project WHERE tenant_id IN ($1, $2)", [tenant, otherTenant]).catch(() => undefined)
    await redis.quit().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("accepts a Chat turn after the message and Agent dispatch are durably committed", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const tenant = `chat_dispatch_${Date.now()}`
  const conversationId = `conversation_dispatch_${Date.now()}`
  let bff
  let agent
  let agentAvailable = false
  let launchAttempts = 0
  try {
    await pool.query(
      "DROP TABLE IF EXISTS bff_scheduled_agent_source_event, bff_scheduled_agent_dispatch, bff_scheduled_agent_scope, bff_agui_run_interaction, bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_conversation_artifact, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE",
    )
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ($1, $2, $3, $4)`,
      [conversationId, tenant, "chat_user", "Durable dispatch"],
    )
    agent = createServer(async (request, response) => {
      if (request.url !== "/v1/runs" || request.method !== "POST") {
        response.writeHead(503, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: { code: "agent_unavailable", message: "retry" }, meta: { request_id: "agent" } }))
        return
      }
      const chunks = []
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const launch = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      assert.deepEqual(launch.selected_skill_source_refs, [])
      launchAttempts += 1
      if (!agentAvailable) {
        response.writeHead(503, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: { code: "agent_unavailable", message: "retry" }, meta: { request_id: "agent" } }))
        return
      }
      response.writeHead(202, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          data: { run_id: launch.run_id, session_id: launch.session_id, replayed: false },
          meta: { request_id: "agent" },
        }),
      )
    })
    const agentBase = await listen(agent)
    const runtimeConfig = config(tenant)
    runtimeConfig.agentEnabled = true
    runtimeConfig.upstreams.agents = agentBase
    bff = createBffServer(runtimeConfig, { sessionAdmission })
    const base = await listen(bff)

    const mismatchedProjectRef = await fetch(`${base}/v1/sessions/${conversationId}/messages?project_ref=query_project`, {
      method: "POST",
      headers: { ...auth(tenant, "chat_user"), "content-type": "application/json", "idempotency-key": "mismatched-project-ref" },
      body: JSON.stringify({ content: "hello", project_ref: "body_project" }),
    })
    assert.equal(mismatchedProjectRef.status, 400)
    assert.equal((await mismatchedProjectRef.json()).error.code, "invalid_message")

    const invalidBodies = [
      { content: "hello", extra: true },
      { content: "hello", model: " " },
      { content: "hello", pinned_skills: ["valid", 7] },
      { content: "hello", selected_skill_source_refs: ["skill:a\n"] },
      { content: "hello", selected_skill_source_refs: ["skill:a", "skill:a"] },
      { content: "x".repeat(100_001) },
    ]
    for (const [index, invalidBody] of invalidBodies.entries()) {
      const invalid = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
        method: "POST",
        headers: { ...auth(tenant, "chat_user"), "content-type": "application/json", "idempotency-key": `invalid-chat-${index}` },
        body: JSON.stringify(invalidBody),
      })
      assert.equal(invalid.status, 400)
      assert.equal((await invalid.json()).error.code, "invalid_message")
    }
    const oversized = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
      method: "POST",
      headers: { ...auth(tenant, "chat_user"), "content-type": "application/json", "idempotency-key": "oversized-chat" },
      body: JSON.stringify({ content: "x".repeat(1024 * 1024 + 1) }),
    })
    assert.equal(oversized.status, 413)

    const submitted = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
      method: "POST",
      headers: {
        ...auth(tenant, "chat_user"),
        "content-type": "application/json",
        "idempotency-key": "durable-chat-turn",
        "x-kokoro-request-id": "request-first",
      },
      body: JSON.stringify({ content: "Persist before dispatch" }),
    })

    assert.equal(submitted.status, 202)
    const submittedEnvelope = await submitted.json()
    const receipt = submittedEnvelope.data

    const replay = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
      method: "POST",
      headers: {
        ...auth(tenant, "chat_user"),
        "content-type": "application/json",
        "idempotency-key": "durable-chat-turn",
        "x-kokoro-request-id": "request-replay",
      },
      body: JSON.stringify({ content: "Persist before dispatch" }),
    })
    assert.equal(replay.status, 202)
    const replayEnvelope = await replay.json()
    assert.deepEqual(replayEnvelope.data, submittedEnvelope.data)
    assert.equal(submittedEnvelope.meta.request_id, "request-first")
    assert.equal(replayEnvelope.meta.request_id, "request-replay")

    const conflict = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
      method: "POST",
      headers: { ...auth(tenant, "chat_user"), "content-type": "application/json", "idempotency-key": "durable-chat-turn" },
      body: JSON.stringify({ content: "Different payload" }),
    })
    assert.equal(conflict.status, 409)

    const differentSubject = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
      method: "POST",
      headers: { ...auth(tenant, "other_user"), "content-type": "application/json", "idempotency-key": "durable-chat-other-subject" },
      body: JSON.stringify({ content: "Must not cross owner" }),
    })
    assert.equal(differentSubject.status, 404)
    const messages = await pool.query(
      `SELECT message_id, role, status, run_id
         FROM bff_message
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY message_seq ASC`,
      [tenant, conversationId],
    )
    assert.deepEqual(messages.rows, [
      { message_id: receipt.user_message_id, role: "user", status: "completed", run_id: receipt.run_id },
      { message_id: receipt.assistant_message_id, role: "assistant", status: "pending", run_id: receipt.run_id },
    ])
    const outbox = await pool.query(
      `SELECT run_id, user_message_id, assistant_message_id, conversation_dispatch_seq, status, attempt_count
         FROM bff_agent_dispatch_outbox
        WHERE tenant_id = $1 AND conversation_id = $2`,
      [tenant, conversationId],
    )
    assert.equal(outbox.rows.length, 1)
    assert.deepEqual(
      {
        run_id: outbox.rows[0].run_id,
        user_message_id: outbox.rows[0].user_message_id,
        assistant_message_id: outbox.rows[0].assistant_message_id,
      },
      {
        run_id: receipt.run_id,
        user_message_id: receipt.user_message_id,
        assistant_message_id: receipt.assistant_message_id,
      },
    )
    assert.equal(outbox.rows[0].conversation_dispatch_seq, "1")

    const retryable = await waitFor(async () => {
      const result = await pool.query(
        `SELECT status, attempt_count, last_error_code
           FROM bff_agent_dispatch_outbox
          WHERE tenant_id = $1 AND conversation_id = $2`,
        [tenant, conversationId],
      )
      return result.rows[0]?.status === "retryable" ? result.rows[0] : null
    })
    assert.equal(retryable.attempt_count, 1)
    assert.equal(retryable.last_error_code, "agent_unavailable")

    await close(bff)
    bff = undefined
    agentAvailable = true
    bff = createBffServer(runtimeConfig, { sessionAdmission })
    await listen(bff)
    const admitted = await waitFor(async () => {
      const result = await pool.query(
        `SELECT status, attempt_count, completed_at
           FROM bff_agent_dispatch_outbox
          WHERE tenant_id = $1 AND conversation_id = $2`,
        [tenant, conversationId],
      )
      return result.rows[0]?.status === "admitted" ? result.rows[0] : null
    })
    assert.ok(admitted.attempt_count >= 2)
    assert.equal(admitted.completed_at, null)
    assert.ok(launchAttempts >= 2)
  } finally {
    if (bff) await close(bff)
    if (agent) await close(agent)
    await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_run_interaction WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_stream WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_message WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("reclaims expired Agent dispatch leases as sticky admission-unknown and fences stale settlement", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const tenant = `chat_fence_${Date.now()}`
  const conversationId = `conversation_fence_${Date.now()}`
  let store
  try {
    await pool.query(
      "DROP TABLE IF EXISTS bff_agui_run_interaction, bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_conversation_artifact, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE",
    )
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ($1, $2, $3, $4)`,
      [conversationId, tenant, "chat_user", "Lease fencing"],
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const receipt = await store.services.chatTurns.submit({
      tenantId: tenant,
      conversationId,
      subjectId: "chat_user",
      actorId: "chat_user",
      requestId: "request_fence",
      idempotencyKey: "chat-fence",
      content: "Fence this dispatch",
    })
    assert.ok(receipt)

    const first = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_a",
      limit: 1,
      leaseDurationMs: 5,
      maxAttempts: 8,
    })
    assert.equal(first.length, 1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_b",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(second.length, 1)
    assert.equal(second[0].fence, first[0].fence + 1)
    assert.ok(second[0].leaseRemainingMs > 0 && second[0].leaseRemainingMs <= 5000)

    assert.equal(
      await store.agentDispatchOutbox.markAgentDispatchAdmitted({
        tenantId: `${tenant}_other`,
        outboxId: second[0].outboxId,
        leaseOwner: second[0].leaseOwner,
        leaseToken: second[0].leaseToken,
        fence: second[0].fence,
      }),
      false,
    )
    assert.equal(
      await store.agentDispatchOutbox.markAgentDispatchAdmitted({
        tenantId: first[0].tenantId,
        outboxId: first[0].outboxId,
        leaseOwner: first[0].leaseOwner,
        leaseToken: first[0].leaseToken,
        fence: first[0].fence,
      }),
      false,
    )
    assert.equal(
      await store.agentDispatchOutbox.markAgentDispatchAdmitted({
        tenantId: second[0].tenantId,
        outboxId: second[0].outboxId,
        leaseOwner: second[0].leaseOwner,
        leaseToken: second[0].leaseToken,
        fence: second[0].fence,
      }),
      true,
    )

    const state = await pool.query(
      `SELECT status, attempt_count, fence, admission_unknown_seen
         FROM bff_agent_dispatch_outbox
        WHERE tenant_id = $1 AND conversation_id = $2`,
      [tenant, conversationId],
    )
    assert.deepEqual(state.rows, [{ status: "admitted", attempt_count: 2, fence: "2", admission_unknown_seen: true }])
  } finally {
    if (store) await store.close()
    await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_run_interaction WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_stream WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_message WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("keeps an admitted Conversation head blocking every later launch until durable terminal", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const tenant = `chat_fifo_${Date.now()}`
  const conversationId = `conversation_fifo_${Date.now()}`
  let store
  try {
    await pool.query(
      "DROP TABLE IF EXISTS bff_agui_run_interaction, bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_conversation_artifact, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE",
    )
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ($1, $2, $3, $4)`,
      [conversationId, tenant, "chat_user", "Strict dispatch FIFO"],
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    for (const suffix of ["first", "second", "third"]) {
      assert.ok(
        await store.services.chatTurns.submit({
          tenantId: tenant,
          conversationId,
          subjectId: "chat_user",
          actorId: "chat_user",
          requestId: `request_${suffix}`,
          idempotencyKey: `chat-fifo-${suffix}`,
          content: `Dispatch ${suffix}`,
        }),
      )
    }

    const queuedSnapshot = await store.services.chat.snapshot(tenant, "chat_user", conversationId, undefined)
    const queuedRows = await pool.query(
      `SELECT run_id, conversation_dispatch_seq
         FROM bff_agent_dispatch_outbox
        WHERE tenant_id=$1 AND conversation_id=$2
        ORDER BY conversation_dispatch_seq,outbox_id`,
      [tenant, conversationId],
    )
    assert.deepEqual(queuedSnapshot.execution_head, {
      run_id: queuedRows.rows[0].run_id,
      state: "queued",
      pending_pauses: [],
    })
    const queuedReplay = await store.agUi.replay(tenant, conversationId, null, 100)
    assert.equal(queuedReplay.kind, "page")
    assert.deepEqual(
      queuedReplay.frames.map(({ eventType, payload }) => ({ eventType, value: payload.value })),
      [
        {
          eventType: "CUSTOM",
          value: { run_id: queuedRows.rows[0].run_id, dispatch_sequence: queuedRows.rows[0].conversation_dispatch_seq },
        },
      ],
    )
    const queuedWatermark = queuedSnapshot.event_watermark

    const replayedFirst = await store.services.chatTurns.submit({
      tenantId: tenant,
      conversationId,
      subjectId: "chat_user",
      actorId: "chat_user",
      requestId: "request_first",
      idempotencyKey: "chat-fifo-first",
      content: "Dispatch first",
    })
    assert.equal(replayedFirst.run_id, queuedRows.rows[0].run_id)
    assert.equal((await store.services.chat.snapshot(tenant, "chat_user", conversationId, undefined)).event_watermark, queuedWatermark)

    const beforeClaim = await pool.query("SELECT expected_run_id FROM bff_agui_stream WHERE tenant_id = $1 AND session_id = $2", [tenant, conversationId])
    assert.equal(beforeClaim.rows[0].expected_run_id, null)

    const first = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_fifo",
      limit: 10,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(first.length, 1)
    assert.equal(first[0].conversationDispatchSeq, "1")
    assert.equal(
      (await pool.query("SELECT expected_run_id FROM bff_agui_stream WHERE tenant_id = $1 AND session_id = $2", [tenant, conversationId])).rows[0]
        .expected_run_id,
      first[0].runId,
    )
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(first[0]), true)
    assert.deepEqual((await store.services.chat.snapshot(tenant, "chat_user", conversationId, undefined)).execution_head, {
      run_id: first[0].runId,
      state: "queued",
      pending_pauses: [],
    })
    const blocked = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_fifo",
      limit: 10,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(blocked.length, 0)

    const rows = await pool.query(
      `SELECT conversation_dispatch_seq, status, attempt_count, last_error_code
         FROM bff_agent_dispatch_outbox
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY conversation_dispatch_seq ASC`,
      [tenant, conversationId],
    )
    assert.deepEqual(rows.rows, [
      { conversation_dispatch_seq: "1", status: "admitted", attempt_count: 1, last_error_code: null },
      { conversation_dispatch_seq: "3", status: "pending", attempt_count: 0, last_error_code: null },
      { conversation_dispatch_seq: "5", status: "pending", attempt_count: 0, last_error_code: null },
    ])
    const pendingAssistant = await pool.query(
      `SELECT status
         FROM bff_message
        WHERE tenant_id = $1 AND conversation_id = $2 AND message_seq = 4`,
      [tenant, conversationId],
    )
    assert.equal(pendingAssistant.rows[0].status, "pending")

    const terminalAt = new Date().toISOString()
    await store.agUi.ingest(tenant, conversationId, [
      {
        sourceRunId: first[0].runId,
        sourceEventId: "fifo_first_started",
        sourceSequence: 1,
        sourceOccurredAt: terminalAt,
        sourcePayload: { run_id: first[0].runId },
        event: {
          event_id: "fifo_first_started",
          seq: 1,
          session_id: conversationId,
          run_id: first[0].runId,
          kind: "run.created",
          timestamp: terminalAt,
          payload: { run_id: first[0].runId },
        },
      },
      {
        sourceRunId: first[0].runId,
        sourceEventId: "fifo_first_terminal",
        sourceSequence: 2,
        sourceOccurredAt: terminalAt,
        sourcePayload: { run_id: first[0].runId },
        event: {
          event_id: "fifo_first_terminal",
          seq: 2,
          session_id: conversationId,
          run_id: first[0].runId,
          kind: "run.completed",
          timestamp: terminalAt,
          payload: { status: "completed" },
        },
      },
    ])
    const handedOff = await store.services.chat.snapshot(tenant, "chat_user", conversationId, undefined)
    assert.deepEqual(handedOff.execution_head, {
      run_id: queuedRows.rows[1].run_id,
      state: "queued",
      pending_pauses: [],
    })
    const afterHandoff = await store.agUi.replay(tenant, conversationId, null, 100)
    assert.equal(afterHandoff.kind, "page")
    const queuedFrames = afterHandoff.frames.filter(({ eventType }) => eventType === "CUSTOM")
    assert.deepEqual(
      queuedFrames.map(({ payload }) => payload.value.run_id),
      [queuedRows.rows[0].run_id, queuedRows.rows[1].run_id],
    )

    await pool.query("UPDATE bff_agui_event SET recorded_at=CURRENT_TIMESTAMP(3)-INTERVAL '2 days' WHERE tenant_id=$1 AND session_id=$2", [
      tenant,
      conversationId,
    ])
    await store.agUiConsumers.collectGarbage({
      now: new Date().toISOString(),
      retentionMs: 1,
      tombstoneRetentionMs: 24 * 60 * 60 * 1000,
      batchSize: 100,
    })
    const retainedHead = await store.agUi.replay(tenant, conversationId, null, 100)
    assert.equal(retainedHead.kind, "page")
    assert.equal(
      retainedHead.frames.some(({ eventType, payload }) => eventType === "CUSTOM" && payload.value.run_id === queuedRows.rows[1].run_id),
      true,
    )
  } finally {
    if (store) await store.close()
    await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_run_interaction WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_stream WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_message WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("projects fenced dispatch failures as durable RUN_ERROR terminals", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const tenant = `chat_failure_${Date.now()}`
  const conversationId = `conversation_failure_${Date.now()}`
  let store
  let bff
  let agent
  let agentRequests = 0
  try {
    await pool.query(
      "DROP TABLE IF EXISTS bff_scheduled_agent_source_event, bff_scheduled_agent_dispatch, bff_scheduled_agent_scope, bff_agui_run_interaction, bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_conversation_artifact, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE",
    )
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ($1, $2, $3, $4)`,
      [conversationId, tenant, "chat_user", "Dispatch failure ledger"],
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const firstReceipt = await store.services.chatTurns.submit({
      tenantId: tenant,
      conversationId,
      subjectId: "chat_user",
      actorId: "chat_user",
      requestId: "request_failure_first",
      idempotencyKey: "failure-first",
      content: "First failing launch",
    })
    assert.ok(firstReceipt)
    const [first] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_failure",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.ok(first)
    const secondReceipt = await store.services.chatTurns.submit({
      tenantId: tenant,
      conversationId,
      subjectId: "chat_user",
      actorId: "chat_user",
      requestId: "request_failure_second",
      idempotencyKey: "failure-second",
      content: "Second failing launch",
    })
    assert.ok(secondReceipt)

    assert.equal(await store.agentDispatchOutbox.markAgentDispatchNotAdmitted(first, 500, "agent_receipt_invalid"), true)
    let stream = await pool.query(
      `SELECT expected_run_id, terminal_run_id, consumer_state
         FROM bff_agui_stream WHERE tenant_id = $1 AND session_id = $2`,
      [tenant, conversationId],
    )
    assert.deepEqual(stream.rows, [
      {
        expected_run_id: null,
        terminal_run_id: first.runId,
        consumer_state: "stopped",
      },
    ])

    const [second] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_failure",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.ok(second)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchNotAdmitted(second, 500, "agent_http_400"), true)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchNotAdmitted(second, 500, "stale_duplicate"), false)

    stream = await pool.query(
      `SELECT expected_run_id, terminal_run_id, consumer_state, consumer_fence
         FROM bff_agui_stream WHERE tenant_id = $1 AND session_id = $2`,
      [tenant, conversationId],
    )
    assert.equal(stream.rows[0].expected_run_id, null)
    assert.equal(stream.rows[0].terminal_run_id, secondReceipt.run_id)
    assert.equal(stream.rows[0].consumer_state, "stopped")
    assert.ok(Number(stream.rows[0].consumer_fence) >= 1)

    const failures = await pool.query(
      `SELECT source.source_owner, source.source_sequence, event.event_type, event.event_payload
         FROM bff_agui_source_event AS source
         JOIN bff_agui_event AS event
           ON event.tenant_id = source.tenant_id
          AND event.session_id = source.session_id
          AND event.source_owner = source.source_owner
          AND event.source_event_id = source.source_event_id
        WHERE source.tenant_id = $1 AND source.session_id = $2
        ORDER BY event.public_sequence ASC`,
      [tenant, conversationId],
    )
    assert.deepEqual(
      failures.rows.map((row) => [row.source_owner, row.source_sequence, row.event_type]),
      [
        ["kokoro-bff", "1", "RUN_ERROR"],
        ["kokoro-bff", "3", "RUN_ERROR"],
      ],
    )
    assert.deepEqual(
      failures.rows.map((row) => row.event_payload.runId),
      [firstReceipt.run_id, secondReceipt.run_id],
    )
    assert.deepEqual(
      failures.rows.map((row) => row.event_payload.code),
      ["agent_receipt_invalid", "agent_http_400"],
    )
    const assistants = await pool.query(
      `SELECT run_id, status, agent_failure_code, agent_failure_retryable FROM bff_message
        WHERE tenant_id = $1 AND conversation_id = $2 AND role = 'assistant'
        ORDER BY message_seq ASC`,
      [tenant, conversationId],
    )
    assert.deepEqual(assistants.rows, [
      { run_id: firstReceipt.run_id, status: "failed", agent_failure_code: null, agent_failure_retryable: null },
      { run_id: secondReceipt.run_id, status: "failed", agent_failure_code: null, agent_failure_retryable: null },
    ])
    assert.equal((await store.services.chat.snapshot(tenant, "chat_user", conversationId, undefined)).active_run, undefined)

    await store.close()
    store = undefined
    agent = createServer((_request, response) => {
      agentRequests += 1
      response.writeHead(500, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { code: "unexpected", message: "must not poll" } }))
    })
    const agentBase = await listen(agent)
    const runtimeConfig = config(tenant)
    runtimeConfig.agentEnabled = true
    runtimeConfig.upstreams.agents = agentBase
    bff = createBffServer(runtimeConfig, { sessionAdmission })
    const base = await listen(bff)
    const replay = await fetch(`${base}/v1/sessions/${conversationId}/events`, { headers: auth(tenant, "chat_user") })
    assert.equal(replay.status, 200)
    const body = await replay.text()
    assert.match(body, /"type":"RUN_ERROR"/u)
    assert.equal(agentRequests, 0)
  } finally {
    if (bff) await close(bff)
    if (agent) await close(agent)
    if (store) await store.close()
    await pool.query("DELETE FROM bff_agent_cancellation_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_event WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_source_event WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_run_interaction WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_stream WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_message WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("deletion atomically fences launches and enqueues durable cancellation for possibly admitted runs", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const tenant = `chat_delete_${Date.now()}`
  const conversationId = `conversation_delete_${Date.now()}`
  let store
  try {
    await pool.query(
      "DROP TABLE IF EXISTS bff_agui_run_interaction, bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_conversation_artifact, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE",
    )
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ($1, $2, $3, $4)`,
      [conversationId, tenant, "chat_user", "Delete compensation"],
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    for (const suffix of ["admitted", "inflight", "local_only"]) {
      assert.ok(
        await store.services.chatTurns.submit({
          tenantId: tenant,
          conversationId,
          subjectId: "chat_user",
          actorId: "chat_user",
          requestId: `request_${suffix}`,
          idempotencyKey: `delete-${suffix}`,
          content: `Delete ${suffix}`,
        }),
      )
    }
    const [admitted] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_delete",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.ok(admitted)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(admitted), true)
    assert.equal(await store.services.chat.deleteConversation(tenant, "chat_user", conversationId, "request_delete_conversation"), true)
    assert.deepEqual(
      await store.agentDispatchOutbox.claimAgentDispatchOutbox({ workerId: "worker_after_delete", limit: 10, leaseDurationMs: 5000, maxAttempts: 8 }),
      [],
    )

    const dispatch = await pool.query(
      `SELECT conversation_dispatch_seq, status, fence FROM bff_agent_dispatch_outbox
        WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY conversation_dispatch_seq ASC`,
      [tenant, conversationId],
    )
    assert.deepEqual(
      dispatch.rows.map((row) => [row.conversation_dispatch_seq, row.status]),
      [
        ["1", "admitted"],
        ["3", "failed"],
        ["5", "failed"],
      ],
    )
    const cancellations = await pool.query(
      `SELECT cancellation_id, command_id, conversation_dispatch_seq, request_id, status, payload
         FROM bff_agent_cancellation_outbox
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY conversation_dispatch_seq ASC`,
      [tenant, conversationId],
    )
    assert.deepEqual(
      cancellations.rows.map((row) => [row.conversation_dispatch_seq, row.status]),
      [["1", "cancel_requested"]],
    )
    assert.ok(cancellations.rows.every((row) => row.cancellation_id === row.command_id))
    assert.ok(cancellations.rows.every((row) => row.request_id === "request_delete_conversation"))
    assert.ok(cancellations.rows.every((row) => row.payload.kind === "run.cancel" && row.payload.session_id === conversationId))

    const firstCancel = await store.agentCancellationOutbox.claimAgentCancellationOutbox({
      workerId: "worker_cancel",
      limit: 10,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(firstCancel.length, 1)
    assert.equal(firstCancel[0].conversationDispatchSeq, "1")
    assert.equal(
      await store.agentCancellationOutbox.markAgentCancellationSucceeded({
        ...firstCancel[0],
        tenantId: `${tenant}_other`,
      }),
      false,
    )
    assert.equal(await store.agentCancellationOutbox.markAgentCancellationSucceeded(firstCancel[0]), true)
    assert.deepEqual(
      await store.agentCancellationOutbox.claimAgentCancellationOutbox({ workerId: "worker_cancel", limit: 10, leaseDurationMs: 5000, maxAttempts: 8 }),
      [],
    )

    const conversation = await pool.query("SELECT status FROM bff_conversation WHERE tenant_id = $1 AND conversation_id = $2", [tenant, conversationId])
    const assistants = await pool.query(
      `SELECT status, agent_failure_code, agent_failure_retryable
         FROM bff_message WHERE tenant_id = $1 AND conversation_id = $2 AND role = 'assistant'`,
      [tenant, conversationId],
    )
    const stream = await pool.query(
      `SELECT consumer_state, consumer_lease_owner, consumer_lease_token, consumer_lease_until
         FROM bff_agui_stream WHERE tenant_id = $1 AND session_id = $2`,
      [tenant, conversationId],
    )
    assert.equal(conversation.rows[0].status, "deleted")
    assert.ok(assistants.rows.every((row) => row.status === "failed" && row.agent_failure_code === null && row.agent_failure_retryable === null))
    assert.deepEqual(stream.rows, [
      {
        consumer_state: "stopped",
        consumer_lease_owner: null,
        consumer_lease_token: null,
        consumer_lease_until: null,
      },
    ])
  } finally {
    if (store) await store.close()
    await pool.query("DELETE FROM bff_agent_cancellation_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_run_interaction WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_stream WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_message WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest(
  "serializes terminal, deletion, failure, and exhausted-head races without reversing stream and dispatch locks",
  { timeout: 30_000 },
  async () => {
    const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
    let store
    const tenant = `chat_barrier_${Date.now()}`
    const owner = "barrier_user"
    const submit = async (conversationId, suffix) => {
      await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1,$2,$3,$4)", [
        conversationId,
        tenant,
        owner,
        suffix,
      ])
      return store.services.chatTurns.submit({
        tenantId: tenant,
        conversationId,
        subjectId: owner,
        actorId: owner,
        requestId: `request_${suffix}`,
        idempotencyKey: `turn_${suffix}`,
        content: suffix,
      })
    }
    const lockers = new Set()
    const pendingOperations = new Set()
    const track = (operation) => {
      pendingOperations.add(operation)
      operation.finally(() => pendingOperations.delete(operation))
      return operation
    }
    const lockStream = async (conversationId) => {
      const client = await pool.connect()
      lockers.add(client)
      await client.query("BEGIN")
      const pid = Number((await client.query("SELECT pg_backend_pid()::int AS pid")).rows[0].pid)
      await client.query("SELECT 1 FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE", [tenant, conversationId])
      client.barrierPid = pid
      return client
    }
    const releaseLocker = async (client) => {
      await client.query("COMMIT")
      lockers.delete(client)
      client.release()
    }
    const lockDispatch = async (outboxId) => {
      const client = await pool.connect()
      lockers.add(client)
      await client.query("BEGIN")
      client.barrierPid = Number((await client.query("SELECT pg_backend_pid()::int AS pid")).rows[0].pid)
      await client.query("SELECT 1 FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND outbox_id=$2 FOR UPDATE", [tenant, outboxId])
      return client
    }
    const waitForBlockedStream = (locker) =>
      waitFor(
        async () =>
          Number(
            (
              await pool.query(
                `SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND $1::int = ANY(pg_blocking_pids(pid))`,
                [locker.barrierPid],
              )
            ).rows[0].count,
          ) > 0,
      )
    const claimTargetConsumer = async (conversationId, workerId, durationMs = 40) => {
      await pool.query("UPDATE bff_agui_stream SET consumer_state='stopped' WHERE tenant_id=$1 AND session_id<>$2", [tenant, conversationId])
      const now = new Date()
      const [lease] = await store.agUiConsumers.claimConsumers({
        workerId,
        now: now.toISOString(),
        leaseUntil: new Date(now.getTime() + durationMs).toISOString(),
        limit: 1,
      })
      assert.equal(lease.sessionId, conversationId)
      return { lease, now }
    }
    try {
      await pool.query(
        "DROP TABLE IF EXISTS bff_agui_run_interaction, bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_conversation_artifact, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE",
      )
      await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
      store = new PostgresBffRepositories(postgresUrl, redisUrl)
      await store.ready()

      const terminalConversation = `${tenant}_terminal`
      const terminalTurn = await submit(terminalConversation, "terminal_claim")
      const terminalLock = await lockStream(terminalConversation)
      const terminalClaimPromise = track(
        store.agentDispatchOutbox.claimAgentDispatchOutbox({ workerId: "barrier_terminal_claim", limit: 1, leaseDurationMs: 5000, maxAttempts: 8 }),
      )
      await waitForBlockedStream(terminalLock)
      await releaseLocker(terminalLock)
      const [terminalClaim] = await terminalClaimPromise
      assert.equal(terminalClaim.runId, terminalTurn.run_id)
      assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(terminalClaim), true)
      const terminalOccurredAt = new Date().toISOString()
      await store.agUi.ingest(tenant, terminalConversation, [
        {
          sourceRunId: terminalTurn.run_id,
          sourceEventId: "barrier_terminal",
          sourceSequence: 1,
          sourceOccurredAt: terminalOccurredAt,
          sourcePayload: { run_id: terminalTurn.run_id },
          event: {
            event_id: "barrier_terminal",
            seq: 1,
            session_id: terminalConversation,
            run_id: terminalTurn.run_id,
            kind: "run.completed",
            timestamp: terminalOccurredAt,
            payload: { status: "completed" },
          },
        },
      ])
      assert.deepEqual(
        await store.agentDispatchOutbox.claimAgentDispatchOutbox({ workerId: "after_terminal", limit: 1, leaseDurationMs: 5000, maxAttempts: 8 }),
        [],
      )

      const deleteConversation = `${tenant}_delete`
      await submit(deleteConversation, "delete_claim")
      const deleteLock = await lockStream(deleteConversation)
      const deleteClaimPromise = track(
        store.agentDispatchOutbox.claimAgentDispatchOutbox({ workerId: "barrier_delete_claim", limit: 1, leaseDurationMs: 5000, maxAttempts: 8 }),
      )
      await waitForBlockedStream(deleteLock)
      const deletePromise = track(store.services.chat.deleteConversation(tenant, owner, deleteConversation, "barrier_delete"))
      await releaseLocker(deleteLock)
      await Promise.all([deleteClaimPromise, deletePromise])
      assert.deepEqual(
        await store.agentDispatchOutbox.claimAgentDispatchOutbox({ workerId: "after_delete", limit: 1, leaseDurationMs: 5000, maxAttempts: 8 }),
        [],
      )

      const failureConversation = `${tenant}_failure`
      const failureTurn = await submit(failureConversation, "failure_terminal")
      const [failureClaim] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
        workerId: "barrier_failure",
        limit: 1,
        leaseDurationMs: 40,
        maxAttempts: 8,
      })
      const failureLock = await lockStream(failureConversation)
      const failurePromise = track(store.agentDispatchOutbox.markAgentDispatchNotAdmitted(failureClaim, 100, "definite_reject"))
      await waitForBlockedStream(failureLock)
      await pool.query("SELECT pg_sleep(0.06)")
      await releaseLocker(failureLock)
      assert.equal(await failurePromise, false)
      const lateTerminalOccurredAt = new Date().toISOString()
      await store.agUi.ingest(tenant, failureConversation, [
        {
          sourceRunId: failureTurn.run_id,
          sourceEventId: "late_terminal",
          sourceSequence: 1,
          sourceOccurredAt: lateTerminalOccurredAt,
          sourcePayload: { run_id: failureTurn.run_id },
          event: {
            event_id: "late_terminal",
            seq: 1,
            session_id: failureConversation,
            run_id: failureTurn.run_id,
            kind: "run.completed",
            timestamp: lateTerminalOccurredAt,
            payload: { status: "completed" },
          },
        },
      ])

      for (const outcome of ["admitted", "unknown"]) {
        const conversationId = `${tenant}_${outcome}`
        await submit(conversationId, `expiry_${outcome}`)
        const [claim] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
          workerId: `expiry_${outcome}`,
          limit: 1,
          leaseDurationMs: 40,
          maxAttempts: 8,
        })
        const locker = await lockDispatch(claim.outboxId)
        const settlement = track(
          outcome === "admitted"
            ? store.agentDispatchOutbox.markAgentDispatchAdmitted(claim)
            : store.agentDispatchOutbox.markAgentDispatchUnknown(claim, 100, "unknown"),
        )
        await waitForBlockedStream(locker)
        await pool.query("SELECT pg_sleep(0.06)")
        await releaseLocker(locker)
        assert.equal(await settlement, false)
      }

      const consumerConversation = `${tenant}_consumer_expiry`
      await submit(consumerConversation, "consumer_expiry")
      const { lease: consumerLease, now } = await claimTargetConsumer(consumerConversation, "consumer_expiry")
      const consumerLock = await lockStream(consumerConversation)
      const renewal = track(store.agUiConsumers.renewConsumerLease(consumerLease, now.toISOString(), new Date(now.getTime() + 5000).toISOString()))
      await waitForBlockedStream(consumerLock)
      await pool.query("SELECT pg_sleep(0.06)")
      await releaseLocker(consumerLock)
      assert.equal(await renewal, false)
      await pool.query("UPDATE bff_agui_stream SET consumer_state='stopped' WHERE tenant_id=$1 AND session_id=$2", [tenant, consumerConversation])
      for (const mode of ["settle", "projection"]) {
        const conversationId = `${tenant}_consumer_${mode}`
        const turn = await submit(conversationId, `consumer_${mode}`)
        const { lease, now: started } = await claimTargetConsumer(conversationId, `consumer_${mode}`)
        const locker = await lockStream(conversationId)
        const operation =
          mode === "settle"
            ? store.agUiConsumers.markConsumerProgress(lease, started.toISOString(), started.toISOString())
            : store.agUi.ingest(
                tenant,
                conversationId,
                [
                  {
                    sourceRunId: turn.run_id,
                    sourceEventId: "expired_projection",
                    sourceSequence: 1,
                    sourceOccurredAt: started.toISOString(),
                    sourcePayload: { run_id: turn.run_id },
                    event: {
                      event_id: "expired_projection",
                      seq: 1,
                      session_id: conversationId,
                      run_id: turn.run_id,
                      kind: "run.created",
                      timestamp: started.toISOString(),
                      payload: { run_id: turn.run_id },
                    },
                  },
                ],
                lease,
              )
        await waitForBlockedStream(locker)
        await pool.query("SELECT pg_sleep(0.06)")
        await releaseLocker(locker)
        if (mode === "settle") assert.equal(await operation, false)
        else await assert.rejects(operation, /consumer lease was lost/u)
        if (mode === "projection")
          assert.equal(
            (await pool.query("SELECT count(*)::int AS count FROM bff_agui_source_event WHERE tenant_id=$1 AND session_id=$2", [tenant, conversationId]))
              .rows[0].count,
            0,
          )
        await pool.query("UPDATE bff_agui_stream SET consumer_state='stopped' WHERE tenant_id=$1 AND session_id=$2", [tenant, conversationId])
      }

      const exhaustedX = `${tenant}_x`
      const availableA = `${tenant}_a`
      const exhaustedTurn = await submit(exhaustedX, "exhausted_x")
      await submit(availableA, "available_a")
      await pool.query(
        "UPDATE bff_agent_dispatch_outbox SET attempt_count=8, status='retryable', available_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND conversation_id=$2",
        [tenant, exhaustedX],
      )
      const exhaustedLock = await lockStream(exhaustedX)
      const firstCycle = store.agentDispatchOutbox.claimAgentDispatchOutbox({ workerId: "barrier_x", limit: 1, leaseDurationMs: 5000, maxAttempts: 8 })
      await waitForBlockedStream(exhaustedLock)
      const secondCycle = store.agentDispatchOutbox.claimAgentDispatchOutbox({ workerId: "barrier_a", limit: 1, leaseDurationMs: 5000, maxAttempts: 8 })
      await releaseLocker(exhaustedLock)
      const [firstClaims, secondClaims] = await Promise.all([firstCycle, secondCycle])
      const remainingClaims = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
        workerId: "barrier_remaining",
        limit: 10,
        leaseDurationMs: 5000,
        maxAttempts: 8,
      })
      const availableClaims = [...firstClaims, ...secondClaims, ...remainingClaims].filter((claim) => claim.conversationId === availableA)
      assert.equal(availableClaims.length, 1)
      assert.equal([...firstClaims, ...secondClaims, ...remainingClaims].filter((claim) => claim.conversationId === exhaustedX).length, 0)
      assert.deepEqual(
        (await pool.query("SELECT status FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2", [tenant, exhaustedX])).rows,
        [{ status: "failed" }],
      )
      assert.deepEqual(
        (await pool.query("SELECT terminal_run_id, expected_run_id FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2", [tenant, exhaustedX])).rows,
        [{ terminal_run_id: exhaustedTurn.run_id, expected_run_id: null }],
      )
      assert.deepEqual(
        (
          await pool.query(
            "SELECT status, agent_failure_code, agent_failure_retryable FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2 AND role='assistant'",
            [tenant, exhaustedX],
          )
        ).rows,
        [{ status: "failed", agent_failure_code: null, agent_failure_retryable: null }],
      )
      const [failedDispatch] = (
        await pool.query("SELECT outbox_id, run_id FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2", [tenant, exhaustedX])
      ).rows
      assert.equal(failedDispatch.run_id, exhaustedTurn.run_id)
      const failureSourceId = `dispatch_failure:${failedDispatch.outbox_id}`
      assert.deepEqual(
        (
          await pool.query("SELECT source_owner,source_event_id,source_sequence FROM bff_agui_source_event WHERE tenant_id=$1 AND session_id=$2", [
            tenant,
            exhaustedX,
          ])
        ).rows,
        [{ source_owner: "kokoro-bff", source_event_id: failureSourceId, source_sequence: "1" }],
      )
      const failureFrames = (
        await pool.query(
          "SELECT event_type,source_owner,source_event_id,event_payload FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 ORDER BY public_sequence",
          [tenant, exhaustedX],
        )
      ).rows
      assert.deepEqual(
        failureFrames.map(({ event_type }) => event_type),
        ["CUSTOM", "RUN_ERROR"],
      )
      assert.equal(failureFrames[0].event_payload.name, "kokoro.run.queued")
      assert.deepEqual(failureFrames[0].event_payload.value, { run_id: exhaustedTurn.run_id, dispatch_sequence: "1" })
      assert.equal(failureFrames[1].source_owner, "kokoro-bff")
      assert.equal(failureFrames[1].source_event_id, failureSourceId)
      assert.equal(failureFrames[1].event_payload.runId, exhaustedTurn.run_id)
      assert.equal(failureFrames[1].event_payload.code, "agent_dispatch_attempts_exhausted")
      assert.deepEqual(
        (
          await pool.query(
            "SELECT run_id FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2 AND status IN ('pending','leased','retryable','admitted')",
            [tenant, exhaustedX],
          )
        ).rows,
        [],
      )
      const exhaustedSnapshot = await store.services.chat.snapshot(tenant, owner, exhaustedX, undefined)
      assert.equal(exhaustedSnapshot.execution_head, undefined)
    } finally {
      for (const locker of lockers) {
        await locker.query("ROLLBACK").catch(() => undefined)
        locker.release()
      }
      lockers.clear()
      await Promise.allSettled([...pendingOperations])
      if (store) await store.close().catch(() => undefined)
      await pool.end()
    }
  },
)

integrationTest("does not return dispatch or consumer leases exhausted by the real commit boundary", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store
  const delayClaimCommitAfterFinalBudget = (repositoryStore, seconds, remainingSqlFragment) => {
    const targetPool = repositoryStore.database.pool
    const originalConnect = targetPool.connect
    const patchedClients = new Map()
    const observation = { matchingQueries: 0, delayedCommits: 0, observedRemainingMs: null }
    targetPool.connect = async () => {
      const client = await originalConnect.call(targetPool)
      if (patchedClients.has(client)) return client
      const originalQuery = client.query
      patchedClients.set(client, originalQuery)
      let delayThisCommit = false
      client.query = async (...args) => {
        const sql = typeof args[0] === "string" ? args[0] : args[0]?.text
        if (delayThisCommit && sql === "COMMIT") {
          observation.delayedCommits += 1
          await originalQuery.call(client, "SELECT pg_sleep($1)", [seconds])
          client.query = originalQuery
          patchedClients.delete(client)
        }
        const result = await originalQuery.apply(client, args)
        if (typeof sql === "string" && sql.includes(remainingSqlFragment)) {
          observation.matchingQueries += 1
          const remaining = result.rows.map((row) => Number(row.lease_remaining_ms))
          assert.ok(remaining.length > 0)
          assert.ok(remaining.every((value) => Number.isSafeInteger(value) && value > 0))
          observation.observedRemainingMs = Math.min(...remaining)
          delayThisCommit = true
        }
        return result
      }
      return client
    }
    return {
      observation,
      restore() {
        targetPool.connect = originalConnect
        for (const [client, originalQuery] of patchedClients) client.query = originalQuery
        patchedClients.clear()
      },
    }
  }
  try {
    await pool.query(
      "DROP TABLE IF EXISTS bff_agui_run_interaction, bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_conversation_artifact, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE",
    )
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const tenant = `commit_budget_${Date.now()}`
    const owner = "commit_budget_user"
    const createTurn = async (conversationId, suffix) => {
      await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,title) VALUES ($1,$2,$3,$4)", [conversationId, tenant, owner, suffix])
      return store.services.chatTurns.submit({
        tenantId: tenant,
        conversationId,
        subjectId: owner,
        actorId: owner,
        requestId: `request_${suffix}`,
        idempotencyKey: `turn_${suffix}`,
        content: suffix,
      })
    }

    const dispatchConversation = `${tenant}_dispatch`
    await createTurn(dispatchConversation, "dispatch")
    let delay = delayClaimCommitAfterFinalBudget(store, 0.06, "FROM bff_agent_dispatch_outbox WHERE outbox_id = ANY")
    try {
      assert.deepEqual(
        await store.agentDispatchOutbox.claimAgentDispatchOutbox({ workerId: "commit_dispatch", limit: 1, leaseDurationMs: 20, maxAttempts: 8 }),
        [],
      )
      assert.equal(delay.observation.matchingQueries, 1)
      assert.equal(delay.observation.delayedCommits, 1)
      assert.ok(delay.observation.observedRemainingMs > 0)
    } finally {
      delay.restore()
    }
    assert.deepEqual(
      (
        await pool.query("SELECT status, lease_owner IS NOT NULL AS leased FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2", [
          tenant,
          dispatchConversation,
        ])
      ).rows,
      [{ status: "leased", leased: true }],
    )
    await pool.query("SELECT pg_sleep(0.03)")
    assert.equal(
      (await store.agentDispatchOutbox.claimAgentDispatchOutbox({ workerId: "commit_dispatch_reclaim", limit: 1, leaseDurationMs: 5000, maxAttempts: 8 }))
        .length,
      1,
    )

    const consumerConversation = `${tenant}_consumer`
    await createTurn(consumerConversation, "consumer")
    await pool.query("UPDATE bff_agui_stream SET consumer_state='stopped' WHERE tenant_id=$1 AND session_id<>$2", [tenant, consumerConversation])
    const now = new Date()
    delay = delayClaimCommitAfterFinalBudget(store, 0.06, "FROM bff_agui_stream WHERE (tenant_id ||")
    try {
      assert.deepEqual(
        await store.agUiConsumers.claimConsumers({
          workerId: "commit_consumer",
          now: now.toISOString(),
          leaseUntil: new Date(now.getTime() + 20).toISOString(),
          limit: 1,
        }),
        [],
      )
      assert.equal(delay.observation.matchingQueries, 1)
      assert.equal(delay.observation.delayedCommits, 1)
      assert.ok(delay.observation.observedRemainingMs > 0)
    } finally {
      delay.restore()
    }
    assert.deepEqual(
      (
        await pool.query("SELECT consumer_lease_owner IS NOT NULL AS leased FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2", [
          tenant,
          consumerConversation,
        ])
      ).rows,
      [{ leased: true }],
    )
    await pool.query("SELECT pg_sleep(0.03)")
    assert.equal(
      (
        await store.agUiConsumers.claimConsumers({
          workerId: "commit_consumer_reclaim",
          now: new Date().toISOString(),
          leaseUntil: new Date(Date.now() + 5000).toISOString(),
          limit: 1,
        })
      ).length,
      1,
    )
  } finally {
    if (store) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest(
  "R43 rolls back all queued-head facts on a scoped queued CUSTOM insert fault and replays one key without new facts",
  { timeout: 30_000 },
  async () => {
    const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
    const suffix = randomUUID().replaceAll("-", "")
    const tenantId = "r43_queued_fault_" + suffix
    const conversationId = "conv_" + randomUUID()
    const subjectId = "r43_queued_owner"
    const functionName = "r43_queued_fault_" + suffix
    const triggerName = "r43_queued_trigger_" + suffix
    const scopedTables = [
      ["bff_conversation", "conversation_id"],
      ["bff_message", "conversation_id"],
      ["bff_agent_dispatch_outbox", "conversation_id"],
      ["bff_agui_stream", "session_id"],
      ["bff_agui_source_event", "session_id"],
      ["bff_agui_event", "session_id"],
    ]
    const input = {
      tenantId,
      conversationId,
      subjectId,
      actorId: subjectId,
      requestId: "r43_queued_request_" + suffix,
      idempotencyKey: "r43_queued_key_" + suffix,
      content: "One atomic first turn",
    }
    let store = null
    let functionInstalled = false
    let triggerInstalled = false
    const fingerprint = async () => {
      const facts = {}
      for (const [table, column] of scopedTables) {
        const result = await pool.query(
          "SELECT to_jsonb(fact) AS fact FROM " + table + " AS fact WHERE tenant_id=$1 AND " + column + "=$2 ORDER BY to_jsonb(fact)::text",
          [tenantId, conversationId],
        )
        facts[table] = result.rows.map(({ fact }) => fact)
      }
      const watermark = await pool.query("SELECT cursor FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 ORDER BY public_sequence DESC LIMIT 1", [
        tenantId,
        conversationId,
      ])
      return { facts, cursor: watermark.rows[0]?.cursor ?? null }
    }
    const removeFault = async () => {
      if (triggerInstalled) {
        await pool.query("DROP TRIGGER " + triggerName + " ON bff_agui_event")
        triggerInstalled = false
      }
      if (functionInstalled) {
        await pool.query("DROP FUNCTION " + functionName + "()")
        functionInstalled = false
      }
    }
    try {
      await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
      await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
      store = new PostgresBffRepositories(postgresUrl, redisUrl)
      await store.ready()
      const before = await fingerprint()
      assert.ok(Object.values(before.facts).every((rows) => rows.length === 0))
      assert.equal(before.cursor, null)
      // Real PostgreSQL failure, restricted to this tenant/conversation and queued CUSTOM.
      await pool.query(
        "CREATE FUNCTION " +
          functionName +
          "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN " +
          "IF NEW.tenant_id=TG_ARGV[0] AND NEW.session_id=TG_ARGV[1] AND NEW.event_type='CUSTOM' " +
          "AND NEW.event_payload->>'name'='kokoro.run.queued' THEN " +
          "RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='R43_QUEUED_INSERT_FAULT'; END IF; RETURN NEW; END; $$",
      )
      functionInstalled = true
      await pool.query(
        "CREATE TRIGGER " +
          triggerName +
          " BEFORE INSERT ON bff_agui_event FOR EACH ROW EXECUTE FUNCTION " +
          functionName +
          "('" +
          tenantId +
          "','" +
          conversationId +
          "')",
      )
      triggerInstalled = true
      let failure
      try {
        await store.services.chatTurns.submit(input)
      } catch (error) {
        failure = error
      }
      const afterFailure = await fingerprint()
      assert.equal(failure?.code, "P0001", "queued insert fault must propagate through production submit")
      assert.equal(failure?.message, "R43_QUEUED_INSERT_FAULT")
      assert.deepEqual(afterFailure, before, "Conversation/Message/outbox/stream/source/public ledger and cursor must all roll back")

      await removeFault()
      const accepted = await store.services.chatTurns.submit(input)
      assert.ok(accepted)
      const committed = await fingerprint()
      assert.equal(committed.facts.bff_conversation.length, 1)
      assert.equal(committed.facts.bff_message.length, 2)
      assert.equal(committed.facts.bff_agent_dispatch_outbox.length, 1)
      assert.equal(committed.facts.bff_agui_stream.length, 1)
      assert.equal(committed.facts.bff_agui_source_event.length, 0)
      assert.equal(committed.facts.bff_agui_event.length, 1)
      const outbox = committed.facts.bff_agent_dispatch_outbox[0]
      const queued = committed.facts.bff_agui_event[0]
      assert.equal(outbox.run_id, accepted.run_id)
      assert.equal(outbox.status, "pending")
      assert.equal(queued.event_type, "CUSTOM")
      assert.equal(queued.event_payload.name, "kokoro.run.queued")
      assert.deepEqual(queued.event_payload.value, {
        run_id: accepted.run_id,
        dispatch_sequence: String(outbox.conversation_dispatch_seq),
      })
      assert.match(committed.cursor, /^agui_[0-9a-f]{32}$/u)
      const snapshot = await store.services.chat.snapshot(tenantId, subjectId, conversationId, undefined)
      assert.deepEqual(snapshot.execution_head, { run_id: accepted.run_id, state: "queued", pending_pauses: [] })
      assert.equal(snapshot.event_watermark, committed.cursor)
      await store.close()
      store = new PostgresBffRepositories(postgresUrl, redisUrl)
      await store.ready()
      assert.deepEqual(await store.services.chatTurns.submit(input), accepted)
      assert.deepEqual(await store.services.chatTurns.submit(input), accepted)
      assert.deepEqual(await fingerprint(), committed, "same key after reconnect must not add facts, alter markers or advance cursor")
    } finally {
      await removeFault()
      if (store !== null) await store.close()
      for (const [table, column] of [...scopedTables].reverse()) {
        await pool.query("DELETE FROM " + table + " WHERE tenant_id=$1 AND " + column + "=$2", [tenantId, conversationId])
      }
      await pool.end()
    }
  },
)

integrationTest("R124 Conversation deletion removes owned compact process rows without cross-owner SQL", { timeout: 30_000 }, async () => {
  const suffix = randomUUID().replaceAll("-", "")
  const tenantId = "r124_delete_" + suffix
  const conversationId = "r124_session_" + suffix
  const ownerId = "r124_owner_" + suffix
  const runId = "r124_run_" + suffix
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", statement_timeout: 5000 })
  let store = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    assert.equal(
      (await pool.query("SELECT to_regclass('kokoro_bff.bff_agui_run_process') AS process, to_regclass('kokoro_bff.bff_agui_run_activity') AS activity"))
        .rows[0].process,
      "bff_agui_run_process",
    )
    assert.equal((await pool.query("SELECT to_regclass('kokoro_bff.bff_agui_run_activity') AS activity")).rows[0].activity, "bff_agui_run_activity")
    await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,title) VALUES ($1,$2,$3,'R124 delete')", [
      conversationId,
      tenantId,
      ownerId,
    ])
    await pool.query(
      `INSERT INTO bff_agui_run_process
       (tenant_id,session_id,run_id,subject_id,start_source_owner,start_source_event_id,start_source_sequence,start_source_digest,start_source_occurred_at,start_public_sequence,start_public_cursor,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'kokoro-agent','source_start',1,$5,CURRENT_TIMESTAMP(3),1,$6,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))`,
      [tenantId, conversationId, runId, ownerId, "a".repeat(64), "agui_" + "a".repeat(32)],
    )
    await pool.query(
      `INSERT INTO bff_agui_run_activity
       (tenant_id,session_id,run_id,activity_id,subject_id,activity_kind,safe_payload,payload_digest,first_source_owner,first_source_event_id,first_source_sequence,first_source_digest,first_source_occurred_at,first_public_sequence,first_public_cursor,latest_source_owner,latest_source_event_id,latest_source_sequence,latest_source_digest,latest_source_occurred_at,latest_public_sequence,latest_public_cursor,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'tool',$6::jsonb,$7,'kokoro-agent','source_activity',2,$7,CURRENT_TIMESTAMP(3),2,$8,'kokoro-agent','source_activity',2,$7,CURRENT_TIMESTAMP(3),2,$8,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))`,
      [
        tenantId,
        conversationId,
        runId,
        "act_" + "d".repeat(64),
        ownerId,
        JSON.stringify({
          activity: "tool",
          activity_id: "act_" + "d".repeat(64),
          segment_id: "seg_" + "d".repeat(64),
          status: "completed",
          display_code: "tool.execution",
        }),
        "d".repeat(64),
        "agui_" + "d".repeat(32),
      ],
    )
    assert.equal(await store.services.chat.deleteConversation(tenantId, ownerId, conversationId, "r124_delete_request_" + suffix), true)
    assert.equal(
      (await pool.query("SELECT count(*)::int AS count FROM bff_agui_run_process WHERE tenant_id=$1 AND session_id=$2", [tenantId, conversationId])).rows[0]
        .count,
      0,
    )
    assert.equal(
      (await pool.query("SELECT count(*)::int AS count FROM bff_agui_run_activity WHERE tenant_id=$1 AND session_id=$2", [tenantId, conversationId])).rows[0]
        .count,
      0,
    )
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    for (const table of ["bff_agui_run_activity", "bff_agui_run_process", "bff_conversation"]) {
      await pool.query("DELETE FROM " + table + " WHERE tenant_id=$1", [tenantId]).catch(() => undefined)
    }
    await pool.end()
  }
})

integrationTest("R146 Move changes only the canonical Conversation Project in a real HTTP and PostgreSQL transaction", { timeout: 30_000 }, async () => {
  const suffix = randomUUID()
  const tenant = `r146_move_${suffix}`
  const subject = `move_owner_${suffix}`
  const projectA = `project_${randomUUID()}`
  const projectB = `project_${randomUUID()}`
  const conversationId = `conv_${randomUUID()}`
  const directId = `conv_${randomUUID()}`
  const raceSameId = `conv_${randomUUID()}`
  const raceDifferentId = `conv_${randomUUID()}`
  const slugId = `conv_${randomUUID()}`
  const foreignId = `conv_${randomUUID()}`
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", statement_timeout: 5000 })
  let store = null
  let bff = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_project (project_id, tenant_id, owner_id, name, slug)
       VALUES ($1,$3,$4,'Move source',$5),($2,$3,$4,'Move target',$6)`,
      [projectA, projectB, tenant, subject, `source-${suffix}`, `target-${suffix}`],
    )
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, project_ref, title)
       VALUES ($1,$3,$4,$5,'Move source session'),($2,$3,$4,NULL,'Direct session')`,
      [conversationId, directId, tenant, subject, projectA],
    )
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title)
       VALUES ($1,$6,$7,NULL,'Same-key race'),($2,$6,$7,NULL,'Different-key race'),
              ($3,$6,$7,$8,'Legacy slug source'),($4,$6,$5,NULL,'Foreign owner')`,
      [raceSameId, raceDifferentId, slugId, foreignId, `foreign_${suffix}`, tenant, subject, `source-${suffix}`],
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const admittedRun = await store.services.chatTurns.submit({
      tenantId: tenant,
      conversationId,
      projectRef: projectA,
      subjectId: subject,
      actorId: subject,
      requestId: `r146_run_${suffix}`,
      idempotencyKey: `r146-run-${suffix}`,
      content: "An admitted run keeps its original context after Move",
      selectedSkillSourceRefs: ["skill:exact-b", "skill:exact-a"],
    })
    assert.ok(admittedRun)
    const bindingRow = async () =>
      (
        await pool.query(
          "SELECT execution_project_ref,execution_context_retired_at::text AS retired_at FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2",
          [tenant, admittedRun.run_id],
        )
      ).rows[0]
    assert.deepEqual(await bindingRow(), { execution_project_ref: projectA, retired_at: null }, "canonical project is a durable binding, not caller trace")
    const assertion = (
      await pool.query("SELECT identity_assertion_ref FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenant, admittedRun.run_id])
    ).rows[0].identity_assertion_ref
    const bindingInput = {
      tenantId: tenant,
      subjectId: subject,
      actorId: subject,
      runId: admittedRun.run_id,
      sessionId: conversationId,
      identityAssertionRef: assertion,
      projectId: projectA,
      selectionDigest: createHash("sha256")
        .update(JSON.stringify(["skill:exact-b", "skill:exact-a"]))
        .digest("hex"),
    }
    const liveBinding = await store.projectExecutionBindings.readProjectExecutionBinding(bindingInput)
    assert.deepEqual(liveBinding, {
      projectId: projectA,
      selectedSkillSourceRefs: ["skill:exact-b", "skill:exact-a"],
      selectionDigest: bindingInput.selectionDigest,
    })
    for (const field of ["tenantId", "subjectId", "actorId", "runId", "sessionId", "identityAssertionRef", "projectId", "selectionDigest"]) {
      assert.equal(
        await store.projectExecutionBindings.readProjectExecutionBinding({
          ...bindingInput,
          [field]: field === "selectionDigest" ? "0".repeat(64) : "wrong-binding",
        }),
        null,
        field,
      )
    }
    const corruptionAllowed = {}
    await pool.query("UPDATE bff_project SET slug=$3 WHERE tenant_id=$1 AND project_id=$2", [tenant, projectB, projectA])
    corruptionAllowed.ambiguousProject = (await store.projectExecutionBindings.readProjectExecutionBinding(bindingInput)) !== null
    await pool.query("UPDATE bff_project SET slug=$3 WHERE tenant_id=$1 AND project_id=$2", [tenant, projectB, `target-${suffix}`])
    const originalPayload = (await pool.query("SELECT payload FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenant, admittedRun.run_id]))
      .rows[0].payload
    for (const field of ["request_id", "message_id"]) {
      await pool.query(
        "UPDATE bff_agent_dispatch_outbox SET payload=jsonb_set(payload,ARRAY['launch',$3::text],$4::jsonb,false) WHERE tenant_id=$1 AND run_id=$2",
        [tenant, admittedRun.run_id, field, JSON.stringify("wrong-lineage")],
      )
      corruptionAllowed[field] = (await store.projectExecutionBindings.readProjectExecutionBinding(bindingInput)) !== null
      await pool.query("UPDATE bff_agent_dispatch_outbox SET payload=$3::jsonb WHERE tenant_id=$1 AND run_id=$2", [
        tenant,
        admittedRun.run_id,
        JSON.stringify(originalPayload),
      ])
    }
    assert.deepEqual(
      corruptionAllowed,
      { ambiguousProject: false, request_id: false, message_id: false },
      "ambiguous scope and corrupt dispatch lineage never grant a binding",
    )
    await pool.query("UPDATE bff_project SET deleted_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND project_id=$2", [tenant, projectA])
    assert.equal(await store.projectExecutionBindings.readProjectExecutionBinding(bindingInput), null, "deleted project is not current authority")
    await pool.query("UPDATE bff_project SET deleted_at=NULL WHERE tenant_id=$1 AND project_id=$2", [tenant, projectA])
    await pool.query("UPDATE bff_conversation SET status='deleted',deleted_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND conversation_id=$2", [
      tenant,
      conversationId,
    ])
    assert.equal(await store.projectExecutionBindings.readProjectExecutionBinding(bindingInput), null, "deleted conversation is not current authority")
    await pool.query("UPDATE bff_conversation SET status='active',deleted_at=NULL WHERE tenant_id=$1 AND conversation_id=$2", [tenant, conversationId])
    await pool.query("UPDATE bff_message SET selected_skill_source_refs=$3::jsonb WHERE tenant_id=$1 AND message_id=$2", [
      tenant,
      admittedRun.user_message_id,
      JSON.stringify(["skill:tampered"]),
    ])
    assert.equal(await store.projectExecutionBindings.readProjectExecutionBinding(bindingInput), null, "Message and dispatch must agree on exact ordered refs")
    await pool.query("UPDATE bff_message SET selected_skill_source_refs=$3::jsonb WHERE tenant_id=$1 AND message_id=$2", [
      tenant,
      admittedRun.user_message_id,
      JSON.stringify(["skill:exact-b", "skill:exact-a"]),
    ])
    assert.deepEqual(await store.projectExecutionBindings.readProjectExecutionBinding(bindingInput), liveBinding)
    const aborted = new AbortController()
    aborted.abort()
    await assert.rejects(store.projectExecutionBindings.readProjectExecutionBinding({ ...bindingInput, signal: aborted.signal }), { name: "AbortError" })
    await pool.query("INSERT INTO bff_share (share_id,tenant_id,conversation_id,url) VALUES ($1,$2,$3,$4)", [
      `share_${suffix}`,
      tenant,
      conversationId,
      `https://share.kokoro.invalid/${suffix}`,
    ])
    await pool.query(
      `INSERT INTO bff_conversation_artifact
       (tenant_id,conversation_id,artifact_id,run_id,source_event_id,source_sequence,source_digest,
        source_asset_id,source_artifact_kind,source_content_sha256,source_title,source_mime,source_size_bytes,delivered_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,'document',$8,'Admitted artifact','text/plain',12,CURRENT_TIMESTAMP(3))`,
      [tenant, conversationId, `artifact_${suffix}`, admittedRun.run_id, `event_${suffix}`, "a".repeat(64), `asset_${suffix}`, "b".repeat(64)],
    )
    const preservedTables = [
      "bff_message",
      "bff_agent_dispatch_outbox",
      "bff_agui_stream",
      "bff_share",
      "bff_conversation_artifact",
      "bff_agent_cancellation_outbox",
    ]
    const preservedRows = async () => {
      const rows = {}
      for (const table of preservedTables) {
        const result = await pool.query(
          `SELECT row_to_json(fact)::text AS value FROM ${table} AS fact WHERE tenant_id=$1 AND ${table === "bff_agui_stream" ? "session_id" : "conversation_id"}=$2 ORDER BY value`,
          [tenant, conversationId],
        )
        rows[table] = result.rows.map((row) => {
          const fact = JSON.parse(row.value)
          if (table === "bff_agent_dispatch_outbox") delete fact.execution_context_retired_at
          return JSON.stringify(fact)
        })
      }
      return rows
    }
    const beforeMoveFacts = await preservedRows()
    bff = createBffServer(config(tenant), {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
    })
    const base = await listen(bff)
    const headers = auth(tenant, subject)
    const sendMove = async (id, key, target) => {
      const response = await fetch(`${base}/v1/sessions/${id}/move`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": key, "content-type": "application/json" },
        body: JSON.stringify({ target_project_id: target }),
      })
      return { response, body: await response.json() }
    }
    const projectRef = async (id) => {
      const result = await pool.query(
        "SELECT project_ref FROM bff_conversation WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3 AND status='active'",
        [tenant, subject, id],
      )
      assert.equal(result.rowCount, 1)
      return result.rows[0].project_ref
    }

    assert.equal(await projectRef(conversationId), projectA)
    const movedOut = await sendMove(conversationId, "r146-move-out", null)
    assert.equal(movedOut.response.status, 200, JSON.stringify(movedOut.body))
    assert.deepEqual(movedOut.body, { data: { session_id: conversationId, project_ref: null } })
    assert.equal(movedOut.response.headers.get("cache-control"), "no-store")
    assert.match(movedOut.response.headers.get("x-request-id") ?? "", /^[\x20-\x7E]{1,128}$/u)
    assert.equal(await projectRef(conversationId), null)
    const retired = await bindingRow()
    assert.equal(retired.execution_project_ref, projectA, "Move preserves the original exact scope")
    assert.ok(retired.retired_at, "Move permanently retires old execution authority")
    assert.equal(await store.projectExecutionBindings.readProjectExecutionBinding(bindingInput), null, "retired binding is no longer an allow")
    assert.deepEqual(await preservedRows(), beforeMoveFacts, "Move must not alter an admitted Run, Message, Share, AG-UI, Artifact or cancel outbox")

    const replay = await sendMove(conversationId, "r146-move-out", null)
    assert.equal(replay.response.status, 200, JSON.stringify(replay.body))
    assert.deepEqual(replay.body, movedOut.body, "same key must replay the original final 200 without another move")
    const conflict = await sendMove(conversationId, "r146-move-out", projectB)
    assert.equal(conflict.response.status, 409, JSON.stringify(conflict.body))
    assert.equal(conflict.body.error?.code, "idempotency_conflict")
    assert.equal(await projectRef(conversationId), null, "conflicting target must not change the committed direct scope")

    const token = headers.authorization.slice("Bearer ".length)
    sessionAdmission.deny(token, { ok: false, status: 401, code: "session_invalid" })
    const revokedReplay = await sendMove(conversationId, "r146-move-out", null)
    assert.equal(revokedReplay.response.status, 401, JSON.stringify(revokedReplay.body))
    assert.equal(revokedReplay.body.error?.code, "session_invalid")
    assert.equal(revokedReplay.response.headers.get("cache-control"), "no-store")
    assert.match(revokedReplay.response.headers.get("x-request-id") ?? "", /^[\x20-\x7E]{1,128}$/u)
    sessionAdmission.allow(token, { namespace: tenant, userId: subject })

    const movedInto = await sendMove(directId, "r146-move-into", projectB)
    assert.equal(movedInto.response.status, 200, JSON.stringify(movedInto.body))
    assert.deepEqual(movedInto.body, { data: { session_id: directId, project_ref: projectB } })
    assert.equal(await projectRef(directId), projectB)
    const timestamp = (await pool.query("SELECT updated_at::text AS value FROM bff_conversation WHERE conversation_id=$1", [directId])).rows[0].value
    const noOp = await sendMove(directId, "r146-move-noop", projectB)
    assert.equal(noOp.response.status, 200, JSON.stringify(noOp.body))
    assert.deepEqual(noOp.body, movedInto.body)
    assert.equal((await pool.query("SELECT updated_at::text AS value FROM bff_conversation WHERE conversation_id=$1", [directId])).rows[0].value, timestamp)

    const slugRun = await store.services.chatTurns.submit({
      tenantId: tenant,
      conversationId: slugId,
      projectRef: projectA,
      subjectId: subject,
      actorId: subject,
      requestId: `slug-binding-${suffix}`,
      idempotencyKey: `slug-binding-${suffix}`,
      content: "Same canonical scope stays authorized",
      selectedSkillSourceRefs: [],
    })
    assert.ok(slugRun)
    const slugAssertion = (
      await pool.query("SELECT identity_assertion_ref FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenant, slugRun.run_id])
    ).rows[0].identity_assertion_ref
    const slugBinding = {
      ...bindingInput,
      runId: slugRun.run_id,
      sessionId: slugId,
      identityAssertionRef: slugAssertion,
      selectionDigest: createHash("sha256").update("[]").digest("hex"),
    }
    assert.ok(await store.projectExecutionBindings.readProjectExecutionBinding(slugBinding))
    const convergedSlug = await sendMove(slugId, "r146-move-slug", projectA)
    assert.equal(convergedSlug.response.status, 200, JSON.stringify(convergedSlug.body))
    assert.equal(await projectRef(slugId), projectA, "a touched legacy slug converges to canonical Project ID")
    assert.ok(await store.projectExecutionBindings.readProjectExecutionBinding(slugBinding), "slug normalization is not a scope change")
    assert.equal((await sendMove(slugId, "r146-same-canonical", projectA)).response.status, 200)
    assert.ok(await store.projectExecutionBindings.readProjectExecutionBinding(slugBinding), "same-project no-op does not retire the binding")
    for (const [id, target] of [
      [foreignId, projectA],
      [conversationId, `project_${randomUUID()}`],
    ]) {
      const hidden = await sendMove(id, `r146-hidden-${randomUUID()}`, target)
      assert.equal(hidden.response.status, 404, JSON.stringify(hidden.body))
      assert.equal(hidden.body.error?.code, "session_not_found")
    }

    const sameRace = await Promise.all([sendMove(raceSameId, "r146-race-same", projectA), sendMove(raceSameId, "r146-race-same", projectA)])
    assert.deepEqual(
      sameRace.map(({ response }) => response.status),
      [200, 200],
    )
    assert.deepEqual(sameRace[0].body, sameRace[1].body)
    assert.equal(await projectRef(raceSameId), projectA)
    const differentRace = await Promise.all([
      sendMove(raceDifferentId, "r146-race-different", projectA),
      sendMove(raceDifferentId, "r146-race-different", projectB),
    ])
    assert.deepEqual(differentRace.map(({ response }) => response.status).sort(), [200, 409])
    const winner = differentRace.find(({ response }) => response.status === 200)
    assert.ok(winner)
    assert.equal(await projectRef(raceDifferentId), winner.body.data.project_ref)
    assert.deepEqual(await preservedRows(), beforeMoveFacts, "concurrent Move must leave historical facts unchanged")
    assert.deepEqual(await bindingRow(), retired, "Move replay and later unrelated Moves do not rewrite the original retirement")
    const directRun = await store.services.chatTurns.submit({
      tenantId: tenant,
      conversationId,
      subjectId: subject,
      actorId: subject,
      requestId: `new-direct-${suffix}`,
      idempotencyKey: `new-direct-${suffix}`,
      content: "Fresh direct binding",
      selectedSkillSourceRefs: [],
    })
    assert.ok(directRun)
    const directAssertion = (
      await pool.query("SELECT identity_assertion_ref FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenant, directRun.run_id])
    ).rows[0].identity_assertion_ref
    const directBinding = {
      ...bindingInput,
      runId: directRun.run_id,
      identityAssertionRef: directAssertion,
      projectId: null,
      selectionDigest: createHash("sha256").update("[]").digest("hex"),
    }
    assert.deepEqual(await store.projectExecutionBindings.readProjectExecutionBinding(directBinding), {
      projectId: null,
      selectedSkillSourceRefs: [],
      selectionDigest: directBinding.selectionDigest,
    })
    assert.equal((await sendMove(conversationId, "r146-move-out", null)).response.status, 200)
    assert.ok(await store.projectExecutionBindings.readProjectExecutionBinding(directBinding), "old Move receipt replay must not retire a later Run")
    const movedBack = await sendMove(conversationId, "r146-move-back", projectA)
    assert.equal(movedBack.response.status, 200)
    assert.deepEqual(await bindingRow(), retired, "P→direct→P never revives the old execution binding")
    assert.equal(await store.projectExecutionBindings.readProjectExecutionBinding(bindingInput), null, "ABA does not revive the old authorization")
    assert.equal(await store.projectExecutionBindings.readProjectExecutionBinding(directBinding), null, "moving into Project retires the preceding direct Run")
    const freshProjectRun = await store.services.chatTurns.submit({
      tenantId: tenant,
      conversationId,
      projectRef: projectA,
      subjectId: subject,
      actorId: subject,
      requestId: `new-project-${suffix}`,
      idempotencyKey: `new-project-${suffix}`,
      content: "Fresh project binding",
      selectedSkillSourceRefs: [],
    })
    assert.ok(freshProjectRun)
    const freshAssertion = (
      await pool.query("SELECT identity_assertion_ref FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenant, freshProjectRun.run_id])
    ).rows[0].identity_assertion_ref
    const freshBinding = { ...directBinding, runId: freshProjectRun.run_id, identityAssertionRef: freshAssertion, projectId: projectA }
    assert.ok(await store.projectExecutionBindings.readProjectExecutionBinding(freshBinding))
    assert.equal((await sendMove(conversationId, "r146-move-out", null)).response.status, 200)
    assert.equal(await projectRef(conversationId), projectA, "old receipt replay never moves the Conversation again")
    assert.ok(await store.projectExecutionBindings.readProjectExecutionBinding(freshBinding), "old receipt replay never revokes a later Project Run")
    const heldClients = await Promise.all(Array.from({ length: 10 }, () => store.database.pool.connect()))
    try {
      const read = store.projectExecutionBindings.readProjectExecutionBinding({ ...freshBinding, signal: AbortSignal.timeout(25) })
      const state = await Promise.race([
        read.then(
          () => "resolved",
          () => "aborted",
        ),
        new Promise((resolve) => setTimeout(() => resolve("still_waiting"), 150)),
      ])
      assert.equal(state, "aborted", "a cancelled binding read must leave the pool wait within the request budget")
      await read.catch(() => undefined)
    } finally {
      for (const client of heldClients) client.release()
    }

    for (const mode of ["cancel", "socket_failure", "timeout"]) {
      const blocker = await pool.connect()
      try {
        await blocker.query("BEGIN")
        await blocker.query("LOCK TABLE bff_agent_dispatch_outbox IN ACCESS EXCLUSIVE MODE")
        const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
        const cancel = new AbortController()
        const pendingRead = store.projectExecutionBindings.readProjectExecutionBinding({ ...freshBinding, signal: cancel.signal }).then(
          () => "resolved",
          () => "rejected",
        )
        const [backend] = await blockedPgQueries(pool, blockerPid, /FROM bff_agent_dispatch_outbox/u)
        if (mode === "cancel") cancel.abort()
        else if (mode === "socket_failure") await pool.query("SELECT pg_terminate_backend($1)", [backend.pid])
        assert.equal(await pendingRead, "rejected", "inflight cancellation/socket failure must reject without terminating BFF")
      } finally {
        await blocker.query("ROLLBACK")
        blocker.release()
      }
      assert.equal((await store.database.pool.query("SELECT 1 AS ready")).rows[0].ready, 1, "the owner pool survives the discarded backend")
    }
  } finally {
    if (bff !== null) await close(bff)
    if (store !== null) await store.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope) > 0", [tenant]).catch(() => undefined)
    for (const table of [
      "bff_agent_cancellation_outbox",
      "bff_conversation_artifact",
      "bff_share",
      "bff_agent_dispatch_outbox",
      "bff_agui_stream",
      "bff_message",
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]).catch(() => undefined)
    }
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("R146 Move target Project lock wait has a bounded typed HTTP failure without a partial receipt", { timeout: 15_000 }, async () => {
  const suffix = randomUUID()
  const tenant = `r146_move_block_${suffix}`
  const subject = `move_owner_${suffix}`
  const projectId = `project_${randomUUID()}`
  const conversationId = `conv_${randomUUID()}`
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  let bff = null
  let blocker = null
  let pendingMove = null
  const controller = new AbortController()
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query("INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$2,$3,'Blocked target',$4)", [
      projectId,
      tenant,
      subject,
      `blocked-${suffix}`,
    ])
    await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title) VALUES ($1,$2,$3,NULL,'Blocked Move')", [
      conversationId,
      tenant,
      subject,
    ])
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    bff = createBffServer(config(tenant), {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
    })
    const base = await listen(bff)
    const headers = auth(tenant, subject)
    blocker = await pool.connect()
    await blocker.query("BEGIN")
    await blocker.query("SELECT project_id FROM bff_project WHERE tenant_id=$1 AND owner_id=$2 AND project_id=$3 FOR UPDATE", [tenant, subject, projectId])
    const blockerPid = (await blocker.query("SELECT pg_backend_pid()::int AS pid")).rows[0].pid

    const startedAt = Date.now()
    pendingMove = fetch(`${base}/v1/sessions/${conversationId}/move`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": `r146-block-${suffix}`, "content-type": "application/json" },
      body: JSON.stringify({ target_project_id: projectId }),
      signal: controller.signal,
    }).then(async (response) => ({ response, body: await response.json() }))
    await waitFor(async () => {
      const result = await pool.query(
        `SELECT EXISTS (
           SELECT 1 FROM pg_stat_activity AS activity
            WHERE activity.pid <> $1
              AND $1 = ANY(pg_blocking_pids(activity.pid))
              AND activity.query LIKE '%bff_project%FOR UPDATE%'
         ) AS blocked`,
        [blockerPid],
      )
      return result.rows[0].blocked
    }, 2500)
    const result = await Promise.race([pendingMove, new Promise((resolve) => setTimeout(() => resolve(null), Math.max(1, 5200 - (Date.now() - startedAt))))])
    assert.notEqual(result, null, "a Move blocked on its target Project must complete within the total budget, not hang in the first retry")
    assert.ok(Date.now() - startedAt < 5000, "the formal Move lock budget includes pool and SQL waits")
    assert.equal(result.response.status, 503, JSON.stringify(result.body))
    assert.deepEqual(result.body, { error: { code: "business_store_unavailable", message: "Conversation result is unavailable", retryable: true } })
    assert.equal(result.response.headers.get("cache-control"), "no-store")
    assert.match(result.response.headers.get("x-request-id") ?? "", /^[\x20-\x7E]{1,128}$/u)
    const conversation = await pool.query("SELECT project_ref FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [tenant, conversationId])
    assert.equal(conversation.rows[0].project_ref, null)
    const receipt = await pool.query("SELECT count(*)::int AS count FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant])
    assert.equal(receipt.rows[0].count, 0, "timed-out Move must not leave a success or pending receipt")
  } finally {
    controller.abort()
    if (blocker !== null) {
      await blocker.query("ROLLBACK").catch(() => undefined)
      blocker.release()
    }
    if (pendingMove !== null) await pendingMove.catch(() => undefined)
    if (bff !== null) await close(bff)
    if (store !== null) await store.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("R146 Move pool acquire timeout discards the late real Client and leaves no receipt", { timeout: 15_000 }, async () => {
  const suffix = randomUUID()
  const tenant = `r146_move_pool_${suffix}`
  const subject = `move_owner_${suffix}`
  const projectId = `project_${randomUUID()}`
  const conversationId = `conv_${randomUUID()}`
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  let bff = null
  let pendingMove = null
  const held = []
  const controller = new AbortController()
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query("INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$2,$3,'Pool target',$4)", [
      projectId,
      tenant,
      subject,
      `pool-${suffix}`,
    ])
    await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title) VALUES ($1,$2,$3,NULL,'Pool Move')", [
      conversationId,
      tenant,
      subject,
    ])
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const ownerPool = store.database.pool
    assert.equal(ownerPool.options.max, 10, "this case saturates the real BFF owner Pool rather than a fake repository")
    for (let index = 0; index < ownerPool.options.max; index += 1) held.push(await ownerPool.connect())
    assert.equal(ownerPool.totalCount, ownerPool.options.max)
    bff = createBffServer(config(tenant), {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
    })
    const base = await listen(bff)
    const startedAt = Date.now()
    pendingMove = fetch(`${base}/v1/sessions/${conversationId}/move`, {
      method: "POST",
      headers: { ...auth(tenant, subject), "idempotency-key": `r146-pool-${suffix}`, "content-type": "application/json" },
      body: JSON.stringify({ target_project_id: projectId }),
      signal: controller.signal,
    })
      .then(async (response) => ({ response, body: await response.json() }))
      .catch((error) => ({ error }))
    await waitFor(() => ownerPool.waitingCount === 1, 1500)
    const result = await Promise.race([pendingMove, new Promise((resolve) => setTimeout(() => resolve(null), Math.max(1, 5200 - (Date.now() - startedAt))))])
    assert.notEqual(result, null, "pool acquire must be covered by the Move total budget")
    assert.ok(Date.now() - startedAt < 5000)
    assert.ok(!result.error, String(result.error))
    assert.equal(result.response.status, 503, JSON.stringify(result.body))
    assert.deepEqual(result.body, { error: { code: "business_store_unavailable", message: "Conversation result is unavailable", retryable: true } })
    assert.equal(result.response.headers.get("cache-control"), "no-store")
    assert.match(result.response.headers.get("x-request-id") ?? "", /^[\x20-\x7E]{1,128}$/u)
    assert.equal(ownerPool.waitingCount, 1, "the timed-out acquire is still queued until the real Pool returns its late Client")
    held.shift().release()
    await waitFor(() => ownerPool.waitingCount === 0 && ownerPool.totalCount === ownerPool.options.max - 1, 1500)
    assert.equal((await ownerPool.query("SELECT 1::int AS value")).rows[0].value, 1, "a replacement Client remains usable while other slots stay held")
    assert.equal((await pool.query("SELECT project_ref FROM bff_conversation WHERE conversation_id=$1", [conversationId])).rows[0].project_ref, null)
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant])).rows[0].count, 0)
  } finally {
    controller.abort()
    for (const client of held) client.release()
    if (pendingMove !== null) await pendingMove.catch(() => undefined)
    if (bff !== null) await close(bff)
    if (store !== null) await store.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("R146 Move client abort destroys the exact blocked backend and preserves the owner Pool", { timeout: 10_000 }, async () => {
  const suffix = randomUUID()
  const tenant = `r146_move_abort_${suffix}`
  const subject = `move_owner_${suffix}`
  const projectId = `project_${randomUUID()}`
  const conversationId = `conv_${randomUUID()}`
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  let bff = null
  let blocker = null
  let pendingMove = null
  const controller = new AbortController()
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query("INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$2,$3,'Abort target',$4)", [
      projectId,
      tenant,
      subject,
      `abort-${suffix}`,
    ])
    await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title) VALUES ($1,$2,$3,NULL,'Abort Move')", [
      conversationId,
      tenant,
      subject,
    ])
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    bff = createBffServer(config(tenant), {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
    })
    const base = await listen(bff)
    blocker = await pool.connect()
    await blocker.query("BEGIN")
    await blocker.query("SELECT project_id FROM bff_project WHERE tenant_id=$1 AND owner_id=$2 AND project_id=$3 FOR UPDATE", [tenant, subject, projectId])
    const blockerPid = (await blocker.query("SELECT pg_backend_pid()::int AS pid")).rows[0].pid
    pendingMove = fetch(`${base}/v1/sessions/${conversationId}/move`, {
      method: "POST",
      headers: { ...auth(tenant, subject), "idempotency-key": `r146-abort-${suffix}`, "content-type": "application/json" },
      body: JSON.stringify({ target_project_id: projectId }),
      signal: controller.signal,
    })
      .then(async (response) => ({ response, body: await response.json() }))
      .catch((error) => ({ error }))
    const blockedPid = await waitFor(async () => {
      const result = await pool.query(
        `SELECT activity.pid::int AS pid FROM pg_stat_activity AS activity
          WHERE activity.pid <> $1 AND $1 = ANY(pg_blocking_pids(activity.pid))
            AND activity.query LIKE '%bff_project%FOR UPDATE%'`,
        [blockerPid],
      )
      assert.ok(result.rowCount <= 1, "the owned Project blocker must identify only this Move backend")
      return result.rows[0]?.pid ?? false
    }, 2500)
    controller.abort()
    const aborted = await Promise.race([pendingMove, new Promise((resolve) => setTimeout(() => resolve(null), 1500))])
    assert.notEqual(aborted, null, "the browser request must settle promptly after abort")
    assert.ok(aborted.error, "aborted browser request must not receive a fabricated successful Move")
    await waitFor(async () => {
      const result = await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid=$1", [blockedPid])
      return result.rows[0].count === 0
    }, 2500)
    assert.equal(
      (await store.database.pool.query("SELECT 1::int AS value")).rows[0].value,
      1,
      "the BFF owner Pool must serve a new real query before blocker release",
    )
    assert.equal((await pool.query("SELECT project_ref FROM bff_conversation WHERE conversation_id=$1", [conversationId])).rows[0].project_ref, null)
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant])).rows[0].count, 0)
  } finally {
    controller.abort()
    if (blocker !== null) {
      await blocker.query("ROLLBACK").catch(() => undefined)
      blocker.release()
    }
    if (pendingMove !== null) await pendingMove.catch(() => undefined)
    if (bff !== null) await close(bff)
    if (store !== null) await store.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest(
  "R148 Move recovers the original committed receipt after a fixture drops only the final COMMIT acknowledgement",
  { timeout: 15_000 },
  async () => {
    const suffix = randomUUID()
    const tenant = `r148_move_ack_${suffix}`
    const subject = `move_owner_${suffix}`
    const projectId = `project_${randomUUID()}`
    const conversationId = `conv_${randomUUID()}`
    const key = `r148-ack-${suffix}`
    const scope = JSON.stringify([tenant, subject, "POST", `/sessions/${conversationId}/move`, key])
    const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
    let store = null
    let bff = null
    let restoreAckFixture = () => {}
    try {
      await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
      await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
      await pool.query("INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$2,$3,'ACK target',$4)", [
        projectId,
        tenant,
        subject,
        `ack-${suffix}`,
      ])
      await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title) VALUES ($1,$2,$3,NULL,'ACK Move')", [
        conversationId,
        tenant,
        subject,
      ])
      store = new PostgresBffRepositories(postgresUrl, redisUrl)
      await store.ready()

      // This fixture forwards every SQL query to the real PostgreSQL client. Only after the
      // final COMMIT has actually succeeded does it discard the client-side acknowledgement.
      const ownerPool = store.database.pool
      const originalConnect = ownerPool.connect
      const patchedClients = new Map()
      let insertedReceipt = false
      let droppedAck = false
      ownerPool.connect = async function (...args) {
        const client = await originalConnect.apply(this, args)
        if (!patchedClients.has(client)) {
          const originalQuery = client.query
          patchedClients.set(client, originalQuery)
          client.query = async function (...queryArgs) {
            const result = await originalQuery.apply(this, queryArgs)
            const sql = queryArgs[0]
            if (typeof sql === "string" && sql.includes("INSERT INTO bff_idempotency_receipt") && queryArgs[1]?.[0] === scope && result.rowCount === 1)
              insertedReceipt = true
            if (insertedReceipt && !droppedAck && sql === "COMMIT") {
              assert.equal(result.command, "COMMIT", "the real server must commit before the fixture drops the ACK")
              droppedAck = true
              throw new Error("R148_FIXTURE_FINAL_COMMIT_ACK_DROPPED")
            }
            return result
          }
        }
        return client
      }
      restoreAckFixture = () => {
        ownerPool.connect = originalConnect
        for (const [client, originalQuery] of patchedClients) client.query = originalQuery
      }

      bff = createBffServer(config(tenant), {
        businessStore: store,
        sessionAdmission,
        agentDispatchDispatcher: idleWorker,
        agentCancellationDispatcher: idleWorker,
        agUiProjector: idleWorker,
        scheduledTaskDispatcher: idleWorker,
      })
      const base = await listen(bff)
      const headers = { ...auth(tenant, subject), "idempotency-key": key, "content-type": "application/json" }
      const token = headers.authorization.slice("Bearer ".length)
      const admissionsBefore = sessionAdmission.calls.filter((call) => call.token === token).length
      const sendMove = async () => {
        const response = await fetch(`${base}/v1/sessions/${conversationId}/move`, {
          method: "POST",
          headers,
          body: JSON.stringify({ target_project_id: projectId }),
          signal: AbortSignal.timeout(7000),
        })
        return { response, body: await response.json() }
      }
      const unknown = await sendMove()
      assert.equal(droppedAck, true, "the fixture must intercept only the final successful COMMIT acknowledgement")
      assert.equal(unknown.response.status, 503, JSON.stringify(unknown.body))
      assert.deepEqual(unknown.body, { error: { code: "business_store_unavailable", message: "Conversation result is unavailable", retryable: true } })
      assert.equal(unknown.response.headers.get("cache-control"), "no-store")
      assert.match(unknown.response.headers.get("x-request-id") ?? "", /^[\x20-\x7E]{1,128}$/u)
      assert.equal(sessionAdmission.calls.filter((call) => call.token === token).length, admissionsBefore + 1)
      const committed = await pool.query("SELECT project_ref,updated_at FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [
        tenant,
        conversationId,
      ])
      assert.equal(committed.rows[0].project_ref, projectId, "the real PG Move must have committed despite the lost ACK")
      const receipt = await pool.query("SELECT status,response_body FROM bff_idempotency_receipt WHERE scope=$1", [scope])
      assert.equal(receipt.rowCount, 1, "the final receipt must be durable in the same committed transaction")
      assert.equal(receipt.rows[0].status, 200)
      assert.deepEqual(receipt.rows[0].response_body, { data: { session_id: conversationId, project_ref: projectId } })

      restoreAckFixture()
      const replay = await sendMove()
      assert.equal(replay.response.status, 200, JSON.stringify(replay.body))
      assert.deepEqual(replay.body, receipt.rows[0].response_body, "same-key recovery must use the original final receipt")
      assert.equal(replay.response.headers.get("cache-control"), "no-store")
      assert.match(replay.response.headers.get("x-request-id") ?? "", /^[\x20-\x7E]{1,128}$/u)
      assert.equal(sessionAdmission.calls.filter((call) => call.token === token).length, admissionsBefore + 2, "replay must pass current IAM admission again")
      const afterReplay = await pool.query("SELECT project_ref,updated_at FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [
        tenant,
        conversationId,
      ])
      assert.equal(afterReplay.rows[0].project_ref, projectId)
      assert.equal(afterReplay.rows[0].updated_at.getTime(), committed.rows[0].updated_at.getTime(), "replay must not move or touch the Conversation again")
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM bff_idempotency_receipt WHERE scope=$1", [scope])).rows[0].count, 1)
    } finally {
      restoreAckFixture()
      if (bff !== null) await close(bff)
      if (store !== null) await store.close().catch(() => undefined)
      await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope=$1", [scope]).catch(() => undefined)
      await pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]).catch(() => undefined)
      await pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]).catch(() => undefined)
      await pool.end()
    }
  },
)

integrationTest("R150 Move discards a broken client after an unknown real COMMIT and recovers the durable receipt", { timeout: 15_000 }, async () => {
  const suffix = randomUUID()
  const tenant = `r150_move_commit_${suffix}`
  const subject = `move_owner_${suffix}`
  const projectId = `project_${randomUUID()}`
  const conversationId = `conv_${randomUUID()}`
  const key = `r150-commit-${suffix}`
  const scope = JSON.stringify([tenant, subject, "POST", `/sessions/${conversationId}/move`, key])
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  let bff = null
  let restoreCommitFixture = () => {}
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query("INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$2,$3,'Unknown COMMIT target',$4)", [
      projectId,
      tenant,
      subject,
      `commit-${suffix}`,
    ])
    await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title) VALUES ($1,$2,$3,NULL,'Unknown COMMIT Move')", [
      conversationId,
      tenant,
      subject,
    ])
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()

    // All SQL, including the final COMMIT, executes against real PostgreSQL. The
    // fixture only removes the transport and its acknowledgement after COMMIT.
    const ownerPool = store.database.pool
    const originalConnect = ownerPool.connect
    const patchedClients = new Map()
    let insertedReceipt = false
    let droppedAck = false
    let brokenPid = null
    const commitReleases = []
    const expectedSocketEvents = []
    const unexpectedSocketEvents = []
    const onOwnerPoolError = (error, client) => {
      if (droppedAck && client?.processID === brokenPid && error?.message === "Connection terminated unexpectedly") {
        expectedSocketEvents.push("pool")
      } else {
        unexpectedSocketEvents.push("pool")
      }
    }
    ownerPool.on("error", onOwnerPoolError)
    ownerPool.connect = async function (...args) {
      const client = await originalConnect.apply(this, args)
      if (!patchedClients.has(client)) {
        const originalQuery = client.query
        patchedClients.set(client, { originalQuery, latestRelease: null })
        client.query = async function (...queryArgs) {
          const result = await originalQuery.apply(this, queryArgs)
          const sql = queryArgs[0]
          if (typeof sql === "string" && sql.includes("INSERT INTO bff_idempotency_receipt") && queryArgs[1]?.[0] === scope && result.rowCount === 1)
            insertedReceipt = true
          if (insertedReceipt && !droppedAck && sql === "COMMIT") {
            assert.equal(result.command, "COMMIT", "the real server must commit before the transport is lost")
            brokenPid = this.processID
            assert.ok(Number.isInteger(brokenPid) && brokenPid > 0)
            assert.ok(this.connection?.stream, "the checked-out real PG client must own a socket")
            droppedAck = true
            const onBrokenClientError = (error) => {
              if (this.processID === brokenPid && error?.message === "Connection terminated unexpectedly") {
                expectedSocketEvents.push("client")
              } else {
                unexpectedSocketEvents.push("client")
              }
            }
            patchedClients.get(this).onBrokenClientError = onBrokenClientError
            this.on("error", onBrokenClientError)
            this.connection.stream.destroy()
            throw new Error("R150_FIXTURE_UNKNOWN_COMMIT_TRANSPORT_LOST")
          }
          return result
        }
      }
      // pg-pool installs a fresh release closure at every checkout, including
      // a reused client after the earlier receipt read. Wrap this lease, not
      // only the first client object observed by the fixture.
      const checkoutRelease = client.release
      patchedClients.get(client).latestRelease = checkoutRelease
      client.release = function (destroy) {
        if (droppedAck && this.processID === brokenPid) commitReleases.push(destroy === true)
        return checkoutRelease.call(this, destroy)
      }
      return client
    }
    restoreCommitFixture = () => {
      ownerPool.connect = originalConnect
      ownerPool.removeListener("error", onOwnerPoolError)
      for (const [client, original] of patchedClients) {
        if (original.onBrokenClientError) client.removeListener("error", original.onBrokenClientError)
        client.query = original.originalQuery
        client.release = original.latestRelease
      }
    }

    bff = createBffServer(config(tenant), {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
    })
    const base = await listen(bff)
    const headers = { ...auth(tenant, subject), "idempotency-key": key, "content-type": "application/json" }
    const token = headers.authorization.slice("Bearer ".length)
    const admissionsBefore = sessionAdmission.calls.filter((call) => call.token === token).length
    const sendMove = async () => {
      const response = await fetch(`${base}/v1/sessions/${conversationId}/move`, {
        method: "POST",
        headers,
        body: JSON.stringify({ target_project_id: projectId }),
        signal: AbortSignal.timeout(7000),
      })
      return { response, body: await response.json() }
    }
    const unknown = await sendMove()
    assert.equal(droppedAck, true, "the fixture must cut only the real final COMMIT acknowledgement")
    assert.equal(unknown.response.status, 503, JSON.stringify(unknown.body))
    assert.deepEqual(unknown.body, { error: { code: "business_store_unavailable", message: "Conversation result is unavailable", retryable: true } })
    assert.equal(unknown.response.headers.get("cache-control"), "no-store")
    assert.match(unknown.response.headers.get("x-request-id") ?? "", /^[\x20-\x7E]{1,128}$/u)
    assert.equal(sessionAdmission.calls.filter((call) => call.token === token).length, admissionsBefore + 1)
    const committed = await pool.query("SELECT project_ref,updated_at FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [
      tenant,
      conversationId,
    ])
    assert.equal(committed.rows[0].project_ref, projectId, "the real PostgreSQL COMMIT must persist the Move despite lost transport")
    const receipt = await pool.query("SELECT status,response_body FROM bff_idempotency_receipt WHERE scope=$1", [scope])
    assert.equal(receipt.rowCount, 1)
    assert.equal(receipt.rows[0].status, 200)
    assert.deepEqual(receipt.rows[0].response_body, { data: { session_id: conversationId, project_ref: projectId } })
    await waitFor(async () => (await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid=$1", [brokenPid])).rows[0].count === 0, 2500)
    assert.deepEqual(unexpectedSocketEvents, [], "only the deliberately severed COMMIT connection may report an error")
    assert.ok(expectedSocketEvents.length <= 2, "the fixture must not hide an unbounded client/Pool error stream")
    assert.deepEqual(commitReleases, [true], "an unknown COMMIT must release(true) the exact broken PoolClient")
    // pg-pool.query uses a callback-style connect internally; the fixture
    // intercepts only Promise-style checkouts used by the Move repository.
    const nextClient = await ownerPool.connect()
    let nextBackend
    try {
      nextBackend = await nextClient.query("SELECT pg_backend_pid()::int AS pid")
    } finally {
      nextClient.release()
    }
    assert.notEqual(nextBackend.rows[0].pid, brokenPid, "the owner Pool must serve a new real backend")

    restoreCommitFixture()
    const replay = await sendMove()
    assert.equal(replay.response.status, 200, JSON.stringify(replay.body))
    assert.deepEqual(replay.body, receipt.rows[0].response_body)
    assert.equal(sessionAdmission.calls.filter((call) => call.token === token).length, admissionsBefore + 2, "replay must pass current IAM admission again")
    const afterReplay = await pool.query("SELECT project_ref,updated_at FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [
      tenant,
      conversationId,
    ])
    assert.equal(afterReplay.rows[0].project_ref, projectId)
    assert.equal(afterReplay.rows[0].updated_at.getTime(), committed.rows[0].updated_at.getTime())
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM bff_idempotency_receipt WHERE scope=$1", [scope])).rows[0].count, 1)
  } finally {
    restoreCommitFixture()
    if (bff !== null) await close(bff)
    if (store !== null) await store.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope=$1", [scope]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest(
  "R148 Move rolls back a real PostgreSQL transaction after a scope-specific receipt INSERT fault and recovers with the original key",
  { timeout: 15_000 },
  async () => {
    const suffix = randomUUID()
    const tenant = `r148_move_fault_${suffix}`
    const subject = `move_owner_${suffix}`
    const projectId = `project_${randomUUID()}`
    const conversationId = `conv_${randomUUID()}`
    const key = `r148-fault-${suffix}`
    const scope = JSON.stringify([tenant, subject, "POST", `/sessions/${conversationId}/move`, key])
    const fixtureName = `r148_fault_${suffix.replaceAll("-", "")}`
    const quotedScope = scope.replaceAll("'", "''")
    const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
    let store = null
    let bff = null
    let restoreFaultObserver = () => {}
    try {
      await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
      await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
      await pool.query("INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$2,$3,'Fault target',$4)", [
        projectId,
        tenant,
        subject,
        `fault-${suffix}`,
      ])
      await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title) VALUES ($1,$2,$3,NULL,'Fault Move')", [
        conversationId,
        tenant,
        subject,
      ])
      // The trigger exists only for this exact generated receipt scope; it is removed
      // before the retry and in finally. PostgreSQL, not a mock, aborts the write transaction.
      await pool.query(
        `CREATE FUNCTION ${fixtureName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'R148_MOVE_SQL_FAULT' USING ERRCODE='P0001'; END $$`,
      )
      await pool.query(
        `CREATE TRIGGER ${fixtureName} BEFORE INSERT ON bff_idempotency_receipt FOR EACH ROW WHEN (NEW.scope = '${quotedScope}') EXECUTE FUNCTION ${fixtureName}()`,
      )
      store = new PostgresBffRepositories(postgresUrl, redisUrl)
      await store.ready()
      const originalRun = await store.services.chatTurns.submit({
        tenantId: tenant,
        conversationId,
        subjectId: subject,
        actorId: subject,
        requestId: `fault-run-${suffix}`,
        idempotencyKey: `fault-run-${suffix}`,
        content: "Retirement rollback",
        selectedSkillSourceRefs: [],
      })
      assert.ok(originalRun)
      const originalDispatch = (
        await pool.query("SELECT identity_assertion_ref FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenant, originalRun.run_id])
      ).rows[0]
      const originalBinding = {
        tenantId: tenant,
        subjectId: subject,
        actorId: subject,
        sessionId: conversationId,
        runId: originalRun.run_id,
        identityAssertionRef: originalDispatch.identity_assertion_ref,
        projectId: null,
        selectionDigest: createHash("sha256").update("[]").digest("hex"),
      }
      assert.ok(await store.projectExecutionBindings.readProjectExecutionBinding(originalBinding))
      const ownerPool = store.database.pool
      const originalConnect = ownerPool.connect
      const patchedClients = new Map()
      let observedRealFault = false
      ownerPool.connect = async function (...args) {
        const client = await originalConnect.apply(this, args)
        if (!patchedClients.has(client)) {
          const originalQuery = client.query
          patchedClients.set(client, originalQuery)
          client.query = async function (...queryArgs) {
            try {
              return await originalQuery.apply(this, queryArgs)
            } catch (error) {
              if (error?.code === "P0001" && error.message?.includes("R148_MOVE_SQL_FAULT")) observedRealFault = true
              throw error
            }
          }
        }
        return client
      }
      restoreFaultObserver = () => {
        ownerPool.connect = originalConnect
        for (const [client, originalQuery] of patchedClients) client.query = originalQuery
      }
      bff = createBffServer(config(tenant), {
        businessStore: store,
        sessionAdmission,
        agentDispatchDispatcher: idleWorker,
        agentCancellationDispatcher: idleWorker,
        agUiProjector: idleWorker,
        scheduledTaskDispatcher: idleWorker,
      })
      const base = await listen(bff)
      const headers = { ...auth(tenant, subject), "idempotency-key": key, "content-type": "application/json" }
      const token = headers.authorization.slice("Bearer ".length)
      const admissionsBefore = sessionAdmission.calls.filter((call) => call.token === token).length
      const sendMove = async () => {
        const response = await fetch(`${base}/v1/sessions/${conversationId}/move`, {
          method: "POST",
          headers,
          body: JSON.stringify({ target_project_id: projectId }),
          signal: AbortSignal.timeout(7000),
        })
        return { response, body: await response.json() }
      }
      const failed = await sendMove()
      assert.equal(observedRealFault, true, "the real PG trigger must raise the scoped SQL error")
      assert.equal(failed.response.status, 503, JSON.stringify(failed.body))
      assert.deepEqual(failed.body, { error: { code: "business_store_unavailable", message: "Conversation result is unavailable", retryable: true } })
      assert.equal(failed.response.headers.get("cache-control"), "no-store")
      assert.match(failed.response.headers.get("x-request-id") ?? "", /^[\x20-\x7E]{1,128}$/u)
      assert.equal(sessionAdmission.calls.filter((call) => call.token === token).length, admissionsBefore + 1)
      assert.equal(
        (await pool.query("SELECT project_ref FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [tenant, conversationId])).rows[0].project_ref,
        null,
        "PG must roll back the Move update",
      )
      assert.equal(
        (await pool.query("SELECT count(*)::int AS count FROM bff_idempotency_receipt WHERE scope=$1", [scope])).rows[0].count,
        0,
        "PG must roll back the final receipt too",
      )

      // Restore the scoped connect observer before Pool.query uses its callback overload.
      restoreFaultObserver()
      assert.ok(await store.projectExecutionBindings.readProjectExecutionBinding(originalBinding), "receipt failure must roll back execution retirement too")
      assert.equal(
        (await pool.query("SELECT execution_context_retired_at FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenant, originalRun.run_id]))
          .rows[0].execution_context_retired_at,
        null,
      )

      await pool.query(`DROP TRIGGER ${fixtureName} ON bff_idempotency_receipt`)
      await pool.query(`DROP FUNCTION ${fixtureName}()`)
      restoreFaultObserver()
      const recovered = await sendMove()
      assert.equal(recovered.response.status, 200, JSON.stringify(recovered.body))
      assert.deepEqual(recovered.body, { data: { session_id: conversationId, project_ref: projectId } })
      assert.equal(sessionAdmission.calls.filter((call) => call.token === token).length, admissionsBefore + 2, "recovery must pass current IAM admission again")
      assert.equal(
        (await pool.query("SELECT project_ref FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [tenant, conversationId])).rows[0].project_ref,
        projectId,
      )
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM bff_idempotency_receipt WHERE scope=$1", [scope])).rows[0].count, 1)
      assert.equal(await store.projectExecutionBindings.readProjectExecutionBinding(originalBinding), null, "successful retry retires the original binding")
      assert.ok(
        (await pool.query("SELECT execution_context_retired_at FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenant, originalRun.run_id]))
          .rows[0].execution_context_retired_at,
      )
    } finally {
      restoreFaultObserver()
      if (bff !== null) await close(bff)
      if (store !== null) await store.close().catch(() => undefined)
      await pool.query(`DROP TRIGGER IF EXISTS ${fixtureName} ON bff_idempotency_receipt`).catch(() => undefined)
      await pool.query(`DROP FUNCTION IF EXISTS ${fixtureName}()`).catch(() => undefined)
      await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope=$1", [scope]).catch(() => undefined)
      for (const table of ["bff_agent_dispatch_outbox", "bff_agui_stream", "bff_message"]) {
        await pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]).catch(() => undefined)
      }
      await pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]).catch(() => undefined)
      await pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]).catch(() => undefined)
      await pool.end()
    }
  },
)

integrationTest(
  "R149 Message and Move serialize in both orders on the same Conversation and the next admission sees its new Project",
  { timeout: 30_000 },
  async () => {
    const suffix = randomUUID()
    const tenant = `r149_move_message_${suffix}`
    const subject = `move_owner_${suffix}`
    const [sourceProject, targetProject] = [`project_${randomUUID()}`, `project_${randomUUID()}`].sort()
    const messageFirstId = `conv_${randomUUID()}`
    const moveFirstId = `conv_${randomUUID()}`
    const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
    let store = null
    let bff = null
    let conversationBlocker = null
    let targetBlocker = null
    const pending = []
    try {
      await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
      await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
      await pool.query(
        `INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug)
       VALUES ($1,$3,$4,'Move source',$5),($2,$3,$4,'Move target',$6)`,
        [sourceProject, targetProject, tenant, subject, `r149-source-${suffix}`, `r149-target-${suffix}`],
      )
      await pool.query(
        `INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title)
       VALUES ($1,$3,$4,$5,'Message first'),($2,$3,$4,$5,'Move first')`,
        [messageFirstId, moveFirstId, tenant, subject, sourceProject],
      )
      await pool.query("INSERT INTO bff_share (share_id,tenant_id,conversation_id,url) VALUES ($1,$2,$3,$4)", [
        `share_${suffix}`,
        tenant,
        messageFirstId,
        `https://share.kokoro.invalid/${suffix}`,
      ])
      store = new PostgresBffRepositories(postgresUrl, redisUrl)
      await store.ready()
      const runtimeConfig = config(tenant)
      runtimeConfig.agentEnabled = true
      runtimeConfig.upstreams.agents = "http://127.0.0.1:9"
      bff = createBffServer(runtimeConfig, {
        businessStore: store,
        sessionAdmission,
        agentDispatchDispatcher: idleWorker,
        agentCancellationDispatcher: idleWorker,
        agUiProjector: idleWorker,
        scheduledTaskDispatcher: idleWorker,
      })
      const base = await listen(bff)
      const identity = auth(tenant, subject)
      const sendMessage = async (conversationId, key, projectRef) => {
        const response = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
          method: "POST",
          headers: { ...identity, "idempotency-key": key, "content-type": "application/json" },
          body: JSON.stringify({ selected_skill_source_refs: [], content: `R149 ${key}`, project_ref: projectRef }),
          signal: AbortSignal.timeout(9000),
        })
        return { response, body: await response.json() }
      }
      const sendMove = async (conversationId, key) => {
        const response = await fetch(`${base}/v1/sessions/${conversationId}/move`, {
          method: "POST",
          headers: { ...identity, "idempotency-key": key, "content-type": "application/json" },
          body: JSON.stringify({ target_project_id: targetProject }),
          signal: AbortSignal.timeout(9000),
        })
        return { response, body: await response.json() }
      }
      const historicalFacts = async (conversationId) => {
        const facts = {}
        for (const table of [
          "bff_message",
          "bff_agent_dispatch_outbox",
          "bff_agui_stream",
          "bff_agui_event",
          "bff_share",
          "bff_conversation_artifact",
          "bff_agent_cancellation_outbox",
        ]) {
          const idColumn = table === "bff_agui_stream" || table === "bff_agui_event" ? "session_id" : "conversation_id"
          const rows = await pool.query(
            `SELECT ${table === "bff_agent_dispatch_outbox" ? "(to_jsonb(fact)-'execution_context_retired_at')" : "row_to_json(fact)"}::text AS value FROM ${table} AS fact WHERE tenant_id=$1 AND ${idColumn}=$2 ORDER BY value`,
            [tenant, conversationId],
          )
          facts[table] = rows.rows.map((row) => row.value)
        }
        return facts
      }

      // Message takes the source Project FOR SHARE, then waits for the Conversation.
      // Move cannot take source Project FOR UPDATE until that real admission commits.
      conversationBlocker = await pool.connect()
      await conversationBlocker.query("BEGIN")
      await conversationBlocker.query("SELECT conversation_id FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2 FOR UPDATE", [
        tenant,
        messageFirstId,
      ])
      const conversationBlockerPid = (await conversationBlocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
      targetBlocker = await pool.connect()
      await targetBlocker.query("BEGIN")
      await targetBlocker.query("SELECT project_id FROM bff_project WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE", [tenant, targetProject])
      const targetBlockerPid = (await targetBlocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid

      const firstMessage = sendMessage(messageFirstId, `r149-message-first-${suffix}`, sourceProject)
      pending.push(firstMessage)
      const [messageBackend] = await blockedPgQueries(pool, conversationBlockerPid, /FROM bff_conversation[\s\S]*FOR UPDATE/u)
      const firstMove = sendMove(messageFirstId, `r149-move-after-message-${suffix}`)
      pending.push(firstMove)
      await blockedPgQueries(pool, messageBackend.pid, /FROM bff_project[\s\S]*FOR UPDATE/u)
      await conversationBlocker.query("COMMIT")
      conversationBlocker.release()
      conversationBlocker = null
      const admittedBeforeMove = await firstMessage
      assert.equal(admittedBeforeMove.response.status, 202, JSON.stringify(admittedBeforeMove.body))
      await blockedPgQueries(pool, targetBlockerPid, /FROM bff_project[\s\S]*FOR UPDATE/u)
      const admittedRun = admittedBeforeMove.body.data.run_id
      const launchBeforeMove = await pool.query(
        "SELECT payload,execution_project_ref,execution_context_retired_at FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2 AND run_id=$3",
        [tenant, messageFirstId, admittedRun],
      )
      assert.equal(launchBeforeMove.rowCount, 1)
      assert.equal(launchBeforeMove.rows[0].payload.launch.trace.project_ref, sourceProject)
      assert.equal(launchBeforeMove.rows[0].execution_project_ref, sourceProject)
      assert.equal(launchBeforeMove.rows[0].execution_context_retired_at, null)
      const beforeMoveFacts = await historicalFacts(messageFirstId)
      assert.equal(beforeMoveFacts.bff_message.length, 2)
      assert.ok(beforeMoveFacts.bff_agui_event.length > 0, "the admitted Run must have a durable AG-UI event before Move")
      assert.equal(beforeMoveFacts.bff_share.length, 1)
      await targetBlocker.query("COMMIT")
      targetBlocker.release()
      targetBlocker = null
      const movedAfterMessage = await firstMove
      assert.equal(movedAfterMessage.response.status, 200, JSON.stringify(movedAfterMessage.body))
      assert.deepEqual(movedAfterMessage.body, { data: { session_id: messageFirstId, project_ref: targetProject } })
      assert.deepEqual(await historicalFacts(messageFirstId), beforeMoveFacts, "Move must not rewrite an admitted Run, Message, AG-UI, Share or Artifact")
      assert.ok(
        (await pool.query("SELECT execution_context_retired_at FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenant, admittedRun])).rows[0]
          .execution_context_retired_at,
        "only the explicit retirement fact changes after Move",
      )

      // Move owns source Project FOR UPDATE while target is blocked; the stale
      // Message waits on that source lock and cannot commit into the old Project.
      targetBlocker = await pool.connect()
      await targetBlocker.query("BEGIN")
      await targetBlocker.query("SELECT project_id FROM bff_project WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE", [tenant, targetProject])
      const secondTargetBlockerPid = (await targetBlocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
      const secondMove = sendMove(moveFirstId, `r149-move-first-${suffix}`)
      pending.push(secondMove)
      const [moveBackend] = await blockedPgQueries(pool, secondTargetBlockerPid, /FROM bff_project[\s\S]*FOR UPDATE/u)
      const staleMessage = sendMessage(moveFirstId, `r149-stale-message-${suffix}`, sourceProject)
      pending.push(staleMessage)
      await blockedPgQueries(pool, moveBackend.pid, /FROM bff_project[\s\S]*FOR SHARE/u)
      await targetBlocker.query("COMMIT")
      targetBlocker.release()
      targetBlocker = null
      const movedBeforeMessage = await secondMove
      assert.equal(movedBeforeMessage.response.status, 200, JSON.stringify(movedBeforeMessage.body))
      const rejectedStale = await staleMessage
      assert.equal(rejectedStale.response.status, 404, JSON.stringify(rejectedStale.body))
      assert.equal(rejectedStale.body.error?.code, "session_not_found")
      assert.equal(
        (await pool.query("SELECT count(*)::int AS count FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2", [tenant, moveFirstId]))
          .rows[0].count,
        0,
      )
      assert.equal(
        (await pool.query("SELECT count(*)::int AS count FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2", [tenant, moveFirstId])).rows[0].count,
        0,
      )
      const nextAdmission = await sendMessage(moveFirstId, `r149-next-admission-${suffix}`, targetProject)
      assert.equal(nextAdmission.response.status, 202, JSON.stringify(nextAdmission.body))
      const nextLaunch = await pool.query(
        "SELECT payload,execution_project_ref,execution_context_retired_at FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2 AND run_id=$3",
        [tenant, moveFirstId, nextAdmission.body.data.run_id],
      )
      assert.equal(nextLaunch.rowCount, 1)
      assert.equal(nextLaunch.rows[0].payload.launch.trace.project_ref, targetProject, "next admission must bind the post-Move canonical Project")
      assert.equal(nextLaunch.rows[0].execution_project_ref, targetProject, "the next trusted binding comes from the locked canonical Project, not trace")
      assert.equal(nextLaunch.rows[0].execution_context_retired_at, null)
    } finally {
      if (conversationBlocker !== null) {
        await conversationBlocker.query("ROLLBACK").catch(() => undefined)
        conversationBlocker.release()
      }
      if (targetBlocker !== null) {
        await targetBlocker.query("ROLLBACK").catch(() => undefined)
        targetBlocker.release()
      }
      await Promise.allSettled(pending)
      if (bff !== null) await close(bff)
      if (store !== null) await store.close().catch(() => undefined)
      await pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant]).catch(() => undefined)
      for (const table of [
        "bff_agent_cancellation_outbox",
        "bff_conversation_artifact",
        "bff_share",
        "bff_agui_event",
        "bff_agui_stream",
        "bff_agent_dispatch_outbox",
        "bff_message",
      ]) {
        await pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]).catch(() => undefined)
      }
      await pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]).catch(() => undefined)
      await pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]).catch(() => undefined)
      await pool.end()
    }
  },
)

integrationTest("R149 identical concurrent Move keys read one real PostgreSQL winner and preserve historical facts", { timeout: 15_000 }, async () => {
  const suffix = randomUUID()
  const tenant = `r149_move_same_${suffix}`
  const subject = `move_owner_${suffix}`
  const conversationId = `conv_${randomUUID()}`
  const targetProject = `project_${randomUUID()}`
  const key = `r149-same-${suffix}`
  const scope = JSON.stringify([tenant, subject, "POST", `/sessions/${conversationId}/move`, key])
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  let bff = null
  let blocker = null
  const pending = []
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query("INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$2,$3,'Same-key target',$4)", [
      targetProject,
      tenant,
      subject,
      `same-${suffix}`,
    ])
    await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title) VALUES ($1,$2,$3,NULL,'Same-key Move')", [
      conversationId,
      tenant,
      subject,
    ])
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const existingRun = await store.services.chatTurns.submit({
      tenantId: tenant,
      conversationId,
      subjectId: subject,
      actorId: subject,
      requestId: `r149-run-${suffix}`,
      idempotencyKey: `r149-run-${suffix}`,
      content: "Historical Run survives both same-key requests",
    })
    assert.ok(existingRun)
    await pool.query("INSERT INTO bff_share (share_id,tenant_id,conversation_id,url) VALUES ($1,$2,$3,$4)", [
      `share_${suffix}`,
      tenant,
      conversationId,
      `https://share.kokoro.invalid/${suffix}`,
    ])
    const historical = {}
    for (const table of ["bff_message", "bff_agent_dispatch_outbox", "bff_agui_stream", "bff_agui_event", "bff_share", "bff_agent_cancellation_outbox"]) {
      const idColumn = table === "bff_agui_stream" || table === "bff_agui_event" ? "session_id" : "conversation_id"
      historical[table] = (
        await pool.query(
          `SELECT ${table === "bff_agent_dispatch_outbox" ? "(to_jsonb(fact)-'execution_context_retired_at')" : "row_to_json(fact)"}::text AS value FROM ${table} AS fact WHERE tenant_id=$1 AND ${idColumn}=$2 ORDER BY value`,
          [tenant, conversationId],
        )
      ).rows.map((row) => row.value)
    }
    assert.equal(historical.bff_message.length, 2)
    assert.ok(historical.bff_agui_event.length > 0, "the existing Run must have a durable AG-UI event")
    assert.equal(historical.bff_share.length, 1)
    bff = createBffServer(config(tenant), {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
    })
    const base = await listen(bff)
    const headers = { ...auth(tenant, subject), "idempotency-key": key, "content-type": "application/json" }
    const token = headers.authorization.slice("Bearer ".length)
    const admissionsBefore = sessionAdmission.calls.filter((call) => call.token === token).length
    const sendMove = async () => {
      const response = await fetch(`${base}/v1/sessions/${conversationId}/move`, {
        method: "POST",
        headers,
        body: JSON.stringify({ target_project_id: targetProject }),
        signal: AbortSignal.timeout(8000),
      })
      return { response, body: await response.json() }
    }
    blocker = await pool.connect()
    await blocker.query("BEGIN")
    await blocker.query("SELECT project_id FROM bff_project WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE", [tenant, targetProject])
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
    const first = sendMove()
    const second = sendMove()
    pending.push(first, second)
    const queued = await blockedPgQueriesThroughQueue(pool, blockerPid, /FROM bff_project[\s\S]*FOR UPDATE/u, 2)
    assert.equal(queued.length, 2, "both distinct Move backends must reach the owned Project lock through the real PG wait queue")
    await blocker.query("COMMIT")
    blocker.release()
    blocker = null
    const results = await Promise.all([first, second])
    assert.deepEqual(
      results.map(({ response }) => response.status),
      [200, 200],
    )
    assert.deepEqual(results[0].body, results[1].body)
    assert.deepEqual(results[0].body, { data: { session_id: conversationId, project_ref: targetProject } })
    assert.equal(sessionAdmission.calls.filter((call) => call.token === token).length, admissionsBefore + 2, "both requests need current IAM admission")
    assert.equal(
      (await pool.query("SELECT project_ref FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [tenant, conversationId])).rows[0].project_ref,
      targetProject,
    )
    const receipts = await pool.query("SELECT status,response_body FROM bff_idempotency_receipt WHERE scope=$1", [scope])
    assert.equal(receipts.rowCount, 1, "both responses must resolve through one durable final receipt")
    assert.equal(receipts.rows[0].status, 200)
    assert.deepEqual(receipts.rows[0].response_body, results[0].body)
    const retirement = (
      await pool.query("SELECT execution_project_ref,execution_context_retired_at FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [
        tenant,
        existingRun.run_id,
      ])
    ).rows[0]
    assert.equal(retirement.execution_project_ref, null, "the original direct Run is not rebound to the new Project")
    assert.ok(retirement.execution_context_retired_at, "the concurrent Move winner retires the original binding")
    for (const [table, before] of Object.entries(historical)) {
      const idColumn = table === "bff_agui_stream" || table === "bff_agui_event" ? "session_id" : "conversation_id"
      const after = (
        await pool.query(
          `SELECT ${table === "bff_agent_dispatch_outbox" ? "(to_jsonb(fact)-'execution_context_retired_at')" : "row_to_json(fact)"}::text AS value FROM ${table} AS fact WHERE tenant_id=$1 AND ${idColumn}=$2 ORDER BY value`,
          [tenant, conversationId],
        )
      ).rows.map((row) => row.value)
      assert.deepEqual(after, before, `same-key Move must not rewrite ${table}`)
    }
  } finally {
    if (blocker !== null) {
      await blocker.query("ROLLBACK").catch(() => undefined)
      blocker.release()
    }
    await Promise.allSettled(pending)
    if (bff !== null) await close(bff)
    if (store !== null) await store.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope=$1", [scope]).catch(() => undefined)
    for (const table of ["bff_agent_cancellation_outbox", "bff_share", "bff_agui_event", "bff_agui_stream", "bff_agent_dispatch_outbox", "bff_message"]) {
      await pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]).catch(() => undefined)
    }
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})
integrationTest("R189 Message freezes the locked canonical Project while caller replay identity survives Move", { timeout: 30_000 }, async () => {
  const suffix = randomUUID()
  const tenant = `r189_message_scope_${suffix}`
  const subject = `r189_owner_${suffix}`
  const projectP = `project_${randomUUID()}`
  const projectQ = `project_${randomUUID()}`
  const otherOwnerProject = `project_${randomUUID()}`
  const projectConversation = `conv_${randomUUID()}`
  const directConversation = `conv_${randomUUID()}`
  const replayConversation = `conv_${randomUUID()}`
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  let bff = null
  let testError = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug)
       VALUES ($1,$4,$5,'R189 P',$6),($2,$4,$5,'R189 Q',$7),($3,$4,$8,'R189 other owner',$9)`,
      [projectP, projectQ, otherOwnerProject, tenant, subject, `r189-p-${suffix}`, `r189-q-${suffix}`, `r189-other-${suffix}`, `r189-other-slug-${suffix}`],
    )
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title)
       VALUES ($1,$4,$5,$6,'Project omitted'),($2,$4,$5,NULL,'Direct omitted'),($3,$4,$5,$6,'Explicit replay')`,
      [projectConversation, directConversation, replayConversation, tenant, subject, projectP],
    )

    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const runtimeConfig = config(tenant)
    runtimeConfig.agentEnabled = true
    runtimeConfig.upstreams.agents = "http://127.0.0.1:9"
    bff = createBffServer(runtimeConfig, {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
    })
    const base = await listen(bff)
    const identity = auth(tenant, subject)
    const sendMessage = async (conversationId, key, content, projectRef) => {
      const body = { content, model: "r189-model" }
      if (projectRef !== undefined) body.project_ref = projectRef
      const response = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
        method: "POST",
        headers: { ...identity, "idempotency-key": key, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(9000),
      })
      return { response, body: await response.json() }
    }
    const sendMove = async (conversationId, key, targetProjectId) => {
      const response = await fetch(`${base}/v1/sessions/${conversationId}/move`, {
        method: "POST",
        headers: { ...identity, "idempotency-key": key, "content-type": "application/json" },
        body: JSON.stringify({ target_project_id: targetProjectId }),
        signal: AbortSignal.timeout(9000),
      })
      return { response, body: await response.json() }
    }
    const dispatches = async (conversationId) =>
      (await pool.query(
        `SELECT request_digest,run_id,user_message_id,assistant_message_id,payload
           FROM bff_agent_dispatch_outbox
          WHERE tenant_id=$1 AND conversation_id=$2
          ORDER BY conversation_dispatch_seq`,
        [tenant, conversationId],
      )).rows
    const messageCount = async (conversationId) =>
      (await pool.query("SELECT count(*)::int AS count FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2", [tenant, conversationId])).rows[0]
        .count

    // 1. Existing Project Conversation: omission means locked canonical P, not Direct.
    const firstOmittedKey = `r189-project-omitted-${suffix}`
    const firstOmitted = await sendMessage(projectConversation, firstOmittedKey, "R189 project omitted", undefined)
    assert.equal(firstOmitted.response.status, 202, JSON.stringify(firstOmitted.body))
    const [firstOmittedDispatch] = await dispatches(projectConversation)
    assert.ok(firstOmittedDispatch)
    assert.match(firstOmittedDispatch.request_digest, /^[0-9a-f]{64}$/u)
    assert.equal(firstOmittedDispatch.payload.launch.trace.project_ref, projectP)
    assert.equal(await messageCount(projectConversation), 2)

    // 2. A later new command omitting project_ref binds Q after the Move; the old Run stays P.
    const movedProjectConversation = await sendMove(projectConversation, `r189-project-move-${suffix}`, projectQ)
    assert.equal(movedProjectConversation.response.status, 200, JSON.stringify(movedProjectConversation.body))
    const secondOmitted = await sendMessage(projectConversation, `r189-project-after-move-${suffix}`, "R189 project after move", undefined)
    assert.equal(secondOmitted.response.status, 202, JSON.stringify(secondOmitted.body))
    const omittedDispatches = await dispatches(projectConversation)
    assert.equal(omittedDispatches.length, 2)
    assert.equal(omittedDispatches[0].payload.launch.trace.project_ref, projectP)
    assert.equal(omittedDispatches[1].payload.launch.trace.project_ref, projectQ)
    assert.notEqual(omittedDispatches[0].run_id, omittedDispatches[1].run_id)
    assert.equal(await messageCount(projectConversation), 4)

    // 3. Existing Direct Conversation remains Direct when project_ref is omitted.
    const direct = await sendMessage(directConversation, `r189-direct-${suffix}`, "R189 direct omitted", undefined)
    assert.equal(direct.response.status, 202, JSON.stringify(direct.body))
    const [directDispatch] = await dispatches(directConversation)
    assert.ok(directDispatch)
    assert.equal(Object.hasOwn(directDispatch.payload.launch.trace, "project_ref"), false)
    assert.equal(await messageCount(directConversation), 2)

    const directBeforeRejectedPreconditions = await dispatches(directConversation)
    const [missingProject, hiddenProject] = await Promise.all([
      sendMessage(directConversation, `r189-direct-missing-project-${suffix}`, "R189 direct missing Project", `project_${randomUUID()}`),
      sendMessage(directConversation, `r189-direct-hidden-project-${suffix}`, "R189 direct hidden Project", otherOwnerProject),
    ])
    assert.equal(missingProject.response.status, 404, JSON.stringify(missingProject.body))
    assert.equal(hiddenProject.response.status, 404, JSON.stringify(hiddenProject.body))
    assert.deepEqual(await dispatches(directConversation), directBeforeRejectedPreconditions)
    assert.equal(await messageCount(directConversation), 2)

    // 4. Exact explicit-P replay returns the original command after Move; changed input conflicts.
    const replayKey = `r189-explicit-replay-${suffix}`
    const original = await sendMessage(replayConversation, replayKey, "R189 explicit replay", projectP)
    assert.equal(original.response.status, 202, JSON.stringify(original.body))
    const [originalDispatch] = await dispatches(replayConversation)
    assert.ok(originalDispatch)
    assert.equal(originalDispatch.payload.launch.trace.project_ref, projectP)
    const movedReplayConversation = await sendMove(replayConversation, `r189-replay-move-${suffix}`, projectQ)
    assert.equal(movedReplayConversation.response.status, 200, JSON.stringify(movedReplayConversation.body))

    const exactReplay = await sendMessage(replayConversation, replayKey, "R189 explicit replay", projectP)
    assert.equal(exactReplay.response.status, 202, JSON.stringify(exactReplay.body))
    assert.deepEqual(exactReplay.body.data, original.body.data)
    assert.deepEqual(await dispatches(replayConversation), [originalDispatch])
    assert.equal(await messageCount(replayConversation), 2)

    const changedReplay = await sendMessage(replayConversation, replayKey, "R189 changed body", projectP)
    assert.equal(changedReplay.response.status, 409, JSON.stringify(changedReplay.body))
    assert.equal(changedReplay.body.error?.code, "idempotency_conflict")
    assert.deepEqual(await dispatches(replayConversation), [originalDispatch])
    assert.equal(await messageCount(replayConversation), 2)

    const staleNewKey = await sendMessage(replayConversation, `r189-stale-new-${suffix}`, "R189 stale new key", projectP)
    assert.equal(staleNewKey.response.status, 404, JSON.stringify(staleNewKey.body))
    assert.deepEqual(await dispatches(replayConversation), [originalDispatch])
    assert.equal(await messageCount(replayConversation), 2)
  } catch (error) {
    testError = error
  } finally {
    const cleanupErrors = []
    const cleanup = async (operation) => { try { await operation() } catch (error) { cleanupErrors.push(error) } }
    if (bff !== null) await cleanup(() => close(bff))
    if (store !== null) await cleanup(() => store.close())
    await cleanup(() => pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant]))
    for (const table of [
      "bff_agent_cancellation_outbox",
      "bff_share",
      "bff_agui_event",
      "bff_agui_stream",
      "bff_agent_dispatch_outbox",
      "bff_message",
    ]) {
      await cleanup(() => pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]))
    }
    await cleanup(() => pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.end())
    if (testError !== null || cleanupErrors.length > 0) {
      throw new AggregateError(testError === null ? cleanupErrors : [testError, ...cleanupErrors], "R189 Message scope case or cleanup failed", {
        cause: testError ?? cleanupErrors[0],
      })
    }
  }
})

integrationTest("R190 omitted Message scope serializes with Move and client-created admission", { timeout: 45_000 }, async () => {
  const suffix = randomUUID().replaceAll("-", "")
  const tenant = `r190_scope_${suffix}`
  const subject = `r190_owner_${suffix}`
  const projectP = `project_${randomUUID()}`
  const projectQ = `project_${randomUUID()}`
  const moveFirstConversation = `conv_${randomUUID()}`
  const messageFirstConversation = `conv_${randomUUID()}`
  const clientCreatedConversation = `conv_${randomUUID()}`
  const triggerName = `r190_client_barrier_${suffix}`
  const triggerFunction = `r190_client_barrier_fn_${suffix}`
  const advisoryKey = `r190-client-${suffix}`
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  let bff = null
  let conversationBlocker = null
  let advisoryBlocker = null
  let advisoryHeld = false
  let testError = null
  const pending = []
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug)
       VALUES ($1,$3,$4,'R190 P',$5),($2,$3,$4,'R190 Q',$6)`,
      [projectP, projectQ, tenant, subject, `r190-p-${suffix}`, `r190-q-${suffix}`],
    )
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title)
       VALUES ($1,$3,$4,$5,'Move first'),($2,$3,$4,$5,'Message first')`,
      [moveFirstConversation, messageFirstConversation, tenant, subject, projectP],
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const runtimeConfig = config(tenant)
    runtimeConfig.agentEnabled = true
    runtimeConfig.upstreams.agents = "http://127.0.0.1:9"
    bff = createBffServer(runtimeConfig, {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: idleWorker,
      agentCancellationDispatcher: idleWorker,
      agUiProjector: idleWorker,
      scheduledTaskDispatcher: idleWorker,
    })
    const base = await listen(bff)
    const identity = auth(tenant, subject)
    const sendMessage = async (conversationId, key, content) => {
      const response = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
        method: "POST",
        headers: { ...identity, "idempotency-key": key, "content-type": "application/json" },
        body: JSON.stringify({ selected_skill_source_refs: [], content }),
        signal: AbortSignal.timeout(12_000),
      })
      return { response, body: await response.json() }
    }
    const sendMove = async (conversationId, key) => {
      const response = await fetch(`${base}/v1/sessions/${conversationId}/move`, {
        method: "POST",
        headers: { ...identity, "idempotency-key": key, "content-type": "application/json" },
        body: JSON.stringify({ target_project_id: projectQ }),
        signal: AbortSignal.timeout(12_000),
      })
      return { response, body: await response.json() }
    }
    const facts = async (conversationId) => ({
      conversation: (await pool.query("SELECT project_ref FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [tenant, conversationId])).rows[0],
      dispatches: (await pool.query(
        `SELECT request_digest,run_id,user_message_id,assistant_message_id,payload
           FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2
          ORDER BY conversation_dispatch_seq`,
        [tenant, conversationId],
      )).rows,
      messages: (await pool.query(
        "SELECT message_id,run_id,role,content,status,message_seq FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY message_seq",
        [tenant, conversationId],
      )).rows,
    })

    // Move owns P/Q before Conversation. Message observes old P without a lock,
    // waits on P SHARE, then must roll the whole attempt back and resolve Q.
    conversationBlocker = await pool.connect()
    await conversationBlocker.query("BEGIN")
    await conversationBlocker.query("SELECT conversation_id FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2 FOR UPDATE", [
      tenant,
      moveFirstConversation,
    ])
    const firstConversationBlockerPid = (await conversationBlocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
    const moveFirst = sendMove(moveFirstConversation, `r190-move-first-${suffix}`)
    pending.push(moveFirst)
    const [moveBackend] = await blockedPgQueries(pool, firstConversationBlockerPid, /FROM bff_conversation[\s\S]*FOR UPDATE/u)
    const moveFirstMessageKey = `r190-message-after-preread-${suffix}`
    const messageAfterPreRead = sendMessage(moveFirstConversation, moveFirstMessageKey, "R190 freezes Q")
    pending.push(messageAfterPreRead)
    await blockedPgQueries(pool, moveBackend.pid, /FROM bff_project[\s\S]*FOR SHARE/u)
    await conversationBlocker.query("COMMIT")
    conversationBlocker.release()
    conversationBlocker = null
    const [movedFirst, admittedQ] = await Promise.all([moveFirst, messageAfterPreRead])
    assert.equal(movedFirst.response.status, 200, JSON.stringify(movedFirst.body))
    assert.equal(admittedQ.response.status, 202, JSON.stringify(admittedQ.body))
    const moveFirstFacts = await facts(moveFirstConversation)
    assert.equal(moveFirstFacts.conversation.project_ref, projectQ)
    assert.equal(moveFirstFacts.dispatches.length, 1)
    assert.equal(moveFirstFacts.messages.length, 2)
    assert.equal(moveFirstFacts.dispatches[0].payload.launch.trace.project_ref, projectQ)
    const replayQ = await sendMessage(moveFirstConversation, moveFirstMessageKey, "R190 freezes Q")
    assert.equal(replayQ.response.status, 202, JSON.stringify(replayQ.body))
    assert.deepEqual(replayQ.body.data, admittedQ.body.data)
    assert.deepEqual(await facts(moveFirstConversation), moveFirstFacts)

    // Message owns P SHARE and waits for Conversation; Move must wait for P.
    // The admitted Run freezes P, while a later new key sees Q.
    conversationBlocker = await pool.connect()
    await conversationBlocker.query("BEGIN")
    await conversationBlocker.query("SELECT conversation_id FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2 FOR UPDATE", [
      tenant,
      messageFirstConversation,
    ])
    const secondConversationBlockerPid = (await conversationBlocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
    const messageFirst = sendMessage(messageFirstConversation, `r190-message-first-${suffix}`, "R190 freezes P")
    pending.push(messageFirst)
    const [messageBackend] = await blockedPgQueries(pool, secondConversationBlockerPid, /FROM bff_conversation[\s\S]*FOR UPDATE/u)
    const moveAfterMessage = sendMove(messageFirstConversation, `r190-move-after-message-${suffix}`)
    pending.push(moveAfterMessage)
    await blockedPgQueries(pool, messageBackend.pid, /FROM bff_project[\s\S]*FOR UPDATE/u)
    await conversationBlocker.query("COMMIT")
    conversationBlocker.release()
    conversationBlocker = null
    const admittedP = await messageFirst
    assert.equal(admittedP.response.status, 202, JSON.stringify(admittedP.body))
    const movedAfterMessage = await moveAfterMessage
    assert.equal(movedAfterMessage.response.status, 200, JSON.stringify(movedAfterMessage.body))
    const afterMessageMove = await facts(messageFirstConversation)
    assert.equal(afterMessageMove.conversation.project_ref, projectQ)
    assert.equal(afterMessageMove.dispatches.length, 1)
    assert.equal(afterMessageMove.dispatches[0].payload.launch.trace.project_ref, projectP)
    const admittedAfterMove = await sendMessage(messageFirstConversation, `r190-message-new-q-${suffix}`, "R190 new Q")
    assert.equal(admittedAfterMove.response.status, 202, JSON.stringify(admittedAfterMove.body))
    const finalMessageFirstFacts = await facts(messageFirstConversation)
    assert.equal(finalMessageFirstFacts.dispatches.length, 2)
    assert.equal(finalMessageFirstFacts.dispatches[0].payload.launch.trace.project_ref, projectP)
    assert.equal(finalMessageFirstFacts.dispatches[1].payload.launch.trace.project_ref, projectQ)

    // Two HTTP backends race the same first-message identity. The second insert
    // waits on the real unique-key owner and then replays exactly one durable Run.
    await pool.query(
      `CREATE FUNCTION ${triggerFunction}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.tenant_id=TG_ARGV[0] AND NEW.conversation_id=TG_ARGV[1] THEN
           PERFORM pg_advisory_xact_lock(hashtext(TG_ARGV[2]));
         END IF;
         RETURN NEW;
       END; $$`,
    )
    await pool.query(
      `CREATE TRIGGER ${triggerName} AFTER INSERT ON bff_conversation FOR EACH ROW
       EXECUTE FUNCTION ${triggerFunction}('${tenant}','${clientCreatedConversation}','${advisoryKey}')`,
    )
    advisoryBlocker = await pool.connect()
    await advisoryBlocker.query("SELECT pg_advisory_lock(hashtext($1))", [advisoryKey])
    advisoryHeld = true
    const clientKey = `r190-client-same-${suffix}`
    const firstClient = sendMessage(clientCreatedConversation, clientKey, "R190 one client identity")
    pending.push(firstClient)
    const advisoryPid = (await advisoryBlocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
    await blockedPgQueries(pool, advisoryPid, /INSERT INTO bff_conversation/u)
    const secondClient = sendMessage(clientCreatedConversation, clientKey, "R190 one client identity")
    pending.push(secondClient)
    await blockedPgQueriesThroughQueue(pool, advisoryPid, /INSERT INTO bff_conversation/u, 2)
    await advisoryBlocker.query("SELECT pg_advisory_unlock(hashtext($1))", [advisoryKey])
    advisoryHeld = false
    advisoryBlocker.release()
    advisoryBlocker = null
    const clientResults = await Promise.all([firstClient, secondClient])
    assert.deepEqual(clientResults.map(({ response }) => response.status), [202, 202])
    assert.deepEqual(clientResults[0].body.data, clientResults[1].body.data)
    const clientFacts = await facts(clientCreatedConversation)
    assert.equal(clientFacts.conversation.project_ref, null)
    assert.equal(clientFacts.dispatches.length, 1)
    assert.equal(clientFacts.messages.length, 2)
    assert.equal(Object.hasOwn(clientFacts.dispatches[0].payload.launch.trace, "project_ref"), false)
  } catch (error) {
    testError = error
  } finally {
    const cleanupErrors = []
    const cleanup = async (operation) => { try { await operation() } catch (error) { cleanupErrors.push(error) } }
    if (conversationBlocker !== null) {
      await cleanup(() => conversationBlocker.query("ROLLBACK"))
      conversationBlocker.release()
    }
    if (advisoryBlocker !== null) {
      if (advisoryHeld) await cleanup(() => advisoryBlocker.query("SELECT pg_advisory_unlock(hashtext($1))", [advisoryKey]))
      advisoryBlocker.release()
    }
    const settled = await Promise.allSettled(pending)
    cleanupErrors.push(...settled.filter(({ status, reason }) => status === "rejected" && reason !== testError).map(({ reason }) => reason))
    if (bff !== null) await cleanup(() => close(bff))
    if (store !== null) await cleanup(() => store.close())
    await cleanup(() => pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON bff_conversation`))
    await cleanup(() => pool.query(`DROP FUNCTION IF EXISTS ${triggerFunction}()`))
    await cleanup(() => pool.query("DELETE FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [tenant]))
    for (const table of ["bff_agent_cancellation_outbox", "bff_share", "bff_agui_event", "bff_agui_stream", "bff_agent_dispatch_outbox", "bff_message"]) {
      await cleanup(() => pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]))
    }
    await cleanup(() => pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.query("DELETE FROM bff_project WHERE tenant_id=$1", [tenant]))
    await cleanup(() => pool.end())
    if (testError !== null || cleanupErrors.length > 0) {
      throw new AggregateError(testError === null ? cleanupErrors : [testError, ...cleanupErrors], "R190 Message scope race or cleanup failed", {
        cause: testError ?? cleanupErrors[0],
      })
    }
  }
})

integrationTest("project Skill defaults freeze exact message refs, reject concurrent changes and do not replay tombstones", { timeout: 20000 }, async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const store = new PostgresBffRepositories(postgresUrl, redisUrl)
  const tenant = `selection_${randomUUID()}`,
    subject = "selection-owner",
    scope = { tenantId: tenant, subjectId: subject },
    signal = new AbortController().signal
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    const project = await store.services.projects.create(scope, "Selection test", "")
    const other = await store.services.projects.create(scope, "Other project", "")
    const save = (ids, key) => store.services.projects.replaceSkillSelection(scope, project.id, ids, key, signal)
    assert.equal((await save(["installation_a"], "first-default")).kind, "replaced")
    assert.equal((await save(["installation_b"], "second-default")).kind, "replaced")
    assert.deepEqual((await save(["installation_a"], "first-default")).receipt.data.installation_ids, ["installation_a"])
    assert.deepEqual((await store.services.projects.skillSelection(scope, project.id)).installation_ids, ["installation_b"])
    assert.equal((await save(["installation_c"], "first-default")).kind, "conflict")
    assert.equal(await store.services.projects.skillSelection({ ...scope, subjectId: "other-owner" }, project.id), null)
    const fault = `selection_fault_${randomUUID().replaceAll("-", "")}`
    const faultScope = JSON.stringify([tenant, subject, "project.skill-selection:v1", project.id, "rollback-default"])
    await pool.query(`CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.scope = '${faultScope.replaceAll("'", "''")}' THEN RAISE EXCEPTION 'selection_receipt_failure'; END IF;
      RETURN NEW; END $$`)
    try {
      await pool.query(`CREATE TRIGGER ${fault} BEFORE INSERT ON bff_idempotency_receipt FOR EACH ROW EXECUTE FUNCTION ${fault}()`)
      await assert.rejects(save(["installation_failed"], "rollback-default"), /selection_receipt_failure/)
      assert.deepEqual((await store.services.projects.skillSelection(scope, project.id)).installation_ids, ["installation_b"])
      assert.equal((await pool.query("SELECT 1 FROM bff_idempotency_receipt WHERE scope=$1", [faultScope])).rowCount, 0)
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fault} ON bff_idempotency_receipt`)
      await pool.query(`DROP FUNCTION ${fault}()`)
    }
    const input = {
      tenantId: tenant,
      subjectId: subject,
      actorId: subject,
      conversationId: `conv_${randomUUID()}`,
      projectRef: project.id,
      requestId: "selection-turn",
      idempotencyKey: "turn",
      content: "hello",
    }
    let resolutions = 0
    const resolver = async (id, ids) => {
      resolutions++
      assert.equal(id, project.id)
      assert.deepEqual(ids, ["installation_b"])
      return ["skill:version_b"]
    }
    const receipt = await store.services.chatTurns.submit(input, resolver)
    assert.ok(receipt)
    const frozen = await pool.query("SELECT selected_skill_source_refs FROM bff_message WHERE message_id=$1", [receipt.user_message_id])
    assert.deepEqual(frozen.rows[0].selected_skill_source_refs, ["skill:version_b"])
    const dispatched = await pool.query("SELECT payload FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2", [
      tenant,
      input.conversationId,
    ])
    assert.deepEqual(dispatched.rows[0].payload.launch.selected_skill_source_refs, ["skill:version_b"])
    await save(["installation_c"], "changed-default")
    assert.deepEqual(
      await store.services.chatTurns.submit(input, async () => {
        throw Error("replay must not resolve current defaults")
      }),
      receipt,
    )
    assert.equal(resolutions, 1)
    await assert.rejects(store.services.chatTurns.submit({ ...input, selectedSkillSourceRefs: [] }), /CHAT_TURN_IDEMPOTENCY_CONFLICT/)
    const empty = await store.services.chatTurns.submit({ ...input, idempotencyKey: "explicit-empty", selectedSkillSourceRefs: [] }, async () => {
      throw Error("explicit empty must not inherit")
    })
    assert.deepEqual(
      (await pool.query("SELECT selected_skill_source_refs FROM bff_message WHERE message_id=$1", [empty.user_message_id])).rows[0].selected_skill_source_refs,
      [],
    )
    const raced = { ...input, conversationId: `conv_${randomUUID()}`, idempotencyKey: "defaults-race" }
    await assert.rejects(
      store.services.chatTurns.submit(raced, async () => {
        await save([], "clear-during-resolve")
        return ["skill:version_c"]
      }),
      /CHAT_SKILL_SELECTION_CHANGED/,
    )
    assert.equal((await pool.query("SELECT 1 FROM bff_conversation WHERE conversation_id=$1", [raced.conversationId])).rowCount, 0)
    await save(["installation_m"], "move-default")
    const movedId = `conv_${randomUUID()}`
    await pool.query("INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,project_ref,title,status) VALUES($1,$2,$3,$4,'move-race','active')", [
      movedId,
      tenant,
      subject,
      project.id,
    ])
    await assert.rejects(
      store.services.chatTurns.submit({ ...input, conversationId: movedId, idempotencyKey: "move-race" }, async () => {
        const moved = await store.services.chat.moveConversation(
          { requestId: "selection-move", identity: { namespace: tenant, userId: subject } },
          movedId,
          other.id,
          "move-key",
          signal,
        )
        assert.equal(moved.kind, "moved")
        return ["skill:version_m"]
      }),
      /CHAT_SKILL_SELECTION_CHANGED/,
    )
    assert.equal((await pool.query("SELECT 1 FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2", [tenant, movedId])).rowCount, 0)
    assert.equal(await store.services.chat.deleteConversation(tenant, subject, input.conversationId, "delete-selection", project.id), true)
    const before = (await pool.query("SELECT count(*)::int AS n FROM bff_message WHERE tenant_id=$1", [tenant])).rows[0].n
    assert.equal(
      await store.services.chatTurns.submit(input, async () => {
        throw Error("deleted conversation must not resolve")
      }),
      null,
    )
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM bff_message WHERE tenant_id=$1", [tenant])).rows[0].n, before)
  } finally {
    await store.close()
    await pool.end()
  }
})
