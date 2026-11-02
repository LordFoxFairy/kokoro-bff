import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import test from "node:test"
import { restoreIntegrationParent, restoreIntegrationBaseline } from "../../scripts/task-b-bff-integration-public-contract.mjs"
import { parseOpenApiOperations } from "../../scripts/check-contract.mjs"
const source = readFileSync(new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
const baseline = JSON.parse(readFileSync(new URL("../../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
const hash = (value) => createHash("sha256").update(value).digest("hex")
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
    assert.throws(() => restoreIntegrationParent(source.replace("version: 29.1.0", "version: 29.1.1"), parent))
    assert.throws(() => restoreIntegrationBaseline([...baseline].reverse(), parent))
  })
}
test("current canonical is Public29.1 and 201 unique operations", () => {
  assert.match(source, /^  version: 29\.1\.0$/mu)
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
  assert.equal(spec.info.version, "29.1.0")
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
    source.replace("version: 29.1.0", "version: 29.2.0"),
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
  for (const mutated of [source + "\n", source.replace("version: 29.1.0", "version: 29.1.1"), source.replace("required: [share]", "required: []")])
    assert.throws(() => checkSessionShareMetadataBrowserContract(mutated, published))
  assert.throws(() => checkSessionShareMetadataBrowserContract(source, published + "\n"))
})
