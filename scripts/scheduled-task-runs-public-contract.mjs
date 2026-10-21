// Additive Public19.2 proof; the owner OpenAPI is the only editable API schema.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/scheduled-task-runs.json", import.meta.url), "utf8"))
const digest = (value) => createHash("sha256").update(value).digest("hex")
const fail = (label) => {
  throw Error(`Public19.2 scheduled task runs: ${label}`)
}
export const isScheduledRunsContract = (source) => /^  version: 19\.2\.0$/mu.test(source)
export function restoreScheduledRunsParent(source) {
  if (!isScheduledRunsContract(source)) return source
  const pathStart = source.indexOf("  /v1/scheduled-task-runs:\n"),
    schemaStart = source.indexOf("    ScheduledTaskRunItem:\n")
  if (pathStart < 0 || schemaStart < 0) fail("missing additive blocks")
  const pathEnd = source.indexOf("  /v1/account/archived-tasks:\n", pathStart),
    schemaEnd = source.indexOf("    ScheduledTask:\n", schemaStart)
  if (pathEnd < 0 || schemaEnd < 0) fail("unbounded additive blocks")
  if (digest(source.slice(pathStart, pathEnd)) !== proof.path_block_sha256 || digest(source.slice(schemaStart, schemaEnd)) !== proof.schema_block_sha256)
    fail("exact metadata contract drift")
  const parent = (source.slice(0, pathStart) + source.slice(pathEnd, schemaStart) + source.slice(schemaEnd)).replace(
    /^  version: 19\.2\.0$/mu,
    "  version: 19.1.0",
  )
  if (digest(parent) !== proof.parent_source_sha256) fail("complete exact Public19.1 parent bytes")
  return parent
}
export function scheduledRunsParentBaseline(baseline) {
  const candidates = baseline.filter((entry) => entry.path === "/v1/scheduled-task-runs" || entry.operation_id === "listScheduledTaskRuns")
  if (candidates.length === 0) return baseline
  if (
    baseline.length !== 167 ||
    candidates.length !== 1 ||
    JSON.stringify(candidates[0]) !== JSON.stringify({ method: "GET", path: "/v1/scheduled-task-runs", operation_id: "listScheduledTaskRuns" })
  )
    fail("one exact additive inventory tuple")
  const parent = baseline.filter((entry) => entry !== candidates[0])
  if (digest(JSON.stringify(parent)) !== proof.parent_ordered_inventory_sha256) fail("complete ordered166 parent inventory")
  return parent
}
export function inspectScheduledRunsContract(source, baseline) {
  try {
    if (!isScheduledRunsContract(source)) fail("current artifact must be Public19.2.0")
    restoreScheduledRunsParent(source)
    if (scheduledRunsParentBaseline(baseline).length !== 166 || baseline.length !== 167) fail("complete current inventory")
    return []
  } catch (error) {
    return [error.message]
  }
}
