// Build/test-only exact additive proof; never a runtime compatibility branch.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/personal-skill-series-delete.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
export function restoreSkillSeriesDeleteContract(source) {
  if (!/^  version: 22\.1\.0$/mu.test(source)) return source
  if (hash(source) !== proof.current_sha256) throw Error("Skill series delete current contract drift")
  const lines = source.split(/(?<=\n)/u)
  for (const change of [...proof.inverse].reverse()) {
    if (hash(lines.slice(change.at, change.at + change.count).join("")) !== change.current_sha256) throw Error("Skill series delete inverse drift")
    lines.splice(change.at, change.count, change.previous)
  }
  const parent = lines.join("")
  if (hash(parent) !== proof.parent_sha256) throw Error("Skill series delete complete parent drift")
  return parent
}
export function skillSeriesDeleteParentBaseline(baseline) {
  if (baseline.length !== 180) return baseline
  if (hash(JSON.stringify(baseline)) !== proof.current_inventory_sha256) throw Error("Skill series delete ordered inventory drift")
  const parent = baseline.filter((operation) => !(proof.operation_ids ?? [proof.operation_id]).includes(operation.operation_id))
  if (hash(JSON.stringify(parent)) !== proof.parent_inventory_sha256) throw Error("Skill series delete parent inventory drift")
  return parent
}
