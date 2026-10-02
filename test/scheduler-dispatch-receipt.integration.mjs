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

async function waitForBlockedCount(pool, blockerPid, expected) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const result = await pool.query(
      `WITH RECURSIVE waiters(pid) AS (
         SELECT a.pid FROM pg_stat_activity a WHERE $1 = ANY(pg_blocking_pids(a.pid)) AND a.wait_event_type='Lock'
         UNION
         SELECT a.pid FROM pg_stat_activity a JOIN waiters w ON w.pid = ANY(pg_blocking_pids(a.pid)) WHERE a.wait_event_type='Lock'
       ) SELECT count(DISTINCT pid)::int count FROM waiters`,
      [blockerPid],
    )
    if (result.rows[0].count >= expected) return
    await delay(10)
  }
  throw new Error("scheduler callback/delete barrier did not observe expected waiters")
}

function snapshot(tenantId, suffix) {
  return {
    tenantId,
    schedule: `kokoro.scheduled.${suffix}`,
    occurrence: "2026-09-01T12:00:00.123456789Z",
    idempotencyKey: ` opaque-${suffix} `,
    actorId: `actor-${suffix}`,
    taskId: `task-${suffix}`,
    taskRevision: 1,
    launch: {
      requestId: `request-${suffix}`,
      body: {
        request_id: `request-${suffix}`,
        run_id: `run-${suffix}`,
        content: "go",
        selected_skill_source_refs: [],
      },
      identityAssertionRef: `bff:${suffix}`,
      receipt: {
        run_id: `run-${suffix}`,
        user_message_id: `user-${suffix}`,
        assistant_message_id: `assistant-${suffix}`,
      },
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
    upstreams: {
      system: null,
      capability: null,
      storage: null,
      scheduler: null,
      agents: agentBase,
      billing: null,
    },
  }
}

function receiverStore(store, receipts = store.schedulerDispatchReceipts, scheduledTasks = store.services.scheduledTasks) {
  return {
    services: { scheduledTasks },
    agUi: store.agUi,
    schedulerDispatchReceipts: receipts,
    scheduledAgentDispatch: store.scheduledAgentDispatch,
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
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
    max: 10,
  })
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

    assert.deepEqual(await repository.claim(scope, differentDigest), {
      outcome: "conflict",
    })
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

    assert.equal(
      await repository.complete(first, {
        status: 202,
        body: { data: { run_id: `run-${suffix}` } },
      }),
      false,
    )
    assert.equal(await repository.releaseRetryable(first, "stale-worker"), false)
    assert.equal(
      await repository.complete(recovered.claim, {
        status: 202,
        body: { data: { run_id: `run-${suffix}` } },
      }),
      true,
    )
    assert.deepEqual(await repository.claim(scope, digest), {
      outcome: "terminal",
      response: { status: 202, body: { data: { run_id: `run-${suffix}` } } },
    })
    assert.deepEqual(await repository.claim(scope, differentDigest), {
      outcome: "conflict",
    })

    const otherTenantScope = JSON.stringify([`${tenant}-other`, "scheduler-dispatch:v1", ` key-${suffix} `])
    assert.equal((await repository.claim(otherTenantScope, digest)).outcome, "claimed")
    const persisted = await pool.query("SELECT response_body FROM bff_idempotency_receipt WHERE scope = $1", [scope])
    assert.equal(persisted.rows[0].response_body.schema_version, 2)
    assert.deepEqual(persisted.rows[0].response_body.snapshot.launch.body.selected_skill_source_refs, [])
    await pool.query("UPDATE bff_idempotency_receipt SET response_body = jsonb_set(response_body, '{schema_version}', '1'::jsonb) WHERE scope = $1", [
      otherTenantScope,
    ])
    await assert.rejects(repository.claim(otherTenantScope, digest), /envelope is invalid/)
  } finally {
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope LIKE $1", [`%${suffix}%`])
    await pool.end()
  }
})

