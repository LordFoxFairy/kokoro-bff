import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { load } from "js-yaml"
import { inspectSharedModelCatalogContract, restorePublic20SharedModelCatalogContract } from "../scripts/shared-model-catalog-public-contract.mjs"
import { inspectSystemModelConnectionContract, restorePublic19SystemModelConnectionContract } from "../scripts/system-model-connection-public-contract.mjs"

const root = new URL("../", import.meta.url)
const commit = "b7fe78e25e3c569ae0e1cb9b42cddab02074ca07"
const digest = "a83b37269e9e4fa7fb5310a1836975e20ab9eaee965a66c83e35bb1ca1b9e5df"

test("System HTTP 5.0 model-routing client pins reviewed owner bytes and five operations", async () => {
  const manifest = JSON.parse(await readFile(new URL("contract/dependencies/system-http.json", root), "utf8"))
  const source = await readFile(new URL(`contract/vendor/kokoro-system/${commit}/system.openapi.json`, root))
  const api = JSON.parse(source)
  assert.equal(manifest.status, "generated")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-system")
  assert.equal(manifest.owner.repository_commit, commit)
  assert.equal(manifest.owner.contract_version, "5.0.0")
  assert.equal(manifest.owner.contract_sha256, digest)
  assert.equal(manifest.owner.provenance_path, "contract/provenance.json")
  const provenance = await readFile(new URL(`contract/vendor/kokoro-system/${commit}/provenance.json`, root))
  assert.equal(manifest.owner.provenance_sha256, "97b20e57f66010ba456fac59fe1dd62d90c17325c82d3da80be455ea9d3cf747")
  assert.equal(createHash("sha256").update(provenance).digest("hex"), manifest.owner.provenance_sha256)
  const published = JSON.parse(provenance)
  assert.equal(published.openapi.sha256, digest)
  assert.equal(published.releaseClassification.contractVersion, "5.0.0")
  assert.deepEqual(Object.keys(await import("../dist/generated/system-http/sdk.gen.js")).sort(), [
    "getModelCatalog",
    "listModelLabel",
    "listModelRevision",
    "listRoutingPolicy",
    "putRoutingPolicy",
  ])
  assert.equal(createHash("sha256").update(source).digest("hex"), digest)
  assert.deepEqual(
    [
      api.paths["/v1/system/model-catalog/catalog"].get.operationId,
      api.paths["/v1/system/model-catalog/labels"].get.operationId,
      api.paths["/v1/system/model-catalog/revisions"].get.operationId,
      api.paths["/v1/system/model-catalog/routing-policies"].get.operationId,
      api.paths["/v1/system/model-catalog/routing-policies/{label_id}"].put.operationId,
    ],
    ["getModelCatalog", "listModelLabel", "listModelRevision", "listRoutingPolicy", "putRoutingPolicy"],
  )
})

test("System generated validators reject unknown owner fields at every reviewed response boundary", async () => {
  const { zPutRoutingPolicyBody, zPutRoutingPolicyResponse } = await import("../dist/generated/system-http/zod.gen.js")
  const body = { model_revision_id: null, visible: true, is_default: false, priority: 0 }
  assert.equal(zPutRoutingPolicyBody.safeParse(body).success, true)
  assert.equal(zPutRoutingPolicyBody.safeParse({ ...body, extra: "secret" }).success, false)
  const routing = {
    ...body,
    id: "00000000-0000-0000-0000-000000000000",
    tenant_id: "tenant_fixture",
    label_id: "00000000-0000-0000-0000-000000000000",
    feature_key: "chat",
    version: "1",
    created_at: "2026-10-06T00:00:00Z",
    updated_at: "2026-10-06T00:00:00Z",
  }
  assert.equal(zPutRoutingPolicyResponse.safeParse({ data: routing }).success, true)
  assert.equal(zPutRoutingPolicyResponse.safeParse({ data: { ...routing, extra: "secret" } }).success, false)
  assert.equal(zPutRoutingPolicyResponse.safeParse({ data: routing, extra: "secret" }).success, false)
})

test("Public21 consumes shared System5 models and restores the complete unchanged Public20 and Public19 proofs", async () => {
  const source = await readFile(new URL("contract/openapi/v1/openapi.yaml", root), "utf8")
  const baseline = JSON.parse(await readFile(new URL("contract/tests/v1-operations.json", root), "utf8")).operations
  const api = JSON.parse(await readFile(new URL(`contract/vendor/kokoro-system/${commit}/system.openapi.json`, root), "utf8"))
  const publicApi = load(source)
  assert.equal(publicApi.info.version, "21.0.0")
  assert.equal(baseline.length, 165)
  const row = publicApi.components.schemas.AdminModelRevision
  const ref = api.paths["/v1/system/model-catalog/revisions"].get.responses["200"].content["application/json"].schema.$ref.split("/").at(-1)
  const ownerRow = api.components.schemas[ref].properties.data.properties.items.items
  assert.deepEqual(row.properties.connection, ownerRow.properties.connection)
  assert.deepEqual(row.properties.request_model, ownerRow.properties.request_model)
  assert.deepEqual([...row.required].sort(), [...ownerRow.required].sort())
  assert.equal(row.properties.transport, undefined)
  assert.equal(row.properties.gateway_model_name, undefined)
  assert.equal(row.properties.feature_key, undefined)
  assert.deepEqual(publicApi.components.schemas.AdminModelLabel.properties.display_name.type, ["string", "null"])
  const candidate = publicApi.components.schemas.ModelCandidate
  assert.equal(candidate.additionalProperties, false)
  assert.deepEqual(
    [...candidate.required].sort(),
    ["provider", "name", "is_default", "display_name", "model_id", "revision_id", "provider_id", "feature_key", "request_model"].sort(),
  )
  assert.equal(candidate.properties.name.maxLength, 128)
  assert.equal(candidate.properties.display_name.maxLength, 255)
  assert.deepEqual(publicApi.components.schemas.ModelCandidateListResponse.properties.data.required, ["models", "next_cursor"])
  assert.deepEqual(inspectSharedModelCatalogContract(source, baseline), [])
  const public20 = restorePublic20SharedModelCatalogContract(source)
  assert.equal(createHash("sha256").update(public20).digest("hex"), "c5e89c7e56663d05d821c7c19115afb0cc913d617a35c6fd96162b13d201514f")
  assert.deepEqual(inspectSystemModelConnectionContract(public20, baseline), [])
  const parent = restorePublic19SystemModelConnectionContract(public20)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "955412b680bf7a2529c4c35f553ff272d7361769ea95bb441ba820b552ffc564")
  for (const changed of [
    source.replace("  version: 21.0.0", "  version: 20.0.0"),
    source.replace("enum: [direct, litellm]", "enum: [litellm]"),
    source.replace("        - request_model\n", "        - gateway_model_name\n"),
    source.replace("const: openai_chat_completions", "const: unknown_protocol"),
    source.replace("additionalProperties: false", "additionalProperties: true"),
    source + "\n",
  ]) {
    assert.notEqual(changed, source)
    assert.ok(inspectSharedModelCatalogContract(changed, baseline).length > 0)
  }
  for (const changed of [baseline.slice(1), [...baseline].reverse(), [...baseline, baseline[0]]])
    assert.ok(inspectSharedModelCatalogContract(source, changed).length > 0)
})
