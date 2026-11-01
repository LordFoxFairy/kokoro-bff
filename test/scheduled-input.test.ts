import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { scheduledCreateInput, scheduledPatchInput } from "../dist/application/scheduled/input.js"

describe("explicit calendar periods", () => {
  const base = { trigger_kind: "calendar", title: "Review", prompt: "Review once due.", time: "08:15", timezone: "UTC" }
  it("stores multiple selected weekdays and month days without an inferred anchor", async () => {
    const { scheduledCreateInput: parse } = await r73ScheduledInputSource()
    assert.deepEqual(parse({ ...base, frequency: "weekly", weekdays: [6, 0, 2] }), {
      title: base.title,
      prompt: base.prompt,
      time: base.time,
      timezone: base.timezone,
      triggerKind: "calendar",
      frequency: "weekly",
      weekdays: [0, 2, 6],
      autoApprove: false,
    })
    assert.deepEqual(parse({ ...base, frequency: "monthly", month_days: [31, 18] }), {
      title: base.title,
      prompt: base.prompt,
      time: base.time,
      timezone: base.timezone,
      triggerKind: "calendar",
      frequency: "monthly",
      monthDays: [18, 31],
      autoApprove: false,
    })
  })
  it("resolves once date in the selected zone, not the machine zone or current date", async () => {
    const { scheduledCreateInput: parse } = await r73ScheduledInputSource()
    const parsed = parse({ ...base, frequency: "once", local_date: "2030-01-01", timezone: "Asia/Kathmandu" })
    assert.ok(parsed !== null)
    assert.equal(parsed.localDate, "2030-01-01")
    assert.equal(parsed.runAt.toISOString(), "2030-01-01T02:30:00.000Z")
    assert.equal(Object.hasOwn(parsed, "recurrenceAnchorAt"), false)
  })
  it("rejects gaps and invalid dates, chooses the earlier repeated local instant", async () => {
    const { scheduledCreateInput: parse } = await r73ScheduledInputSource()
    assert.equal(parse({ ...base, frequency: "once", local_date: "2030-03-10", time: "02:30", timezone: "America/New_York" }), null)
    assert.equal(parse({ ...base, frequency: "once", local_date: "2030-02-30" }), null)
    assert.equal(parse({ ...base, frequency: "once", local_date: "2030-02-29" }), null)
    const fold = parse({ ...base, frequency: "once", local_date: "2030-11-03", time: "01:30", timezone: "America/New_York" })
    assert.ok(fold !== null)
    assert.equal(fold.runAt.toISOString(), "2030-11-03T05:30:00.000Z")
    const halfHour = parse({ ...base, frequency: "once", local_date: "2030-04-07", time: "01:45", timezone: "Australia/Lord_Howe" })
    assert.ok(halfHour !== null)
    assert.equal(halfHour.runAt.toISOString(), "2030-04-06T14:45:00.000Z")
  })
  it("validates shape but does not use now before immutable receipt replay", async () => {
    const { scheduledCreateInput: parse } = await r73ScheduledInputSource()
    assert.ok(parse({ ...base, frequency: "once", local_date: "2001-01-01" }) !== null)
  })
  it("rejects missing, mixed, duplicate, noninteger and out-of-range selections and retired anchor", async () => {
    const { scheduledCreateInput: parse } = await r73ScheduledInputSource()
    for (const rule of [
      { frequency: "weekly" },
      { frequency: "weekly", weekdays: [] },
      { frequency: "weekly", weekdays: [1, 1] },
      { frequency: "weekly", weekdays: [1.5] },
      { frequency: "weekly", weekdays: [7] },
      { frequency: "weekly", weekdays: ["1"] },
      { frequency: "monthly", month_days: [0] },
      { frequency: "monthly", month_days: [32] },
      { frequency: "monthly", month_days: [31, 31] },
      { frequency: "daily", weekdays: [1] },
      { frequency: "once", local_date: "2030-01-01", month_days: [1] },
      { frequency: "daily", recurrence_anchor_at: "2030-01-01T00:00:00Z" },
    ])
      assert.equal(parse({ ...base, ...rule }), null, JSON.stringify(rule))
  })
  it("requires a complete calendar rule for rule patches while keeping ordinary partial edits", async () => {
    const { scheduledPatchInput: parse } = await r73ScheduledInputSource()
    assert.equal(parse({ time: "10:30" }), null)
    assert.equal(parse({ frequency: "weekly", weekdays: [1] }), null)
    assert.deepEqual(parse({ trigger_kind: "calendar", frequency: "weekly", weekdays: [4, 1], time: "10:30", timezone: "UTC" }), {
      triggerKind: "calendar",
      frequency: "weekly",
      weekdays: [1, 4],
      time: "10:30",
      timezone: "UTC",
    })
    assert.deepEqual(parse({ title: "Renamed", enabled: false, expires_at: null }), { title: "Renamed", enabled: false, expiresAt: null })
  })
})

