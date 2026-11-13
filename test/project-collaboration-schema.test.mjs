import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import {
  projectCollaborationDefinitions,
  classifyProjectCollaborationCatalog,
  legacyScheduledDispatchRevision,
} from "../scripts/project-collaboration-schema.mjs"

const current = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
test("evolution derives only the exact issued d875/28.38 parent, not an edited working-tree history", () => {
  const parent = execFileSync("git", ["show", "d875e3bde8e9942118e9bb402df7a34ba55bf2f4:database/schema.sql"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  })
  const definitions = projectCollaborationDefinitions(current)
  assert.equal(definitions.parent, parent)
  assert.equal(definitions.oldTables.length, 9)
  assert.equal(definitions.newTables.length, 2)
  assert.throws(() => projectCollaborationDefinitions(current.replace("owner_id TEXT NOT NULL", "owner_id TEXT")), /SQL drift/u)
})
test("scoped evolution accepts all-parent or exact-current only; unknown and mixed catalogs do not repair themselves", () => {
  const parent = { project: { columns: ["old"] }, stream: { columns: ["old"] }, grant: null }
  const target = { project: { columns: ["old", "version"] }, stream: { columns: ["new"] }, grant: { columns: ["new"] } }
  assert.equal(classifyProjectCollaborationCatalog(parent, parent, target), "parent")
  assert.equal(classifyProjectCollaborationCatalog(target, parent, target), "current")
  for (const actual of [
    { ...parent, grant: target.grant },
    { ...target, project: parent.project },
    { ...parent, project: { columns: ["unknown"] } },
  ])
    assert.throws(() => classifyProjectCollaborationCatalog(actual, parent, target), /PROJECT_COLLABORATION_SCHEMA_UNKNOWN/u)
})
const dispatch = {
  tenant_id: "tenant",
  task_id: "task",
  occurrence: "occurrence",
  idempotency_key: "callback-key",
  request_digest: "a".repeat(64),
  subject_id: "original",
  request_id: "request",
  run_id: "run",
  user_message_id: "user-message",
  assistant_message_id: "assistant-message",
  identity_assertion_ref: "proof",
  payload: { session_id: "session", run_id: "run", selected_skill_source_refs: [] },
  owner_id: "original",
}
function receipt() {
  return {
    fingerprint: dispatch.request_digest,
    status: 202,
    response_body: {
      schema_version: 2,
      state: "terminal",
      claim_token: null,
      lease_until: null,
      retry_at: null,
      last_error_code: null,
      snapshot: {
        tenantId: "tenant",
        taskId: "task",
        occurrence: "occurrence",
        idempotencyKey: "callback-key",
        actorId: "original",
        taskRevision: 7,
        schedule: "schedule",
        launch: {
          requestId: "request",
          identityAssertionRef: "proof",
          body: structuredClone(dispatch.payload),
          receipt: { run_id: "run", user_message_id: "user-message", assistant_message_id: "assistant-message" },
        },
      },
      response: { status: 202, body: { data: { task_id: "task", run_id: "run" } } },
    },
  }
}
test("legacy dispatch revision comes from its original atomic accepted receipt even after Task deletion, never the current Task revision", () => {
  assert.equal(legacyScheduledDispatchRevision(dispatch, receipt()), 7)
  assert.equal(legacyScheduledDispatchRevision({ ...dispatch, owner_id: null, revision: "99" }, receipt()), 7)
  const broken = [
    (r) => {
      r.fingerprint = "b".repeat(64)
    },
    (r) => {
      r.response_body.state = "pending"
    },
    (r) => {
      r.response_body.snapshot.actorId = "editor"
    },
    (r) => {
      r.response_body.snapshot.taskRevision = 0
    },
    (r) => {
      r.response_body.snapshot.launch.body.run_id = "other"
    },
    (r) => {
      r.response_body.response.body.data.run_id = "other"
    },
  ]
  for (const change of broken) {
    const value = receipt()
    change(value)
    assert.throws(() => legacyScheduledDispatchRevision(dispatch, value), /PROJECT_COLLABORATION_DISPATCH_ORIGIN_INVALID/u)
  }
  assert.throws(() => legacyScheduledDispatchRevision({ ...dispatch, owner_id: "different" }, receipt()), /PROJECT_COLLABORATION_DISPATCH_ORIGIN_INVALID/u)
  assert.throws(() => legacyScheduledDispatchRevision(dispatch, null), /PROJECT_COLLABORATION_DISPATCH_ORIGIN_INVALID/u)
})
