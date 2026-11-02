import { restoreSessionShareMetadataContract, sessionShareMetadataParentBaseline } from "./session-share-metadata-public-contract.mjs"
// Exact build/test-only proof for the two distinct historical parents.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/task-b-bff-integration.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
export function restoreIntegrationParent(source, parent) {
  source = restoreSessionShareMetadataContract(source)
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
  baseline = sessionShareMetadataParentBaseline(baseline)
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
  source = restoreContextWindowFailureSchema(source)
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

/** Named historical proof only. Real canonical DDL retains the new nonretryable code. */
export function restoreContextWindowFailureSchema(source) {
  if (!source.includes("'context_window_exceeded'")) return source
  const parents = {
    "01a84aa0488888f90f51b9ee09656f548d39fb6cd8efaa094a28c7ff755d7313": "0e414066fc8e0cb87ed63677d4a1f0a27d9426153e8f0bcfdeee2bfbf2d3a6f5",
    "2a7cfbb26a1abed2f565b525c77a6a0f6f61411f292a1bb813282ee26a51c909": "fc2007dd117a46eea4d59869ec9e458ee856ed23c1cab236fbd5553436508b98",
    "3963abc5b7c1e1d61552a4a04f7c916986b65e258c3064d66703bfab8418417a": "b798b18ac37cbafdfb18538927c51073ac8c7d4ec338e0a752c19be6c1c437ad",
    "07763e7a5dc67545578d9605d6cdf1cba259c9e11b75fe4de8fe8d56ac94385f": "4649e21e9e9b3007eefe3c092fa965ebb8f60db7d17ef9d669167c59d816f2df",
    a12dcd30209d86312f36a5c8a199827d225f26450a251ebeffd29876aa3fe157: "e286ddaaa9976a2718fca228239cc2d610e3b64f99c8c949b72bdf5cc88b82b4",
  }
  const parent = parents[hash(source)]
  assert.ok(parent, "invalid_schema: complete context failure SQL child drift")
  const marker = ", 'context_window_exceeded'"
  assert.equal(source.split(marker).length, 2, "invalid_schema: one exact failure CHECK addition")
  const restored = source.replace(marker, "")
  assert.equal(hash(restored), parent, "invalid_schema: complete exact context failure SQL parent")
  return restored
}
