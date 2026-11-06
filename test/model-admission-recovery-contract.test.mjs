import assert from "node:assert/strict"
import { test } from "node:test"
import * as sdk from "../src/generated/billing-http/sdk.gen.ts"
import { readFile } from "node:fs/promises"
import { load } from "js-yaml"
test("fixed owner includes a distinct recover-only operation rather than a proof-optional reserve", () => {
  assert.equal(typeof sdk.recoverModelAdmission, "function")
})
test("internal recover is Agent-only and reuses closed original schemas without a proof header", async () => {
  const doc = load(await readFile(new URL("../contract/openapi/internal/v1/openapi.yaml", import.meta.url), "utf8"))
  assert.equal(doc.info.version, "1.3.0")
  const op = doc.paths["/internal/v1/model-admissions/recover"].post
  assert.equal(op.operationId, "recoverAgentModelAdmission")
  assert.equal(op["x-kokoro-permission"], "agent.model_admission_recovery")
  assert.deepEqual(op.security, [{ AgentModelAdmissionBearer: [] }])
  assert.deepEqual(
    op.parameters.map((x) => x.name),
    ["Idempotency-Key"],
  )
  assert.equal(op.requestBody.content["application/json"].schema.$ref, "#/components/schemas/AgentModelAdmissionRequest")
  assert.equal(op.responses[200].content["application/json"].schema.$ref, "#/components/schemas/AgentModelAdmissionResponse")
  assert.equal(op.responses[404].content["application/json"].schema.$ref, "#/components/schemas/AgentModelAdmissionError")
  assert.equal(op.responses[201], undefined)
})
