import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const root = new URL("../", import.meta.url)
const commit = "955bd587f46a771e43a4330d202d90a7d2d67262"
const digest = "94ed91655741cbba66ce80a4c41717b9179cc509cb6858534e0b78aa3e6dc059"

test("System HTTP 3.0 model-routing client pins reviewed owner bytes and four operations", async () => {
  const manifest = JSON.parse(await readFile(new URL("contract/dependencies/system-http.json", root), "utf8"))
  const source = await readFile(new URL(`contract/vendor/kokoro-system/${commit}/system.openapi.json`, root))
  const api = JSON.parse(source)
  assert.equal(manifest.status, "generated")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-system")
  assert.equal(manifest.owner.repository_commit, commit)
  assert.equal(manifest.owner.contract_version, "3.0.0")
  assert.equal(manifest.owner.contract_sha256, digest)
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
