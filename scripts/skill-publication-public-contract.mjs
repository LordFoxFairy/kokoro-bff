import { restoreSkillSeriesDeleteContract } from "./skill-series-delete-public-contract.mjs"
// Build/test-only exact publication delta. Not a runtime compatibility path.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/skill-publication-precondition.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
export function restoreSkillPublicationContract(source) {
  source = restoreSkillSeriesDeleteContract(source)
  if (!/^  version: 22\.0\.0$/mu.test(source)) return source
  if (hash(source) !== proof.current_sha256) throw Error("Skill publication current contract drift")
  const lines = source.split(/(?<=\n)/u)
  for (const change of [...proof.inverse].reverse()) {
    if (hash(lines.slice(change.at, change.at + change.count).join("")) !== change.current_sha256) throw Error("Skill publication inverse hunk drift")
    lines.splice(change.at, change.count, change.previous)
  }
  const parent = lines.join("")
  if (hash(parent) !== proof.parent_sha256) throw Error("Skill publication complete parent drift")
  return parent
}