integrationTest("Scheduler receipt CAS takes actual database time after row-lock waits", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
    max: 10,
  })
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
      [
        2,
        (claim) =>
          repository.complete(claim, {
            status: 202,
            body: { data: { run_id: "late" } },
          }),
      ],
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
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
    max: 5,
  })
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
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
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
    assert.deepEqual(await repository.claim(scope, "d".repeat(64)), {
      outcome: "conflict",
    })
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
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  const agentCalls = []
  const agent = createServer((request, response) => {
    if (request.method === "GET" && request.url?.startsWith("/v1/sessions/")) {
      const after = Number(new URL(request.url, "http://agent.test").searchParams.get("after_seq") ?? "0")
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          data: { events: [], next_seq: after, watermark: after },
          meta: {
            request_id: request.headers["x-request-id"] ?? "scheduled-source",
          },
        }),
      )
      return
    }
    const chunks = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const launch = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      agentCalls.push({ launch, requestId: request.headers["x-request-id"] })
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          data: { run_id: launch.run_id },
          meta: { request_id: request.headers["x-request-id"] },
        }),
      )
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
      {
        tenantId: tenant,
        actorId: owner,
        requestId: `create-${suffix}`,
        idempotencyKey: `create-${suffix}`,
      },
    )
    const durableReceipts = store.schedulerDispatchReceipts
    const durableDispatch = store.scheduledAgentDispatch
    const heldDispatch = {
      accept: durableDispatch.accept.bind(durableDispatch),
      claim: async () => null,
      markAdmitted: durableDispatch.markAdmitted.bind(durableDispatch),
      markUnknown: durableDispatch.markUnknown.bind(durableDispatch),
      markNotAdmitted: durableDispatch.markNotAdmitted.bind(durableDispatch),
      claimConsumer: async () => null,
      commitSourcePage: durableDispatch.commitSourcePage.bind(durableDispatch),
      releaseConsumer: durableDispatch.releaseConsumer.bind(durableDispatch),
    }
    bff = createBffServer(receiverConfig(agentBase), {
      businessStore: {
        ...receiverStore(store, durableReceipts),
        scheduledAgentDispatch: heldDispatch,
      },
      readiness: async () => undefined,
      close: async () => undefined,
    })
    let base = await listen(bff)
    const first = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
      method: "POST",
      headers: dispatchHeaders(tenant, schedule, occurrence, key, `transport-first-${suffix}`),
      body: JSON.stringify(body),
    })
    assert.equal(first.status, 202)
    assert.equal(agentCalls.length, 0)
    const persisted = await pool.query("SELECT payload FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND task_id=$2", [tenant, taskId])
    assert.equal(persisted.rows.length, 1)
    const frozenLaunch = persisted.rows[0].payload

    await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id=$1 AND task_id=$2", [tenant, taskId])
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
    const deadline = Date.now() + 3000
    while (agentCalls.length === 0 && Date.now() < deadline) await delay(20)
    assert.equal(agentCalls.length, 1)
    assert.deepEqual(agentCalls[0].launch, frozenLaunch)
    assert.equal(agentCalls[0].launch.request_id, `transport-first-${suffix}`)
    assert.equal(agentCalls[0].requestId, `transport-first-${suffix}`)
    const replay = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
      method: "POST",
      headers: dispatchHeaders(tenant, schedule, occurrence, key, `transport-replay-${suffix}`),
      body: JSON.stringify(body),
    })
    assert.equal(replay.status, 202)
    assert.equal(agentCalls.length, 1)
  } finally {
    if (bff !== null) await bff.shutdown().catch(() => undefined)
    if (store !== null) await store.close().catch(() => undefined)
    if (agent.listening) await new Promise((resolve) => agent.close(() => resolve()))
    await pool.query("DELETE FROM bff_scheduled_agent_source_event WHERE tenant_id=$1 AND task_id=$2", [tenant, taskId]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND task_id=$2", [tenant, taskId]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2", [tenant, taskId]).catch(() => undefined)
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope LIKE $1", [`%${suffix}%`]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_task_outbox WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id = $1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

receiverIntegrationTest("Scheduler enqueue conflict rolls back receipt finalization and newly-created scope atomically", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16)
  const tenant = `scheduler-rollback-${suffix}`
  const owner = `owner-${suffix}`
  const taskId = `task-${suffix}`
  const occurrence = "2026-09-01T12:00:00.123456789Z"
  const scope = schedulerDispatchScope(tenant, `rollback-${suffix}`)
  const digest = "9".repeat(64)
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store
  try {
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.services.scheduledTasks.create(
      { tenantId: tenant, subjectId: owner },
      {
        title: "Rollback",
        prompt: "go",
        frequency: "daily",
        time: "08:00",
        timezone: "UTC",
        nextRunAt: new Date("2026-09-01T08:00:00.000Z"),
        autoApprove: false,
      },
      taskId,
      {
        tenantId: tenant,
        actorId: owner,
        requestId: `create-${suffix}`,
        idempotencyKey: `create-${suffix}`,
      },
    )
    const claimed = await store.schedulerDispatchReceipts.claim(scope, digest)
    assert.equal(claimed.outcome, "claimed")
    const preparedSnapshot = {
      tenantId: tenant,
      schedule: `kokoro.scheduled.${taskId}`,
      occurrence,
      idempotencyKey: `rollback-${suffix}`,
      actorId: owner,
      taskId,
      taskRevision: 1,
      launch: {
        requestId: `request-${suffix}`,
        body: {
          request_id: `request-${suffix}`,
          run_id: `run-${suffix}`,
          session_id: `scheduled:${taskId}`,
          feature_key: "chat",
          message_id: `message-${suffix}`,
          content: "go",
          selected_skill_source_refs: [],
          trace: { source: "kokoro-bff-scheduler" },
        },
        identityAssertionRef: `bff:${suffix}`,
        receipt: {
          run_id: `run-${suffix}`,
          user_message_id: `user-${suffix}`,
          assistant_message_id: `assistant-${suffix}`,
        },
      },
    }
    const prepared = await store.schedulerDispatchReceipts.prepareSnapshot(claimed.claim, preparedSnapshot)
    await pool.query(
      `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload) VALUES($1,$2,$3,$4,'2026-09-01T12:00:00.123456789Z',$5,'conflict-request','conflict-key',$6,'conflict-run','bff:conflict','{}')`,
      [`conflict-${suffix}`, tenant, taskId, occurrence, owner, "8".repeat(64)],
    )
    await assert.rejects(
      store.scheduledAgentDispatch.accept({
        claim: { ...claimed.claim, ...prepared, snapshot: preparedSnapshot },
        snapshot: preparedSnapshot,
        rejections: r67AcceptanceRejections(`request-${suffix}`),
        response: { status: 202, body: { data: { accepted: true } } },
      }),
      /SCHEDULED_AGENT_DISPATCH_CONFLICT/,
    )
    assert.equal((await pool.query("SELECT 1 FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2", [tenant, taskId])).rowCount, 0)
    assert.deepEqual((await pool.query("SELECT status,response_body->>'state' state FROM bff_idempotency_receipt WHERE scope=$1", [scope])).rows, [
      { status: 102, state: "pending" },
    ])
    assert.deepEqual(
      (await pool.query("SELECT request_digest,run_id FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND task_id=$2", [tenant, taskId])).rows,
      [{ request_digest: "8".repeat(64), run_id: "conflict-run" }],
    )
  } finally {
    if (store) await store.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_source_event WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_scope WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope=$1 OR scope LIKE $2", [scope, `%${suffix}%`]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_task_outbox WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

receiverIntegrationTest("Scheduler callback and physical task delete serialize with both lock winners", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
    max: 12,
  })
  for (const winner of ["callback", "delete"]) {
    const suffix = `${winner}-${randomUUID().replaceAll("-", "").slice(0, 12)}`
    const tenant = `scheduler-race-${suffix}`
    const owner = `owner-${suffix}`
    const taskId = `task-${suffix}`
    const occurrence = "2026-09-01T12:00:00.123456789Z"
    const receiptScope = schedulerDispatchScope(tenant, `race-${suffix}`)
    const digest = (winner === "callback" ? "a" : "b").repeat(64)
    let store
    let locker
    let acceptOperation
    let deleteOperation
    try {
      store = new PostgresBffRepositories(postgresUrl, redisUrl)
      await store.services.scheduledTasks.create(
        { tenantId: tenant, subjectId: owner },
        {
          title: "Race",
          prompt: "go",
          frequency: "daily",
          time: "08:00",
          timezone: "UTC",
          nextRunAt: new Date("2026-09-01T08:00:00.000Z"),
          autoApprove: false,
        },
        taskId,
        {
          tenantId: tenant,
          actorId: owner,
          requestId: `create-${suffix}`,
          idempotencyKey: `create-${suffix}`,
        },
      )
      const claimed = await store.schedulerDispatchReceipts.claim(receiptScope, digest)
      assert.equal(claimed.outcome, "claimed")
      const frozen = {
        tenantId: tenant,
        schedule: `kokoro.scheduled.${taskId}`,
        occurrence,
        idempotencyKey: `race-${suffix}`,
        actorId: owner,
        taskId,
        taskRevision: 1,
        launch: {
          requestId: `request-${suffix}`,
          body: {
            request_id: `request-${suffix}`,
            run_id: `run-${suffix}`,
            session_id: `scheduled:${taskId}`,
            feature_key: "chat",
            message_id: `message-${suffix}`,
            content: "go",
            selected_skill_source_refs: [],
            trace: { source: "kokoro-bff-scheduler" },
          },
          identityAssertionRef: `bff:${suffix}`,
          receipt: {
            run_id: `run-${suffix}`,
            user_message_id: `user-${suffix}`,
            assistant_message_id: `assistant-${suffix}`,
          },
        },
      }
      const observation = await store.schedulerDispatchReceipts.prepareSnapshot(claimed.claim, frozen)
      assert.ok(observation)
      const preparedClaim = {
        ...claimed.claim,
        ...observation,
        snapshot: frozen,
      }
      const accept = () =>
        store.scheduledAgentDispatch.accept({
          claim: preparedClaim,
          snapshot: frozen,
          rejections: r67AcceptanceRejections(`request-${suffix}`),
          response: { status: 202, body: { data: { accepted: true } } },
        })
      const remove = () =>
        store.services.scheduledTasks.delete({ tenantId: tenant, subjectId: owner }, taskId, {
          tenantId: tenant,
          actorId: owner,
          requestId: `delete-${suffix}`,
          idempotencyKey: `delete-${suffix}`,
        })
      locker = await pool.connect()
      await locker.query("BEGIN")
      const blockerPid = (await locker.query("SELECT pg_backend_pid() pid")).rows[0].pid
      await locker.query("SELECT 1 FROM bff_scheduled_task WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE", [tenant, taskId])
      if (winner === "callback") {
        acceptOperation = accept()
        await waitForBlockedCount(pool, blockerPid, 1)
        deleteOperation = remove()
      } else {
        deleteOperation = remove()
        await waitForBlockedCount(pool, blockerPid, 1)
        acceptOperation = accept()
      }
      await waitForBlockedCount(pool, blockerPid, 2)
      await locker.query("COMMIT")
      locker.release()
      locker = undefined
      const [accepted, deleted] = await Promise.all([acceptOperation, deleteOperation])
      acceptOperation = undefined
      deleteOperation = undefined
      assert.equal(deleted, true)
      assert.deepEqual(
        accepted,
        winner === "callback" ? { outcome: "accepted" } : { outcome: "rejected", response: r67AcceptanceRejections(`request-${suffix}`).task_not_found },
      )
      assert.equal((await pool.query("SELECT 1 FROM bff_scheduled_task WHERE tenant_id=$1 AND task_id=$2", [tenant, taskId])).rowCount, 0)
      assert.equal(
        (await pool.query("SELECT 1 FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND task_id=$2", [tenant, taskId])).rowCount,
        winner === "callback" ? 1 : 0,
      )
      assert.equal(
        (await pool.query("SELECT 1 FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2", [tenant, taskId])).rowCount,
        winner === "callback" ? 1 : 0,
      )
      assert.deepEqual(
        (
          await pool.query("SELECT status,response_body->>'state' state,response_body->'response' response FROM bff_idempotency_receipt WHERE scope=$1", [
            receiptScope,
          ])
        ).rows,
        [
          {
            status: winner === "callback" ? 202 : 404,
            state: "terminal",
            response: winner === "callback" ? { status: 202, body: { data: { accepted: true } } } : r67AcceptanceRejections(`request-${suffix}`).task_not_found,
          },
        ],
      )
    } finally {
      if (locker) {
        await locker.query("ROLLBACK").catch(() => undefined)
        locker.release()
      }
      await Promise.allSettled([acceptOperation, deleteOperation].filter(Boolean))
      if (store) await store.close().catch(() => undefined)
      await pool.query("DELETE FROM bff_scheduled_agent_source_event WHERE tenant_id=$1", [tenant]).catch(() => undefined)
      await pool.query("DELETE FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1", [tenant]).catch(() => undefined)
      await pool.query("DELETE FROM bff_scheduled_agent_scope WHERE tenant_id=$1", [tenant]).catch(() => undefined)
      await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope=$1 OR scope LIKE $2", [receiptScope, `%${suffix}%`]).catch(() => undefined)
      await pool.query("DELETE FROM bff_scheduled_task_outbox WHERE tenant_id=$1", [tenant]).catch(() => undefined)
      await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    }
  }
  await pool.end()
})

