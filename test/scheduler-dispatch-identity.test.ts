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
