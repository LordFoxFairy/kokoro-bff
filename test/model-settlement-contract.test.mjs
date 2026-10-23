import assert from "node:assert/strict"
import { test } from "node:test"
import * as schemas from "../src/generated/billing-http/zod.gen.ts"
const request = { run_id: "original-run", evidence_event_id: "11111111-1111-4111-8111-111111111111", evidence_revision: "1", evidence_digest: "a".repeat(64) }
const receipt = {
  admission_id: "22222222-2222-4222-8222-222222222222",
  run_id: request.run_id,
  attempt_id: "33333333-3333-4333-8333-333333333333",
  ...Object.fromEntries(Object.entries(request).filter(([k]) => k !== "run_id")),
  status: "captured",
  reason: null,
  captured_credits: "1",
  released_credits: "9",
  usage_event_id: "44444444-4444-4444-8444-444444444444",
  settlement_id: "55555555-5555-4555-8555-555555555555",
  updated_at: "2026-10-22T00:00:00.000Z",
}
test("fixed owner settlement schemas reject extra fields and enforce canonical whole-credit and revision bounds", () => {
  assert.equal(typeof schemas.zAdmissionSettlementRequest?.safeParse, "function", "settlement operation must be generated from fixed owner")
  const q = schemas.zAdmissionSettlementRequest,
    a = schemas.zAdmissionSettlementResponse
  assert.equal(q.safeParse(request).success, true)
  for (const x of [
    { ...request, user_id: "victim" },
    { ...request, evidence_revision: "9223372036854775808" },
    { ...request, evidence_revision: "01" },
    { ...request, evidence_revision: "0" },
  ])
    assert.equal(q.safeParse(x).success, false)
  assert.equal(q.safeParse({ ...request, evidence_revision: "9223372036854775807", run_id: "😀".repeat(512) }).success, true)
  assert.equal(q.safeParse({ ...request, run_id: "😀".repeat(513) }).success, false)
  assert.equal(a.safeParse({ data: receipt }).success, true)
  assert.equal(a.safeParse({ data: { ...receipt, captured_credits: "9223372036854" } }).success, true)
  for (const x of [
    { ...receipt, captured_credits: "9223372036855" },
    { ...receipt, captured_credits: "1.0" },
    { ...receipt, raw_evidence: "private" },
    { ...receipt, evidence_revision: "9223372036854775808" },
  ])
    assert.equal(a.safeParse({ data: x }).success, false)
})
test("fixed settlement three-state constraints are preserved rather than dropped by generated intersections", () => {
  assert.equal(typeof schemas.zAdmissionSettlementResponse?.safeParse, "function")
  const a = schemas.zAdmissionSettlementResponse
  const pending = {
    ...receipt,
    status: "pending_reconciliation",
    reason: "unknown_usage_or_outcome",
    captured_credits: "0",
    released_credits: "0",
    usage_event_id: null,
    settlement_id: null,
  }
  assert.equal(a.safeParse({ data: pending }).success, true)
  assert.equal(a.safeParse({ data: { ...pending, status: "released", reason: null, released_credits: "10" } }).success, true)
  for (const x of [
    { ...pending, reason: null },
    { ...pending, released_credits: "1" },
    { ...pending, captured_credits: "1" },
    { ...pending, usage_event_id: receipt.usage_event_id },
    { ...receipt, reason: "unknown_usage_or_outcome" },
    { ...receipt, settlement_id: null },
    { ...pending, status: "released", reason: null, captured_credits: "1" },
  ])
    assert.equal(a.safeParse({ data: x }).success, false)
})

test("internal settlement is separately declared, proof-free and Agent-only without changing public product API", async () => {
  const { readFile } = await import("node:fs/promises"),
    { load } = await import("js-yaml")
  const doc = load(await readFile(new URL("../contract/openapi/internal/v1/openapi.yaml", import.meta.url), "utf8"))
  assert.equal(doc.info.version, "1.2.0")
  const op = doc.paths["/internal/v1/model-admissions/{admission_id}/settle"].post
  assert.equal(op.operationId, "settleAgentModelAdmission")
  assert.deepEqual(op.security, [{ AgentModelAdmissionBearer: [] }])
  assert.equal(op["x-kokoro-permission"], "agent.model_settlement")
  assert.deepEqual(
    op.parameters.map((x) => x.name),
    ["admission_id", "Idempotency-Key"],
  )
  assert.equal(op.responses[200].content["application/json"].schema.$ref, "#/components/schemas/AgentModelSettlementResponse")
  assert.equal(doc.components.schemas.AgentModelSettlementRequest.additionalProperties, false)
})
