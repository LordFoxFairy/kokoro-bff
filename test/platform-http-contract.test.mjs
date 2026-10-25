import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)
const ownerCommit = "8cfead647856ef54ec851a3bebe169a3ca14d212"
const ownerDigest = "085e1367f69c34edc6b80cbfb448596f36039f9857cee3bd5a407befbc295361"
const ownerUrl = new URL(`contract/vendor/kokoro-platform/${ownerCommit}/openapi/platform-http.openapi.json`, root)

test("Platform HTTP client pins the same current owner bundle", async () => {
  const manifest = JSON.parse(await readFile(new URL("contract/dependencies/platform-http.json", root), "utf8"))
  const source = await readFile(ownerUrl)
  const { default: generatorConfig } = await import("../openapi-ts.platform-http.config.ts")
  assert.equal((await generatorConfig).input, fileURLToPath(ownerUrl), "generation input must match owner provenance")
  assert.equal(manifest.status, "generated")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-capability")
  assert.equal(manifest.owner.repository_commit, ownerCommit)
  assert.equal(manifest.owner.contract_version, "7.0.0")
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

test("SSE successor: current generated Connection and Public26 both keep the closed transport union", async () => {
  const { zMcpConnection } = await import("../src/generated/platform-http/zod.gen.ts")
  const connection = {
    connection_id: "connection",
    connector_id: "connector",
    server_id: "server",
    provider_key: "private",
    transport: "sse_compat",
    status: "active",
  }
  assert.equal(zMcpConnection.safeParse(connection).success, true)
  for (const transport of ["stdio", "unknown", 3, null]) assert.equal(zMcpConnection.safeParse({ ...connection, transport }).success, false)
  const { load } = await import("js-yaml")
  const source = await readFile(new URL("contract/openapi/v1/openapi.yaml", root), "utf8")
  const doc = load(source)
  assert.equal(doc.info.version, "26.0.0")
  assert.deepEqual(doc.components.schemas.McpConnectionProjection.properties.transport.enum, ["streamable_http", "sse_compat"])
  const { restorePublic25McpPersonalSseContract } = await import("../scripts/mcp-personal-sse-public-contract.mjs")
  const old = restorePublic25McpPersonalSseContract(source)
  assert.equal(createHash("sha256").update(old).digest("hex"), "7261ac9ce2140555ba97ebff2bf0359533cc49dda014b08dcd6a6054a8d38b1c")
  for (const changed of [
    source + "\n",
    source.replace("x-kokoro-permission: capability.skill.read", "x-kokoro-permission: forged.read"),
    source.replace("enum: [streamable_http, sse_compat]", "enum: [streamable_http, sse_compat, stdio]"),
  ]) {
    assert.notEqual(changed, source)
    assert.throws(() => restorePublic25McpPersonalSseContract(changed))
  }
})

test("SSE successor: real HTTP7 JSON traverses the production Connection reader without fallback", async () => {
  const { createServer } = await import("node:http")
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { PlatformProjectionHttpClient } = await import("../src/infrastructure/clients/platform/projection-http.js")
  const tenant = "123e4567-e89b-42d3-a456-426614174000"
  const dir = await mkdtemp(join(tmpdir(), "bff-sse-projection-")),
    credential = join(dir, "fixture.json")
  await writeFile(
    credential,
    JSON.stringify({
      version: 1,
      entries: [
        { credential_id: "fixture", secret: "fixture-projection-only-000000000000", caller: "kokoro-bff", surfaces: ["projection"], tenant_id: tenant },
      ],
    }),
    { mode: 0o600 },
  )
  let row = { connection_id: "connection", connector_id: "connector", server_id: "server", provider_key: "private", transport: "sse_compat", status: "active" }
  let sends = 0
  const owner = createServer((request, response) => {
    sends++
    assert.equal(request.method, "GET")
    assert.equal(request.url, "/v1/mcp/connections")
    assert.equal(request.headers["x-kokoro-subject"], "subject")
    assert.equal(request.headers["x-kokoro-tenant-id"], tenant)
    response.writeHead(200, { "content-type": "application/json", "x-kokoro-request-id": "wire", "cache-control": "no-store" })
    response.end(JSON.stringify({ data: { connections: [row] } }))
  })
  await new Promise((resolve) => owner.listen(0, "127.0.0.1", resolve))
  try {
    const client = new PlatformProjectionHttpClient(`http://127.0.0.1:${owner.address().port}`, credential)
    assert.deepEqual(await client.read("mcpConnections", tenant, "subject", "wire"), { ok: true, status: 200, data: { connections: [row] } })
    const valid = row
    for (const patch of [{ transport: "stdio" }, { status: "pending" }, { extra: true }]) {
      row = { ...valid, ...patch }
      assert.deepEqual(await client.read("mcpConnections", tenant, "subject", "wire"), {
        ok: false,
        status: 502,
        code: "mcp_connection_response_invalid",
        retryable: false,
      })
    }
    assert.equal(sends, 4, "one read per intent; invalid replies never cause fallback/retry")
  } finally {
    owner.closeAllConnections()
    await new Promise((resolve) => owner.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
})
