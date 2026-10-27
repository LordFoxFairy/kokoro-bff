// Build/test-only strict additive Project-resource inverse; never imported by production.
import { createHash } from "node:crypto"
const hash = (value) => createHash("sha256").update(value).digest("hex")
export const projectResourcePublic28Sha256 = "34ca44c01ebc73f7ff76a4a06be33696b96ba1636e8818f02c38d57b1f539809"
const blocks = [
  ["PATHS", "3ab202c604b5dc7258d63922715ec485419734133b14200ba343bf1bc1f2ab86"],
  ["SCHEMAS", "a23e8f4b6f4efcaad3b53c4bdd54544b9556c8a5798462748f13791526bebf6d"],
]
export function restorePublic28ProjectResourceContract(source) {
  if (!/^  version: 28\.1\.0$/mu.test(source)) return source
  let parent = source
  for (const [kind, digest] of blocks) {
    const pattern = new RegExp(
      `^${kind === "PATHS" ? "  " : "    "}# PROJECT-RESOURCE-ACCESS-${kind}-BEGIN\\n[\\s\\S]*?^${kind === "PATHS" ? "  " : "    "}# PROJECT-RESOURCE-ACCESS-${kind}-END\\n`,
      "mu",
    )
    const block = parent.match(pattern)?.[0]
    if (!block || hash(block) !== digest) throw Error(`Project resource ${kind} exact delta drift`)
    parent = parent.replace(block, "")
  }
  parent = parent.replace(/^  version: 28\.1\.0$/mu, "  version: 28.0.0")
  if (hash(parent) !== projectResourcePublic28Sha256) throw Error("Project resource complete Public28 parent drift")
  return parent
}
export function projectResourceParentBaseline(inventory) {
  if (inventory.length !== 190) return inventory
  if (hash(JSON.stringify(inventory)) !== "4f0a6670c897a6d5bae05fc3a5bd86b65327698f3252861e075bd25feeb27ae8")
    throw Error("Project resource current inventory drift")
  const parent = inventory.filter((item) => !["getProjectResource", "downloadProjectResource", "deleteProjectResource"].includes(item.operation_id))
  if (parent.length !== 187 || hash(JSON.stringify(parent)) !== "4f58ddbc0dd6fe72c457651948fa5ac281c4057fbf98ae618dc7e5f1358c2d01")
    throw Error("Project resource complete parent inventory drift")
  return parent
}