// These lifecycle cases use the complete production launch and durable receipt APIs.
// Root runs them in its isolated PostgreSQL/Redis fixture; no Agent worker is started.
async function r66LifecycleFixture(context) {
  const { buildScheduledAgentLaunch } = await import("../dist/infrastructure/clients/agent/launch.js")
  const { schedulerOccurrenceIdentity } = await import("../dist/infrastructure/clients/scheduler/dispatch-identity.js")
  const suffix = randomUUID().replaceAll("-", "")
  const tenant = `scheduler-lifecycle-${suffix}`
  const otherTenant = `${tenant}-other`
  const tenants = [tenant, otherTenant]
  const owner = `owner-${suffix}`
  const taskId = `task-${suffix}`
  const schedule = `kokoro.scheduled.${taskId}`
  const occurrence = "2026-09-01T12:00:00.123456789Z"
  const key = `lifecycle-${suffix}`
  const body = { tenant_id: tenant, task_id: taskId, owner_id: owner, prompt: "go", auto_approve: false, timezone: "UTC" }
  const scopes = new Set()
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  let bff = null
  let base
  let requestSequence = 0
  const executionTables = [
    "bff_scheduled_agent_source_event",
    "bff_scheduled_agent_dispatch",
    "bff_scheduled_agent_scope",
    "bff_agent_cancellation_outbox",
    "bff_message",
    "bff_conversation",
  ]
  context.after(async () => {
    const failures = []
    const clean = async (operation) => {
      try {
        await operation()
      } catch (error) {
        failures.push(error)
      }
    }
    if (bff !== null) await clean(() => bff.shutdown())
    if (store !== null) await clean(() => store.close())
    for (const table of executionTables) await clean(() => pool.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::text[])`, [tenants]))
    await clean(() => pool.query("DELETE FROM bff_idempotency_receipt WHERE scope = ANY($1::text[])", [[...scopes]]))
    for (const table of ["bff_scheduled_task_outbox", "bff_scheduled_task"]) {
      await clean(() => pool.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::text[])`, [tenants]))
    }
    await clean(() => pool.end())
    if (failures.length > 0) throw new AggregateError(failures, "R66 lifecycle fixture cleanup failed")
  })
  const restart = async () => {
    if (bff !== null) {
      await bff.shutdown()
      bff = null
    }
    if (store !== null) {
      await store.close()
      store = null
    }
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    bff = createBffServer(receiverConfig(null), {
      businessStore: receiverStore(store),
      readiness: async () => undefined,
      close: async () => undefined,
    })
    base = await listen(bff)
  }
  await restart()
  const lineage = () => {
    const requestId = `mutation-${suffix}-${++requestSequence}`
    return { tenantId: tenant, actorId: owner, requestId, idempotencyKey: requestId }
  }
  await store.services.scheduledTasks.create(
    { tenantId: tenant, subjectId: owner },
    {
      title: "Lifecycle",
      prompt: "go",
      frequency: "daily",
      time: "08:00",
      timezone: "UTC",
      nextRunAt: new Date("2026-09-01T08:00:00.000Z"),
      autoApprove: false,
    },
    taskId,
    lineage(),
  )
  const facts = async () =>
    Object.fromEntries(
      await Promise.all(
        executionTables.map(async (table) => {
          const result = await pool.query(`SELECT to_jsonb(fact) AS fact FROM ${table} fact WHERE tenant_id = ANY($1::text[]) ORDER BY to_jsonb(fact)::text`, [
            tenants,
          ])
          return [table, result.rows.map((row) => row.fact)]
        }),
      ),
    )
  const emptyFacts = Object.fromEntries(executionTables.map((table) => [table, []]))
  const receipt = async (receiptKey = key, receiptTenant = tenant) => {
    const result = await pool.query("SELECT fingerprint,status,response_body FROM bff_idempotency_receipt WHERE scope=$1", [
      schedulerDispatchScope(receiptTenant, receiptKey),
    ])
    assert.equal(result.rowCount, 1)
    return result.rows[0]
  }
  const callback = async ({ callbackKey = key, callbackOccurrence = occurrence, callbackTenant = tenant, callbackBody = body } = {}) => {
    scopes.add(schedulerDispatchScope(callbackTenant, callbackKey))
    const response = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
      method: "POST",
      headers: dispatchHeaders(callbackTenant, schedule, callbackOccurrence, callbackKey, `delivery-${suffix}-${++requestSequence}`),
      body: JSON.stringify(callbackBody),
    })
    return { status: response.status, body: await response.json() }
  }
  const setActive = async (active) => {
    const task = await store.services.scheduledTasks.update(
      { tenantId: tenant, subjectId: owner },
      taskId,
      { enabled: active, status: active ? "active" : "paused" },
      lineage(),
    )
    assert.ok(task !== null)
    assert.equal(task.enabled, active)
    assert.equal(task.status, active ? "active" : "paused")
  }
  const prepare = async () => {
    const record = await store.services.scheduledTasks.findRecord(tenant, taskId)
    assert.ok(record !== null)
    assert.equal(record.task.projectId, undefined)
    const requestId = `prepared-${suffix}`
    const launch = buildScheduledAgentLaunch({
      identity: { namespace: tenant, userId: owner },
      requestId,
      sessionId: `scheduled:${taskId}`,
      occurrenceIdentity: schedulerOccurrenceIdentity({ tenantId: tenant, schedule, occurrence }),
      content: record.task.prompt,
    })
    const preparedSnapshot = {
      tenantId: tenant,
      schedule,
      occurrence,
      idempotencyKey: key,
      actorId: owner,
      taskId,
      taskRevision: record.task.revision,
      launch: { requestId, ...launch },
    }
    const scope = schedulerDispatchScope(tenant, key)
    scopes.add(scope)
    const digest = schedulerDispatchDigest({ tenantId: tenant, schedule, occurrence, body })
    const claimed = await store.schedulerDispatchReceipts.claim(scope, digest)
    assert.equal(claimed.outcome, "claimed")
    const prepared = await store.schedulerDispatchReceipts.prepareSnapshot(claimed.claim, preparedSnapshot)
    assert.ok(prepared !== null)
    assert.equal(await store.schedulerDispatchReceipts.releaseRetryable({ ...claimed.claim, ...prepared, snapshot: preparedSnapshot }, "r66_restart", 0), true)
    const persisted = await receipt()
    assert.equal(persisted.response_body.state, "retryable")
    assert.deepEqual(persisted.response_body.snapshot, preparedSnapshot)
    assert.deepEqual(await facts(), emptyFacts)
    return preparedSnapshot
  }
  return {
    tenant,
    otherTenant,
    owner,
    taskId,
    key,
    body,
    pool,
    restart,
    facts,
    emptyFacts,
    receipt,
    callback,
    setActive,
    prepare,
    get store() {
      return store
    },
  }
}

