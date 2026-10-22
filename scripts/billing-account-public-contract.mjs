import { restoreProviderModelDiscoveryContract, providerModelDiscoveryParentBaseline } from "./provider-model-discovery-public-contract.mjs"
// Build/test-only additive proof. No runtime compatibility behavior.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/billing-account-initialization.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
export function restoreBillingAccountContract(source) {
  source = restoreProviderModelDiscoveryContract(source)
  if (!/^  version: 22\.2\.0$/mu.test(source)) return source
  if (hash(source) !== proof.current_sha256) throw Error("Billing/delete additive contract drift")
  const parent = source.replace(proof.block, "").replace("  version: 22.2.0", "  version: 22.1.0")
  if (hash(parent) !== proof.parent_sha256) throw Error("Billing complete parent drift")
  return parent
}
export function billingAccountParentBaseline(baseline) {
  baseline = providerModelDiscoveryParentBaseline(baseline)
  if (baseline.length !== 181) return baseline
  if (hash(JSON.stringify(baseline)) !== proof.current_inventory_sha256) throw Error("Billing inventory drift")
  const parent = baseline.filter((item) => item.operation_id !== "initializeBillingCreditAccount")
  if (hash(JSON.stringify(parent)) !== proof.parent_inventory_sha256) throw Error("Billing parent inventory drift")
  return parent
}
