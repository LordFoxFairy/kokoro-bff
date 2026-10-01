import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  canonicalSchedulerJson,
  canonicalSchedulerOccurrence,
  schedulerDispatchDigest,
  schedulerDispatchScope,
  schedulerOccurrenceIdentity,
} from "../dist/infrastructure/clients/scheduler/dispatch-identity.js"

describe("Scheduler dispatch identity", () => {
  it("recursively orders UTF-16 object keys without integer-index reordering", () => {
    const value = { "2": "two", "10": "ten", "01": "one", nested: { "2": 2, "10": 10, "01": 1 } }
    assert.equal(canonicalSchedulerJson(value), '{"01":"one","10":"ten","2":"two","nested":{"01":1,"10":10,"2":2}}')
  })

  it("preserves Unicode and array order while normalizing only JSON number semantics", () => {
    const decomposed = "e\u0301"
    assert.equal(canonicalSchedulerJson({ z: [3, -0, 1.25, { b: "雪", a: decomposed }] }), `{"z":[3,0,1.25,{"a":"${decomposed}","b":"雪"}]}`)
    assert.throws(() => canonicalSchedulerJson({ value: Number.POSITIVE_INFINITY }), /finite JSON number/u)
    assert.throws(() => canonicalSchedulerJson(undefined), /JSON value/u)
  })

  it("canonicalizes valid RFC3339Nano UTC instants without losing fractional precision", () => {
    assert.equal(canonicalSchedulerOccurrence("2026-09-01T12:00:00.120000000Z"), "2026-09-01T12:00:00.12Z")
    assert.equal(canonicalSchedulerOccurrence("2026-09-01T12:00:00.000Z"), "2026-09-01T12:00:00Z")
    assert.throws(() => canonicalSchedulerOccurrence("20260901T120000Z"), /RFC3339Nano/u)
    assert.throws(() => canonicalSchedulerOccurrence("2026-02-30T12:00:00Z"), /RFC3339Nano/u)
    assert.throws(() => canonicalSchedulerOccurrence("2026-09-01T12:00:60Z"), /RFC3339Nano/u)
    assert.throws(() => canonicalSchedulerOccurrence("2026-09-01T12:00:00+00:00"), /RFC3339Nano/u)
  })

  it("validates proleptic Gregorian years without Date.UTC 0000-0099 remapping", () => {
    assert.equal(canonicalSchedulerOccurrence("0000-02-29T00:00:00Z"), "0000-02-29T00:00:00Z")
    assert.equal(canonicalSchedulerOccurrence("0099-12-31T23:59:59.100Z"), "0099-12-31T23:59:59.1Z")
    assert.equal(canonicalSchedulerOccurrence("0100-01-01T00:00:00Z"), "0100-01-01T00:00:00Z")
    assert.throws(() => canonicalSchedulerOccurrence("0099-02-29T00:00:00Z"), /RFC3339Nano/u)
    assert.throws(() => canonicalSchedulerOccurrence("0100-02-29T00:00:00Z"), /RFC3339Nano/u)
    assert.equal(canonicalSchedulerOccurrence("0400-02-29T00:00:00Z"), "0400-02-29T00:00:00Z")
  })

  it("separates receipt scope from semantic digest and occurrence identity", () => {
    const body = { tenant_id: "tenant-a", task_id: "task-a", owner_id: "actor-a", prompt: "go", auto_approve: false, timezone: "UTC" }
    const input = { tenantId: "tenant-a", schedule: "kokoro.scheduled.task-a", occurrence: "2026-09-01T12:00:00.1Z", body }
    assert.equal(schedulerDispatchScope("tenant-a", " opaque key "), '["tenant-a","scheduler-dispatch:v1"," opaque key "]')
    assert.equal(schedulerDispatchDigest(input), schedulerDispatchDigest({ ...input, occurrence: "2026-09-01T12:00:00.100Z" }))
    assert.notEqual(schedulerDispatchDigest(input), schedulerDispatchDigest({ ...input, occurrence: "2026-09-01T12:00:00.100000001Z" }))
    assert.equal(schedulerOccurrenceIdentity(input), schedulerOccurrenceIdentity({ ...input, body: { changed: true } }))
    assert.equal(schedulerOccurrenceIdentity(input), schedulerOccurrenceIdentity({ ...input, body, requestId: "different" } as never))
    assert.notEqual(schedulerOccurrenceIdentity(input), schedulerOccurrenceIdentity({ ...input, schedule: "kokoro.scheduled.task-b" }))
  })
})

it("rejects legacy receipt envelopes and snapshots lacking explicit empty selection", async () => {
  const { PostgresSchedulerDispatchReceiptRepository } = await import("../dist/infrastructure/postgres/scheduler-dispatch-receipt-repository.js")
  const base = {
    schema_version: 2,
    state: "pending",
    claim_token: "old",
    lease_until: "2099-01-01T00:00:00Z",
    retry_at: null,
    last_error_code: null,
    response: null,
    snapshot: {
      tenantId: "t",
      schedule: "s",
      occurrence: "o",
      idempotencyKey: "k",
      actorId: "a",
      taskId: "task",
      taskRevision: 1,
      launch: {
        requestId: "r",
        body: { selected_skill_source_refs: [] },
        identityAssertionRef: "i",
        receipt: { run_id: "r", user_message_id: "u", assistant_message_id: "a" },
      },
    },
  }
  const observations: string[] = []
  const repository = (envelope: unknown) =>
    new PostgresSchedulerDispatchReceiptRepository({
      connect: async () => ({
        query: async (sql: string) => {
          observations.push(sql)
          if (sql.startsWith("SELECT fingerprint")) return { rows: [{ fingerprint: "digest", status: 102, response_body: envelope }] }
          if (sql.startsWith("SELECT clock_timestamp")) return { rows: [{ now: new Date("2026-01-01") }] }
          return { rowCount: 0, rows: [] }
        },
        release: () => undefined,
      }),
    } as never)
  assert.deepEqual(await repository(base).claim("scope", "digest"), { outcome: "pending" })
  for (const envelope of [
    { ...base, schema_version: 1 },
    ...[{}, { selected_skill_source_refs: null }, { selected_skill_source_refs: ["skill:a"] }].map((body) => ({
      ...base,
      snapshot: { ...base.snapshot, launch: { ...base.snapshot.launch, body } },
    })),
  ]) {
    await assert.rejects(repository(envelope).claim("scope", "digest"), /envelope is invalid/)
  }
  assert.equal(
    observations.some((sql) => sql.startsWith("UPDATE")),
    false,
  )
})
