import { restorePublic21ModelConfigurationContract, modelConfigurationParentBaseline } from "./model-configuration-public-contract.mjs"
import { restorePublic20SharedModelCatalogContract } from "./shared-model-catalog-public-contract.mjs"
import { restorePublic19SystemModelConnectionContract } from "./system-model-connection-public-contract.mjs"
// Exact proof of the two approved merge parents; never used by runtime decoders.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/closure-integration.json", import.meta.url), "utf8"))
const digest = (value) => createHash("sha256").update(value).digest("hex")
const current = (source) => /^  version: 19\.0\.0$/mu.test(source)
const projectUnionDescription =
  "Personal and project installations form a union when project_id is present; the complete exact project installation takes precedence for the same series, including disabled installations. Personal-only items remain; no latest substitution, automatic upgrade or execution authorization. Both scopes share the request deadline, the result remains limited to 1000 items, and current project access is rechecked before disclosure."
function restoreProjectListPatch(source) {
  if (!/^  version: 19\.0\.1$/mu.test(source)) return source
  const addition = ` ${projectUnionDescription}`
  const operation = source.match(/^  \/v1\/skill\.list:\n    get:\n(?:(?!^  \/)[\s\S])*/mu)?.[0]
  const description = operation?.match(/^      description: (.+)$/mu)?.[1]
  if (source.split(addition).length !== 2 || !description?.endsWith(addition)) throw Error("Public19.0.1 project list description drift")
  const restored = source.replace(addition, "").replace(/^  version: 19\.0\.1$/mu, "  version: 19.0.0")
  if (digest(restored) !== proof.current_sha256) throw Error("Public19.0.1 exact Public19 parent drift")
  return restored
}
function restore(source, name) {
  source = restorePublic19SystemModelConnectionContract(restorePublic20SharedModelCatalogContract(restorePublic21ModelConfigurationContract(source)))
  source = restoreProjectListPatch(source)
  if (!current(source)) return source
  if (digest(source) !== proof.current_sha256) throw Error("Public19 complete integration source drift")
  const parent = proof.parents[name],
    lines = source.split(/(?<=\n)/u)
  for (const change of [...parent.inverse_changes].reverse()) {
    if (digest(lines.slice(change.at, change.at + change.count).join("")) !== change.current_sha256) throw Error("Public19 exact approved hunk drift")
    lines.splice(change.at, change.count, change.previous)
  }
  const result = lines.join("")
  if (digest(result) !== parent.source_sha256) throw Error("Public19 complete parent inverse drift")
  return result
}
function restoreBaseline(baseline, name) {
  baseline = modelConfigurationParentBaseline(baseline)
  if (digest(JSON.stringify(baseline)) !== proof.current_inventory_sha256) throw Error("Public19 exact165 ordered inventory drift")
  const parent = proof.parents[name]
  if (digest(JSON.stringify(parent.inventory)) !== parent.inventory_sha256) throw Error("Public19 frozen parent inventory drift")
  return structuredClone(parent.inventory)
}
export const restoreClosureLocalContract = (source) => restore(source, "local")
export const restoreClosureMainContract = (source) => restore(source, "main")
export const closureLocalBaseline = (baseline) => restoreBaseline(baseline, "local")
export const closureMainBaseline = (baseline) => restoreBaseline(baseline, "main")
export function inspectClosureIntegrationContract(source, baseline) {
  try {
    baseline = modelConfigurationParentBaseline(baseline)
    source = restorePublic19SystemModelConnectionContract(restorePublic20SharedModelCatalogContract(restorePublic21ModelConfigurationContract(source)))
    source = restoreProjectListPatch(source)
    if (!current(source)) throw Error("current public artifact must be Public19.0.0")
    restoreClosureLocalContract(source)
    restoreClosureMainContract(source)
    closureLocalBaseline(baseline)
    closureMainBaseline(baseline)
    return []
  } catch (error) {
    return [error.message]
  }
}
