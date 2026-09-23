import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { test } from "node:test"

import { Pool } from "pg"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { createBffServer } from "../dist/main.js"
import { schedulerDispatchDigest, schedulerDispatchScope } from "../dist/infrastructure/clients/scheduler/dispatch-identity.js"
import { PostgresBffRepositories } from "../dist/infrastructure/postgres/repositories.js"
import { PostgresSchedulerDispatchReceiptRepository } from "../dist/infrastructure/postgres/scheduler-dispatch-receipt-repository.js"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const redisUrl = process.env.KOKORO_TEST_REDIS_URL
const integrationTest = postgresUrl ? test : test.skip
const receiverIntegrationTest = postgresUrl && redisUrl ? test : test.skip

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function snapshot(tenantId, suffix) {
  return {
    tenantId,
    schedule: `kokoro.scheduled.${suffix}`,
    occurrence: "2026-09-01T12:00:00.123456789Z",
    idempotencyKey: ` opaque-${suffix} `,
    actorId: `actor-${suffix}`,
    taskId: `task-${suffix}`,
    launch: {
      requestId: `request-${suffix}`,
      body: { request_id: `request-${suffix}`, run_id: `run-${suffix}`, content: "go" },
      identityAssertionRef: `bff:${suffix}`,
      receipt: { run_id: `run-${suffix}`, user_message_id: `user-${suffix}`, assistant_message_id: `assistant-${suffix}` },
    },
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

function receiverConfig(agentBase) {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant_test",
    iamBaseUrl: null,
    sharedSecret: "web-secret",
    upstreamSecret: "bff-secret",
    upstreamTimeoutMs: 70_000,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: "scheduler-secret",
    schedulerTargetUrl: null,
    agentEnabled: true,
    postgresUrl,
    redisUrl,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { system: null, capability: null, storage: null, scheduler: null, agents: agentBase, billing: null },
  }
}

function receiverStore(store, receipts = store.schedulerDispatchReceipts, scheduledTasks = store.services.scheduledTasks) {
  return {
    services: { scheduledTasks },
    agUi: store.agUi,
    schedulerDispatchReceipts: receipts,
    ready: store.ready.bind(store),
    close: async () => undefined,
  }
}

function dispatchHeaders(tenantId, schedule, occurrence, idempotencyKey, requestId) {
  return {
    authorization: "Bearer scheduler-secret",
    "content-type": "application/json",
    "x-kokoro-tenant-id": tenantId,
    "x-kokoro-scheduler-schedule": schedule,
    "x-kokoro-scheduler-occurrence": occurrence,
    "x-request-id": requestId,
    "idempotency-key": idempotencyKey,
    traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
  }
}

integrationTest("Scheduler dispatch receipts preserve digest, snapshot, and fenced recovery", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 10 })
  const repository = new PostgresSchedulerDispatchReceiptRepository(pool)
  const suffix = `${Date.now()}-${randomUUID()}`
  const tenant = `scheduler-receipt-${suffix}`
  const scope = JSON.stringify([tenant, "scheduler-dispatch:v1", ` key-${suffix} `])
  const digest = "a".repeat(64)
  const differentDigest = "b".repeat(64)
  try {
    const [left, right] = await Promise.all([repository.claim(scope, digest), repository.claim(scope, digest)])
    const claimed = [left, right].filter((result) => result.outcome === "claimed")
    const pending = [left, right].filter((result) => result.outcome === "pending")
    assert.equal(claimed.length, 1)
    assert.equal(pending.length, 1)
    const first = claimed[0].claim
    assert.ok(first.leaseRemainingMs > 59_000 && first.leaseRemainingMs <= 60_000)

    assert.deepEqual(await repository.claim(scope, differentDigest), { outcome: "conflict" })
    const prepared = await repository.prepareSnapshot(first, snapshot(tenant, suffix))
    assert.ok(prepared.leaseRemainingMs > 59_000 && prepared.leaseRemainingMs <= 60_000)

    await pool.query(
      `UPDATE bff_idempotency_receipt
          SET response_body = jsonb_set(response_body, '{lease_until}', to_jsonb('2000-01-01T00:00:00.000Z'::text))
        WHERE scope = $1`,
      [scope],
    )
    const recovered = await new PostgresSchedulerDispatchReceiptRepository(pool).claim(scope, digest)
    assert.equal(recovered.outcome, "claimed")
    assert.deepEqual(recovered.claim.snapshot, snapshot(tenant, suffix))
    assert.notEqual(recovered.claim.claimToken, first.claimToken)

    assert.equal(await repository.complete(first, { status: 202, body: { data: { run_id: `run-${suffix}` } } }), false)
    assert.equal(await repository.releaseRetryable(first, "stale-worker"), false)
    assert.equal(await repository.complete(recovered.claim, { status: 202, body: { data: { run_id: `run-${suffix}` } } }), true)
    assert.deepEqual(await repository.claim(scope, digest), {
      outcome: "terminal",
      response: { status: 202, body: { data: { run_id: `run-${suffix}` } } },
    })
    assert.deepEqual(await repository.claim(scope, differentDigest), { outcome: "conflict" })

    const otherTenantScope = JSON.stringify([`${tenant}-other`, "scheduler-dispatch:v1", ` key-${suffix} `])
    assert.equal((await repository.claim(otherTenantScope, digest)).outcome, "claimed")
  } finally {
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope LIKE $1", [`%${suffix}%`])
    await pool.end()
  }
})

