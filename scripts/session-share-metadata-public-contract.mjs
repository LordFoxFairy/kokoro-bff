// Build/test-only finite additive proof; never used by runtime readers.
import { restoreTeamRolePermissionsContract } from "./team-role-permissions-public-contract.mjs"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/session-share-metadata.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
export function restoreSessionShareMetadataContract(source) {
  source = restoreTeamRolePermissionsContract(source)
  if (!/^  version: 29\.1\.0$/mu.test(source)) {
    assert.ok(!source.includes("operationId: getSessionShareMetadata"), "unknown share metadata release")
    return source
  }
  assert.equal(hash(source), proof.current_source_sha256, "complete Public29.1 share metadata artifact drift")
  for (const block of [proof.get_block, proof.schema_block]) {
    assert.equal(source.split(block).length, 2, "exact share metadata addition")
    source = source.replace(block, "")
  }
  source = source.replace(/^  version: 29\.1\.0$/mu, "  version: 29.0.0")
  assert.equal(hash(source), proof.parent_source_sha256, "complete committed Public29 parent bytes")
  return source
}
export function sessionShareMetadataParentBaseline(inventory) {
  if (inventory.length !== 201) {
    assert.ok(!inventory.some((operation) => operation.operation_id === "getSessionShareMetadata"), "share metadata inventory drift")
    return inventory
  }
  assert.equal(hash(JSON.stringify(inventory)), proof.current_inventory_sha256, "complete ordered201 inventory drift")
  const parent = inventory.filter((operation) => operation.operation_id !== "getSessionShareMetadata")
  assert.equal(hash(JSON.stringify(parent)), proof.parent_inventory_sha256, "complete committed ordered200 inventory")
  return parent
}
