import assert from "node:assert/strict"
import { test } from "node:test"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { load } from "js-yaml"
import { fromJSONSchema } from "zod"
import { restoreAdminIdentityAuditContract, adminIdentityAuditParentBaseline } from "../scripts/admin-identity-audit-public-contract.mjs"
import {
  restoreProjectGrantContract,
  restoreProjectGrantSchema,
  projectGrantParentBaseline,
  projectGrantParentOpenApiSha,
  projectGrantParentSqlSha,
} from "../scripts/project-grant-public-contract.mjs"
const source = restoreAdminIdentityAuditContract(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"))
const sql = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
const spec = load(source)
const hash = (value) => createHash("sha256").update(value).digest("hex")
const schema = (name) =>
  fromJSONSchema(
    JSON.parse(
      JSON.stringify({
        $ref: `#/components/schemas/${name}`,
        $defs: spec.components.schemas,
      }).replaceAll("#/components/schemas/", "#/$defs/"),
    ),
  )
test("Public29 restores complete Public28.38/SQL parent and retains the ordered 217 operations", async () => {
  assert.equal(hash(restoreProjectGrantContract(source)), projectGrantParentOpenApiSha)
  assert.equal(hash(restoreProjectGrantSchema(sql)), projectGrantParentSqlSha)
  assert.throws(() => restoreProjectGrantContract(source.replace("getProjectAccess", "forgedProjectAccess")), /drift/)
  assert.throws(() => restoreProjectGrantSchema(sql.replace("access_version >= 1", "access_version >= 0")), /drift/)
  const inventory = JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8"))
  const operations = adminIdentityAuditParentBaseline(inventory.operations)
  assert.equal(operations.length, 227)
  assert.equal(projectGrantParentBaseline(operations).length, 217)
  const changed = structuredClone(operations)
  changed.at(-1).method = "POST"
  assert.throws(() => projectGrantParentBaseline(changed), /drift/)
})
test("grant schema is closed and explicit role/expiry only, with required native CAS/idempotency operations", () => {
  const request = schema("ProjectGrantRequest")
  assert.equal(request.safeParse({ role: "editor", expires_at: null }).success, true)
  for (const invalid of [{ role: "viewer" }, { role: "owner", expires_at: null }, { role: "editor", expires_at: null, subject_id: "forged" }])
    assert.equal(request.safeParse(invalid).success, false)
  const path = spec.paths["/v1/projects/{projectId}/grants/{subject_id}"]
  for (const method of ["put", "delete"]) {
    const op = path[method]
    assert.equal(op["x-kokoro-permission"], "project.manage")
    assert.equal(op["x-kokoro-idempotency"], "required")
    for (const name of ["If-Match", "Idempotency-Key"]) assert.ok(op.parameters.some((p) => p.name === name && p.in === "header" && p.required === true))
    assert.ok(op.responses["428"])
    assert.ok(op.responses["409"])
  }
})
test("Public29 breaks only the execution PATCH/retry CAS and exposes the real revision/executor for explicit edits", () => {
  assert.equal(spec.info.version, "29.0.0")
  const scheduled = spec.components.schemas.ScheduledTaskDetails
  assert.equal(spec.components.schemas.ScheduledTask.required.includes("revision"), false)
  assert.ok(scheduled.required.includes("revision"))
  assert.ok(scheduled.required.includes("execution_actor_id"))
  for (const [path, method] of [
    ["/v1/scheduled-tasks/{id}", "patch"],
    ["/v1/scheduled-tasks/{id}/retry", "post"],
  ]) {
    const op = spec.paths[path][method]
    assert.ok(op.parameters.some((p) => p.name === "If-Match" && p.required === true))
    assert.ok(op.responses["428"])
  }
  assert.equal(
    spec.paths["/v1/scheduled-tasks/{id}"].delete.parameters.some((p) => p.name === "If-Match"),
    false,
  )
})
test("Scheduled collaboration adds only the executor and frozen dispatch revision, with enabled/executor integrity", () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS execution_actor_id TEXT/u)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS task_revision BIGINT NOT NULL/u)
  assert.match(sql, /NOT enabled OR \(execution_actor_id IS NOT NULL/u)
  assert.doesNotMatch(sql, /execution_binding_version|execution_binding_digest|execution_authorization_ref/u)
})
test("shared snapshot delivery is closed and hides Storage/internal paths without weakening an original private delivery", () => {
  const shared = schema("ProjectDelivery")
  const item = {
    conversation_id: "conversation",
    artifact_id: "artifact",
    artifact_kind: "document",
    title: "Result",
    mime: "text/plain",
    size: 6,
    run_id: "run",
    created_at: "2026-11-13T00:00:00.000Z",
  }
  assert.equal(shared.safeParse(item).success, true)
  assert.equal(shared.safeParse({ ...item, asset_id: "private-asset" }).success, false)
  assert.equal(shared.safeParse({ ...item, display_path: "private/internal/path" }).success, false)
  assert.equal(schema("PrivateDelivery").safeParse(item).success, false)
})
test("shared FINAL detail exposes Project capability but never private asset or favorite fields", () => {
  const item = {
    kind: "artifact",
    conversation_id: "conversation",
    artifact_id: "artifact",
    artifact_kind: "document",
    title: "Result",
    filename: "result.txt",
    mime_type: "text/plain",
    size_bytes: "6",
    content_sha256: "a".repeat(64),
    source_run_id: "run",
    delivered_at: "2026-11-13T00:00:00.000Z",
    project_ref: "project",
    project_access: { project_id: "project", role: "viewer", expires_at: null, access_version: "2", capabilities: ["read"] },
  }
  const response = { data: item, meta: { request_id: "request" } }
  assert.equal(schema("LibraryArtifactResponse").safeParse(response).success, true)
  for (const key of ["asset_id", "favorited"])
    assert.equal(schema("LibraryArtifactResponse").safeParse({ ...response, data: { ...item, [key]: key === "favorited" ? true : "private" } }).success, false)
})