integrationTest("Scheduler receipt CAS takes actual database time after row-lock waits", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 10 })
  const repository = new PostgresSchedulerDispatchReceiptRepository(pool)
  const suffix = `${Date.now()}-${randomUUID()}`
  const digest = "e".repeat(64)
  const scopes = ["claim", "prepare", "complete", "release"].map((name) =>
    JSON.stringify([`scheduler-lock-${suffix}`, "scheduler-dispatch:v1", `${name}-${suffix}`]),
  )
  const lockThen = async (scope, operation, waitMs = 250) => {
    const locker = await pool.connect()
    try {
      await locker.query("BEGIN")
      await locker.query("SELECT scope FROM bff_idempotency_receipt WHERE scope = $1 FOR UPDATE", [scope])
      const pending = operation()
      await delay(waitMs)
      await locker.query("COMMIT")
      return await pending
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined)
      locker.release()
    }
  }
  try {
    const initialClaim = await repository.claim(scopes[0], digest)
    assert.equal(initialClaim.outcome, "claimed")
    await pool.query(
      "UPDATE bff_idempotency_receipt SET response_body = jsonb_set(response_body, '{lease_until}', to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE scope = $1",
      [scopes[0]],
    )
    const reclaimed = await lockThen(scopes[0], () => repository.claim(scopes[0], digest))
    assert.equal(reclaimed.outcome, "claimed")
    assert.ok(reclaimed.claim.leaseRemainingMs > 59_900, `reclaimed lease had only ${reclaimed.claim.leaseRemainingMs}ms remaining`)

    const preparing = await repository.claim(scopes[1], digest)
    assert.equal(preparing.outcome, "claimed")
    const prepared = await lockThen(scopes[1], () => repository.prepareSnapshot(preparing.claim, snapshot(`scheduler-lock-${suffix}`, `prepare-${suffix}`)))
    assert.ok(prepared !== null)
    assert.ok(prepared.leaseRemainingMs > 59_000 && prepared.leaseRemainingMs < 59_900)

    for (const [index, settle] of [
      [2, (claim) => repository.complete(claim, { status: 202, body: { data: { run_id: "late" } } })],
      [3, (claim) => repository.releaseRetryable(claim, "late")],
    ]) {
      const current = await repository.claim(scopes[index], digest)
      assert.equal(current.outcome, "claimed")
      const locker = await pool.connect()
      try {
        await locker.query("BEGIN")
        await locker.query(
          "UPDATE bff_idempotency_receipt SET response_body = jsonb_set(response_body, '{lease_until}', to_jsonb((clock_timestamp() + interval '100 milliseconds')::text)) WHERE scope = $1",
          [scopes[index]],
        )
        const pending = settle(current.claim)
        await delay(250)
        await locker.query("COMMIT")
        assert.equal(await pending, false)
      } finally {
        await locker.query("ROLLBACK").catch(() => undefined)
        locker.release()
      }
    }
  } finally {
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope LIKE $1", [`%${suffix}%`])
    await pool.end()
  }
})

