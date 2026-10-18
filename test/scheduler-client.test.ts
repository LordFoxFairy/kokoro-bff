import assert from "node:assert/strict"
import { createServer } from "node:http"
import { describe, it } from "node:test"

import { buildSchedulerSchedule, schedulerScheduleName } from "../dist/infrastructure/clients/scheduler/schedule.js"
import { SchedulerControlClient } from "../dist/infrastructure/clients/scheduler/control-client.js"

it("maps explicit calendars to generic recurring rules or a frozen once instant", async () => {
  const { tsImport } = await import("tsx/esm/api")
  const { buildSchedulerSchedule: build } = await tsImport("../src/infrastructure/clients/scheduler/schedule.ts", import.meta.url)
  const base = {
    id: "scheduled_calendar",
    title: "Calendar",
    prompt: "Review",
    time: "08:15",
    timezone: "UTC",
    autoApprove: false,
    enabled: true,
    status: "active",
    revision: 1,
  }
  assert.equal(build({ ...base, frequency: "weekly", weekdays: [0, 2, 6] }, "tenant", "owner", "http://bff.test/dispatch").schedule, "15 8 * * 0,2,6")
  assert.equal(build({ ...base, frequency: "monthly", monthDays: [18, 31] }, "tenant", "owner", "http://bff.test/dispatch").schedule, "15 8 18,31 * *")
  const once = build(
    { ...base, frequency: "once", localDate: "2030-01-01", runAt: new Date("2030-01-01T08:15:00Z") },
    "tenant",
    "owner",
    "http://bff.test/dispatch",
  )
  assert.equal(Object.hasOwn(once, "schedule"), false)
  assert.equal(once.run_at, "2030-01-01T08:15:00.000Z")
})

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

