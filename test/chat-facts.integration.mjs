import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { test } from "node:test"

import { Pool } from "pg"
import { createClient } from "redis"

import { createBffServer } from "../dist/main.js"
import { PostgresBffRepositories } from "../dist/infrastructure/postgres/repositories.js"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const redisUrl = process.env.KOKORO_TEST_REDIS_URL
const integrationTest = postgresUrl && redisUrl ? test : test.skip

function auth(namespace, principal = "chat_integration_user") {
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "web-secret",
    "x-kokoro-namespace": namespace,
    "x-kokoro-principal-id": principal,
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

function config() {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant_test",
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

integrationTest("serves tenant-scoped Chat facts from BFF PostgreSQL and revokes expired shares before replacement", async () => {
  const pool = new Pool({ connectionString: postgresUrl })
  const redis = createClient({ url: redisUrl })
  const tenant = `chat_facts_${Date.now()}`
  const otherTenant = `${tenant}_other`
  const conversationId = `conversation_${Date.now()}`
  let bff
  try {
    await pool.query("DROP TABLE IF EXISTS bff_share, bff_message, bff_conversation")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ($1, $2, $3, $4)`,
      [conversationId, tenant, "chat_user", "Canonical Chat facts"],
    )
    await pool.query(
      `INSERT INTO bff_message (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq)
       VALUES ($1, $2, $3, $4, 'user', $5, 'completed', 1)`,
      [`message_${Date.now()}`, tenant, conversationId, "run_opaque", "Persisted in BFF"],
    )
    await redis.connect()
    bff = createBffServer(config())
    const base = await listen(bff)

    const listed = await fetch(`${base}/v1/sessions`, { headers: auth(tenant) })
    assert.equal(listed.status, 200)
    assert.equal((await listed.json()).data.sessions[0].session_id, conversationId)

    const otherRead = await fetch(`${base}/v1/sessions/${conversationId}`, { headers: auth(otherTenant) })
    assert.equal(otherRead.status, 404)
    assert.equal((await otherRead.json()).error.code, "session_not_found")

    const messages = await fetch(`${base}/v1/sessions/${conversationId}/messages`, { headers: auth(tenant) })
    assert.equal(messages.status, 200)
    assert.equal((await messages.json()).data.messages[0].content, "Persisted in BFF")

    const shared = await fetch(`${base}/v1/sessions/${conversationId}/share`, {
      method: "POST",
      headers: { ...auth(tenant), "idempotency-key": "chat-share-integration" },
    })
    assert.equal(shared.status, 200)
    const shareId = (await shared.json()).data.share_id

    const publicShare = await fetch(`${base}/v1/shared/${shareId}`, {
      headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "web-secret" },
    })
    assert.equal(publicShare.status, 200)
    assert.equal((await publicShare.json()).data.session.session_id, conversationId)

    await pool.query(
      `UPDATE bff_share
          SET created_at = CURRENT_TIMESTAMP(3) - INTERVAL '2 seconds',
              expires_at = CURRENT_TIMESTAMP(3) - INTERVAL '1 second'
        WHERE share_id = $1`,
      [shareId],
    )
    const replacement = await fetch(`${base}/v1/sessions/${conversationId}/share`, {
      method: "POST",
      headers: { ...auth(tenant), "idempotency-key": "chat-share-replacement-integration" },
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
    assert.equal(crossTenantTitle.status, 404)

    const revoked = await fetch(`${base}/v1/sessions/${conversationId}/share`, {
      method: "DELETE",
      headers: { ...auth(tenant), "idempotency-key": "chat-revoke-integration" },
    })
    assert.equal(revoked.status, 200)
    const afterRevoke = await fetch(`${base}/v1/shared/${shareId}`, {
      headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "web-secret" },
    })
    assert.equal(afterRevoke.status, 404)
  } finally {
    if (bff) await close(bff)
    await pool.query("DELETE FROM bff_share WHERE tenant_id IN ($1, $2)", [tenant, otherTenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_message WHERE tenant_id IN ($1, $2)", [tenant, otherTenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id IN ($1, $2)", [tenant, otherTenant]).catch(() => undefined)
    await redis.quit().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("accepts a Chat turn after the message and Agent dispatch are durably committed", async () => {
  const pool = new Pool({ connectionString: postgresUrl })
  const tenant = `chat_dispatch_${Date.now()}`
  const conversationId = `conversation_dispatch_${Date.now()}`
  let bff
  let agent
  let agentAvailable = false
  let launchAttempts = 0
  try {
    await pool.query("DROP TABLE IF EXISTS bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_agui_stream, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE")
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
      launchAttempts += 1
      if (!agentAvailable) {
        response.writeHead(503, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: { code: "agent_unavailable", message: "retry" }, meta: { request_id: "agent" } }))
        return
      }
      response.writeHead(202, { "content-type": "application/json" })
      response.end(JSON.stringify({
        data: { run_id: launch.run_id, session_id: launch.session_id, replayed: false },
        meta: { request_id: "agent" },
      }))
    })
    const agentBase = await listen(agent)
    const runtimeConfig = config()
    runtimeConfig.agentEnabled = true
    runtimeConfig.upstreams.agents = agentBase
    bff = createBffServer(runtimeConfig)
    const base = await listen(bff)

    const submitted = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
      method: "POST",
      headers: { ...auth(tenant, "chat_user"), "content-type": "application/json", "idempotency-key": "durable-chat-turn" },
      body: JSON.stringify({ content: "Persist before dispatch" }),
    })

    assert.equal(submitted.status, 202)
    const submittedEnvelope = await submitted.json()
    const receipt = submittedEnvelope.data

    const replay = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
      method: "POST",
      headers: { ...auth(tenant, "chat_user"), "content-type": "application/json", "idempotency-key": "durable-chat-turn" },
      body: JSON.stringify({ content: "Persist before dispatch" }),
    })
    assert.equal(replay.status, 202)
    assert.deepEqual(await replay.json(), submittedEnvelope)

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
      `SELECT run_id, user_message_id, assistant_message_id, status, attempt_count
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
    bff = createBffServer(runtimeConfig)
    await listen(bff)
    const succeeded = await waitFor(async () => {
      const result = await pool.query(
        `SELECT status, attempt_count, completed_at
           FROM bff_agent_dispatch_outbox
          WHERE tenant_id = $1 AND conversation_id = $2`,
        [tenant, conversationId],
      )
      return result.rows[0]?.status === "succeeded" ? result.rows[0] : null
    })
    assert.ok(succeeded.attempt_count >= 2)
    assert.ok(succeeded.completed_at)
    assert.ok(launchAttempts >= 2)
  } finally {
    if (bff) await close(bff)
    if (agent) await close(agent)
    await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_stream WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_message WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("reclaims expired Agent dispatch leases and rejects stale or cross-tenant settlement", async () => {
  const pool = new Pool({ connectionString: postgresUrl })
  const tenant = `chat_fence_${Date.now()}`
  const conversationId = `conversation_fence_${Date.now()}`
  let store
  try {
    await pool.query("DROP TABLE IF EXISTS bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_agui_stream, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE")
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
    })
    assert.equal(first.length, 1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_b",
      limit: 1,
      leaseDurationMs: 5000,
    })
    assert.equal(second.length, 1)
    assert.equal(second[0].fence, first[0].fence + 1)

    assert.equal(await store.agentDispatchOutbox.markAgentDispatchSucceeded({
      tenantId: `${tenant}_other`,
      outboxId: second[0].outboxId,
      leaseOwner: second[0].leaseOwner,
      leaseToken: second[0].leaseToken,
      fence: second[0].fence,
    }), false)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchSucceeded({
      tenantId: first[0].tenantId,
      outboxId: first[0].outboxId,
      leaseOwner: first[0].leaseOwner,
      leaseToken: first[0].leaseToken,
      fence: first[0].fence,
    }), false)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchSucceeded({
      tenantId: second[0].tenantId,
      outboxId: second[0].outboxId,
      leaseOwner: second[0].leaseOwner,
      leaseToken: second[0].leaseToken,
      fence: second[0].fence,
    }), true)

    const state = await pool.query(
      `SELECT status, attempt_count, fence
         FROM bff_agent_dispatch_outbox
        WHERE tenant_id = $1 AND conversation_id = $2`,
      [tenant, conversationId],
    )
    assert.deepEqual(state.rows, [{ status: "succeeded", attempt_count: 2, fence: "2" }])
  } finally {
    if (store) await store.close()
    await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_stream WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_message WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})
