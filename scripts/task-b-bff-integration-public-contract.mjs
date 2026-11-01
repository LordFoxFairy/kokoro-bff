// Exact build/test-only proof for the two distinct historical parents.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/task-b-bff-integration.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
export function restoreIntegrationParent(source, parent) {
  const target = proof.parents[parent]
  assert.ok(target, "known integration parent")
  if (hash(source) === target.source_sha256) return source
  assert.equal(hash(source), proof.current_source_sha256, "complete Public29 integration artifact drift")
  const lines = source.split(/(?<=\n)/u)
  for (const change of [...target.inverse_changes].reverse()) {
    assert.deepEqual(lines.slice(change.start, change.start + change.current_lines.length), change.current_lines, "finite integration inverse")
    lines.splice(change.start, change.current_lines.length, ...change.parent_lines)
  }
  const restored = lines.join("")
  assert.equal(hash(restored), target.source_sha256, "complete exact integration parent bytes")
  return restored
}
export function restoreIntegrationBaseline(baseline, parent) {
  const target = proof.parents[parent]
  assert.ok(target, "known integration parent")
  if (hash(JSON.stringify(baseline)) === target.inventory_sha256) return baseline
  assert.equal(hash(JSON.stringify(baseline)), proof.current_inventory_sha256, "complete current ordered200 inventory drift")
  const restored = structuredClone(target.inventory)
  assert.equal(hash(JSON.stringify(restored)), target.inventory_sha256, "complete exact parent ordered inventory")
  return restored
}

/** Historical SQL proof only; named evolutions continue deriving DDL from canonical. */
export function restoreIntegrationSchema(source, parent) {
  const target = proof.schema.parents[parent]
  assert.ok(target, "known integration schema parent")
  if (hash(source) === target.source_sha256) return source
  assert.equal(hash(source), proof.schema.current_sha256, "complete integrated SQL artifact drift")
  const lines = source.split(/(?<=\n)/u)
  for (const change of [...target.inverse_changes].reverse()) {
    assert.deepEqual(lines.slice(change.start, change.start + change.current_lines.length), change.current_lines, "finite schema inverse")
    lines.splice(change.start, change.current_lines.length, ...change.parent_lines)
  }
  const restored = lines.join("")
  assert.equal(hash(restored), target.source_sha256, "complete exact integration schema parent")
  return restored
}
