import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
test("A2 publishes single local corrective major and real Connector CAS metadata", async () => {
  const spec = load(await readFile(new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"))
  assert.equal(spec.info.version, "14.0.0")
  assert.equal(
    Object.values(spec.paths).reduce(
      (n, path) => n + Object.keys(path).filter((k) => ["get", "post", "patch", "put", "delete", "head", "options"].includes(k)).length,
      0,
    ),
    143,
  )
  const schema = spec.components.schemas.PersonalMcpConnector
  assert.ok(schema.required.includes("enabled"))
  assert.ok(schema.required.includes("state_version"))
  for (const field of ["display_name", "description", "created_at", "updated_at"]) assert.ok(!schema.required.includes(field))
})
test("A2 six operations and exact historical inverse reject any extra old or new delta", async () => {
  const { restorePublic133McpPersonalContract, inspectBffOpenApi } = await import("../../scripts/verify-openapi.ts")
  const { createHash } = await import("node:crypto")
  const source = await readFile(new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const baseline = JSON.parse(await readFile(new URL("../../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
  assert.equal(
    createHash("sha256").update(restorePublic133McpPersonalContract(source)).digest("hex"),
    "0a9683b38cfd30534931dd0cd7821e3ccded94d6d15613a711cebc1f1e83a209",
  )
  assert.deepEqual(inspectBffOpenApi(source, baseline), [])
  const spec = load(source)
  for (const [path, method, operation] of [
    ["/v1/self/mcp/connectors", "post", "createPersonalMcpConnector"],
    ["/v1/self/mcp/connectors/{connector_id}", "patch", "updatePersonalMcpConnector"],
    ["/v1/self/mcp/connectors/{connector_id}", "delete", "removePersonalMcpConnector"],
    ["/v1/self/mcp/connectors/{connector_id}/enabled", "put", "setPersonalMcpConnectorEnabled"],
    ["/v1/self/mcp/providers", "get", "listPersonalMcpProviders"],
    ["/v1/self/mcp/providers/{provider_key}", "get", "getPersonalMcpProvider"],
  ])
    assert.equal(spec.paths[path][method].operationId, operation)
  for (const changed of [
    source.replace("operationId: createPersonalMcpConnector", "operationId: unsupported"),
    source.replace("required: [connector_id, connector_type, provider_key, status, approved_scopes, enabled, state_version]", "required: [connector_id]"),
    source.replace("mcp_personal_command_in_progress", "generic_error"),
    source.replace("operationId: listPersonalMcpConnections", "operationId: old_tamper"),
    source.replace("  version: 14.0.0", "  version: 13.3.0"),
    source + "unexpected: true\n",
  ])
    assert.notDeepEqual(inspectBffOpenApi(changed, baseline), [])
  const cas = spec.components.schemas.RemovePersonalMcpConnectorRequest.properties.expected_state_version
  for (const value of ["1", "9007199254740991"]) assert.match(value, new RegExp(cas.pattern, "u"))
  for (const value of ["0", "01", "9007199254740992", "10000000000000000", "1\n"]) assert.doesNotMatch(value, new RegExp(cas.pattern, "u"))
  const key = spec.paths["/v1/self/mcp/connectors"].post.parameters.find((p) => p.name === "Idempotency-Key").schema
  assert.match("original-key", new RegExp(key.pattern, "u"))
  for (const value of ["", "a b", "x".repeat(192), "x\n"]) assert.doesNotMatch(value, new RegExp(key.pattern, "u"))
  assert.deepEqual(
    spec.paths["/v1/self/mcp/providers"].get.parameters.map((p) => p.name),
    ["query", "directory_type", "category_key", "limit", "cursor"],
  )
  assert.ok(!Object.hasOwn(spec.paths["/v1/self/mcp/providers"].get.responses, "404"))
  assert.equal(spec.components.schemas.PersonalMcpConflictError.oneOf[0].properties.error.properties.retryable.const, false)
  assert.equal(spec.components.schemas.PersonalMcpConflictError.oneOf[1].properties.error.properties.retryable.const, true)
})
