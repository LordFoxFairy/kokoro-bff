import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)
const ownerCommit = "e17283888ae1a8cf10365dfc8dd670115d6d187c"
const ownerDigest = "18699985514e5b75bb48dc1fbaad638f6184e88032ed5e6d242ef89e6144b0fd"
const ownerUrl = new URL(`contract/vendor/kokoro-platform/${ownerCommit}/openapi/platform-http.openapi.json`, root)

test("Platform HTTP client pins the same current owner bundle", async () => {
  const manifest = JSON.parse(await readFile(new URL("contract/dependencies/platform-http.json", root), "utf8"))
  const source = await readFile(ownerUrl)
  const { default: generatorConfig } = await import("../openapi-ts.platform-http.config.ts")
  assert.equal((await generatorConfig).input, fileURLToPath(ownerUrl), "generation input must match owner provenance")
  assert.equal(manifest.status, "generated")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-capability")
  assert.equal(manifest.owner.repository_commit, ownerCommit)
  assert.equal(manifest.owner.contract_version, "6.1.0")
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

test("S2 generated HTTP validator preserves the owner installed-acquisition conditional", async () => {
  const { zSkill } = await import("../src/generated/platform-http/zod.gen.ts")
  const skill = {
    series_id: "series",
    source_ref: "skill:version",
    name: "Skill",
    description: "Description",
    content_hash: "sha256:" + "a".repeat(64),
    scope: "personal",
    revision: "1",
    enabled: false,
    skill_updated_at: "2026-10-17T00:00:00Z",
    example_prompts: [],
    category_keys: [],
    product: { publication_audience: "catalog", state_version: "1" },
    created_at: "2026-10-17T00:00:00Z",
    updated_at: "2026-10-17T00:00:00Z",
    owner_scope: { kind: "user", id: "owner" },
  }
  assert.equal(zSkill.safeParse(skill).success, true)
  assert.equal(zSkill.safeParse({ ...skill, installed: false }).success, true)
  assert.equal(zSkill.safeParse({ ...skill, installed: true }).success, false)
  for (const acquisition_kind of ["unknown", "direct", "hub"]) assert.equal(zSkill.safeParse({ ...skill, installed: true, acquisition_kind }).success, true)
  for (const acquisition_kind of [null, "device", "forged"]) assert.equal(zSkill.safeParse({ ...skill, installed: true, acquisition_kind }).success, false)
})