describe("BFF Scheduler control mapping", () => {
  const daily = {
    id: "scheduled_fixture",
    projectId: "project_fixture",
    title: "Daily review",
    prompt: "Review the project.",
    frequency: "daily" as const,
    time: "08:15",
    timezone: "America/New_York",
    autoApprove: true,
    enabled: true,
    status: "active" as const,
    revision: 1,
  }

  it("maps daily local wall time and IANA timezone to the owner ScheduleInput", () => {
    assert.equal(schedulerScheduleName(daily.id), "kokoro.scheduled.scheduled_fixture")
    assert.deepEqual(buildSchedulerSchedule(daily, "tenant_fixture", "user_fixture", "http://bff.test/internal/bff/scheduled-tasks/dispatch"), {
      name: "kokoro.scheduled.scheduled_fixture",
      schedule: "15 8 * * *",
      timezone: "America/New_York",
      url: "http://bff.test/internal/bff/scheduled-tasks/dispatch",
      method: "POST",
      body: {
        tenant_id: "tenant_fixture",
        task_id: "scheduled_fixture",
        task_revision: 1,
        project_id: "project_fixture",
        owner_id: "user_fixture",
        prompt: "Review the project.",
        auto_approve: true,
        timezone: "America/New_York",
      },
      retry: { max_attempts: 3, backoff_seconds: 30, max_backoff_seconds: 300, max_retry_window_seconds: 3600 },
      misfire_policy: "fire_once",
      catch_up_limit: 1,
      overlap_policy: "forbid",
      paused: false,
    })
  })

  it("maps selected weekdays without an anchor, returns them to readers, and pauses inactive tasks", async () => {
    const weekly = {
      ...daily,
      id: "scheduled_weekly",
      frequency: "weekly" as const,
      time: "23:30",
      timezone: "America/Los_Angeles",
      weekdays: [0, 3],
      enabled: false,
      status: "paused" as const,
    }
    const result = buildSchedulerSchedule(weekly, "tenant", "owner", "http://bff.test/dispatch")
    assert.equal(result.schedule, "30 23 * * 0,3")
    assert.equal(result.timezone, "America/Los_Angeles")
    assert.equal(result.paused, true)
    const { tsImport } = await import("tsx/esm/api")
    const { scheduledTaskResponse } = await tsImport("../src/application/scheduled/mappers.ts", import.meta.url)
    const snapshot = scheduledTaskResponse(weekly)
    assert.equal(Object.hasOwn(snapshot, "recurrence_anchor_at"), false, "immutable mutation snapshots retain their original shape")
    const { scheduledTaskDetails } = await tsImport("../src/application/scheduled/mappers.ts", import.meta.url)
    for (const nextRunAt of [null, new Date("2026-09-14T06:30:00.000Z")]) {
      const response = scheduledTaskDetails({ task: weekly, state: nextRunAt === null ? "pending" : "active", nextRunAt })
      assert.deepEqual(response.weekdays, [0, 3])
      assert.equal(response.next_run_at, nextRunAt?.toISOString() ?? null)
      assert.equal(response.timezone, "America/Los_Angeles")
      assert.equal(Object.hasOwn(response, "recurrence_anchor_at"), false)
    }
  })

  it("uses generated control operations with exact path, credentials, and owner envelope", async () => {
    const calls: Array<{ method?: string; url?: string; headers: typeof import("node:http").IncomingHttpHeaders }> = []
    const owner = createServer((request, response) => {
      calls.push({ method: request.method, url: request.url, headers: request.headers })
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { name: "kokoro.scheduled.scheduled_fixture", status: "registered" }, meta: { request_id: "request-1" } }))
    })
    const baseUrl = await listen(owner)
    try {
      const client = new SchedulerControlClient(baseUrl, "scheduler-token", 1000, 1024 * 1024)
      const result = await client.create(
        schedulerScheduleName(daily.id),
        buildSchedulerSchedule(daily, "tenant_fixture", "owner_fixture", "http://bff.test/dispatch"),
        { tenantId: "tenant_fixture", requestId: "request-1", idempotencyKey: "command-1" },
      )
      assert.equal(result.kind, "response")
      assert.equal(calls[0]?.method, "POST")
      assert.equal(calls[0]?.url, "/internal/scheduler/v1/schedules/kokoro.scheduled.scheduled_fixture")
      assert.equal(calls[0]?.headers.authorization, "Bearer scheduler-token")
      assert.equal(calls[0]?.headers["x-kokoro-tenant-id"], "tenant_fixture")
      assert.equal(calls[0]?.headers["idempotency-key"], "command-1")
    } finally {
      await new Promise<void>((resolve) => owner.close(() => resolve()))
    }
  })

  it("cancels a streamed owner response as soon as the hard cap is exceeded", async () => {
    let writes = 0
    let responseClosed = false
    let timer: ReturnType<typeof setInterval> | undefined
    const owner = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.once("close", () => {
        responseClosed = true
        if (timer !== undefined) clearInterval(timer)
      })
      timer = setInterval(() => {
        writes += 1
        response.write("x".repeat(32))
        if (writes === 80) {
          clearInterval(timer)
          response.end()
        }
      }, 5)
    })
    const baseUrl = await listen(owner)
    try {
      const client = new SchedulerControlClient(baseUrl, "scheduler-token", 2000, 64)
      const result = await client.delete("kokoro.scheduled.fixture", { tenantId: "tenant", requestId: "request", idempotencyKey: "command" })
      assert.equal(result.kind, "transport")
      await new Promise((resolve) => setTimeout(resolve, 50))
      assert.equal(responseClosed, true)
      assert.ok(writes <= 6, `stream consumed ${writes * 32} bytes before cancellation`)
    } finally {
      if (timer !== undefined) clearInterval(timer)
      owner.closeAllConnections()
      await new Promise<void>((resolve) => owner.close(() => resolve()))
    }
  })
})

it("consumes exclusive recurring or absolute once triggers from the fixed Scheduler contract", async () => {
  const { zScheduleInput } = await import("../dist/generated/scheduler/zod.gen.js")
  const common = { url: "http://bff.test/dispatch" }
  assert.equal(zScheduleInput.safeParse({ ...common, run_at: "2026-11-01T05:30:00.123Z" }).success, true)
  assert.equal(zScheduleInput.safeParse({ ...common, schedule: "30 8 * * 1,3,5" }).success, true)
  for (const invalid of [common, { ...common, schedule: "@daily", run_at: "2026-11-01T05:30:00Z" }]) {
    assert.equal(zScheduleInput.safeParse(invalid).success, false)
  }
})