integrationTest("Scheduler receipt lease observation precedes budget query and commit delivery", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 5 })
  const suffix = `${Date.now()}-${randomUUID()}`
  const tenant = `scheduler-observation-${suffix}`
  const scopes = ["claim", "prepare"].map((name) => JSON.stringify([tenant, "scheduler-dispatch:v1", `${name}-${suffix}`]))
  const digest = "f".repeat(64)
  const delayedPool = {
    connect: async () => {
      const client = await pool.connect()
      return {
        query: async (...args) => {
          const result = await client.query(...args)
          const sql = String(args[0])
          if (sql.includes("remaining_ms")) await delay(50)
          if (sql === "COMMIT") await delay(80)
          return result
        },
        release: () => client.release(),
      }
    },
  }
  const repository = new PostgresSchedulerDispatchReceiptRepository(delayedPool)
  try {
    const claimed = await repository.claim(scopes[0], digest)
    assert.equal(claimed.outcome, "claimed")
    assert.ok(Number.isFinite(claimed.claim.leaseObservedAt))
    assert.ok(performance.now() - claimed.claim.leaseObservedAt >= 120)

    const ordinary = new PostgresSchedulerDispatchReceiptRepository(pool)
    const preparing = await ordinary.claim(scopes[1], digest)
    assert.equal(preparing.outcome, "claimed")
    const prepared = await repository.prepareSnapshot(preparing.claim, snapshot(tenant, `observation-${suffix}`))
    assert.ok(prepared !== null)
    assert.ok(Number.isFinite(prepared.leaseObservedAt))
    assert.ok(performance.now() - prepared.leaseObservedAt >= 120)
  } finally {
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope = ANY($1::text[])", [scopes])
    await pool.end()
  }
})

integrationTest("Scheduler dispatch retryable release preserves immutable binding after response-unknown", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const repository = new PostgresSchedulerDispatchReceiptRepository(pool)
  const suffix = `${Date.now()}-${randomUUID()}`
  const tenant = `scheduler-response-unknown-${suffix}`
  const scope = JSON.stringify([tenant, "scheduler-dispatch:v1", `key-${suffix}`])
  const digest = "c".repeat(64)
  try {
    const claimed = await repository.claim(scope, digest)
    assert.equal(claimed.outcome, "claimed")
    const frozen = snapshot(tenant, suffix)
    assert.ok(await repository.prepareSnapshot(claimed.claim, frozen))
    assert.equal(await repository.releaseRetryable(claimed.claim, "agent_response_unknown", 0), true)
    assert.deepEqual(await repository.claim(scope, "d".repeat(64)), { outcome: "conflict" })
    const retry = await repository.claim(scope, digest)
    assert.equal(retry.outcome, "claimed")
    assert.deepEqual(retry.claim.snapshot, frozen)
  } finally {
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope = $1", [scope])
    await pool.end()
  }
})