function r66AssertInactive(result) {
  assert.equal(result.status, 409)
  assert.equal(result.body.error.code, "scheduled_task_not_active")
}

receiverIntegrationTest("R66 prepared occurrence paused before acceptance is durably rejected after restart without execution facts", async (context) => {
  const fixture = await r66LifecycleFixture(context)
  const prepared = await fixture.prepare()
  await fixture.setActive(false)
  await fixture.restart()
  assert.deepEqual((await fixture.receipt()).response_body.snapshot, prepared)
  const rejected = await fixture.callback()
  assert.deepEqual(await fixture.facts(), fixture.emptyFacts)
  r66AssertInactive(rejected)
  const terminal = await fixture.receipt()
  assert.equal(terminal.status, 409)
  assert.equal(terminal.response_body.state, "terminal")
  assert.deepEqual(terminal.response_body.response, rejected)
  await fixture.restart()
  assert.deepEqual(await fixture.callback(), rejected)
  assert.deepEqual(await fixture.receipt(), terminal)
  assert.deepEqual(await fixture.facts(), fixture.emptyFacts)
})

receiverIntegrationTest("R66 resume preserves old rejection while a new occurrence is accepted exactly once across restart", async (context) => {
  const fixture = await r66LifecycleFixture(context)
  const prepared = await fixture.prepare()
  await fixture.setActive(false)
  await fixture.restart()
  const rejected = await fixture.callback()
  assert.deepEqual(await fixture.facts(), fixture.emptyFacts)
  await fixture.setActive(true)
  await fixture.restart()
  const oldReplay = await fixture.callback()
  assert.deepEqual(await fixture.facts(), fixture.emptyFacts)
  const next = { callbackKey: `${fixture.key}-next`, callbackOccurrence: "2026-09-02T12:00:00.123456789Z" }
  const accepted = await fixture.callback(next)
  assert.equal(accepted.status, 202)
  assert.equal(accepted.body.data.task_id, fixture.taskId)
  assert.notEqual(accepted.body.data.run_id, prepared.launch.receipt.run_id)
  const admittedFacts = await fixture.facts()
  assert.equal(admittedFacts.bff_scheduled_agent_scope.length, 1)
  assert.equal(admittedFacts.bff_scheduled_agent_dispatch.length, 1)
  assert.equal(admittedFacts.bff_scheduled_agent_dispatch[0].run_id, accepted.body.data.run_id)
  assert.equal(admittedFacts.bff_scheduled_agent_dispatch[0].occurrence, next.callbackOccurrence)
  for (const table of ["bff_conversation", "bff_message", "bff_agent_cancellation_outbox", "bff_scheduled_agent_source_event"])
    assert.deepEqual(admittedFacts[table], [])
  await fixture.restart()
  assert.deepEqual(await fixture.callback(next), accepted)
  const redelivery = await fixture.callback({ ...next, callbackKey: `${fixture.key}-next-redelivery` })
  assert.equal(redelivery.status, 202)
  assert.deepEqual(redelivery.body.data, accepted.body.data)
  assert.deepEqual(await fixture.facts(), admittedFacts)
  // Keep the valid fresh-occurrence control observable even while the old rejection is RED.
  r66AssertInactive(rejected)
  assert.deepEqual(oldReplay, rejected)
  assert.deepEqual(await fixture.callback(), rejected)
  assert.deepEqual(await fixture.facts(), admittedFacts)
})

