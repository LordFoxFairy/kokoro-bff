import { skillSeriesDeleteParentBaseline } from "./skill-series-delete-public-contract.mjs"
import {
  restorePersonalSkillHistoryContract,
  personalSkillHistoryParentBaseline,
  inspectPersonalSkillHistoryContract,
} from "./personal-skill-history-public-contract.mjs"
// Test/build-only exact additive proof. Never imported by runtime consumers.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/model-configuration.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
const projectUnionAddition =
  " Personal and project installations form a union when project_id is present; the complete exact project installation takes precedence for the same series, including disabled installations. Personal-only items remain; no latest substitution, automatic upgrade or execution authorization. Both scopes share the request deadline, the result remains limited to 1000 items, and current project access is rechecked before disclosure."
function restoreProjectUnionPatch(source) {
  if (!/^  version: 21\.1\.1$/mu.test(source)) return source
  const operation = source.match(/^  \/v1\/skill\.list:\n    get:\n(?:(?!^  \/)[\s\S])*/mu)?.[0]
  const description = operation?.match(/^      description: (.+)$/mu)?.[1]
  if (source.split(projectUnionAddition).length !== 2 || !description?.endsWith(projectUnionAddition))
    throw Error("Public21.1.1 project list description drift")
  const restored = source.replace(projectUnionAddition, "").replace(/^  version: 21\.1\.1$/mu, "  version: 21.1.0")
  if (hash(restored) !== proof.current_sha256) throw Error("Public21.1.1 exact configuration parent drift")
  return restored
}
export function restorePublic21ModelConfigurationContract(source) {
  source = restorePersonalSkillHistoryContract(source)
  source = restoreProjectUnionPatch(source)
  if (!/^  version: 21\.1\.0$/mu.test(source)) return source
  if (hash(source) !== proof.current_sha256) throw Error("Public21.1 exact configuration source drift")
  const lines = source.split(/(?<=\n)/u)
  for (const change of [...proof.inverse].reverse()) {
    if (hash(lines.slice(change.at, change.at + change.count).join("")) !== change.current_sha256) throw Error("Configuration inverse hunk drift")
    lines.splice(change.at, change.count, change.previous)
  }
  const parent = lines.join("")
  if (hash(parent) !== proof.parent_sha256) throw Error("Configuration parent source drift")
  return parent
}
export function modelConfigurationParentBaseline(baseline) {
  baseline = skillSeriesDeleteParentBaseline(baseline)
  if (baseline.length === 176) baseline = personalSkillHistoryParentBaseline(baseline)
  if (baseline.length === 165) {
    if (hash(JSON.stringify(baseline)) !== proof.parent_inventory_sha256) throw Error("Configuration parent inventory drift")
    return baseline
  }
  if (hash(JSON.stringify(baseline)) !== proof.current_inventory_sha256) throw Error("Configuration ordered inventory drift")
  if (baseline.length !== 175 || new Set(baseline.map((v) => v.operation_id)).size !== 175) throw Error("Configuration operation inventory drift")
  for (const id of proof.operations) if (baseline.filter((v) => v.operation_id === id).length !== 1) throw Error("Configuration operation missing")
  return baseline.filter((v) => !proof.operations.includes(v.operation_id))
}
export function inspectModelConfigurationContract(source, baseline) {
  try {
    const historyErrors = inspectPersonalSkillHistoryContract(source, baseline)
    if (historyErrors.length > 0) return historyErrors
    source = restorePersonalSkillHistoryContract(source)
    baseline = personalSkillHistoryParentBaseline(baseline)
    if (!/^  version: 21\.1\.1$/mu.test(source)) throw Error("Configuration current version differs")
    restorePublic21ModelConfigurationContract(source)
    modelConfigurationParentBaseline(baseline)
    if (baseline.length !== 175) throw Error("Configuration current inventory differs")
    return []
  } catch (error) {
    return [error.message]
  }
}
