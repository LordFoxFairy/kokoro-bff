import { restoreClosureLocalContract } from "../../scripts/verify-closure-integration-contract.mjs"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { inspectPersonalKnowledgeContract, restorePublic16KnowledgeContract } from "../../scripts/verify-personal-knowledge-contract.mjs"
const read = async () => restoreClosureLocalContract(await readFile(new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"))
test("knowledge additive public contract preserves the complete fixed Public16 parent", async () => {
  const source = await read()
  assert.deepEqual(inspectPersonalKnowledgeContract(source), [])
  assert.equal(
    createHash("sha256").update(restorePublic16KnowledgeContract(source)).digest("hex"),
    "e15758fa80a62c4375e7d9b93784a1591b350f214f63c8483c2df27fc4800bd6",
  )
  assert.throws(
    () => restorePublic16KnowledgeContract(source.replace("Current IAM-admitted Product identity projections.", "tampered unrelated identity")),
    /parent inverse drift/u,
  )
})
test("knowledge contract rejects relaxed CAS, field limits and operation identity", async () => {
  const source = await read()
  for (const modified of [
    source.replace("operationId: replaceSelfKnowledge\n", "operationId: wrongOperation\n"),
    source.replace("maximum: 9007199254740991", "maximum: 9999999999999999"),
    source.replace("maxLength: 2000", "maxLength: 2001"),
  ])
    assert.ok(inspectPersonalKnowledgeContract(modified).length > 0)
})

test("knowledge operations bind their own bodies, successes and bounded search", async () => {
  const source = await read()
  for (const altered of [
    source.replace("$ref: '#/components/schemas/ReplacePersonalKnowledgeRequest'", "$ref: '#/components/schemas/ReplacePersonalKnowledgeUsageRequest'"),
    source.replace("$ref: '#/components/schemas/PersonalKnowledgeItemResponse'", "$ref: '#/components/schemas/PersonalKnowledgeUsageResponse'"),
    source.replace("maxLength: 500", "maxLength: 501"),
  ])
    assert.ok(inspectPersonalKnowledgeContract(altered).length > 0)
})