it("keeps current Scheduler lifecycle conditions when generating Zod validators", async () => {
  const { zCurrentScheduleResponse, zSchedule } = await import("../dist/generated/scheduler/zod.gen.js")
  const common = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "kokoro.scheduled.fixture",
    timezone: "UTC",
    url: "http://bff.test/dispatch",
    method: "POST",
    body: {},
    retry: { max_attempts: 3, backoff_seconds: 30, max_backoff_seconds: 300, max_retry_window_seconds: 3600 },
    misfire_policy: "fire_once",
    catch_up_limit: 1,
    overlap_policy: "forbid",
    paused: false,
    version: 2,
  }
  const current = { ...common, schedule: "@daily", status: "active", next_due_at: "2026-11-01T05:30:00Z" }
  const exhausted = { ...common, run_at: "2026-11-01T05:30:00Z", status: "exhausted", next_due_at: null }
  for (const schedule of [current, exhausted]) assert.equal(zCurrentScheduleResponse.safeParse({ data: { schedule } }).success, true)
  const consumedAck = { ...common, run_at: exhausted.run_at, next_due_at: null }
  assert.equal(zSchedule.safeParse(consumedAck).success, true, "consumed once mutation ACK is valid")
  const missingNext: Record<string, unknown> = { ...consumedAck }
  delete missingNext.next_due_at
  for (const schedule of [
    { ...common, schedule: "@daily", next_due_at: null },
    { ...consumedAck, paused: true },
    { ...consumedAck, schedule: "@daily" },
    missingNext,
  ])
    assert.equal(zSchedule.safeParse(schedule).success, false, JSON.stringify(schedule))
  const neither: Record<string, unknown> = { ...current }
  delete neither.schedule
  const missing: Record<string, unknown> = { ...current }
  delete missing.timezone
  for (const schedule of [
    missing,
    { ...current, retry: { max_attempts: 3 } },
    { ...current, retry: { ...common.retry, extra: true } },
    neither,
    { ...current, run_at: "2026-11-01T05:30:00Z" },
    { ...current, next_due_at: null },
    { ...exhausted, next_due_at: "2026-11-01T05:31:00Z" },
    { ...current, status: "exhausted", next_due_at: null },
    { ...current, unexpected: true },
  ])
    assert.equal(zCurrentScheduleResponse.safeParse({ data: { schedule } }).success, false, JSON.stringify(schedule))
})