receiverIntegrationTest("R66 accepted admitted head survives pause and restart with its original receipt and no cancellation", async (context) => {
  const fixture = await r66LifecycleFixture(context)
  await fixture.prepare()
  const accepted = await fixture.callback()
  assert.equal(accepted.status, 202)
  // Make only this owned dispatch unambiguously due; this case does not test sub-millisecond readiness.
  const due = await fixture.pool.query(
    "UPDATE bff_scheduled_agent_dispatch SET available_at='2000-01-01T00:00:00Z' WHERE tenant_id=$1 AND task_id=$2 AND status='pending'",
    [fixture.tenant, fixture.taskId],
  )
  assert.equal(due.rowCount, 1)
  const command = await fixture.store.scheduledAgentDispatch.claim({
    workerId: `r66-${fixture.taskId}`,
    leaseDurationMs: 5000,
    settlementReserveMs: 500,
    maxAttempts: 8,
  })
  assert.ok(command !== null)
  assert.equal(command.tenantId, fixture.tenant)
  assert.equal(command.taskId, fixture.taskId)
  assert.equal(command.runId, accepted.body.data.run_id)
  assert.equal(await fixture.store.scheduledAgentDispatch.markAdmitted(command), true)
  const before = await fixture.facts()
  assert.equal(before.bff_scheduled_agent_dispatch.length, 1)
  assert.equal(before.bff_scheduled_agent_dispatch[0].status, "admitted")
  assert.equal(before.bff_scheduled_agent_scope.length, 1)
  assert.equal(before.bff_scheduled_agent_scope[0].active_dispatch_id, command.dispatchId)
  assert.equal(before.bff_scheduled_agent_scope[0].active_run_id, command.runId)
  for (const table of ["bff_conversation", "bff_message", "bff_agent_cancellation_outbox", "bff_scheduled_agent_source_event"])
    assert.deepEqual(before[table], [])
  const terminal = await fixture.receipt()
  await fixture.setActive(false)
  await fixture.restart()
  assert.deepEqual(await fixture.callback(), accepted)
  assert.deepEqual(await fixture.receipt(), terminal)
  assert.deepEqual(await fixture.facts(), before)
  const task = await fixture.store.services.scheduledTasks.findRecord(fixture.tenant, fixture.taskId)
  assert.equal(task.task.status, "paused")
  assert.equal(task.task.enabled, false)
})

