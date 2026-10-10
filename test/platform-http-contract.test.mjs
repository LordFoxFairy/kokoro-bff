import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
const root = new URL("../", import.meta.url)
const ownerCommit = "91bc3655ebd3648cb8f8ccddfacb5628bdeb1c5c"
const ownerDigest = "c5f9a343170c87d59e0c40134c503cc6d40b59416216ac993a138cfbac3bb581"
const ownerUrl = new URL(`contract/vendor/kokoro-platform/${ownerCommit}/openapi/platform-http.openapi.json`, root)

test("routed Platform HTTP 3.5.0 projection client pins reviewed owner bytes", async () => {
  const manifest = JSON.parse(await readFile(new URL("contract/dependencies/platform-http.json", root), "utf8"))
  const source = await readFile(ownerUrl)
  const api = JSON.parse(source)
  assert.equal(manifest.status, "generated")
  assert.equal(manifest.owner.contract_version, "5.3.0")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-capability")
  assert.equal(manifest.owner.repository_commit, ownerCommit)
  assert.equal(manifest.owner.contract_sha256, ownerDigest)
  assert.equal(createHash("sha256").update(source).digest("hex"), manifest.owner.contract_sha256)
  assert.deepEqual(
    ["/v1/skills", "/v1/skills/{skill_id}", "/v1/skills/pool", "/v1/skills/catalog", "/v1/mcp/servers", "/v1/mcp/connections"].map(
      (path) => api.paths[path].get.operationId,
    ),
    ["listVisibleSkills", "getPublishedPersonalSkill", "listVisibleSkillPool", "listVisibleSkillCatalog", "listMcpServers", "listSelfMcpConnections"],
  )
})

test("R266 Platform HTTP 3.5 management projection pin exposes only the two reviewed self reads", async () => {
  const manifest = JSON.parse(await readFile(new URL("contract/dependencies/platform-http.json", root), "utf8"))
  const source = await readFile(new URL(`contract/vendor/kokoro-platform/${manifest.owner.repository_commit}/openapi/platform-http.openapi.json`, root))
  const api = JSON.parse(source)
  assert.equal(manifest.owner.contract_version, "5.3.0")
  assert.equal(manifest.owner.repository_commit, ownerCommit)
  assert.equal(manifest.owner.contract_sha256, ownerDigest)
  assert.equal(createHash("sha256").update(source).digest("hex"), manifest.owner.contract_sha256)
  assert.deepEqual(
    [api.paths["/v1/self/skills"].get.operationId, api.paths["/v1/self/skills/{skill_id}"].get.operationId],
    ["listSelfManagedSkills", "getSelfManagedSkill"],
  )
  assert.deepEqual(Object.keys(api.paths["/v1/self/skills"]), ["get"])
  assert.deepEqual(Object.keys(api.paths["/v1/self/skills/{skill_id}"]), ["get"])
})

test("R345 Platform HTTP 3.4 adds only required Skill update instants to the complete 3.3 parent", async () => {
  const [currentBytes, parentBytes] = await Promise.all([
    readFile(ownerUrl),
    readFile(new URL(`contract/vendor/kokoro-platform/${ownerCommit}/descriptor/platform-skill-updated-at-http-3.3.0.json`, root)),
  ])
  assert.equal(createHash("sha256").update(currentBytes).digest("hex"), ownerDigest)
  assert.equal(createHash("sha256").update(parentBytes).digest("hex"), "b6e5d0e0118207ee37933e5c22e94c86d95d74307b22a44e26e8974fede82acf")
  const current = JSON.parse(
    await readFile(new URL(`contract/vendor/kokoro-platform/${ownerCommit}/descriptor/platform-skill-example-prompts-http-3.4.0.json`, root)),
  )
  const stripped = structuredClone(current)
  const exactFields = {
    Skill: ["source_ref", "name", "description", "content_hash", "scope", "revision", "enabled", "categories", "skill_updated_at"],
    SelfManagedSkill: ["skill_id", "source_ref", "series_id", "revision", "name", "summary", "tags", "status", "skill_updated_at"],
    PublishedPersonalSkill: ["skill_id", "source_ref", "revision", "status", "name", "summary", "tags", "skill_updated_at"],
  }
  assert.equal(current.info.version, "3.4.0")
  for (const [name, required] of Object.entries(exactFields)) {
    const schema = current.components.schemas[name]
    assert.equal(schema.additionalProperties, false)
    assert.deepEqual(schema.required, required)
    assert.deepEqual(schema.properties.skill_updated_at, { type: "string", format: "date-time" })
    const parent = stripped.components.schemas[name]
    parent.required = parent.required.filter((field) => field !== "skill_updated_at")
    delete parent.properties.skill_updated_at
  }
  stripped.info.version = "3.3.0"
  assert.deepEqual(stripped, JSON.parse(parentBytes), "stripping only the three update fields and version must restore the complete owner parent")
})

test("R350 HTTP3.5 adds exactly required examples to complete HTTP3.4", async () => {
  const current = JSON.parse(
    await readFile(new URL(`contract/vendor/kokoro-platform/${ownerCommit}/descriptor/platform-skill-category-keys-http-3.5.0.json`, root)),
  )
  assert.equal(current.info.version, "3.5.0")
  for (const name of ["Skill", "SelfManagedSkill", "PublishedPersonalSkill"]) {
    const schema = current.components.schemas[name]
    assert.ok(schema.required.includes("example_prompts"))
    assert.equal(schema.properties.example_prompts.maxItems, 10)
    assert.equal(schema.properties.example_prompts.items.maxLength, 1000)
    delete schema.properties.example_prompts
    schema.required = schema.required.filter((field) => field !== "example_prompts")
  }
  current.info.version = "3.4.0"
  const bytes = await readFile(new URL(`contract/vendor/kokoro-platform/${ownerCommit}/descriptor/platform-skill-example-prompts-http-3.4.0.json`, root))
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "ca90f41f124c53a690746434cb66ac774f4a134acf109decd44bb110fafa61d6")
  assert.deepEqual(current, JSON.parse(bytes))
})
