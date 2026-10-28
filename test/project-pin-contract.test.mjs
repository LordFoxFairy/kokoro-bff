import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { load } from "js-yaml"
import { restorePublic287ProjectContentContract, projectContentParentInventory } from "../scripts/project-pin-public-contract.mjs"
import { operationBaseline, inspectOpenApiGovernance } from "../scripts/check-contract.mjs"

test("Project pin adds exactly two personal preference operations without altering old Project wire or Public28.4", async () => {
  const input = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const { restorePublic285HubPublisherContract } = await import("../scripts/project-pin-public-contract.mjs")
  const raw = restorePublic285HubPublisherContract(input)
  const spec = load(raw)
  assert.equal(spec.info.version, "28.5.0")
  const { restorePublic284ProjectPinContract, projectPinParentInventory } = await import("../scripts/project-pin-public-contract.mjs")
  const parent = restorePublic284ProjectPinContract(raw)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "48aa9638d133223c9f78655e9398ddbb44159963f92a2db891a09212f3aa2726")
  const inventory = projectContentParentInventory(
    JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations,
  )
  assert.equal(inventory.length, 194)
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(projectPinParentInventory(inventory)))
      .digest("hex"),
    "804e1bf56c3b66fb7da55024031aac235aab789c7aac21509eca37ed3e433180",
  )
  assert.equal(operationBaseline(raw).length, 194)
  assert.deepEqual(inspectOpenApiGovernance(raw), [])
  assert.deepEqual(spec.components.schemas.Project, load(parent).components.schemas.Project)
  const get = spec.paths["/v1/self/project-pins"].get,
    put = spec.paths["/v1/projects/{projectId}/pin"].put
  assert.equal(get["x-kokoro-permission"], "project.read")
  assert.equal(put["x-kokoro-permission"], "project.read")
  assert.equal(put["x-kokoro-idempotency"], "natural")
  assert.equal(spec.components.schemas.SetProjectPinRequest.additionalProperties, false)
  assert.deepEqual(spec.components.schemas.SetProjectPinRequest.required, ["is_pinned"])
  assert.deepEqual(spec.components.schemas.SetProjectPinRequest.properties, { is_pinned: { type: "boolean" } })
  for (const changed of [raw + "\n", raw.replace("listProjects", "unrelatedMutation"), raw.replace("project.read", "project.update")])
    assert.throws(() => restorePublic284ProjectPinContract(changed))
})

test("S13 Hub publisher changes only two Hub fields and version; exact Public28.5 remains the parent", async () => {
  const { restorePublic286GithubDiscoveryContract } = await import("../scripts/project-pin-public-contract.mjs")
  const raw = restorePublic286GithubDiscoveryContract(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")),
    spec = load(raw)
  assert.equal(spec.info.version, "28.6.0")
  const { restorePublic285HubPublisherContract } = await import("../scripts/project-pin-public-contract.mjs")
  const oldRaw = restorePublic285HubPublisherContract(raw),
    old = load(oldRaw)
  assert.equal(createHash("sha256").update(oldRaw).digest("hex"), "109a2ae063b10699ae52776b09533c5622d906679c093d65730a289206043b1a")
  const fields = spec.components.schemas.SpecificationHubResponse.properties.skills.items.properties
  assert.equal(fields.product.$ref, "#/components/schemas/Public9SkillProductFacts")
  assert.equal(fields.publisher_profile.$ref, "#/components/schemas/SkillPublisherProfile")
  const normalized = structuredClone(spec)
  delete normalized.components.schemas.SpecificationHubResponse.properties.skills.items.properties.product
  delete normalized.components.schemas.SpecificationHubResponse.properties.skills.items.properties.publisher_profile
  normalized.info.version = "28.5.0"
  assert.deepEqual(normalized, old, "every non-Hub object, operation, existing profile and wire stays identical")
  assert.deepEqual(operationBaseline(raw), operationBaseline(oldRaw))
  for (const invalid of [
    raw + "\n",
    raw.replace("listProjects", "unrelatedOperation"),
    raw.replace("project.read", "project.update"),
    raw.replace('SkillPublisherProfile"\n                description', 'Public9SkillProductFacts"\n                description'),
    raw.replace("version: 28.6.0", "version: 28.7.0"),
  ])
    assert.throws(() => restorePublic285HubPublisherContract(invalid), "not a generic stripping exception")
})

test("S10 GitHub discovery changes only512 choices and version, preserving exact Public28.6", async () => {
  const raw = restorePublic287ProjectContentContract(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")),
    spec = load(raw)
  assert.equal(spec.info.version, "28.7.0")
  const { restorePublic286GithubDiscoveryContract } = await import("../scripts/project-pin-public-contract.mjs")
  const oldRaw = restorePublic286GithubDiscoveryContract(raw),
    old = load(oldRaw)
  assert.equal(createHash("sha256").update(oldRaw).digest("hex"), "a020e849f740165fa20099f5ab041b76bc480c70a9bbc067955e57f5ec22ae02")
  const branches = spec.components.schemas.GithubSkillResponse.properties.data.oneOf
  assert.equal(branches[1].properties.paths.maxItems, 512)
  const normalized = structuredClone(spec)
  normalized.info.version = "28.6.0"
  normalized.components.schemas.GithubSkillResponse.properties.data.oneOf[1].properties.paths.maxItems = 128
  assert.deepEqual(normalized, old)
  assert.deepEqual(operationBaseline(raw), operationBaseline(oldRaw))
  for (const invalid of [
    raw + "\n",
    raw.replace("maxItems: 512", "maxItems: 513"),
    raw.replace("listProjects", "otherOperation"),
    raw.replace("project.read", "project.update"),
    raw.replace("version: 28.7.0", "version: 28.8.0"),
  ])
    assert.throws(() => restorePublic286GithubDiscoveryContract(invalid))
})

test("Project content Public28.8 adds exactly one Project installation package read over complete Public28.7", async () => {
  const raw = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"),
    spec = load(raw)
  assert.equal(spec.info.version, "28.8.0")
  const parent = restorePublic287ProjectContentContract(raw),
    old = load(parent)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "818dfe54d5eb50a72725983be136211c63bb17fa7392f94c5c1d46234db3ebd1")
  const path = "/v1/projects/{projectId}/skill-installations/{installation_id}/package"
  assert.equal(spec.paths[path].get.operationId, "getProjectSkillInstallationPackage")
  assert.equal(spec.paths[path].get.responses["200"].$ref, "#/components/responses/SkillPackageInspectionOk")
  const normalized = structuredClone(spec)
  delete normalized.paths[path]
  normalized.info.version = "28.7.0"
  assert.deepEqual(normalized, old)
  assert.equal(operationBaseline(raw).length, 195)
  const inventory = JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
  assert.equal(projectContentParentInventory(inventory).length, 194)
  for (const invalid of [
    raw + "\n",
    raw.replace("listProjects", "otherOperation"),
    raw.replace("getProjectSkillInstallationPackage", "otherRead"),
    raw.replace("28.8.0", "28.9.0"),
  ])
    assert.throws(() => restorePublic287ProjectContentContract(invalid), /drift/)
  assert.throws(() => projectContentParentInventory(inventory.slice(1)), /drift/)
})