receiverIntegrationTest("Scheduler HTTP receiver replays the frozen launch after finalize failure and restart", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16)
  const tenant = `scheduler-http-${suffix}`
  const owner = `owner-${suffix}`
  const taskId = `scheduled_${suffix}`
  const schedule = `kokoro.scheduled.${taskId}`
  const occurrence = "2026-09-01T12:00:00.123456789Z"
  const key = `receiver-${suffix}`
  const body = {
    tenant_id: tenant,
    task_id: taskId,
    owner_id: owner,
    prompt: "frozen prompt",
    auto_approve: false,
    timezone: "UTC",
  }
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const agentCalls = []
  const agent = createServer((request, response) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const launch = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      agentCalls.push({ launch, requestId: request.headers["x-request-id"] })
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { run_id: launch.run_id }, meta: { request_id: request.headers["x-request-id"] } }))
    })
  })
  let bff = null
  let store = null
  try {
    const agentBase = await listen(agent)
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.services.scheduledTasks.create(
      { tenantId: tenant, subjectId: owner },
      {
        title: "Receiver fixture",
        prompt: body.prompt,
        frequency: "daily",
        time: "08:00",
        timezone: "UTC",
        nextRunAt: new Date("2026-09-01T08:00:00.000Z"),
        autoApprove: false,
      },
      taskId,
      { tenantId: tenant, actorId: owner, requestId: `create-${suffix}`, idempotencyKey: `create-${suffix}` },
    )
    let failFinalize = true
    const durableReceipts = store.schedulerDispatchReceipts
    const finalizeFailingReceipts = {
      claim: durableReceipts.claim.bind(durableReceipts),
      prepareSnapshot: durableReceipts.prepareSnapshot.bind(durableReceipts),
      complete: async (...args) => {
        if (failFinalize) {
          failFinalize = false
          return false
        }
        return durableReceipts.complete(...args)
      },
      releaseRetryable: durableReceipts.releaseRetryable.bind(durableReceipts),
    }
    bff = createBffServer(receiverConfig(agentBase), {
      businessStore: receiverStore(store, finalizeFailingReceipts),
      readiness: async () => undefined,
      close: async () => undefined,
    })
    let base = await listen(bff)
    const first = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
      method: "POST",
      headers: dispatchHeaders(tenant, schedule, occurrence, key, `transport-first-${suffix}`),
      body: JSON.stringify(body),
    })
    assert.equal(first.status, 503)
    assert.equal(agentCalls.length, 1)
    const firstLaunch = structuredClone(agentCalls[0].launch)
    const scope = schedulerDispatchScope(tenant, key)
    await pool.query(
      `UPDATE bff_idempotency_receipt
          SET response_body = jsonb_set(response_body, '{lease_until}', to_jsonb('2000-01-01T00:00:00.000Z'::text))
        WHERE scope = $1`,
      [scope],
    )
    await pool.query(
      "UPDATE bff_scheduled_task SET prompt = 'database prompt changed', owner_id = 'database-owner-changed', revision = revision + 1 WHERE tenant_id = $1 AND task_id = $2",
      [tenant, taskId],
    )

    await bff.shutdown()
    bff = null
    await store.close()
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    bff = createBffServer(receiverConfig(agentBase), {
      businessStore: receiverStore(store),
      readiness: async () => undefined,
      close: async () => undefined,
    })
    base = await listen(bff)
    const recovered = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
      method: "POST",
      headers: dispatchHeaders(tenant, schedule, occurrence, key, `transport-after-restart-${suffix}`),
      body: JSON.stringify(body),
    })
    assert.equal(recovered.status, 202)
    assert.equal(agentCalls.length, 2)
    assert.deepEqual(agentCalls[1].launch, firstLaunch)
    assert.equal(agentCalls[1].launch.run_id, agentCalls[0].launch.run_id)
    assert.equal(agentCalls[1].launch.request_id, `transport-first-${suffix}`)
    assert.equal(agentCalls[1].requestId, `transport-first-${suffix}`)

    await pool.query("UPDATE bff_scheduled_task SET prompt = $3, owner_id = $4, enabled = true, status = 'active' WHERE tenant_id = $1 AND task_id = $2", [
      tenant,
      taskId,
      body.prompt,
      owner,
    ])
    const staleOccurrence = "2026-09-01T12:00:01.123456789Z"
    const staleKey = `stale-${suffix}`
    const staleScope = schedulerDispatchScope(tenant, staleKey)
    const staleDigest = schedulerDispatchDigest({ tenantId: tenant, schedule, occurrence: staleOccurrence, body })
    let fencedClaim = null
    const interceptingTasks = {
      findRecord: async (...args) => {
        await pool.query(
          `UPDATE bff_idempotency_receipt
              SET response_body = jsonb_set(response_body, '{lease_until}', to_jsonb('2000-01-01T00:00:00.000Z'::text))
            WHERE scope = $1`,
          [staleScope],
        )
        fencedClaim = await store.schedulerDispatchReceipts.claim(staleScope, staleDigest)
        return store.services.scheduledTasks.findRecord(...args)
      },
    }
    await bff.shutdown()
    bff = createBffServer(receiverConfig(agentBase), {
      businessStore: receiverStore(store, store.schedulerDispatchReceipts, interceptingTasks),
      readiness: async () => undefined,
      close: async () => undefined,
    })
    base = await listen(bff)
    const callsBeforeStalePrepare = agentCalls.length
    const stale = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
      method: "POST",
      headers: dispatchHeaders(tenant, schedule, staleOccurrence, staleKey, `transport-stale-${suffix}`),
      body: JSON.stringify(body),
    })
    assert.equal(stale.status, 503)
    assert.equal((await stale.json()).error.code, "scheduler_receipt_claim_lost")
    assert.equal(fencedClaim?.outcome, "claimed")
    assert.equal(agentCalls.length, callsBeforeStalePrepare)
  } finally {
    if (bff !== null) await bff.shutdown().catch(() => undefined)
    if (store !== null) await store.close().catch(() => undefined)
    if (agent.listening) await new Promise((resolve) => agent.close(() => resolve()))
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope LIKE $1", [`%${suffix}%`]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_task_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})
