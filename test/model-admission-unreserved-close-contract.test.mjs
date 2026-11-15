import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { load } from "js-yaml"
import * as schemas from "../src/generated/billing-http/zod.gen.ts"

const request = {
  run_id: "original-run",
  attempt_id: "11111111-1111-4111-8111-111111111111",
  request_ref: "original-key",
  attempt_binding_digest: "a".repeat(64),
  planned_digest: "b".repeat(64),
  final_request_digest: "c".repeat(64),
  evidence_event_id: "22222222-2222-4222-8222-222222222222",
  evidence_revision: "1",
  evidence_digest: "d".repeat(64),
}
test("fixed owner closure wire remains strict, string-based and distinct from financial settlement", () => {
  const q = schemas.zAdmissionUnreservedCloseRequest,
    a = schemas.zAdmissionUnreservedCloseResponse
  assert.equal(typeof q?.safeParse, "function", "closure schema must be generated from the fixed owner")
  assert.equal(q.safeParse(request).success, true)
  assert.equal(q.safeParse({ ...request, run_id: "😀".repeat(512), request_ref: "😀".repeat(512), evidence_revision: "9223372036854775807" }).success, true)
  for (const patch of [
    { evidence_revision: "9223372036854775808" },
    { evidence_revision: 1 },
    { evidence_revision: "01" },
    { run_id: "😀".repeat(513) },
    { request_ref: "😀".repeat(513) },
    { tenant_id: "forged" },
  ])
    assert.equal(q.safeParse({ ...request, ...patch }).success, false)
  const data = { ...request, closure_ref: "33333333-3333-4333-8333-333333333333", status: "unreserved_closed", closed_at: "2026-11-15T00:00:00.000Z" }
  assert.equal(a.safeParse({ data }).success, true)
  for (const patch of [
    { captured_credits: "0" },
    { released_credits: "0" },
    { admission_id: data.closure_ref },
    { status: "released" },
    { evidence_revision: "9223372036854775808" },
  ])
    assert.equal(a.safeParse({ data: { ...data, ...patch } }).success, false)
})
test("internal1.4 adds only the dedicated close operation and wire, preserving the complete internal1.3 parent", async () => {
  const doc = load(await readFile(new URL("../contract/openapi/internal/v1/openapi.yaml", import.meta.url), "utf8"))
  assert.equal(doc.info.version, "1.4.0")
  const operation = doc.paths["/internal/v1/model-admissions/close-unreserved"].post
  assert.equal(operation.operationId, "closeUnreservedAgentModelAdmission")
  assert.deepEqual(operation.security, [{ AgentModelAdmissionBearer: [] }])
  assert.deepEqual(
    operation.parameters.map((item) => item.name),
    ["Idempotency-Key"],
  )
  assert.equal(operation.responses[200].content["application/json"].schema.$ref, "#/components/schemas/AgentModelUnreservedCloseResponse")
  delete doc.paths["/internal/v1/model-admissions/close-unreserved"]
  for (const name of ["AgentModelUnreservedCloseRequest", "AgentModelUnreservedCloseResponse"]) delete doc.components.schemas[name]
  doc.info.version = "1.3.0"
  assert.equal(createHash("sha256").update(JSON.stringify(doc)).digest("hex"), "86f744223b8d8b9fea15c2c2507c2bb6591e99d1459d0cf736ee1db5e25e5bfa")
})
