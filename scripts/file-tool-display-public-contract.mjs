import { restorePublic283ActionDetailContract } from "./action-detail-public-contract.mjs"
// Build/test-only exact Public28.3→28.2 inverse. Never imported by production.
import { createHash } from "node:crypto"

const hash = (source) => createHash("sha256").update(source).digest("hex")
export const fileToolDisplayCurrentSha256 = "85a1b51cd151581b51d7ea7992d85e04462c03fafb36d0527e1df352dd85223a"
export const fileToolDisplayParentSha256 = "e0bb74069c65fb8d414a6a3cb0d6f4c8d9bcb40bb693c2409a9cbe051b8bac53"
const currentField =
  "        display_code: { type: string, enum: [tool.execution, tool.file.read, tool.mcp.discover, tool.mcp.describe, tool.mcp.call, tool.web.search, tool.web.fetch, tool.file.write, tool.file.deliver] }\n"
const parentField =
  "        display_code: { type: string, enum: [tool.execution, tool.file.read, tool.mcp.discover, tool.mcp.describe, tool.mcp.call, tool.web.search, tool.web.fetch] }\n"

export function restorePublic282FileToolDisplayContract(source) {
  source = restorePublic283ActionDetailContract(source)
  if (!/^  version: 28\.3\.0$/mu.test(source)) {
    if (source.includes("tool.file.write") || source.includes("tool.file.deliver")) throw Error("Tool display file version drift")
    return source
  }
  if (hash(source) !== fileToolDisplayCurrentSha256) throw Error("Tool display file complete Public28.3 drift")
  const block = source.match(/^    RunToolActivity:\n[\s\S]*?(?=^    RunSubagentActivity:)/mu)?.[0]
  if (!block || block.split(currentField).length !== 2 || source.split(currentField).length !== 2) throw Error("Tool display file exact field delta drift")
  const parent = source.replace(block, () => block.replace(currentField, parentField)).replace(/^  version: 28\.3\.0$/mu, "  version: 28.2.0")
  if (hash(parent) !== fileToolDisplayParentSha256) throw Error("Tool display file complete Public28.2 parent drift")
  return parent
}