receiverIntegrationTest("R66 prepared receipt rejects digest and identity conflicts without cross-scope writes before valid acceptance", async (context) => {
  const fixture = await r66LifecycleFixture(context)
  const prepared = await fixture.prepare()
  const receipt = await fixture.receipt()
  await fixture.restart()
  const conflict = await fixture.callback({ callbackBody: { ...fixture.body, prompt: "different" } })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.error.code, "idempotency_conflict")
  const subjectConflict = await fixture.callback({ callbackBody: { ...fixture.body, owner_id: `${fixture.owner}-other` } })
  assert.equal(subjectConflict.status, 409)
  assert.equal(subjectConflict.body.error.code, "idempotency_conflict")
  const wrongSubject = await fixture.callback({ callbackKey: `${fixture.key}-subject`, callbackBody: { ...fixture.body, owner_id: `${fixture.owner}-other` } })
  assert.equal(wrongSubject.status, 404)
  assert.equal(wrongSubject.body.error.code, "scheduled_task_not_found")
  const otherTenant = await fixture.callback({ callbackTenant: fixture.otherTenant, callbackBody: { ...fixture.body, tenant_id: fixture.otherTenant } })
  assert.equal(otherTenant.status, 404)
  assert.equal(otherTenant.body.error.code, "scheduled_task_not_found")
  const mismatchedTenant = await fixture.callback({ callbackKey: `${fixture.key}-tenant-mismatch`, callbackTenant: fixture.otherTenant })
  assert.equal(mismatchedTenant.status, 400)
  assert.deepEqual(await fixture.receipt(), receipt)
  assert.deepEqual(await fixture.facts(), fixture.emptyFacts)
  const accepted = await fixture.callback()
  assert.equal(accepted.status, 202)
  assert.equal(accepted.body.data.run_id, prepared.launch.receipt.run_id)
  const after = await fixture.facts()
  assert.equal(after.bff_scheduled_agent_dispatch.length, 1)
  assert.equal(after.bff_scheduled_agent_scope.length, 1)
  assert.equal(after.bff_scheduled_agent_dispatch[0].tenant_id, fixture.tenant)
  assert.equal(after.bff_scheduled_agent_dispatch[0].subject_id, fixture.owner)
  for (const table of ["bff_conversation", "bff_message", "bff_agent_cancellation_outbox", "bff_scheduled_agent_source_event"])
    assert.deepEqual(after[table], [])
})

