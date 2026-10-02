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

// R73 is create-only. Load production source so stale dist cannot manufacture RED/GREEN.
async function r73ScheduledInputSource() {
  const { tsImport } = await import("tsx/esm/api")
  return tsImport("../src/application/scheduled/input.ts", import.meta.url)
}

function r73ScheduledPayload(): Record<string, unknown> {
  return {
    title: "R73 independent review",
    prompt: "Review the next steps.",
    frequency: "daily",
    time: "08:00",
    timezone: "UTC",
    next_run_at: "2026-10-03T08:00:00.000Z",
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
      title: "R73 independent review",
      prompt: "Review the next steps.",
      frequency: "daily",
      time: "08:00",
      timezone: "UTC",
      nextRunAt: new Date("2026-10-03T08:00:00.000Z"),
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