describe("ScheduledTask time boundary", () => {
  it("normalizes offset-bearing expiry to aware UTC without inventing an anchor", () => {
    const input = scheduledCreateInput({
      trigger_kind: "calendar",
      title: "Review",
      prompt: "Review the project.",
      frequency: "daily",
      time: "08:00",
      timezone: "America/New_York",
      expires_at: "2026-09-02T08:00:00+00:00",
    })

    assert.ok(input !== null)
    assert.equal(Object.hasOwn(input, "recurrenceAnchorAt"), false)
    assert.equal(input.expiresAt?.toISOString(), "2026-09-02T08:00:00.000Z")
  })

  it("rejects a non-IANA timezone and a timezone-less instant", () => {
    assert.equal(
      scheduledCreateInput({
        trigger_kind: "calendar",
        title: "Review",
        prompt: "Review the project.",
        frequency: "daily",
        time: "08:00",
        timezone: "Not/AZone",
      }),
      null,
    )
    assert.equal(
      scheduledCreateInput({
        trigger_kind: "calendar",
        title: "Review",
        prompt: "Review the project.",
        frequency: "daily",
        time: "08:00",
        timezone: "UTC",
        expires_at: "2026-09-01T08:00:00",
      }),
      null,
    )
  })

  it("keeps patch clearing semantics while returning Date values", () => {
    const patch = scheduledPatchInput({
      trigger_kind: "calendar",
      frequency: "weekly",
      time: "08:00",
      weekdays: [2, 4],
      expires_at: null,
      timezone: "UTC",
    })
    assert.ok(patch !== null)
    assert.deepEqual(patch.weekdays, [2, 4])
    assert.equal(patch.expiresAt, null)
  })
})

// R73 is create-only. Load production source so stale dist cannot manufacture RED/GREEN.
async function r73ScheduledInputSource() {
  const { tsImport } = await import("tsx/esm/api")
  return tsImport("../src/application/scheduled/input.ts", import.meta.url)
}

function r73ScheduledPayload(): Record<string, unknown> {
  return {
    trigger_kind: "calendar",
    title: "R73 independent review",
    prompt: "Review the next steps.",
    frequency: "daily",
    time: "08:00",
    timezone: "UTC",
    expires_at: "2026-11-03T08:00:00.000Z",
    auto_approve: false,
  }
}

async function r73ParseCreate(payload: Record<string, unknown>) {
  const { scheduledCreateInput: parse } = await r73ScheduledInputSource()
  // Exercise the existing route call shape, including its current second argument.
  return parse(payload, typeof payload.project_id === "string" ? payload.project_id : undefined)
}

