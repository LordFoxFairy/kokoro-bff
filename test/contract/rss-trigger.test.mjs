import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { load } from "js-yaml"
const source = readFileSync(new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
const sql = readFileSync(new URL("../../database/schema.sql", import.meta.url), "utf8")
const document = load(source)
test("Public20 makes trigger kind mandatory without adding operations", () => {
  assert.equal(document.info.version, "20.0.0")
  for (const name of ["ScheduledTask", "ScheduledTaskDetails", "CreateScheduledTaskRequest", "ScheduledTaskRunItem"])
    assert.ok(document.components.schemas[name].required.includes("trigger_kind"), name)
})
test("mutation and current details have independent closed facts", () => {
  const { ScheduledTask: mutation, ScheduledTaskDetails: details } = document.components.schemas
  assert.equal(mutation.properties.feed_state, undefined)
  assert.equal(mutation.properties.scheduling_state, undefined)
  assert.equal(details.additionalProperties, false)
  assert.ok(details.properties.feed_state)
})
test("RSS run time is real observed_at rather than a fabricated scheduled_for", () => {
  const item = document.components.schemas.ScheduledTaskRunItem
  assert.ok(item.properties.observed_at)
  assert.ok(item.oneOf.some((branch) => branch.properties?.scheduled_for?.type === "null"))
})
test("canonical has a bounded current poll and durable source-scoped seen", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bff_scheduled_rss_poll/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bff_scheduled_rss_seen/)
  assert.match(sql, /rss_order_high_watermark/)
})

