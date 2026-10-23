import assert from "node:assert/strict"
import test from "node:test"
import { scheduledCreateInput, scheduledPatchInput } from "../src/application/scheduled/input.js"

test("RSS create accepts its genuine trigger and rejects fabricated calendar fields", () => {
  const task = scheduledCreateInput({ title: "Feed", prompt: "Summarize", trigger_kind: "rss", feed_url: "https://news.example.org/feed", conditions: [] })
  assert.ok(task)
  assert.equal((task as unknown as { triggerKind: string }).triggerKind, "rss")
  assert.equal(
    scheduledCreateInput({ title: "Feed", prompt: "Summarize", trigger_kind: "rss", feed_url: "https://news.example.org/feed", conditions: [], time: "09:00" }),
    null,
  )
})
test("new calendar input requires explicit kind and PATCH trigger is atomic", () => {
  assert.equal(scheduledCreateInput({ title: "Task", prompt: "Do", frequency: "daily", time: "09:00", timezone: "UTC" }), null)
  assert.ok(scheduledCreateInput({ title: "Task", prompt: "Do", trigger_kind: "calendar", frequency: "daily", time: "09:00", timezone: "UTC" }))
  assert.equal(scheduledPatchInput({ feed_url: "https://news.example.org/feed" }), null)
  assert.ok(scheduledPatchInput({ title: "Changed" }))
})

import { buildScheduledTaskOutboxPayload, parseScheduledTaskOutboxPayload, scheduledTaskOutboxTaskFromPayload } from "../src/domain/scheduled-task/outbox.js"
import { canonicalEpoch } from "../src/domain/scheduled-task/trigger.js"
import { buildSchedulerSchedule } from "../src/infrastructure/clients/scheduler/schedule.js"
test("v5 once preserves exact instant while RSS Scheduler wake has no fabricated calendar or prompt", () => {
  const common = {
    taskId: "scheduled_t",
    ownerId: "owner",
    title: "Task",
    prompt: "secret prompt",
    autoApprove: false,
    enabled: true,
    status: "active" as const,
    revision: 1,
    triggerEpoch: "1",
  }
  const lineage = { tenantId: "tenant", actorId: "owner", requestId: "request", idempotencyKey: "key" }
  const once = {
    ...common,
    triggerKind: "calendar" as const,
    frequency: "once" as const,
    time: "08:15",
    timezone: "UTC",
    localDate: "2030-01-01",
    runAt: new Date("2030-01-01T08:15:00.000Z"),
  }
  const payload = buildScheduledTaskOutboxPayload("register", lineage, once)
  assert.equal(payload.schema_version, 5)
  assert.equal(payload.task.run_at, once.runAt.toISOString())
  assert.deepEqual(scheduledTaskOutboxTaskFromPayload(parseScheduledTaskOutboxPayload(payload).task), once)
  const rss = { ...common, triggerKind: "rss" as const, feedUrl: "https://feed.example.org/rss", conditions: [] }
  const projected = buildScheduledTaskOutboxPayload("register", lineage, rss)
  assert.deepEqual(scheduledTaskOutboxTaskFromPayload(parseScheduledTaskOutboxPayload(projected).task), rss)
  const schedule = buildSchedulerSchedule({ ...rss, id: rss.taskId }, "tenant", "owner", "https://bff.example.org/dispatch")
  assert.equal(schedule.timezone, "UTC")
  assert.equal(JSON.stringify(schedule).includes("secret prompt"), false)
  assert.equal(JSON.stringify(schedule).includes("feed.example.org"), false)
  assert.throws(() => parseScheduledTaskOutboxPayload({ ...projected, schema_version: 4 }))
  for (const value of ["0", "01", "-1", "9223372036854775808", 1, null]) assert.throws(() => canonicalEpoch(value))
  assert.equal(canonicalEpoch("9223372036854775807"), "9223372036854775807")
})

