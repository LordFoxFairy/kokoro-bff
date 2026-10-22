import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/billing-credit-account.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
export const isBillingCreditAccountContract = (source) => /^  version: 19\.3\.0$/mu.test(source)
export function restoreBillingCreditAccountParent(source) {
  if (!isBillingCreditAccountContract(source)) return source
  const start = source.indexOf("  /v1/billing/credit-account:\n"),
    end = source.indexOf("  /v1/billing/summary:\n", start)
  const schema = source.indexOf("    BillingCreditAccountError400:\n"),
    schemaEnd = source.indexOf("    BillingSummaryResponse:\n", schema)
  assert.ok(start >= 0 && end > start && schema > end && schemaEnd > schema, "Public19.3 additive boundaries")
  assert.equal(hash(source.slice(start, end)), proof.path_block_sha256, "exact initialization operation including all errors/headers/metadata")
  assert.equal(hash(source.slice(schema, schemaEnd)), proof.schema_block_sha256, "closed initialization error schemas")
  const parent = (source.slice(0, start) + source.slice(end, schema) + source.slice(schemaEnd)).replace(/^  version: 19\.3\.0$/mu, "  version: 19.2.0")
  assert.equal(hash(parent), proof.parent_source_sha256, "complete exact Public19.2 source")
  return parent
}
export function billingCreditAccountParentBaseline(baseline) {
  const added = baseline.filter((entry) => entry.path === "/v1/billing/credit-account" || entry.operation_id === "initializeBillingCreditAccount")
  if (added.length === 0) return baseline
  assert.equal(baseline.length, 168)
  assert.deepEqual(added, [{ method: "PUT", path: "/v1/billing/credit-account", operation_id: "initializeBillingCreditAccount" }])
  const parent = baseline.filter((entry) => entry !== added[0])
  assert.equal(hash(JSON.stringify(parent)), proof.parent_ordered_inventory_sha256, "complete ordered167 parent inventory")
  return parent
}
export function inspectBillingCreditAccountContract(source, baseline) {
  try {
    assert.ok(isBillingCreditAccountContract(source), "current artifact must be Public19.3")
    restoreBillingCreditAccountParent(source)
    assert.equal(baseline.length, 168)
    assert.equal(billingCreditAccountParentBaseline(baseline).length, 167)
    return []
  } catch (error) {
    return [error.message]
  }
}