import { createHash } from "node:crypto"
import { inspectRssTriggerContract, restoreRssTriggerParent, rssTriggerParentBaseline } from "../../scripts/rss-trigger-public-contract.mjs"
import { inspectBillingCreditAccountContract } from "../../scripts/billing-credit-account-public-contract.mjs"
const inventory = JSON.parse(readFileSync(new URL("../../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
const schemas = document.components.schemas
// Test-local JSON Schema evaluator: reads the canonical definitions; no second business schema.
function accepts(schema, value) {
  if (schema.$ref) return accepts(schemas[schema.$ref.split("/").at(-1)], value)
  if (schema.const !== undefined && value !== schema.const) return false
  if (schema.enum && !schema.enum.includes(value)) return false
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value
    if (!types.includes(type) && !(types.includes("integer") && Number.isInteger(value))) return false
  }
  if (schema.allOf && !schema.allOf.every((s) => accepts(s, value))) return false
  if (schema.anyOf && !schema.anyOf.some((s) => accepts(s, value))) return false
  if (schema.oneOf && schema.oneOf.filter((s) => accepts(s, value)).length !== 1) return false
  if (schema.not && accepts(schema.not, value)) return false
  if (schema.if && accepts(schema.if, value) && schema.then && !accepts(schema.then, value)) return false
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (schema.required?.some((key) => !Object.hasOwn(value, key))) return false
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) return false
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(schema.properties ?? {}, key))) return false
    for (const [key, s] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key) && !accepts(s, value[key])) return false
  }
  if (Array.isArray(value)) {
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) return false
    if (schema.uniqueItems && new Set(value.map((x) => JSON.stringify(x))).size !== value.length) return false
    if (schema.items && !value.every((x) => accepts(schema.items, x))) return false
  }
  if (typeof value === "string") {
    const length = Array.from(value).length
    if ((schema.minLength !== undefined && length < schema.minLength) || (schema.maxLength !== undefined && length > schema.maxLength)) return false
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) return false
  }
  if (typeof value === "number") {
    if ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) return false
  }
  return true
}
const common = { title: "Task", prompt: "Observe feed", auto_approve: false }
const rss = { trigger_kind: "rss", feed_url: "https://feed.example/rss", conditions: [] }
const calendar = { trigger_kind: "calendar", frequency: "daily", time: "09:00", timezone: "UTC" }
test("create calendar and RSS are complete mutually exclusive definitions", () => {
  const s = schemas.CreateScheduledTaskRequest
  assert.ok(accepts(s, { ...common, ...calendar }))
  assert.ok(accepts(s, { ...common, ...rss }))
  for (const bad of [
    { ...common },
    { ...common, ...rss, time: "09:00" },
    { ...common, ...calendar, feed_url: rss.feed_url },
    { ...common, trigger_kind: "rss", feed_url: rss.feed_url },
    { ...common, ...rss, unknown: true },
  ])
    assert.equal(accepts(s, bad), false, JSON.stringify(bad))
})
test("PATCH common-only is allowed but each trigger edit must be a complete closed branch", () => {
  const s = schemas.ScheduledTaskPatchRequest
  assert.ok(accepts(s, { title: "Changed" }))
  assert.ok(accepts(s, rss))
  assert.ok(accepts(s, calendar))
  for (const bad of [
    { feed_url: rss.feed_url },
    { conditions: [] },
    { trigger_kind: "calendar" },
    { ...rss, timezone: "UTC" },
    { ...calendar, conditions: [] },
  ])
    assert.equal(accepts(s, bad), false)
})
test("conditions close seven fields ten operators and bounded OR/AND without regex", () => {
  const s = schemas.ScheduledRssConditions
  assert.ok(accepts(s, []))
  for (const field of ["title", "summary", "content", "author", "category", "link", "domain"]) {
    for (const operator of ["contains", "not_contains", "equals", "not_equals", "starts_with", "not_starts_with", "ends_with", "not_ends_with"])
      assert.ok(accepts(s, [[{ field, operator, value: "text" }]]))
    for (const operator of ["is_empty", "is_not_empty"]) {
      assert.ok(accepts(s, [[{ field, operator }]]))
      assert.equal(accepts(s, [[{ field, operator, value: "" }]]), false)
    }
  }
  const item = { field: "title", operator: "contains", value: "x" }
  for (const bad of [
    [[]],
    Array(9).fill([item]),
    [Array(17).fill(item)],
    [[{ ...item, operator: "regex" }]],
    [[{ ...item, field: "html" }]],
    [[{ ...item, value: "" }]],
    [[{ ...item, extra: true }]],
    [[{ ...item, value: "x".repeat(1025) }]],
  ])
    assert.equal(accepts(s, bad), false)
  assert.match(schemas.ScheduledRssCondition.properties.value.description, /UTF-8/u)
  assert.match(schemas.CreateScheduledTaskRequest.properties.feed_url.description, /UTF-8/u)
})
test("current exact inverse recovers immutable19.3 and delegates original billing oracle", () => {
  const parent = restoreRssTriggerParent(source)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "bf1b8809173fcbbabb1d3c4c1994f55763e552b9d3b46b3c577ef10ee7291423")
  assert.deepEqual(inspectRssTriggerContract(source, inventory), [])
  assert.deepEqual(inspectBillingCreditAccountContract(parent, inventory), [])
  assert.deepEqual(rssTriggerParentBaseline(inventory), inventory)
})
test("current version, unrelated old bytes, new constraints and ordered inventory cannot drift", () => {
  for (const [from, to] of [
    ["version: 20.0.0", "version: 19.3.0"],
    ["title: Kokoro Business API", "title: Other"],
    ["maxItems: 8", "maxItems: 9"],
    ["trigger_kind:", "trigger_alias:"],
    ["feed_state:", "feed_alias:"],
  ]) {
    assert.ok(source.includes(from), from)
    assert.ok(inspectRssTriggerContract(source.replace(from, to), inventory).length > 0, from)
  }
  for (const changed of [
    inventory.slice(1),
    [...inventory].reverse(),
    [...inventory, inventory[0]],
    inventory.map((x, i) => (i === 0 ? { ...x, path: "/alias" } : x)),
  ])
    assert.ok(inspectRssTriggerContract(source, changed).length > 0)
})
test("RSS queue SQL uses explicit null-safe branches, lease consistency and cross-epoch capacity index", () => {
  for (const fragment of [
    "trigger_epoch BIGINT NOT NULL",
    "trigger_kind='rss'",
    "rss_url IS NOT NULL",
    "frequency IS NULL",
    "lease_owner IS NULL",
    "lease_token IS NULL",
    "lease_until IS NULL",
    "seen_count",
    "100000",
    "matched=true",
    "dispatch_id IS NOT NULL",
    "source_observed_at",
    "rss_order_high_watermark",
    "source_epoch,source_item_identity",
  ])
    assert.ok(sql.includes(fragment), fragment)
  assert.match(sql, /IS TRUE/u)
  assert.match(sql, /WHERE source_kind='rss' AND status IN/u)
  assert.doesNotMatch(sql, /CHECK[^;]*count\(\*/iu)
})

test("all four calendar frequencies retain their exclusive required period", () => {
  for (const period of [
    { frequency: "daily" },
    { frequency: "weekly", weekdays: [0, 6] },
    { frequency: "monthly", month_days: [1, 31] },
    { frequency: "once", local_date: "2026-10-23" },
  ]) {
    assert.ok(accepts(schemas.CreateScheduledTaskRequest, { ...common, ...calendar, ...period }))
    assert.equal(accepts(schemas.CreateScheduledTaskRequest, { ...common, ...calendar, ...period, conditions: [] }), false)
  }
  for (const period of [
    { frequency: "weekly" },
    { frequency: "weekly", weekdays: [-1] },
    { frequency: "weekly", weekdays: [7] },
    { frequency: "monthly" },
    { frequency: "monthly", month_days: [0] },
    { frequency: "monthly", month_days: [32] },
    { frequency: "once" },
    { frequency: "daily", weekdays: [1] },
  ])
    assert.equal(accepts(schemas.CreateScheduledTaskRequest, { ...common, ...calendar, ...period }), false)
})
test("mutation never leaks current feed facts while details require all RSS facts", () => {
  const base = { ...common, id: "task", auto_approve: false, enabled: true, status: "active", next_run_at: null }
  const ack = { ...base, ...rss }
  const detail = { ...ack, scheduling_state: "active", feed_state: "active", last_checked_at: null, next_check_at: null, error_code: null }
  assert.ok(accepts(schemas.ScheduledTask, ack))
  assert.ok(accepts(schemas.ScheduledTaskDetails, detail))
  for (const key of ["scheduling_state", "feed_state", "last_checked_at", "next_check_at", "error_code"])
    assert.equal(accepts(schemas.ScheduledTask, { ...ack, [key]: detail[key] }), false)
  for (const key of ["feed_state", "last_checked_at", "next_check_at", "error_code"]) {
    const missing = { ...detail }
    delete missing[key]
    assert.equal(accepts(schemas.ScheduledTaskDetails, missing), false, key)
    assert.equal(accepts(schemas.ScheduledTaskDetails, { ...base, ...calendar, scheduling_state: "active", [key]: detail[key] }), false, key)
  }
  assert.equal(accepts(schemas.ScheduledTask, { ...ack, next_run_at: "2026-10-23T00:00:00Z" }), false)
  assert.equal(accepts(schemas.ScheduledTaskDetails, { ...detail, error_code: "raw exception" }), false)
})
test("RSS runs require real discovery and null scheduled_for; calendar retains old precision", () => {
  const run = { task_id: "task", title: "Task", project_ref: null, run_id: "run", state: "pending", terminal_event_at: null }
  const actual = { ...run, trigger_kind: "rss", scheduled_for: null, observed_at: "2026-10-23T00:00:00.123Z" }
  const scheduled = { ...run, trigger_kind: "calendar", scheduled_for: "2026-10-23T00:00:00.123456789Z" }
  assert.ok(accepts(schemas.ScheduledTaskRunItem, actual))
  assert.ok(accepts(schemas.ScheduledTaskRunItem, scheduled))
  const missing = { ...actual }
  delete missing.observed_at
  for (const bad of [
    missing,
    { ...actual, scheduled_for: scheduled.scheduled_for },
    { ...scheduled, observed_at: actual.observed_at },
    { ...scheduled, scheduled_for: null },
    { ...scheduled, scheduled_for: "2026-10-23T00:00:00.123Z" },
  ])
    assert.equal(accepts(schemas.ScheduledTaskRunItem, bad), false)
})
