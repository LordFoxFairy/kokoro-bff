import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { scheduledCreateInput, scheduledPatchInput } from "../dist/application/scheduled/input.js"

describe("ScheduledTask time boundary", () => {
  it("normalizes offset-bearing instants to aware UTC Date values", () => {
    const input = scheduledCreateInput({
      title: "Review",
      prompt: "Review the project.",
      frequency: "daily",
      time: "08:00",
      timezone: "America/New_York",
      next_run_at: "2026-09-01T08:00:00-04:00",
      expires_at: "2026-09-02T08:00:00+00:00",
    })

    assert.ok(input !== null)
    assert.ok(input.nextRunAt instanceof Date)
    assert.equal(input.nextRunAt.toISOString(), "2026-09-01T12:00:00.000Z")
    assert.equal(input.expiresAt?.toISOString(), "2026-09-02T08:00:00.000Z")
  })

  it("rejects a non-IANA timezone and a timezone-less instant", () => {
    assert.equal(scheduledCreateInput({
      title: "Review",
      prompt: "Review the project.",
      frequency: "daily",
      time: "08:00",
      timezone: "Not/AZone",
      next_run_at: "2026-09-01T08:00:00Z",
    }), null)
    assert.equal(scheduledCreateInput({
      title: "Review",
      prompt: "Review the project.",
      frequency: "daily",
      time: "08:00",
      timezone: "UTC",
      next_run_at: "2026-09-01T08:00:00",
    }), null)
  })

  it("keeps patch clearing semantics while returning Date values", () => {
    const patch = scheduledPatchInput({
      next_run_at: "2026-09-01T08:00:00+02:00",
      expires_at: null,
      timezone: "UTC",
    })
    assert.ok(patch !== null)
    assert.equal(patch.nextRunAt?.toISOString(), "2026-09-01T06:00:00.000Z")
    assert.equal(patch.expiresAt, null)
  })
})
