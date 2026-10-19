// Exact proof of the two approved merge parents; never used by runtime decoders.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/closure-integration.json", import.meta.url), "utf8"))
const digest = (value) => createHash("sha256").update(value).digest("hex")
const current = (source) => /^  version: 19\.0\.0$/mu.test(source)
function restore(source, name) {
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
