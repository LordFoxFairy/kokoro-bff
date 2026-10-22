import { skillSeriesDeleteParentBaseline } from "./skill-series-delete-public-contract.mjs"
import { restoreSkillPublicationContract } from "./skill-publication-public-contract.mjs"
// Build/test-only additive proof; no runtime compatibility branch.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/personal-skill-history.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
export function restorePersonalSkillHistoryContract(source) {
  source = restoreSkillPublicationContract(source)
  if (!/^  version: 21\.2\.0$/mu.test(source)) return source
  if (hash(source) !== proof.current_sha256) throw Error("Personal Skill history current contract drift")
  const lines = source.split(/(?<=\n)/u)
  for (const change of [...proof.inverse].reverse()) {
    if (hash(lines.slice(change.at, change.at + change.count).join("")) !== change.current_sha256) throw Error("Personal Skill history inverse hunk drift")
    lines.splice(change.at, change.count, change.previous)
  }
  const restored = lines.join("")
  if (hash(restored) !== proof.parent_sha256) throw Error("Personal Skill history complete parent drift")
  return restored
}
export function personalSkillHistoryParentBaseline(baseline) {
  baseline = skillSeriesDeleteParentBaseline(baseline)
  if (baseline.length === 175) {
    if (hash(JSON.stringify(baseline)) !== proof.parent_inventory_sha256) throw Error("Personal Skill history parent inventory drift")
    return baseline
  }
  if (baseline.length !== 176 || hash(JSON.stringify(baseline)) !== proof.current_inventory_sha256)
    throw Error("Personal Skill history ordered inventory drift")
  const parent = baseline.filter((operation) => operation.operation_id !== proof.operation_id)
  if (hash(JSON.stringify(parent)) !== proof.parent_inventory_sha256) throw Error("Personal Skill history restored inventory drift")
  return parent
}
export function inspectPersonalSkillHistoryContract(source, baseline) {
  baseline = skillSeriesDeleteParentBaseline(baseline)
  try {
    source = restoreSkillPublicationContract(source)
    if (!/^  version: 21\.2\.0$/mu.test(source) || baseline.length !== 176) throw Error("Personal Skill history current publication differs")
    restorePersonalSkillHistoryContract(source)
    personalSkillHistoryParentBaseline(baseline)
    return []
  } catch (error) {
    return [error.message]
  }
}
