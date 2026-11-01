import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { load } from "js-yaml"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/rss-trigger.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
export const isRssTriggerContract = (source) => /^  version: 20\.0\.0$/mu.test(source)
export function restoreRssTriggerParent(source) {
  if (!isRssTriggerContract(source)) return source
  assert.equal(hash(source), proof.current_source_sha256, "Public20 exact approved trigger surface")
  const lines = source.split(/(?<=\n)/u)
  for (const change of [...proof.inverse_changes].reverse()) {
    assert.deepEqual(lines.slice(change.start, change.start + change.new_lines.length), change.new_lines, "exact current inverse patch")
    lines.splice(change.start, change.new_lines.length, ...change.old_lines)
  }
  const parent = lines.join("")
  assert.equal(hash(parent), proof.parent_source_sha256, "complete exact Public19.3 source")
  return parent
}
export function rssTriggerParentBaseline(baseline) {
  assert.equal(baseline.length, 168, "RSS does not add or delete operations")
  assert.equal(hash(JSON.stringify(baseline)), proof.parent_ordered_inventory_sha256, "complete ordered168 inventory")
  return baseline
}
export function inspectRssTriggerContract(source, baseline) {
  try {
    assert.ok(isRssTriggerContract(source), "current artifact must be Public20.0.0")
    const schemas = load(source).components.schemas
    for (const name of ["ScheduledTask", "ScheduledTaskDetails", "CreateScheduledTaskRequest", "ScheduledTaskRunItem"]) {
      assert.equal(schemas[name].additionalProperties, false, `${name} closed`)
      assert.ok(schemas[name].required.includes("trigger_kind"), `${name} requires trigger kind`)
    }
    assert.equal(schemas.ScheduledTask.properties.feed_state, undefined, "mutation does not carry current feed facts")
    assert.equal(schemas.ScheduledTask.properties.scheduling_state, undefined, "mutation does not carry current lifecycle")
    assert.equal(schemas.ScheduledTaskDetails.allOf, undefined, "details is an independently closed projection")
    assert.equal(schemas.ScheduledRssConditions.maxItems, 8)
    assert.equal(schemas.ScheduledRssConditions.items.minItems, 1)
    assert.equal(schemas.ScheduledRssConditions.items.maxItems, 16)
    restoreRssTriggerParent(source)
    rssTriggerParentBaseline(baseline)
    return []
  } catch (error) {
    return [error.message]
  }
}