import { createServer } from "node:http"
import { schedulerDispatch } from "../src/http/routes/scheduler.js"
test("real Scheduler HTTP RSS branch is closed, separate from calendar v2 replay", async (t) => {
  let polls = 0,
    calendarClaims = 0
  const summary = { poll_id: "rss_poll_fixture", outcome: "baseline", observed_count: 2, enqueued_count: 0 }
  const store = {
    schedulerDispatchReceipts: {
      claim: async () => {
        calendarClaims++
        return { outcome: "terminal", response: { status: 202, body: { immutable: "v2 calendar" } } }
      },
    },
  }
  const service = {
    poll: async (input: { epoch: string; signal: AbortSignal; deadlineAt: number }) => {
      polls++
      assert.equal(input.epoch, "9223372036854775807")
      assert.equal(input.signal.aborted, false)
      assert.ok(input.deadlineAt - performance.now() <= 20000)
      return { outcome: "terminal", summary }
    },
  }
  const server = createServer((request, response) => {
    void schedulerDispatch(request, response, { schedulerServiceToken: "token" } as never, store as never, new Map(), service as never)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const url = `http://127.0.0.1:${address.port}/dispatch`
  const headers = {
    authorization: "Bearer token",
    "content-type": "application/json",
    "x-kokoro-tenant-id": "tenant",
    "x-kokoro-scheduler-schedule": "kokoro.scheduled.scheduled_task",
    "x-kokoro-scheduler-occurrence": "2026-10-23T12:00:00Z",
    "x-request-id": "request",
    "idempotency-key": "poll",
    traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
  }
  const body = {
    tenant_id: "tenant",
    task_id: "scheduled_task",
    task_revision: 1,
    owner_id: "owner",
    trigger_kind: "rss",
    trigger_epoch: "9223372036854775807",
  }
  const send = (value: string, extra = {}) => fetch(url, { method: "POST", headers: { ...headers, ...extra }, body: value })
  const response = await send(JSON.stringify(body))
  assert.equal(response.status, 202)
  assert.deepEqual(((await response.json()) as { data: unknown }).data, summary)
  for (const invalid of [
    { ...body, prompt: "injected" },
    { ...body, trigger_epoch: "01" },
    { ...body, trigger_epoch: 1 },
    { ...body, project_id: null },
  ])
    assert.equal((await send(JSON.stringify(invalid))).status, 400)
  assert.equal((await send(JSON.stringify(body).replace('"trigger_kind":"rss"', '"trigger_kind":"calendar","trigger_kind":"rss"'))).status, 400)
  assert.equal((await send(JSON.stringify(body), { authorization: "Bearer invalid" })).status, 401)
  assert.equal(polls, 1)
  assert.equal(calendarClaims, 0)
  const previous = await send(JSON.stringify({ ...body, trigger_kind: "calendar", trigger_epoch: "1" }))
  assert.equal(previous.status, 202)
  assert.deepEqual(await previous.json(), { immutable: "v2 calendar" })
  assert.equal(calendarClaims, 1)
})

import { request as nodeRequest } from "node:http"
test("Scheduler entry budget includes an unfinished body and retires socket before any receipt/feed IO", { timeout: 25000 }, async (t) => {
  let receipts = 0,
    polls = 0
  const server = createServer((request, response) => {
    void schedulerDispatch(
      request,
      response,
      { schedulerServiceToken: "token" } as never,
      {
        schedulerDispatchReceipts: {
          claim: async () => {
            receipts++
            throw Error("unexpected")
          },
        },
      } as never,
      new Map(),
      {
        poll: async () => {
          polls++
          throw Error("unexpected")
        },
      } as never,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const start = performance.now()
  await new Promise<void>((resolve, reject) => {
    const request = nodeRequest({
      host: "127.0.0.1",
      port: address.port,
      path: "/dispatch",
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json", "transfer-encoding": "chunked" },
    })
    request.once("error", (error) => (error.message.includes("socket hang up") || ("code" in error && error.code === "ECONNRESET") ? resolve() : reject(error)))
    request.once("response", (response) => {
      response.resume()
      response.once("end", resolve)
    })
    request.write("{")
  })
  const elapsed = performance.now() - start
  assert.ok(elapsed >= 19000 && elapsed < 23000, `entry lifetime ${elapsed}ms`)
  assert.equal(receipts, 0)
  assert.equal(polls, 0)
})
