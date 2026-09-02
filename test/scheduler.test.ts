import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { buildSchedulerJob, schedulerJobName } from "../dist/adapters/scheduler.js"

describe("BFF Scheduler adapter", () => {
  it("maps a BFF task into a stable UTC ScheduleJob", () => {
    const task = {
      id: "scheduled_fixture",
      project_id: "project_fixture",
      title: "Daily review",
      prompt: "Review the project.",
      frequency: "daily" as const,
      time: "08:00",
      timezone: "America/New_York",
      next_run_at: "2026-09-01T12:00:00.000Z",
      auto_approve: true,
      enabled: true,
      status: "active" as const,
    }
    assert.equal(schedulerJobName(task.id), "kokoro.scheduled.scheduled_fixture")
    assert.deepEqual(buildSchedulerJob(task, "tenant_fixture", "user_fixture", "http://bff.test/internal/bff/scheduled-tasks/dispatch"), {
      name: "kokoro.scheduled.scheduled_fixture",
      schedule: "0 12 * * *",
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
      retry: { max_attempts: 3, backoff_seconds: 30 },
      misfire_policy: "fire_once",
      paused: false,
    })
  })

  it("uses the next occurrence weekday for weekly tasks and pauses disabled tasks", () => {
    const task = {
      id: "scheduled_weekly",
      title: "Weekly review",
      prompt: "Review.",
      frequency: "weekly" as const,
      time: "08:00",
      timezone: "UTC",
      next_run_at: "2026-09-06T08:00:00.000Z",
      auto_approve: false,
      enabled: false,
      status: "paused" as const,
    }
    assert.equal(buildSchedulerJob(task, "tenant", "owner", "http://bff.test/dispatch").schedule, "0 8 * * 0")
    assert.equal(buildSchedulerJob(task, "tenant", "owner", "http://bff.test/dispatch").paused, true)
  })
})
