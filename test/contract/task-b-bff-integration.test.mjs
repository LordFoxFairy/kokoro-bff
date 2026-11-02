import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import test from "node:test"
import { restoreIntegrationParent, restoreIntegrationBaseline } from "../../scripts/task-b-bff-integration-public-contract.mjs"
import { parseOpenApiOperations } from "../../scripts/check-contract.mjs"
const source = readFileSync(new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
const baseline = JSON.parse(readFileSync(new URL("../../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
const hash = (value) => createHash("sha256").update(value).digest("hex")
test("Team role permissions publish the complete fixed IAM skill action catalog", async () => {
  const { load } = await import("js-yaml")
  const canonical = load(source)
  const iam = JSON.parse(
    readFileSync(new URL("../../contract/vendor/kokoro-iam/4db7012a85752071f5fd30b9a5a3b4977e9dd4f3/iam.internal.v1.json", import.meta.url), "utf8"),
  )
  const expected =
    iam.paths["/internal/v1/tenants/{tenant_id}/roles"].get.responses["200"].content["application/json"].schema.properties.data.items.properties.permissions
      .properties.skill.items.enum
  const actual = canonical.components.schemas.TeamRole.properties.permissions.properties.skill.items.enum
  assert.ok(expected.includes("delete_series"), "fixed IAM owner catalog includes series deletion")
  assert.deepEqual(actual, expected)
  assert.equal(actual.includes("unknown_action"), false)
  const { zListTenantRolesResponse } = await import("../../src/generated/iam-http/zod.gen.ts")
  const permissionSchemas =
    iam.paths["/internal/v1/tenants/{tenant_id}/roles"].get.responses["200"].content["application/json"].schema.properties.data.items.properties.permissions
      .properties
  const permissions = Object.fromEntries(Object.entries(permissionSchemas).map(([domain, schema]) => [domain, schema.items.enum]))
  const page = { data: ["owner", "admin"].map((name) => ({ role_id: null, name, kind: "builtin", permissions })), meta: { next_cursor: null } }
  assert.deepEqual(zListTenantRolesResponse.parse(page), page)
  const unknown = structuredClone(page)
  unknown.data[0].permissions.skill.push("unknown_action")
  assert.equal(zListTenantRolesResponse.safeParse(unknown).success, false)
})
for (const [parent, digest, count] of [
  ["approved", "ea0031103488daa1fcc0cca45fdd13f4d4061546ac4525c745ec47105649f7e7", 199],
  ["rss", "6574930b3a893a208596e6f27c2f9e09122e759d111a7fdbf2d54c294efc0e8f", 168],
]) {
  test(`Public29 preserves complete exact ${parent} parent bytes and ordered inventory`, () => {
    const restored = restoreIntegrationParent(source, parent)
    assert.equal(hash(restored), digest)
    assert.equal(parseOpenApiOperations(restored).length, count)
    assert.equal(restoreIntegrationBaseline(baseline, parent).length, count)
  })
  test(`Public29 ${parent} projection rejects unrelated drift and ordered inventory drift`, () => {
    assert.throws(() => restoreIntegrationParent(source.replace("title:", "title: changed"), parent))
    assert.throws(() => restoreIntegrationParent(source.replace("version: 29.3.0", "version: 29.3.1"), parent))
    assert.throws(() => restoreIntegrationBaseline([...baseline].reverse(), parent))
  })
}
test("current canonical is Public29.3 and 201 unique operations", () => {
  assert.match(source, /^  version: 29\.3\.0$/mu)
  const operations = parseOpenApiOperations(source)
  assert.equal(operations.length, 201)
  assert.equal(new Set(operations.map((x) => `${x.method} ${x.path}`)).size, 201)
  assert.equal(operations.filter((x) => x.fields.get("operationId") === "initializeBillingCreditAccount").length, 1)
  assert.equal(
    operations.some((x) => x.path.startsWith("/v1/projects/") && x.path.includes("/resources/") && x.path.endsWith("/content")),
    false,
  )
})

test("integrated SQL restores both complete exact canonical parents and refuses drift", async () => {
  const { restoreIntegrationSchema } = await import("../../scripts/task-b-bff-integration-public-contract.mjs")
  const schema = readFileSync(new URL("../../database/schema.sql", import.meta.url), "utf8")
  assert.equal(hash(restoreIntegrationSchema(schema, "approved")), "8444edf810bba34c55a10d3ea56a266be605898f269327b16e4f51b713039043")
  for (const parent of ["approved", "rss"]) {
    assert.throws(() => restoreIntegrationSchema(schema + "\n-- drift", parent))
    assert.throws(() => restoreIntegrationSchema(schema.replace("trigger_epoch", "trigger_unknown"), parent))
  }
})

test("Public29.1 share metadata publishes a closed read-only owner contract", async () => {
  const { load } = await import("js-yaml")
  const spec = load(source)
  assert.equal(spec.info.version, "29.3.0")
  const operation = spec.paths["/v1/sessions/{id}/share"].get
  assert.equal(operation.operationId, "getSessionShareMetadata")
  assert.equal(operation["x-kokoro-idempotency"], "none")
  assert.equal(operation["x-kokoro-permission"], "chat.read")
  const envelope = spec.components.schemas.SessionShareMetadataResponse
  assert.equal(envelope.additionalProperties, false)
  const data = envelope.properties.data
  assert.deepEqual(data.required, ["share"])
  assert.equal(data.additionalProperties, false)
  const metadata = spec.components.schemas.SessionShareMetadata
  assert.deepEqual(metadata.required, ["share_id", "created_at", "expires_at"])
  assert.deepEqual(Object.keys(metadata.properties), metadata.required)
  assert.equal(metadata.additionalProperties, false)
  assert.ok(!operation.parameters.some((p) => p.$ref.endsWith("IdempotencyKey")))
})

test("share metadata finite inverse preserves exact committed parent and rejects unrelated or future drift", async () => {
  const { restoreSessionShareMetadataContract, sessionShareMetadataParentBaseline } = await import("../../scripts/session-share-metadata-public-contract.mjs")
  const proof = JSON.parse(readFileSync(new URL("../../contract/tests/session-share-metadata.json", import.meta.url), "utf8"))
  const restored = restoreSessionShareMetadataContract(source)
  assert.equal(hash(restored), proof.parent_source_sha256)
  assert.equal(hash(JSON.stringify(sessionShareMetadataParentBaseline(baseline))), proof.parent_inventory_sha256)
  for (const mutated of [
    source + "\n",
    source.replace("permission: chat.read", "permission: chat.write"),
    source.replace("version: 29.3.0", "version: 29.4.0"),
    source.replace("required: [share]", "required: []"),
  ]) {
    assert.notEqual(mutated, source)
    assert.throws(() => restoreSessionShareMetadataContract(mutated))
  }
  for (const mutated of [[...baseline].reverse(), baseline.slice(1), [...baseline, baseline[0]]])
    assert.throws(() => sessionShareMetadataParentBaseline(mutated))
  assert.equal(restoreSessionShareMetadataContract(restored), restored)
})

test("share metadata browser artifact is a deterministic canonical reference closure and rejects drift", async () => {
  const { load } = await import("js-yaml")
  const { sessionShareMetadataBrowserBytes, checkSessionShareMetadataBrowserContract } =
    await import("../../scripts/generate-session-share-metadata-browser-contract.mjs")
  const published = readFileSync(new URL("../../contract/openapi/browser/v1/session-share-metadata.json", import.meta.url), "utf8")
  assert.equal(published, sessionShareMetadataBrowserBytes(source))
  assert.equal(sessionShareMetadataBrowserBytes(source), sessionShareMetadataBrowserBytes(source))
  const artifact = JSON.parse(published),
    canonical = load(source),
    resource = "/v1/sessions/{id}/share"
  assert.deepEqual(Object.keys(artifact.paths), [resource])
  assert.deepEqual(Object.keys(artifact.paths[resource]), ["parameters", "get"])
  assert.deepEqual(artifact.paths[resource].get, canonical.paths[resource].get)
  assert.deepEqual(artifact.paths[resource].parameters, canonical.paths[resource].parameters)
  assert.deepEqual(artifact.security, canonical.security)
  assert.equal(artifact["x-kokoro-projection"].source.sha256, hash(source))
  for (const [group, entries] of Object.entries(artifact.components))
    for (const [name, value] of Object.entries(entries)) assert.deepEqual(value, canonical.components[group][name])
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (value === null || typeof value !== "object") return
    if (value.$ref)
      assert.ok(
        value.$ref
          .split("/")
          .slice(1)
          .reduce((cursor, key) => cursor?.[key.replaceAll("~1", "/").replaceAll("~0", "~")], artifact),
        value.$ref,
      )
    for (const nested of Object.values(value)) walk(nested)
  }
  walk(artifact)
  for (const mutated of [source + "\n", source.replace("version: 29.3.0", "version: 29.3.1"), source.replace("required: [share]", "required: []")])
    assert.throws(() => checkSessionShareMetadataBrowserContract(mutated, published))
  assert.throws(() => checkSessionShareMetadataBrowserContract(source, published + "\n"))
})

test("Team role permissions finite inverse preserves the complete Public29.1 and unchanged ordered inventory", async () => {
  const { restoreTeamRolePermissionsContract } = await import("../../scripts/team-role-permissions-public-contract.mjs")
  const proof = JSON.parse(readFileSync(new URL("../../contract/tests/session-share-metadata.json", import.meta.url), "utf8"))
  const parent = restoreTeamRolePermissionsContract(source)
  assert.equal(hash(parent), proof.current_source_sha256)
  assert.deepEqual(parseOpenApiOperations(source), parseOpenApiOperations(parent))
  assert.equal(hash(JSON.stringify(baseline)), proof.current_inventory_sha256)
  assert.equal(restoreTeamRolePermissionsContract(parent), parent)
  const { projectSessionShareMetadataBrowserContract } = await import("../../scripts/generate-session-share-metadata-browser-contract.mjs")
  const previousProjection = projectSessionShareMetadataBrowserContract(parent)
  const currentProjection = projectSessionShareMetadataBrowserContract(source)
  currentProjection.info.version = previousProjection.info.version
  currentProjection["x-kokoro-projection"].source = previousProjection["x-kokoro-projection"].source
  assert.deepEqual(currentProjection, previousProjection, "share projection only changes canonical source version and digest")
  for (const mutated of [
    source + "\n",
    source.replace("delete_series, begin_upload", "delete_series, unknown_action, begin_upload"),
    source.replace("delete_series, begin_upload", "begin_upload"),
    source.replace("permission: chat.read", "permission: chat.write"),
    source.replace("version: 29.3.0", "version: 29.4.0"),
  ])
    assert.throws(() => restoreTeamRolePermissionsContract(mutated))
})

test("B08 public context failure is exactly additive and cannot hide unknown contract drift", async () => {
  const { restorePersonalContextFailureContract, restoreTeamRolePermissionsContract } = await import("../../scripts/team-role-permissions-public-contract.mjs")
  const parent = restorePersonalContextFailureContract(source)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "df5a33d4fa33662e4f70967bf5db60033f71f29511bf5975aa2395d61abb3e9c")
  for (const mutated of [source + "\n", source.replace("context_window_exceeded", "unknown_capacity"), source.replace("version: 29.3.0", "version: 29.3.1")])
    assert.throws(() => restoreTeamRolePermissionsContract(mutated), /drift|unknown/)
})