test("Project snapshot and message pages expose explicit current control/regeneration facts while direct legacy representations stay valid", () => {
  const head = spec.components.schemas.ExecutionHead
  assert.equal(head.properties.can_control.type, "boolean")
  for (const name of ["ChatMessage", "OrderedAssistantMessageRead", "CancelledAssistantMessageRead", "RegeneratedAssistantMessageRead"])
    assert.equal(spec.components.schemas[name].properties.can_regenerate.type, "boolean")
  assert.equal(spec.components.schemas.SessionMessageListResponse.properties.data.properties.project_access.$ref, "#/components/schemas/ProjectAccess")
  // Zod's JSON Schema importer does not implement if/then/not. Check these
  // normative context clauses directly; runtime owner/peer behavior is tested over HTTP.
  assert.equal(head.required.includes("can_control"), false, "direct legacy heads keep their original required fields")
  assert.equal(spec.components.schemas.ChatMessage.required.includes("can_regenerate"), false)
  const eligibility = fromJSONSchema(spec.components.schemas.ChatMessage.properties.can_regenerate)
  assert.equal(eligibility.safeParse(false).success, true)
  assert.equal(eligibility.safeParse("false").success, false)
  const listData = spec.components.schemas.SessionMessageListResponse.properties.data
  assert.deepEqual(listData.allOf[0].if.required, ["project_access"])
  assert.deepEqual(listData.allOf[0].then.properties.messages.items.required, ["can_regenerate"])
  const snapshotData = spec.components.schemas.PrivateSessionSnapshotResponse.properties.data
  const condition = snapshotData.allOf.find((item) => item.if?.required?.join() === "project_access")
  assert.deepEqual(condition.then.properties.execution_head.required, ["can_control"])
  assert.deepEqual(condition.then.properties.messages.items.required, ["can_regenerate"])
  const coarse = head.allOf.find((item) => item.if?.required?.includes("can_control"))
  assert.deepEqual(coarse.then.properties.state.enum, ["queued", "active"])
  assert.equal(coarse.then.properties.pending_pauses.maxItems, 0)
})

test("Project AGUI can_control extends both original closed source branches without changing Agent failure or synthetic owner semantics", () => {
  const branches = spec.components.schemas.KokoroAgUiReplayMetadata.properties.kokoro.oneOf
  for (const branch of branches) assert.equal(branch.properties.can_control.type, "boolean")
  assert.equal(branches[0].properties.failure.$ref, "#/components/schemas/ChatMessage/properties/failure")
  assert.equal(branches[1].properties.source_owner.const, "kokoro-bff")
  assert.equal(branches[1].properties.failure, undefined)
  for (const branch of branches) {
    assert.equal(branch.additionalProperties, false)
    assert.equal(branch.required.includes("can_control"), false, "direct legacy stream metadata remains unchanged")
    const control = fromJSONSchema(branch.properties.can_control)
    assert.equal(control.safeParse(false).success, true)
    assert.equal(control.safeParse("false").success, false)
  }
  const failure = spec.components.schemas.ChatMessage.properties.failure
  assert.equal(failure.additionalProperties, false)
  assert.deepEqual(failure.required, ["source", "code", "retryable"])
  assert.equal(failure.properties.source.const, "agent")
  assert.ok(failure.properties.code.enum.includes("model_access_denied"))
  assert.deepEqual(failure.then.properties.code.enum, ["model_unavailable", "dependency_unavailable"])
})
