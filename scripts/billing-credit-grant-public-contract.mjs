import { restoreMeteringContract, meteringParentBaseline } from "./billing-metering-public-contract.mjs"
// Build/test-only complete additive proof, not runtime compatibility.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/billing-credit-grant.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
export function restoreCreditGrantContract(source) {
  source = restoreMeteringContract(source)
  if (!/^  version: 22\.4\.0$/mu.test(source)) return source
  if (hash(source) !== proof.current_sha256) throw Error("Credit grant additive contract drift")
  const parent = source.replace(proof.path_block, "").replace(proof.schema_block, "").replace("  version: 22.4.0", "  version: 22.3.0")
  if (hash(parent) !== proof.parent_sha256) throw Error("Credit grant complete parent drift")
  return parent
}
export function creditGrantParentBaseline(baseline) {
  baseline = meteringParentBaseline(baseline)
  if (baseline.length !== 183) return baseline
  if (hash(JSON.stringify(baseline)) !== proof.current_inventory_sha256) throw Error("Credit grant inventory drift")
  const parent = baseline.filter((item) => item.operation_id !== "createAdminCreditGrant")
  if (hash(JSON.stringify(parent)) !== proof.parent_inventory_sha256) throw Error("Credit grant parent inventory drift")
  return parent
}