it("reads current owner state with trusted scope but without a command identity or body", async () => {
  const calls: Array<{ method?: string; url?: string; headers: typeof import("node:http").IncomingHttpHeaders; body: string }> = []
  const current = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "kokoro.scheduled.fixture",
    timezone: "UTC",
    url: "http://bff.test/dispatch",
    method: "POST",
    body: { task_revision: 3 },
    retry: { max_attempts: 3, backoff_seconds: 30, max_backoff_seconds: 300, max_retry_window_seconds: 3600 },
    misfire_policy: "fire_once",
    catch_up_limit: 1,
    overlap_policy: "forbid",
    paused: false,
    version: 4,
    run_at: "2026-11-01T05:30:00Z",
    status: "exhausted",
    next_due_at: null,
  }
  let snapshot: Record<string, unknown> = current
  const owner = createServer((request, response) => {
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk: string) => {
      body += chunk
    })
    request.on("end", () => {
      calls.push({ method: request.method, url: request.url, headers: request.headers, body })
      response.setHeader("content-type", "application/json")
      response.setHeader("x-request-id", "req-current")
      response.setHeader("cache-control", "no-store")
      response.end(JSON.stringify({ data: { schedule: snapshot } }))
    })
  })
  const baseUrl = await listen(owner)
  try {
    const client = new SchedulerControlClient(baseUrl, "scheduler-token", 1000, 1024 * 1024)
    const read = Reflect.get(client, "current")
    assert.equal(typeof read, "function")
    const result = await read.call(client, current.name, { tenantId: "tenant-a", requestId: "req-current" })
    assert.deepEqual(result, { kind: "response", status: 200, body: { data: { schedule: current } } })
    assert.equal(calls[0]?.method, "GET")
    assert.equal(calls[0]?.url, `/internal/scheduler/v1/schedules/${current.name}`)
    assert.equal(calls[0]?.headers.authorization, "Bearer scheduler-token")
    assert.equal(calls[0]?.headers["x-kokoro-tenant-id"], "tenant-a")
    assert.equal(calls[0]?.headers["idempotency-key"], undefined)
    assert.equal(calls[0]?.body, "")
    for (const invalid of [
      { ...current, name: "other" },
      { ...current, paused: true },
      { ...current, status: "active" },
      { ...current, next_due_at: "2026-11-01T05:31:00Z" },
      { ...current, status: "active", run_at: "2026-11-01T05:30:00.123Z", next_due_at: "2026-11-01T05:30:00.1234Z" },
    ]) {
      snapshot = invalid
      const rejected = await read.call(client, current.name, { tenantId: "tenant-a", requestId: "req-current" })
      assert.equal(rejected.kind, "transport", "invalid current state must never become success")
    }
    snapshot = { ...current, status: "active", run_at: "2026-11-01T05:30:00.1Z", next_due_at: "2026-11-01T05:30:00.100Z" }
    const equivalent = await read.call(client, current.name, { tenantId: "tenant-a", requestId: "req-current" })
    assert.equal(equivalent.kind, "response", "equivalent instants with different trailing zeros remain valid")
    const before = calls.length
    const controller = new AbortController()
    controller.abort()
    const cancelled = await read.call(client, current.name, { tenantId: "tenant-a", requestId: "req-current" }, controller.signal)
    assert.equal(cancelled.kind, "transport")
    assert.equal(calls.length, before, "cancelled reads must not reach the owner")
  } finally {
    await new Promise<void>((resolve) => owner.close(() => resolve()))
  }
})

it("cancels an in-flight current query before headers and during the response stream", async () => {
  for (const phase of ["headers", "body"]) {
    let seen!: () => void
    let closed!: () => void
    const received = new Promise<void>((resolve) => {
      seen = resolve
    })
    const disconnected = new Promise<void>((resolve) => {
      closed = resolve
    })
    const owner = createServer((_request, response) => {
      response.once("close", closed)
      if (phase === "body") {
        response.writeHead(200, { "content-type": "application/json" })
        response.write('{"data":')
      }
      seen()
    })
    const baseUrl = await listen(owner)
    const client = new SchedulerControlClient(baseUrl, "scheduler-token", 5000, 1024 * 1024)
    const controller = new AbortController()
    const pending = client.current("kokoro.scheduled.fixture", { tenantId: "tenant-a", requestId: "req-current" }, controller.signal)
    let watchdog: ReturnType<typeof setTimeout> | undefined
    try {
      await received
      controller.abort()
      await Promise.race([
        disconnected,
        new Promise<never>((_resolve, reject) => {
          watchdog = setTimeout(() => reject(new Error(`${phase}: caller abort did not close the owner response`)), 1000)
        }),
      ])
      const result = await pending
      assert.deepEqual(result, { kind: "transport", errorCode: "scheduler_request_cancelled" })
    } finally {
      clearTimeout(watchdog)
      owner.closeAllConnections()
      await pending
      await new Promise<void>((resolve) => owner.close(() => resolve()))
    }
  }
})

