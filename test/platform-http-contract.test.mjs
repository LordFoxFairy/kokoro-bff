import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
const root = new URL("../", import.meta.url)
test("routed Platform HTTP 3.3.0 projection client pins reviewed owner bytes", async () => {
  const manifest = JSON.parse(await readFile(new URL("contract/dependencies/platform-http.json", root), "utf8"))
  const source = await readFile(new URL("contract/vendor/kokoro-platform-http/3d4ba6c3462e3896481f902adf47e0713c4187e4/platform-http.openapi.json", root))
  const api = JSON.parse(source)
  assert.equal(manifest.status, "generated")
  assert.equal(manifest.owner.contract_version, "3.3.0")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-capability")
  assert.equal(manifest.owner.repository_commit, "3d4ba6c3462e3896481f902adf47e0713c4187e4")
  assert.equal(manifest.owner.contract_sha256, "b6e5d0e0118207ee37933e5c22e94c86d95d74307b22a44e26e8974fede82acf")
  assert.equal(createHash("sha256").update(source).digest("hex"), manifest.owner.contract_sha256)
  assert.deepEqual(
    ["/v1/skills", "/v1/skills/{skill_id}", "/v1/skills/pool", "/v1/skills/catalog", "/v1/mcp/servers", "/v1/mcp/connections"].map(
      (path) => api.paths[path].get.operationId,
    ),
    ["listVisibleSkills", "getPublishedPersonalSkill", "listVisibleSkillPool", "listVisibleSkillCatalog", "listMcpServers", "listSelfMcpConnections"],
  )
})

test("R266 Platform HTTP 3.3 management projection pin exposes only the two reviewed self reads", async () => {
  const manifest = JSON.parse(await readFile(new URL("contract/dependencies/platform-http.json", root), "utf8"))
  const source = await readFile(
    new URL(`contract/vendor/kokoro-platform-http/${manifest.owner.repository_commit}/platform-http.openapi.json`, root),
  )
  const api = JSON.parse(source)
  assert.equal(manifest.owner.contract_version, "3.3.0")
  assert.equal(manifest.owner.repository_commit, "3d4ba6c3462e3896481f902adf47e0713c4187e4")
  assert.equal(manifest.owner.contract_sha256, "b6e5d0e0118207ee37933e5c22e94c86d95d74307b22a44e26e8974fede82acf")
  assert.equal(createHash("sha256").update(source).digest("hex"), manifest.owner.contract_sha256)
  assert.deepEqual(
    [api.paths["/v1/self/skills"].get.operationId, api.paths["/v1/self/skills/{skill_id}"].get.operationId],
    ["listSelfManagedSkills", "getSelfManagedSkill"],
  )
  assert.deepEqual(Object.keys(api.paths["/v1/self/skills"]), ["get"])
  assert.deepEqual(Object.keys(api.paths["/v1/self/skills/{skill_id}"]), ["get"])
})
