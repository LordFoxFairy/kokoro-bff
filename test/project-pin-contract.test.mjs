import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { load } from "js-yaml"
import { operationBaseline, inspectOpenApiGovernance } from "../scripts/check-contract.mjs"

test("Project pin adds exactly two personal preference operations without altering old Project wire or Public28.4", async () => {
  const raw = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const spec = load(raw)
  assert.equal(spec.info.version, "28.5.0")
  const { restorePublic284ProjectPinContract, projectPinParentInventory } = await import("../scripts/project-pin-public-contract.mjs")
  const parent = restorePublic284ProjectPinContract(raw)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "48aa9638d133223c9f78655e9398ddbb44159963f92a2db891a09212f3aa2726")
  const inventory = JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
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
