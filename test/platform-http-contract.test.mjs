import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
const root = new URL("../", import.meta.url)
test("routed Platform HTTP 3.2.0 projection client pins reviewed owner bytes", async () => {
  const manifest = JSON.parse(await readFile(new URL("contract/dependencies/platform-http.json", root), "utf8"))
  const source = await readFile(new URL("contract/vendor/kokoro-platform-http/9ab3b653360d04fb498a238659edeec01e72f62d/platform-http.openapi.json", root))
  const api = JSON.parse(source)
  assert.equal(manifest.status, "generated")
  assert.equal(manifest.owner.contract_version, "3.2.0")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-capability")
  assert.equal(manifest.owner.repository_commit, "9ab3b653360d04fb498a238659edeec01e72f62d")
  assert.equal(manifest.owner.contract_sha256, "4b42dd161c972b3447cfea3a6f80a949bbdb573c46213dbf8ef4c3ecb58e72da")
  assert.equal(createHash("sha256").update(source).digest("hex"), manifest.owner.contract_sha256)
  assert.deepEqual(
    ["/v1/skills", "/v1/skills/{skill_id}", "/v1/skills/pool", "/v1/skills/catalog", "/v1/mcp/servers", "/v1/mcp/connections"].map(
      (path) => api.paths[path].get.operationId,
    ),
    ["listVisibleSkills", "getPublishedPersonalSkill", "listVisibleSkillPool", "listVisibleSkillCatalog", "listMcpServers", "listSelfMcpConnections"],
  )
})