describe("R73 ScheduledTask create closed input", () => {
  it("keeps a legal independent task without Project or Conversation", async () => {
    const input = await r73ParseCreate(r73ScheduledPayload())
    assert.deepEqual(input, {
      triggerKind: "calendar",
      title: "R73 independent review",
      prompt: "Review the next steps.",
      frequency: "daily",
      time: "08:00",
      timezone: "UTC",
      expiresAt: new Date("2026-11-03T08:00:00.000Z"),
      autoApprove: false,
    })
  })

  for (const reference of ["project_owned", "owned-project-slug"]) {
    it(`preserves the exact legal Project reference ${reference}`, async () => {
      const independent = await r73ParseCreate(r73ScheduledPayload())
      assert.ok(independent !== null)
      assert.deepEqual(await r73ParseCreate({ ...r73ScheduledPayload(), project_id: reference }), { ...independent, projectId: reference })
    })
  }

  it("keeps omitted auto_approve=false and explicit true controls", async () => {
    const payload = r73ScheduledPayload()
    delete payload.auto_approve
    const omitted = await r73ParseCreate(payload)
    assert.ok(omitted !== null)
    assert.equal(omitted.autoApprove, false)
    assert.deepEqual(await r73ParseCreate({ ...payload, auto_approve: true }), { ...omitted, autoApprove: true })
  })

  const invalidProjects: [string, unknown][] = [
    ["null", null],
    ["number", 42],
    ["boolean", false],
    ["array", []],
    ["object", {}],
    ["empty", ""],
    ["spaces", "   "],
    ["tabs", "\t"],
    ["leading space", " project_owned"],
    ["trailing space", "project_owned "],
    ["leading newline", "\nproject_owned"],
    ["trailing newline", "project_owned\n"],
    ["leading nonbreaking space", "\u00a0project_owned"],
    ["trailing byte-order mark", "project_owned\ufeff"],
  ]
  for (const [label, projectId] of invalidProjects) {
    it(`rejects project_id ${label} rather than creating an independent task or trimming`, async () => {
      assert.equal(await r73ParseCreate({ ...r73ScheduledPayload(), project_id: projectId }), null)
    })
  }

  for (const field of ["unexpected", "tenant_id", "owner_id", "conversation_id", "session_id"]) {
    it(`rejects undeclared create field ${field}`, async () => {
      assert.equal(await r73ParseCreate({ ...r73ScheduledPayload(), [field]: "foreign" }), null)
    })
  }

  for (const [label, value] of [
    ["null", null],
    ["number", 0],
    ["string", "false"],
    ["array", []],
    ["object", {}],
  ] as const) {
    it(`rejects auto_approve ${label} instead of silently defaulting false`, async () => {
      assert.equal(await r73ParseCreate({ ...r73ScheduledPayload(), auto_approve: value }), null)
    })
  }

  for (const enabled of [false, true]) {
    it(`rejects create enabled=${enabled}; creation defaults are not caller-settable`, async () => {
      assert.equal(await r73ParseCreate({ ...r73ScheduledPayload(), enabled }), null)
    })
  }
  for (const status of ["active", "paused", "failed"]) {
    it(`rejects create status=${status}; state changes remain PATCH-owned`, async () => {
      assert.equal(await r73ParseCreate({ ...r73ScheduledPayload(), status }), null)
    })
  }

  it("preserves the existing PATCH pause and enable behavior", async () => {
    const { scheduledPatchInput: parsePatch } = await r73ScheduledInputSource()
    assert.deepEqual(parsePatch({ enabled: false, status: "paused" }), { enabled: false, status: "paused" })
    assert.deepEqual(parsePatch({ enabled: true, status: "active" }), { enabled: true, status: "active" })
  })
})

it("R74 one parser call obtains the exact optional Project from the body for both authorization and creation", async () => {
  const { scheduledCreateInput: parse } = await r73ScheduledInputSource()
  const independent = parse(r73ScheduledPayload())
  assert.ok(independent !== null)
  for (const projectId of ["project_owned", "owned-project-slug"]) {
    assert.deepEqual(parse({ ...r73ScheduledPayload(), project_id: projectId }), { ...independent, projectId })
  }
})

it("R74 shared Project-path parser retains the existing path-bound reference", async () => {
  const { scheduledCreateInput: parse } = await r73ScheduledInputSource()
  const independent = parse(r73ScheduledPayload())
  assert.ok(independent !== null)
  assert.deepEqual(parse(r73ScheduledPayload(), "project_from_path"), { ...independent, projectId: "project_from_path" })
})
