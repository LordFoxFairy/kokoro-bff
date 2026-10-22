import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)
const ownerCommit = "efe1ed1a3f81e87df1edded53e6e796d20edea55"
const ownerDigest = "3a187ad6e98b1824cf8d8e50c80218e77c7f14f4eb2a5cfcfe8d4be97c677a08"
const ownerUrl = new URL(`contract/vendor/kokoro-platform/${ownerCommit}/openapi/platform-http.openapi.json`, root)

test("Platform HTTP client pins the same current owner bundle", async () => {
  const manifest = JSON.parse(await readFile(new URL("contract/dependencies/platform-http.json", root), "utf8"))
  const source = await readFile(ownerUrl)
  const { default: generatorConfig } = await import("../openapi-ts.platform-http.config.ts")
  assert.equal((await generatorConfig).input, fileURLToPath(ownerUrl), "generation input must match owner provenance")
  assert.equal(manifest.status, "generated")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-capability")
  assert.equal(manifest.owner.repository_commit, ownerCommit)
  assert.equal(manifest.owner.contract_version, "6.3.0")
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

test("public history keeps the owner revision facts and required nullable terminal cursor beside the unchanged draft command", async () => {
  const { load } = await import("js-yaml")
  const api = load(await readFile(new URL("contract/openapi/v1/openapi.yaml", root), "utf8"))
  const owner = JSON.parse(await readFile(ownerUrl, "utf8"))
  const route = api.paths["/v1/self/skills/{skill_id}/versions"]
  assert.equal(route.get.operationId, "listPersonalSkillVersions")
  assert.equal(route.get["x-kokoro-permission"], "product.skill.read_managed_personal")
  assert.equal(route.get["x-kokoro-idempotency"], "none")
  assert.equal(route.get.requestBody, undefined)
  assert.deepEqual(
    route.get.parameters.map((item) => [item.in, item.name]),
    [
      ["path", "skill_id"],
      ["query", "limit"],
      ["query", "cursor"],
    ],
  )
  assert.equal(route.post.operationId, "createPersonalSkillVersion")
  assert.equal(route.post["x-kokoro-idempotency"], "required")
  const schemas = api.components.schemas
  for (const name of ["PersonalSkillHistoryVersion", "PersonalSkillHistoryPublication", "PersonalSkillHistoryPage", "PersonalSkillHistoryResponse"])
    assert.equal(schemas[name].additionalProperties, false)
  assert.deepEqual([...schemas.PersonalSkillHistoryVersion.required].sort(), [...owner.components.schemas.PersonalSkillHistoryVersion.required].sort())
  assert.deepEqual(schemas.PersonalSkillHistoryVersion.properties.status.enum, owner.components.schemas.PersonalSkillHistoryVersion.properties.status.enum)
  assert.ok(schemas.PersonalSkillHistoryPage.required.includes("next_cursor"))
  assert.deepEqual(schemas.PersonalSkillHistoryPage.properties.next_cursor.type, ["string", "null"])
  assert.equal(api.components.responses.PersonalSkillHistoryOk.headers["Cache-Control"].schema.const, "no-store")
})