it("binds current task state to the complete delivered definition, not a frozen mutation next", async () => {
  const { tsImport } = await import("tsx/esm/api")
  const { SchedulerTaskStateReader } = await tsImport("../src/infrastructure/clients/scheduler/task-state-reader.ts", import.meta.url)
  const task = {
    id: "scheduled_current",
    title: "Once",
    prompt: "Review",
    frequency: "once",
    time: "08:15",
    timezone: "UTC",
    localDate: "2030-01-01",
    runAt: new Date("2030-01-01T08:15:00Z"),
    autoApprove: false,
    enabled: true,
    status: "active",
    revision: 3,
  }
  const scope = { tenantId: "tenant", subjectId: "owner" }
  const target = "http://bff.test/dispatch"
  const expected = buildSchedulerSchedule(task, scope.tenantId, scope.subjectId, target)
  let current = { ...expected, id: "00000000-0000-4000-8000-000000000001", version: 9, status: "exhausted", next_due_at: null }
  const reader = new SchedulerTaskStateReader(
    {
      async current() {
        return { kind: "response", status: 200, body: { data: { schedule: current } } }
      },
    },
    target,
  )
  assert.deepEqual(await reader.read(task, scope, "req", new AbortController().signal), { state: "exhausted", nextRunAt: null })
  const pausedOnce = { ...task, enabled: false, status: "paused" }
  assert.deepEqual(await reader.read(pausedOnce, scope, "req", new AbortController().signal), { state: "exhausted", nextRunAt: null })
  for (const mutate of [
    () => ({ ...current, body: { ...expected.body, task_revision: 2 } }),
    () => ({ ...current, body: { ...expected.body, owner_id: "other" } }),
    () => ({ ...current, url: "http://foreign.test/dispatch" }),
    () => ({ ...current, run_at: "2030-01-01T08:15:00.000000001Z" }),
    () => ({ ...current, schedule: "15 8 * * *" }),
  ]) {
    const valid = current
    current = mutate()
    await assert.rejects(reader.read(task, scope, "req", new AbortController().signal), /scheduler_current_unavailable/u)
    await assert.rejects(reader.read(pausedOnce, scope, "req", new AbortController().signal), /scheduler_current_unavailable/u)
    current = valid
  }
  const recurring = { ...task, frequency: "weekly", weekdays: [0, 2], localDate: undefined, runAt: undefined }
  current = {
    ...buildSchedulerSchedule(recurring, "tenant", "owner", target),
    id: current.id,
    version: 10,
    status: "active",
    next_due_at: "2030-01-08T08:15:00Z",
  }
  assert.deepEqual(await reader.read(recurring, scope, "req", new AbortController().signal), { state: "active", nextRunAt: new Date("2030-01-08T08:15:00Z") })
  current = { ...current, paused: true, status: "paused" }
  await assert.rejects(reader.read(recurring, scope, "req", new AbortController().signal), /scheduler_current_unavailable/u)
  assert.deepEqual(await reader.read({ ...recurring, enabled: false, status: "paused" }, scope, "req", new AbortController().signal), {
    state: "paused",
    nextRunAt: null,
  })
})

it("reads only settled exact-revision schedules and rejects a changed task after the owner query", async () => {
  const { tsImport } = await import("tsx/esm/api")
  const { ScheduledTaskReadService } = await tsImport("../src/application/scheduled-task-read-service.ts", import.meta.url)
  const task = {
    id: "scheduled_current",
    title: "Review",
    prompt: "Review",
    frequency: "daily",
    time: "08:15",
    timezone: "UTC",
    autoApprove: false,
    enabled: true,
    status: "active",
    revision: 3,
  }
  let snapshot = { task, deliveryStatus: "pending" }
  let calls = 0
  const scope = { tenantId: "tenant", subjectId: "owner" }
  const service = new ScheduledTaskReadService(
    {
      async snapshots() {
        return [snapshot]
      },
    },
    {
      async read() {
        calls++
        return { state: "active", nextRunAt: new Date("2030-01-01T08:15:00Z") }
      },
    },
  )
  assert.deepEqual(await service.read(scope, "req", new AbortController().signal), [{ task, state: "pending", nextRunAt: null }])
  assert.equal(calls, 0)
  snapshot = { task, deliveryStatus: "succeeded" }
  assert.equal((await service.read(scope, "req", new AbortController().signal))[0].nextRunAt.toISOString(), "2030-01-01T08:15:00.000Z")
  assert.equal(calls, 1)
  const racing = new ScheduledTaskReadService(
    {
      async snapshots() {
        return [snapshot]
      },
    },
    {
      async read() {
        snapshot = { task: { ...task, revision: 4 }, deliveryStatus: "pending" }
        return { state: "active", nextRunAt: new Date("2030-01-01T08:15:00Z") }
      },
    },
  )
  await assert.rejects(racing.read(scope, "req", new AbortController().signal), /scheduled_task_read_changed/u)
  snapshot = { task, deliveryStatus: null }
  await assert.rejects(service.read(scope, "req", new AbortController().signal), /scheduled_task_delivery_missing/u)
})