function r67AcceptanceRejections(requestId) {
  const response = (status, code, message) => ({ status, body: { error: { code, message }, meta: { request_id: requestId } } })
  return {
    task_not_found: response(404, "scheduled_task_not_found", "Scheduled task was not found"),
    task_not_active: response(409, "scheduled_task_not_active", "Scheduled task is not active"),
    task_changed: response(409, "invalid_scheduler_dispatch", "Scheduler dispatch does not match the stored task"),
  }
}

for (const invalidation of ["deleted", "owner_changed", "revision_changed"]) {
  receiverIntegrationTest(`R67 prepared ${invalidation} occurrence has an atomic durable rejection after restart`, async (context) => {
    const fixture = await r66LifecycleFixture(context)
    await fixture.prepare()
    if (invalidation === "deleted") {
      assert.equal(
        await fixture.store.services.scheduledTasks.delete({ tenantId: fixture.tenant, subjectId: fixture.owner }, fixture.taskId, {
          tenantId: fixture.tenant,
          actorId: fixture.owner,
          requestId: `${fixture.key}-delete`,
          idempotencyKey: `${fixture.key}-delete`,
        }),
        true,
      )
    } else if (invalidation === "owner_changed") {
      // This owned row fixture simulates a stale prepared owner; no cross-tenant row is modified.
      assert.equal(
        (
          await fixture.pool.query("UPDATE bff_scheduled_task SET owner_id=$3 WHERE tenant_id=$1 AND task_id=$2", [
            fixture.tenant,
            fixture.taskId,
            `${fixture.owner}-replacement`,
          ])
        ).rowCount,
        1,
      )
    } else {
      const updated = await fixture.store.services.scheduledTasks.update(
        { tenantId: fixture.tenant, subjectId: fixture.owner },
        fixture.taskId,
        { prompt: "revised prompt" },
        { tenantId: fixture.tenant, actorId: fixture.owner, requestId: `${fixture.key}-revise`, idempotencyKey: `${fixture.key}-revise` },
      )
      assert.ok(updated !== null)
      assert.equal(updated.revision, 2)
    }
    await fixture.restart()
    const rejected = await fixture.callback()
    assert.equal(rejected.status, invalidation === "revision_changed" ? 409 : 404)
    assert.equal(rejected.body.error.code, invalidation === "revision_changed" ? "invalid_scheduler_dispatch" : "scheduled_task_not_found")
    const terminal = await fixture.receipt()
    assert.equal(terminal.status, rejected.status)
    assert.equal(terminal.response_body.state, "terminal")
    assert.deepEqual(terminal.response_body.response, rejected)
    assert.deepEqual(await fixture.facts(), fixture.emptyFacts)
    await fixture.restart()
    assert.deepEqual(await fixture.callback(), rejected)
    assert.deepEqual(await fixture.receipt(), terminal)
    assert.deepEqual(await fixture.facts(), fixture.emptyFacts)
  })
}
