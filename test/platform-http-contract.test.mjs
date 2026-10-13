import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const root = new URL("../", import.meta.url)
const ownerCommit = "b402b499535a213e1a337924e5dd0090927fbe6f"
const ownerDigest = "c5f9a343170c87d59e0c40134c503cc6d40b59416216ac993a138cfbac3bb581"
const ownerUrl = new URL(`contract/vendor/kokoro-platform/${ownerCommit}/openapi/platform-http.openapi.json`, root)

test("Platform HTTP client pins the same current owner bundle", async () => {
  const manifest = JSON.parse(await readFile(new URL("contract/dependencies/platform-http.json", root), "utf8"))
  const source = await readFile(ownerUrl)
  assert.equal(manifest.status, "generated")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-capability")
  assert.equal(manifest.owner.repository_commit, ownerCommit)
  assert.equal(manifest.owner.contract_version, "5.3.0")
  assert.equal(manifest.owner.contract_sha256, ownerDigest)
  assert.equal(createHash("sha256").update(source).digest("hex"), ownerDigest)
})

test("Platform HTTP projection retains the active Skills and MCP discovery routes", async () => {
  const api = JSON.parse(await readFile(ownerUrl, "utf8"))
  assert.deepEqual(
    ["/v1/skills", "/v1/skills/{skill_id}", "/v1/skills/pool", "/v1/skills/catalog", "/v1/mcp/servers", "/v1/mcp/connections"].map(
      (path) => api.paths[path].get.operationId,
    ),
    ["listVisibleSkills", "getPublishedPersonalSkill", "listVisibleSkillPool", "listVisibleSkillCatalog", "listMcpServers", "listSelfMcpConnections"],
  )
})
