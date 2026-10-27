// Build/test-only exact Public28.2→28.1 inverse. Never imported by production.
import { createHash } from "node:crypto"
const hash = (value) => createHash("sha256").update(value).digest("hex")
export const recommendationsParentSha256 = "07e98d803ac3c7342c2e322b507e8760d89e63bc5ecdab3cdf447b68bf3c904c"
const blocks = [
  ["PATHS", "ce9b142e9e19beaabfc3e89ca7adcb1abd1ffb78f8995bcf8d0222249c510a31"],
  ["SCHEMAS", "3ddb3d479f7e2399f7dfb187ca2e19dcdb350c4e9009c274e4dac399a3911071"],
]
export function restorePublic281McpRecommendationsContract(source) {
  if (!/^  version: 28\.2\.0$/mu.test(source)) {
    if (source.includes("PROJECT-MCP-RECOMMENDATIONS-")) throw Error("Project MCP recommendations version drift")
    return source
  }
  if (hash(source) !== "e0bb74069c65fb8d414a6a3cb0d6f4c8d9bcb40bb693c2409a9cbe051b8bac53") throw Error("Project MCP recommendations complete Public28.2 drift")
  let parent = source
  for (const [kind, digest] of blocks) {
    const indent = kind === "PATHS" ? "  " : "    "
    const pattern = new RegExp(`^${indent}# PROJECT-MCP-RECOMMENDATIONS-${kind}-BEGIN\n[\\s\\S]*?^${indent}# PROJECT-MCP-RECOMMENDATIONS-${kind}-END\n`, "mu")
    const block = parent.match(pattern)?.[0]
    if (!block || hash(block) !== digest) throw Error(`Project MCP recommendations ${kind} delta drift`)
    parent = parent.replace(block, "")
  }
  parent = parent.replace(/^  version: 28\.2\.0$/mu, "  version: 28.1.0")
  if (hash(parent) !== recommendationsParentSha256) throw Error("Project MCP recommendations complete Public28.1 parent drift")
  return parent
}
export function recommendationsParentBaseline(inventory) {
  if (inventory.length !== 192) {
    if (inventory.some((item) => ["getProjectMcpRecommendations", "replaceProjectMcpRecommendations"].includes(item.operation_id)))
      throw Error("Project MCP recommendations census drift")
    return inventory
  }
  if (hash(JSON.stringify(inventory)) !== "804e1bf56c3b66fb7da55024031aac235aab789c7aac21509eca37ed3e433180")
    throw Error("Project MCP recommendations complete Public28.2 inventory drift")
  const parent = inventory.filter((item) => !["getProjectMcpRecommendations", "replaceProjectMcpRecommendations"].includes(item.operation_id))
  if (parent.length !== 190 || hash(JSON.stringify(parent)) !== "4f0a6670c897a6d5bae05fc3a5bd86b65327698f3252861e075bd25feeb27ae8")
    throw Error("Project MCP recommendations Public28.1 inventory drift")
  return parent
}

// Exact additive SQL proof for historical tests; no runtime/schema execution.
export function restoreProjectMcpRecommendationsSchema(source) {
  if (hash(source) !== "70f6933f3bf0542d4c8babc6ced7ab7f4c128c0cc0a570ab195309850373e993") throw Error("Project MCP recommendations current SQL drift")
  let parent = source
  for (const line of [
    "  recommended_mcp_refs JSONB NOT NULL DEFAULT '[]'::jsonb CONSTRAINT ck_bff_project_mcp_refs CHECK (jsonb_typeof(recommended_mcp_refs) = 'array' AND jsonb_array_length(recommended_mcp_refs) <= 16),\n",
    "  mcp_recommendations_state_version INTEGER NOT NULL DEFAULT 1 CONSTRAINT ck_bff_project_mcp_version CHECK (mcp_recommendations_state_version >= 1),\n",
  ]) {
    if (parent.split(line).length !== 2) throw Error("Project MCP recommendations exact SQL delta drift")
    parent = parent.replace(line, "")
  }
  if (hash(parent) !== "38f1dcf6ffbdba1fcd459ff78f8be0d3e870405c5eccb2160d8a4961433f1e24") throw Error("Project MCP recommendations complete parent SQL drift")
  return parent
}
