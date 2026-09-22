import assert from "node:assert/strict"
import { createServer } from "node:http"
import { describe, it } from "node:test"

import { buildSchedulerSchedule, schedulerScheduleName } from "../dist/infrastructure/clients/scheduler/schedule.js"
import { SchedulerControlClient } from "../dist/infrastructure/clients/scheduler/control-client.js"

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
    nextRunAt: new Date("2026-09-01T12:15:00.000Z"),
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

  it("maps weekly weekday in the configured local timezone and pauses inactive tasks", () => {
    const weekly = {
      ...daily,
      id: "scheduled_weekly",
      frequency: "weekly" as const,
      time: "23:30",
      timezone: "America/Los_Angeles",
      nextRunAt: new Date("2026-09-07T06:30:00.000Z"), // Sunday 23:30 local.
      enabled: false,
      status: "paused" as const,
    }
    const result = buildSchedulerSchedule(weekly, "tenant", "owner", "http://bff.test/dispatch")
    assert.equal(result.schedule, "30 23 * * 0")
    assert.equal(result.timezone, "America/Los_Angeles")
    assert.equal(result.paused, true)
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
