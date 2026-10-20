import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { load } from "js-yaml"
import { inspectSystemModelConnectionContract, restorePublic19SystemModelConnectionContract } from "../scripts/system-model-connection-public-contract.mjs"

const root = new URL("../", import.meta.url)
const commit = "dafbc66c9ab5e55b556dbd1dd71c79cef354f69c"
const digest = "c7cda9d09db266cd26dc1b80dfe9bb95c3c9f6a91bdbd6c5d7de4f85295d1dc6"

test("System HTTP 4.0 model-routing client pins reviewed owner bytes and four operations", async () => {
  const manifest = JSON.parse(await readFile(new URL("contract/dependencies/system-http.json", root), "utf8"))
  const source = await readFile(new URL(`contract/vendor/kokoro-system/${commit}/system.openapi.json`, root))
  const api = JSON.parse(source)
  assert.equal(manifest.status, "generated")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-system")
  assert.equal(manifest.owner.repository_commit, commit)
  assert.equal(manifest.owner.contract_version, "4.0.0")
  assert.equal(manifest.owner.contract_sha256, digest)
  assert.equal(manifest.owner.provenance_path, "contract/provenance.json")
  const provenance = await readFile(new URL(`contract/vendor/kokoro-system/${commit}/provenance.json`, root))
  assert.equal(manifest.owner.provenance_sha256, "37e338939ebecc4a61cf7aff4d14c2e28b5bc34381e66324a2009988e793d2d0")
  assert.equal(createHash("sha256").update(provenance).digest("hex"), manifest.owner.provenance_sha256)
  const published = JSON.parse(provenance)
  assert.equal(published.openapi.sha256, digest)
  assert.equal(published.releaseClassification.contractVersion, "4.0.0")
  assert.deepEqual(Object.keys(await import("../dist/generated/system-http/sdk.gen.js")).sort(), [
    "listModelLabel",
    "listModelRevision",
    "listRoutingPolicy",
    "putRoutingPolicy",
  ])
  assert.equal(createHash("sha256").update(source).digest("hex"), digest)
  assert.deepEqual(
    [
      api.paths["/v1/system/model-catalog/labels"].get.operationId,
      api.paths["/v1/system/model-catalog/revisions"].get.operationId,
      api.paths["/v1/system/model-catalog/routing-policies"].get.operationId,
      api.paths["/v1/system/model-catalog/routing-policies/{label_id}"].put.operationId,
    ],
    ["listModelLabel", "listModelRevision", "listRoutingPolicy", "putRoutingPolicy"],
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

test("Public20 changes only the System4 revision connection representation over the complete Public19 contract", async () => {
  const source = await readFile(new URL("contract/openapi/v1/openapi.yaml", root), "utf8")
  const baseline = JSON.parse(await readFile(new URL("contract/tests/v1-operations.json", root), "utf8")).operations
  const api = JSON.parse(await readFile(new URL(`contract/vendor/kokoro-system/${commit}/system.openapi.json`, root), "utf8"))
  const publicApi = load(source)
  assert.equal(publicApi.info.version, "20.0.0")
  assert.equal(baseline.length, 165)
  const row = publicApi.components.schemas.AdminModelRevision
  const ref = api.paths["/v1/system/model-catalog/revisions"].get.responses["200"].content["application/json"].schema.$ref.split("/").at(-1)
  const ownerRow = api.components.schemas[ref].properties.data.properties.items.items
  assert.deepEqual(row.properties.connection, ownerRow.properties.connection)
  assert.deepEqual(row.properties.request_model, ownerRow.properties.request_model)
  assert.deepEqual([...row.required].sort(), [...ownerRow.required].sort())
  assert.equal(row.properties.transport, undefined)
  assert.equal(row.properties.gateway_model_name, undefined)
  assert.deepEqual(inspectSystemModelConnectionContract(source, baseline), [])
  const parent = restorePublic19SystemModelConnectionContract(source)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "955412b680bf7a2529c4c35f553ff272d7361769ea95bb441ba820b552ffc564")
  for (const changed of [
    source.replace("  version: 20.0.0", "  version: 19.0.0"),
    source.replace("enum: [direct, litellm]", "enum: [litellm]"),
    source.replace("        - request_model\n", "        - gateway_model_name\n"),
    source.replace("const: openai_chat_completions", "const: unknown_protocol"),
    source.replace("additionalProperties: false", "additionalProperties: true"),
    source + "\n",
  ]) {
    assert.notEqual(changed, source)
    assert.ok(inspectSystemModelConnectionContract(changed, baseline).length > 0)
  }
  for (const changed of [baseline.slice(1), [...baseline].reverse(), [...baseline, baseline[0]]])
    assert.ok(inspectSystemModelConnectionContract(source, changed).length > 0)
})
