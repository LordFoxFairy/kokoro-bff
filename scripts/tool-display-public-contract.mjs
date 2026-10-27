import { restorePublic28ProjectResourceContract } from "./project-resource-access-public-contract.mjs"
// Build/test-only exact Public28→27 inverse. Never imported by production.
import { createHash } from "node:crypto"

export const toolDisplayParentSha256 = "d2b3d546164cadc9655616fc44daf1511a6f7d4a2e5d172f1415552af8942ed1"
const currentField =
  "        display_code: { type: string, enum: [tool.execution, tool.file.read, tool.mcp.discover, tool.mcp.describe, tool.mcp.call, tool.web.search, tool.web.fetch] }\n"

export function restorePublic27ToolDisplayContract(source) {
  source = restorePublic28ProjectResourceContract(source)
  if (!/^  version: 28\.0\.0$/mu.test(source)) return source
  const block = source.match(/^    RunToolActivity:\n[\s\S]*?(?=^    RunSubagentActivity:)/mu)?.[0]
  if (!block || block.split(currentField).length !== 2 || source.split(currentField).length !== 2) throw Error("Tool display Public28 exact field delta drift")
  const parent = source
    .replace(block, () => block.replace(currentField, "        display_code: { const: tool.execution }\n"))
    .replace(/^  version: 28\.0\.0$/mu, "  version: 27.0.0")
  if (createHash("sha256").update(parent).digest("hex") !== toolDisplayParentSha256) throw Error("Tool display complete Public27 parent drift")
  return parent
}
