import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { load } from "js-yaml"

test("internal admission adds one Agent-only surface without changing original IAM binding or public product API", async () => {
  const doc = load(await readFile(new URL("../contract/openapi/internal/v1/openapi.yaml", import.meta.url), "utf8"))
  assert.equal(doc.info.version, "1.3.0")
  delete doc.paths["/internal/v1/model-admissions/recover"]
  doc.info.version = "1.2.0"
  assert.equal(createHash("sha256").update(JSON.stringify(doc)).digest("hex"), "64b3d8a5d73c4b07e25f4283f932a755a513f0a409d924eb27403f152e7fdb29")
  delete doc.paths["/internal/v1/model-admissions/{admission_id}/settle"]
  for (const name of ["AgentModelSettlementRequest", "AgentModelSettlementResponse", "AgentModelSettlementError"]) delete doc.components.schemas[name]
  doc.info.version = "1.1.0"
  assert.equal(createHash("sha256").update(JSON.stringify(doc)).digest("hex"), "da24170c930de582a286871514d7d9368db5b0d7330dcf1e65b2430612555ca5")
  assert.equal(doc.info.version, "1.1.0")
  const operation = doc.paths["/internal/v1/model-admissions"].post
  assert.equal(operation.operationId, "createAgentModelAdmission")
  assert.equal(operation["x-kokoro-permission"], "agent.model_admission")
  assert.deepEqual(operation.security, [{ AgentModelAdmissionBearer: [] }])
  for (const name of ["AgentModelAdmissionRequest", "AgentModelAdmissionResponse", "AgentModelAdmissionError"])
    assert.equal(doc.components.schemas[name].additionalProperties, false)
  const source = structuredClone(doc)
  delete source.paths["/internal/v1/model-admissions"]
  delete source.components.securitySchemes.AgentModelAdmissionBearer
  for (const name of ["AgentModelAdmissionRequest", "AgentModelAdmissionResponse", "AgentModelAdmissionError"]) delete source.components.schemas[name]
  source.info.version = "1.0.0"
  assert.equal(createHash("sha256").update(JSON.stringify(source)).digest("hex"), "c74784b6d946e4dd2837b895751998f7f5e7ebf173e4f6a17ec15ae165ce20cb")
  assert.equal(
    createHash("sha256")
      .update(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url)))
      .digest("hex"),
    "703dba47da8a5c659b4236bb0a72317588ad29a4ca444ff9e5c99cfbcd00634b",
  )
})
