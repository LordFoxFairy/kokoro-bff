import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)
const ownerCommit = "6b4c9db6719d2f5fd37a752921e603f4b0221de6"
const ownerDigest = "50afde42d7a1564ecb058c78dff68e4ea81bbb3552bd96dbf6203b036ec381ae"
const ownerUrl = new URL(`contract/vendor/kokoro-platform/${ownerCommit}/openapi/platform-http.openapi.json`, root)

test("Platform HTTP client pins the same current owner bundle", async () => {
  const manifest = JSON.parse(await readFile(new URL("contract/dependencies/platform-http.json", root), "utf8"))
  const source = await readFile(ownerUrl)
  const { default: generatorConfig } = await import("../openapi-ts.platform-http.config.ts")
  assert.equal((await generatorConfig).input, fileURLToPath(ownerUrl), "generation input must match owner provenance")
  assert.equal(manifest.status, "generated")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-capability")
  assert.equal(manifest.owner.repository_commit, ownerCommit)
  assert.equal(manifest.owner.contract_version, "6.0.0")
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
