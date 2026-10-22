// Build/test-only exact additive proof; never a runtime compatibility branch.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/provider-model-discovery.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
export function restoreProviderModelDiscoveryContract(source) {
  if (!/^  version: 22\.3\.0$/mu.test(source)) return source
  if (hash(source) !== proof.current_sha256) throw Error("Provider discovery additive contract drift")
  const parent = source.replace(proof.path_block, "").replace(proof.schema_block, "").replace("  version: 22.3.0", "  version: 22.2.0")
  if (hash(parent) !== proof.parent_sha256) throw Error("Provider discovery complete parent drift")
  return parent
}
export function providerModelDiscoveryParentBaseline(baseline) {
  if (baseline.length !== 182) return baseline
  if (hash(JSON.stringify(baseline)) !== proof.current_inventory_sha256) throw Error("Provider discovery inventory drift")
  const parent = baseline.filter((item) => item.operation_id !== "listAdminModelProviderUpstreamModels")
  if (hash(JSON.stringify(parent)) !== proof.parent_inventory_sha256) throw Error("Provider discovery parent inventory drift")
  return parent
}
