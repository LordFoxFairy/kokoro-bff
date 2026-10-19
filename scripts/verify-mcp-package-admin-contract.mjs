import { restoreClosureLocalContract } from "./verify-closure-integration-contract.mjs"
import { createHash } from "node:crypto"
// Exact release inverse; not a runtime compatibility decoder or second schema.
const blocks = [
  {
    start: "  /v1/admin/mcp/packages/{package_id}/uploads:\n",
    end: "  /v1/admin/mcp/providers:\n",
    sha256: "af4385631370eb8c2f19d703f7dbe2b431225174ed3f4f8c50d32d2d68a7d8c6",
  },
  {
    start: "    AdminMcpPackageId:\n",
    end: "    McpProviderAdminKey:\n",
    sha256: "59c9665313f7d6ca015cda7c183ce9d43515e6ce32a12e0f6a101132fed35b8a",
  },
  {
    start: "    BeginAdminMcpPackageUploadRequest:\n",
    end: "    PersonalKnowledgeItem:\n",
    sha256: "01505d9e159799b7848d997b257625ce1124c50ed28a14c1165eafc86280c3d5",
  },
  {
    start: "    AdminMcpPackageBeginOk:\n",
    end: "    McpProviderAdminListOk:\n",
    sha256: "26edfdc00334d8655b5b4fab9eb0a68d4082ae3839b64268c5ed257f2a16320a",
  },
]
const digest = (source) => createHash("sha256").update(source).digest("hex")
export function restorePublic18McpPackageContract(source) {
  source = restoreClosureLocalContract(source)
  if (!/^  version: 18\.1\.0$/mu.test(source)) return source
  for (const block of blocks) {
    const start = source.indexOf(block.start),
      end = source.indexOf(block.end, start)
    if (start < 0 || end < start || digest(source.slice(start, end)) !== block.sha256) throw Error("MCP package current block drift")
    source = source.slice(0, start) + source.slice(end)
  }
  const parent = source.replace("  version: 18.1.0", "  version: 18.0.0")
  if (digest(parent) !== "beaf5441b20d769455990b1707e6b553ebf16c6dba4855cbee68a03a2b1d371a") throw Error("MCP package complete Public18 parent inverse drift")
  return parent
}
export function inspectMcpPackageAdminContract(source) {
  try {
    source = restoreClosureLocalContract(source)
    if (!/^  version: 18\.1\.0$/mu.test(source)) throw Error("MCP package current version drift")
    restorePublic18McpPackageContract(source)
    return []
  } catch (error) {
    return [error.message]
  }
}
