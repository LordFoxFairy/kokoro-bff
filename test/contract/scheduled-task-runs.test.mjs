import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { load } from "js-yaml"
import { inspectScheduledRunsContract, restoreScheduledRunsParent, scheduledRunsParentBaseline } from "../../scripts/scheduled-task-runs-public-contract.mjs"
import { inspectProjectResourceDownloadContract } from "../../scripts/project-resource-download-public-contract.mjs"
const source = await readFile(new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
const inventory = JSON.parse(await readFile(new URL("../../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
const hash = (text) => createHash("sha256").update(text).digest("hex")
test("Public19.2 exact additive metadata and complete19.1 reverse proof", () => {
  assert.deepEqual(inspectScheduledRunsContract(source, inventory), [])
  const parent = restoreScheduledRunsParent(source)
  assert.equal(hash(parent), "ac649109f7b394ab894d17352c5f9f106e24e1cbf94e74672569333190adfab5")
  assert.deepEqual(inspectProjectResourceDownloadContract(parent, scheduledRunsParentBaseline(inventory)), [])
  const d = load(source),
    operation = d.paths["/v1/scheduled-task-runs"].get
  assert.equal(d.info.version, "19.2.0")
  assert.equal(inventory.length, 167)
  assert.equal(operation["x-kokoro-permission"], "scheduled_task.read")
  assert.deepEqual(d.components.schemas.ScheduledTaskRunItem.properties.state.enum, [
    "pending",
    "admission_unknown",
    "admitted",
    "dispatch_failed",
    "completed",
    "cancelled",
    "failed",
  ])
  assert.deepEqual(d.components.schemas.ScheduledTaskRunItem.required, [
    "task_id",
    "title",
    "project_ref",
    "run_id",
    "scheduled_for",
    "state",
    "terminal_event_at",
  ])
})
for (const [from, to] of [
  ["operationId: listScheduledTaskRuns", "operationId: listWrongRuns"],
  ["OnlyGeneratedNeverPresent", "x"],
  ["maxItems: 100", "maxItems: 101"],
  ["summary/output or fabricated chat link", "summary/output is fabricated"],
  ["Current IAM-admitted Product identity projections.", "unrelated drift"],
]) {
  if (!source.includes(from)) continue
  test(`Public19.2 rejects exact or parent drift ${from}`, () => assert.ok(inspectScheduledRunsContract(source.replace(from, to), inventory).length > 0))
}
test("Public19.2 rejects inventory aliases reorder removal and extra operation", () => {
  for (const changed of [
    inventory.slice(1),
    [...inventory].reverse(),
    [...inventory, { method: "GET", path: "/v1/alias", operation_id: "alias" }],
    inventory.map((x) => (x.path === "/v1/scheduled-task-runs" ? { ...x, path: "/v1/runs" } : x)),
  ])
    assert.ok(inspectScheduledRunsContract(source, changed).length > 0)
})
test("shared governance cannot accept19.2 source with an old166 inventory", async () => {
  const { inspectClosureIntegrationContract } = await import("../../scripts/verify-closure-integration-contract.mjs")
  const { inspectBffOpenApi } = await import("../../scripts/verify-openapi.ts")
  assert.ok(inspectClosureIntegrationContract(source, scheduledRunsParentBaseline(inventory)).length > 0)
  assert.ok(inspectProjectResourceDownloadContract(source, scheduledRunsParentBaseline(inventory)).length > 0)
  assert.ok(inspectBffOpenApi(source, scheduledRunsParentBaseline(inventory)).length > 0)
})
