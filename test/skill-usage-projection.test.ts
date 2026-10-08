import assert from "node:assert/strict"
import test from "node:test"

import { projectSkillUsageFacts, skillUsageResult } from "../src/application/agui/skill-usage.ts"

test("R353 records only strict ready and completed facts", () => {
  assert.deepEqual(
    projectSkillUsageFacts(
      { kind: "activity.updated", value: { activity: "skill", activity_id: "a", preflight_id: "p", source_refs: ["skill:s1"], phase: "ready" } },
      "run_1",
    ),
    { kind: "ready", runId: "run_1", sourceRefs: ["skill:s1"] },
  )
  assert.deepEqual(projectSkillUsageFacts({ kind: "run.completed", payload: { status: "completed" } }, "run_1"), {
    kind: "terminal",
    runId: "run_1",
    status: "completed",
  })
  assert.equal(projectSkillUsageFacts({ kind: "run.completed", payload: { status: "cancelled" } }, "run_1")?.kind, "terminal")
})

test("R353 never turns missing coverage into zero", () => {
  assert.deepEqual(skillUsageResult("unavailable", 0n), { status: "unavailable" })
  assert.deepEqual(skillUsageResult("complete", 0n), { status: "available", successfulRunCount: "0" })
})
