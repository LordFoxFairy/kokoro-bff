import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
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
    assert.equal(persistedSelection.rows[0].payload.schema_version, 2)
    assert.deepEqual(persistedSelection.rows[0].payload.launch.selected_skill_source_refs, selectedBody.selected_skill_source_refs)
    const explicitEmptyReplay = await send("first-turn", titleSource, conversationId, { selected_skill_source_refs: [] })
    assert.equal(explicitEmptyReplay.status, 202)
    assert.deepEqual((await explicitEmptyReplay.json()).data, receipt)

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
          schema_version: 2,
          launch: {
            request_id: "rollback-request",
            run_id: rollbackRunId,
            session_id: rollbackId,
            feature_key: "chat",
            message_id: receipt.user_message_id,
            content: "Rollback this first turn",
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
    })
    assert.ok(admittedRun)
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
        rows[table] = result.rows.map((row) => row.value)
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

    const convergedSlug = await sendMove(slugId, "r146-move-slug", projectA)
    assert.equal(convergedSlug.response.status, 200, JSON.stringify(convergedSlug.body))
    assert.equal(await projectRef(slugId), projectA, "a touched legacy slug converges to canonical Project ID")
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
    } finally {
      restoreFaultObserver()
      if (bff !== null) await close(bff)
      if (store !== null) await store.close().catch(() => undefined)
      await pool.query(`DROP TRIGGER IF EXISTS ${fixtureName} ON bff_idempotency_receipt`).catch(() => undefined)
      await pool.query(`DROP FUNCTION IF EXISTS ${fixtureName}()`).catch(() => undefined)
      await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope=$1", [scope]).catch(() => undefined)
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
          body: JSON.stringify({ content: `R149 ${key}`, project_ref: projectRef }),
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
          const rows = await pool.query(`SELECT row_to_json(fact)::text AS value FROM ${table} AS fact WHERE tenant_id=$1 AND ${idColumn}=$2 ORDER BY value`, [
            tenant,
            conversationId,
          ])
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
      const launchBeforeMove = await pool.query("SELECT payload FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2 AND run_id=$3", [
        tenant,
        messageFirstId,
        admittedRun,
      ])
      assert.equal(launchBeforeMove.rowCount, 1)
      assert.equal(launchBeforeMove.rows[0].payload.launch.trace.project_ref, sourceProject)
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
      const nextLaunch = await pool.query("SELECT payload FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2 AND run_id=$3", [
        tenant,
        moveFirstId,
        nextAdmission.body.data.run_id,
      ])
      assert.equal(nextLaunch.rowCount, 1)
      assert.equal(nextLaunch.rows[0].payload.launch.trace.project_ref, targetProject, "next admission must bind the post-Move canonical Project")
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
        await pool.query(`SELECT row_to_json(fact)::text AS value FROM ${table} AS fact WHERE tenant_id=$1 AND ${idColumn}=$2 ORDER BY value`, [
          tenant,
          conversationId,
        ])
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
    for (const [table, before] of Object.entries(historical)) {
      const idColumn = table === "bff_agui_stream" || table === "bff_agui_event" ? "session_id" : "conversation_id"
      const after = (
        await pool.query(`SELECT row_to_json(fact)::text AS value FROM ${table} AS fact WHERE tenant_id=$1 AND ${idColumn}=$2 ORDER BY value`, [
          tenant,
          conversationId,
        ])
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
