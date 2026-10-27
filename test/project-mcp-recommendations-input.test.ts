import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { load } from "js-yaml"

test("project recommendation wire carries all three stable closed identities and is naturally idempotent", async () => {
  const doc = load(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")) as any
  const route = doc.paths["/v1/projects/{projectId}/mcp-recommendations"]
  assert.ok(route, "recommendation configuration has its own governed GET/PUT, not publication pins")
  assert.equal(route.get.operationId, "getProjectMcpRecommendations")
  assert.equal(route.put.operationId, "replaceProjectMcpRecommendations")
  assert.equal(route.put["x-kokoro-idempotency"], "natural")
  assert.equal(route.put.parameters?.some((p: any) => p.$ref?.includes("Idempotency")) ?? false, false)
  const schemas = doc.components.schemas
  assert.equal(schemas.ProjectMcpRecommendations.properties.data.properties.recommendations.maxItems, 16)
  assert.equal(schemas.ProjectMcpRecommendationRef.oneOf.length, 3)
  assert.deepEqual(schemas.ReplaceProjectMcpRecommendationsRequest.required, ["expected_state_version", "recommendations"])
  assert.equal(schemas.ReplaceProjectMcpRecommendationsRequest.additionalProperties, false)
})

test("closed reference codec canonicalizes all three identities, retaining only exact stable fields", async () => {
  const { parseProjectMcpRecommendations: parse } = await import("../src/domain/project/mcp-recommendations.js")
  assert.deepEqual(
    parse([
      { kind: "provider", provider_key: "z" },
      { kind: "mcp_connector", connector_id: "private:C" },
      { kind: "custom_api", profile_id: "api.A" },
    ]),
    [
      { kind: "custom_api", profile_id: "api.A" },
      { kind: "mcp_connector", connector_id: "private:C" },
      { kind: "provider", provider_key: "z" },
    ],
  )
  assert.deepEqual(parse([]), [])
  assert.equal(parse(Array.from({ length: 17 }, (_, i) => ({ kind: "provider", provider_key: `p-${i}` }))), null)
  assert.equal(parse(Array.from({ length: 16 }, (_, i) => ({ kind: "provider", provider_key: `p-${i}` })))?.length, 16)
  for (const bad of [
    null,
    {},
    [{ kind: "provider", provider_key: "valid\n" }],
    [{ kind: "provider", provider_key: "UPPER" }],
    [{ kind: "provider", provider_key: "p", connector_id: "x" }],
    [{ kind: "mcp_connector", connector_id: "x", secret: "hidden" }],
    [{ kind: "custom_api", profile_id: "" }],
    [{ kind: "other", profile_id: "x" }],
    [
      { kind: "provider", provider_key: "p" },
      { kind: "provider", provider_key: "p" },
    ],
  ])
    assert.equal(parse(bad), null)
})

test("Public28.2 inverse proves the full untouched 28.1 parent and rejects unrelated tampering", async () => {
  const { restorePublic281McpRecommendationsContract: restore, recommendationsParentSha256 } =
    await import("../scripts/project-mcp-recommendations-public-contract.mjs")
  const { createHash } = await import("node:crypto")
  const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  assert.equal(createHash("sha256").update(restore(source)).digest("hex"), recommendationsParentSha256)
  assert.throws(() => restore(source.replace("summary: Read current project MCP recommendations", "summary: Changed")), /drift/)
  assert.throws(() => restore(source.replace("title: Kokoro Business API", "title: unrelated drift")), /drift/)
})
test("configuration JSON rejects malformed UTF-8, duplicate keys, surplus fields and noncanonical versions", async () => {
  const { parseProjectMcpRecommendationsInput: parse } = await import("../src/http/project-mcp-recommendations-input.js")
  for (const value of [
    '{"expected_state_version":"01","recommendations":[]}',
    '{"expected_state_version":"2147483648","recommendations":[]}',
    '{"expected_state_version":1,"recommendations":[]}',
    '{"expected_state_version":"1","recommendations":[],"actor_id":"untrusted"}',
    '{"expected_state_version":"1","recommendations":[],"recommendations":[]}',
  ])
    assert.equal(parse(Buffer.from(value)), null)
  assert.equal(parse(Buffer.from([255])), null)
  assert.deepEqual(parse(Buffer.from('{"expected_state_version":"2147483647","recommendations":[]}')), {
    expectedStateVersion: "2147483647",
    recommendations: [],
  })
})

test("new canonical SQL and both current/old wire surfaces are independently pinned before historical inverses", async () => {
  const {
    restoreProjectMcpRecommendationsSchema: sql,
    restorePublic281McpRecommendationsContract: wire,
    recommendationsParentBaseline: census,
  } = await import("../scripts/project-mcp-recommendations-public-contract.mjs")
  const { createHash } = await import("node:crypto")
  const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
  assert.equal(createHash("sha256").update(sql(schema)).digest("hex"), "38f1dcf6ffbdba1fcd459ff78f8be0d3e870405c5eccb2160d8a4961433f1e24")
  for (const bad of [schema.replace("recommended_mcp_refs JSONB NOT NULL", "recommended_mcp_refs JSONB"), schema.replace("name TEXT NOT NULL", "name TEXT")])
    assert.throws(() => sql(bad), /drift/)
  const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  assert.throws(() => wire(source.replace("version: 28.2.0", "version: 28.1.0")), /drift/)
  const operations = JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
  assert.equal(census(operations).length, 190)
  assert.throws(() => census(operations.map((op) => (op.operation_id === "replaceProjectMcpRecommendations" ? { ...op, path: "/forged" } : op))), /drift/)
})
