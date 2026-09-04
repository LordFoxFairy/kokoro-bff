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
    await pool.query("DROP TABLE IF EXISTS bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ($1, $2, $3, $4)`,
      [conversationId, tenant, "chat_user", "Canonical Chat facts"],
    )
    await pool.query(
      `INSERT INTO bff_message (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq)
       VALUES ($1, $2, $3, $4, 'user', $5, 'completed', $6)`,
      [`message_${Date.now()}`, tenant, conversationId, "run_opaque", "Persisted in BFF", "9223372036854775806"],
    )
    await pool.query(
      `INSERT INTO bff_message (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq)
       VALUES ($1, $2, $3, $4, 'assistant', $5, 'completed', $6)`,
      [`message_${Date.now()}_second`, tenant, conversationId, "run_opaque", "Second high sequence", "9223372036854775807"],
    )
    await redis.connect()
    bff = createBffServer(config())
    const base = await listen(bff)

    const listed = await fetch(`${base}/v1/sessions`, { headers: auth(tenant, "chat_user") })
    assert.equal(listed.status, 200)
    assert.equal((await listed.json()).data.sessions[0].session_id, conversationId)

    const otherRead = await fetch(`${base}/v1/sessions/${conversationId}`, { headers: auth(otherTenant) })
    assert.equal(otherRead.status, 404)
    assert.equal((await otherRead.json()).error.code, "session_not_found")

    const messages = await fetch(`${base}/v1/sessions/${conversationId}/messages`, { headers: auth(tenant, "chat_user") })
    assert.equal(messages.status, 200)
    assert.equal((await messages.json()).data.messages[0].content, "Persisted in BFF")

    const firstMessagePage = await fetch(`${base}/v1/sessions/${conversationId}/messages?limit=1`, { headers: auth(tenant, "chat_user") })
    const firstMessagePageBody = await firstMessagePage.json()
    assert.equal(firstMessagePageBody.data.messages[0].content, "Persisted in BFF")
    const secondMessagePage = await fetch(
      `${base}/v1/sessions/${conversationId}/messages?limit=1&cursor=${encodeURIComponent(firstMessagePageBody.data.next_cursor)}`,
      { headers: auth(tenant, "chat_user") },
    )
    const secondMessagePageBody = await secondMessagePage.json()
    assert.equal(secondMessagePageBody.data.messages[0].content, "Second high sequence")
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
    assert.equal((await publicShare.json()).data.session.session_id, conversationId)

    const otherSubject = "other_chat_user"
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
    ]
    assert.deepEqual((await ownerMatrix[0].json()).data.sessions, [])
    for (const response of ownerMatrix.slice(1)) assert.equal(response.status, 404)

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
    assert.equal(queryDrift.status, 409)

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
    assert.equal(crossTenantTitle.status, 404)

    const revoked = await fetch(`${base}/v1/sessions/${conversationId}/share`, {
      method: "DELETE",
      headers: { ...auth(tenant, "chat_user"), "idempotency-key": "chat-revoke-integration" },
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
    await pool.query("DROP TABLE IF EXISTS bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE")
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

    const invalidBodies = [
      { content: "hello", extra: true },
      { content: "hello", model: " " },
      { content: "hello", pinned_skills: ["valid", 7] },
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
      headers: { ...auth(tenant, "chat_user"), "content-type": "application/json", "idempotency-key": "durable-chat-turn", "x-kokoro-request-id": "request-first" },
      body: JSON.stringify({ content: "Persist before dispatch" }),
    })

    assert.equal(submitted.status, 202)
    const submittedEnvelope = await submitted.json()
    const receipt = submittedEnvelope.data

    const replay = await fetch(`${base}/v1/sessions/${conversationId}/messages`, {
      method: "POST",
      headers: { ...auth(tenant, "chat_user"), "content-type": "application/json", "idempotency-key": "durable-chat-turn", "x-kokoro-request-id": "request-replay" },
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
    await pool.query("DROP TABLE IF EXISTS bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE")
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

integrationTest("claims Agent launches in persisted conversation FIFO and terminalizes exhausted heads before claim", async () => {
  const pool = new Pool({ connectionString: postgresUrl })
  const tenant = `chat_fifo_${Date.now()}`
  const conversationId = `conversation_fifo_${Date.now()}`
  let store
  try {
    await pool.query("DROP TABLE IF EXISTS bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ($1, $2, $3, $4)`,
      [conversationId, tenant, "chat_user", "Strict dispatch FIFO"],
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    for (const suffix of ["first", "second", "third"]) {
      assert.ok(await store.services.chatTurns.submit({
        tenantId: tenant,
        conversationId,
        subjectId: "chat_user",
        actorId: "chat_user",
        requestId: `request_${suffix}`,
        idempotencyKey: `chat-fifo-${suffix}`,
        content: `Dispatch ${suffix}`,
      }))
    }

    const first = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_fifo",
      limit: 10,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(first.length, 1)
    assert.equal(first[0].conversationDispatchSeq, "1")
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchSucceeded(first[0]), true)

    await pool.query(
      `UPDATE bff_agent_dispatch_outbox
          SET status = 'retryable', attempt_count = 8,
              available_at = CURRENT_TIMESTAMP(3) - INTERVAL '1 second'
        WHERE tenant_id = $1 AND conversation_id = $2 AND conversation_dispatch_seq = 3`,
      [tenant, conversationId],
    )
    const afterExhaustion = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_fifo",
      limit: 10,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(afterExhaustion.length, 1)
    assert.equal(afterExhaustion[0].conversationDispatchSeq, "5")

    const rows = await pool.query(
      `SELECT conversation_dispatch_seq, status, attempt_count, last_error_code
         FROM bff_agent_dispatch_outbox
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY conversation_dispatch_seq ASC`,
      [tenant, conversationId],
    )
    assert.deepEqual(rows.rows, [
      { conversation_dispatch_seq: "1", status: "succeeded", attempt_count: 1, last_error_code: null },
      { conversation_dispatch_seq: "3", status: "failed", attempt_count: 8, last_error_code: "agent_dispatch_attempts_exhausted" },
      { conversation_dispatch_seq: "5", status: "leased", attempt_count: 1, last_error_code: null },
    ])
    const failedAssistant = await pool.query(
      `SELECT status
         FROM bff_message
        WHERE tenant_id = $1 AND conversation_id = $2 AND message_seq = 4`,
      [tenant, conversationId],
    )
    assert.equal(failedAssistant.rows[0].status, "failed")
  } finally {
    if (store) await store.close()
    await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_stream WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_message WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("projects fenced dispatch failures as durable RUN_ERROR terminals", async () => {
  const pool = new Pool({ connectionString: postgresUrl })
  const tenant = `chat_failure_${Date.now()}`
  const conversationId = `conversation_failure_${Date.now()}`
  let store
  let bff
  let agent
  let agentRequests = 0
  try {
    await pool.query("DROP TABLE IF EXISTS bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE")
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

    assert.equal(await store.agentDispatchOutbox.markAgentDispatchFailed(first, "agent_receipt_invalid"), true)
    let stream = await pool.query(
      `SELECT expected_run_id, terminal_run_id, consumer_state
         FROM bff_agui_stream WHERE tenant_id = $1 AND session_id = $2`,
      [tenant, conversationId],
    )
    assert.deepEqual(stream.rows, [{
      expected_run_id: secondReceipt.run_id,
      terminal_run_id: null,
      consumer_state: "active",
    }])

    const [second] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_failure",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.ok(second)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchFailed(second, "agent_http_400"), true)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchFailed(second, "stale_duplicate"), false)

    stream = await pool.query(
      `SELECT expected_run_id, terminal_run_id, consumer_state, consumer_fence
         FROM bff_agui_stream WHERE tenant_id = $1 AND session_id = $2`,
      [tenant, conversationId],
    )
    assert.equal(stream.rows[0].expected_run_id, secondReceipt.run_id)
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
    assert.deepEqual(failures.rows.map((row) => [row.source_owner, row.source_sequence, row.event_type]), [
      ["kokoro-bff", "1", "RUN_ERROR"],
      ["kokoro-bff", "3", "RUN_ERROR"],
    ])
    assert.deepEqual(failures.rows.map((row) => row.event_payload.runId), [firstReceipt.run_id, secondReceipt.run_id])
    assert.deepEqual(failures.rows.map((row) => row.event_payload.code), ["agent_receipt_invalid", "agent_http_400"])
    const assistants = await pool.query(
      `SELECT run_id, status FROM bff_message
        WHERE tenant_id = $1 AND conversation_id = $2 AND role = 'assistant'
        ORDER BY message_seq ASC`,
      [tenant, conversationId],
    )
    assert.deepEqual(assistants.rows, [
      { run_id: firstReceipt.run_id, status: "failed" },
      { run_id: secondReceipt.run_id, status: "failed" },
    ])

    await store.close()
    store = undefined
    agent = createServer((_request, response) => {
      agentRequests += 1
      response.writeHead(500, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { code: "unexpected", message: "must not poll" } }))
    })
    const agentBase = await listen(agent)
    const runtimeConfig = config()
    runtimeConfig.agentEnabled = true
    runtimeConfig.upstreams.agents = agentBase
    bff = createBffServer(runtimeConfig)
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
    await pool.query("DELETE FROM bff_agui_stream WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_message WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("deletion atomically fences launches and enqueues durable cancellation for possibly admitted runs", async () => {
  const pool = new Pool({ connectionString: postgresUrl })
  const tenant = `chat_delete_${Date.now()}`
  const conversationId = `conversation_delete_${Date.now()}`
  let store
  try {
    await pool.query("DROP TABLE IF EXISTS bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_idempotency_receipt CASCADE")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ($1, $2, $3, $4)`,
      [conversationId, tenant, "chat_user", "Delete compensation"],
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    for (const suffix of ["admitted", "inflight", "local_only"]) {
      assert.ok(await store.services.chatTurns.submit({
        tenantId: tenant,
        conversationId,
        subjectId: "chat_user",
        actorId: "chat_user",
        requestId: `request_${suffix}`,
        idempotencyKey: `delete-${suffix}`,
        content: `Delete ${suffix}`,
      }))
    }
    const [admitted] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_delete",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.ok(admitted)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchSucceeded(admitted), true)
    const [inflight] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_delete",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.ok(inflight)

    assert.equal(await store.services.chat.deleteConversation(
      tenant,
      "chat_user",
      conversationId,
      "request_delete_conversation",
    ), true)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchSucceeded(inflight), false)

    const dispatch = await pool.query(
      `SELECT conversation_dispatch_seq, status, fence FROM bff_agent_dispatch_outbox
        WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY conversation_dispatch_seq ASC`,
      [tenant, conversationId],
    )
    assert.deepEqual(dispatch.rows.map((row) => [row.conversation_dispatch_seq, row.status]), [
      ["1", "succeeded"],
      ["3", "failed"],
      ["5", "failed"],
    ])
    assert.ok(Number(dispatch.rows[1].fence) > inflight.fence)
    const cancellations = await pool.query(
      `SELECT cancellation_id, command_id, conversation_dispatch_seq, request_id, status, payload
         FROM bff_agent_cancellation_outbox
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY conversation_dispatch_seq ASC`,
      [tenant, conversationId],
    )
    assert.deepEqual(cancellations.rows.map((row) => [row.conversation_dispatch_seq, row.status]), [
      ["1", "cancel_requested"],
      ["3", "cancel_requested"],
    ])
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
    assert.equal(await store.agentCancellationOutbox.markAgentCancellationSucceeded({
      ...firstCancel[0],
      tenantId: `${tenant}_other`,
    }), false)
    assert.equal(await store.agentCancellationOutbox.markAgentCancellationSucceeded(firstCancel[0]), true)
    const secondCancel = await store.agentCancellationOutbox.claimAgentCancellationOutbox({
      workerId: "worker_cancel",
      limit: 10,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(secondCancel.length, 1)
    assert.equal(secondCancel[0].conversationDispatchSeq, "3")

    const conversation = await pool.query(
      "SELECT status FROM bff_conversation WHERE tenant_id = $1 AND conversation_id = $2",
      [tenant, conversationId],
    )
    const assistants = await pool.query(
      `SELECT status FROM bff_message WHERE tenant_id = $1 AND conversation_id = $2 AND role = 'assistant'`,
      [tenant, conversationId],
    )
    const stream = await pool.query(
      `SELECT consumer_state, consumer_lease_owner, consumer_lease_token, consumer_lease_until
         FROM bff_agui_stream WHERE tenant_id = $1 AND session_id = $2`,
      [tenant, conversationId],
    )
    assert.equal(conversation.rows[0].status, "deleted")
    assert.ok(assistants.rows.every((row) => row.status === "failed"))
    assert.deepEqual(stream.rows, [{
      consumer_state: "stopped",
      consumer_lease_owner: null,
      consumer_lease_token: null,
      consumer_lease_until: null,
    }])
  } finally {
    if (store) await store.close()
    await pool.query("DELETE FROM bff_agent_cancellation_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_agui_stream WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_message WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})