it("bounds current list fanout and cancels in-flight queries before starting queued tasks", async () => {
  const { tsImport } = await import("tsx/esm/api")
  const { ScheduledTaskReadService } = await tsImport("../src/application/scheduled-task-read-service.ts", import.meta.url)
  const task = {
    id: "scheduled",
    title: "Review",
    prompt: "Review",
    frequency: "daily",
    time: "08:15",
    timezone: "UTC",
    autoApprove: false,
    enabled: true,
    status: "active",
    revision: 1,
  }
  const rows = Array.from({ length: 20 }, (_, i) => ({ task: { ...task, id: `scheduled_${i}` }, deliveryStatus: "succeeded" }))
  let calls = 0,
    running = 0,
    max = 0
  let started!: () => void
  const firstFour = new Promise<void>((resolve) => {
    started = resolve
  })
  const source = {
    async snapshots() {
      return rows
    },
  }
  const owner = {
    async read(_task, _scope, _id, signal: AbortSignal) {
      calls++
      running++
      max = Math.max(max, running)
      if (calls === 4) started()
      try {
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(Error("cancelled")), { once: true })
        })
      } finally {
        running--
      }
    },
  }
  const service = new ScheduledTaskReadService(source, owner)
  const controller = new AbortController()
  const pending = service.read({ tenantId: "tenant", subjectId: "owner" }, "req", controller.signal)
  await firstFour
  controller.abort()
  await assert.rejects(pending)
  assert.equal(max, 4)
  assert.equal(calls, 4)
  assert.equal(running, 0)
  let failStarted = 0,
    failClosed = 0
  const failOne = new ScheduledTaskReadService(source, {
    async read(_task, _scope, _id, signal: AbortSignal) {
      const i = failStarted++
      if (i === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        throw Error("owner-down")
      }
      try {
        await new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(Error("cancelled")), { once: true }))
      } finally {
        failClosed++
      }
    },
  })
  await assert.rejects(failOne.read({ tenantId: "tenant", subjectId: "owner" }, "req", new AbortController().signal), /owner-down/u)
  assert.equal(failStarted, 4)
  assert.equal(failClosed, 3)
})

it("enforces one monotonic current-read deadline even before the abort timer can run", async () => {
  const { tsImport } = await import("tsx/esm/api")
  const { ScheduledTaskReadService } = await tsImport("../src/application/scheduled-task-read-service.ts", import.meta.url)
  const task = {
    id: "scheduled",
    title: "Review",
    prompt: "Review",
    frequency: "daily",
    time: "08:15",
    timezone: "UTC",
    autoApprove: false,
    enabled: true,
    status: "active",
    revision: 1,
  }
  let reads = 0
  const deadline = performance.now() + 30
  const service = new ScheduledTaskReadService(
    {
      async snapshots() {
        reads++
        return [{ task, deliveryStatus: "succeeded" }]
      },
    },
    {
      async read() {
        // An event-loop-delayed timer is not a deadline. Simulate completion before its callback runs.
        while (performance.now() <= deadline + 5) {
          /* bounded CPU delay in this test process only */
        }
        return { state: "active", nextRunAt: new Date("2030-01-01T08:15:00Z") }
      },
    },
  )
  await assert.rejects(
    service.read({ tenantId: "tenant", subjectId: "owner" }, "req", new AbortController().signal, { deadline }),
    /scheduled_task_read_deadline/u,
  )
  assert.equal(reads, 1, "do not start more I/O after the page budget is exhausted")
})
