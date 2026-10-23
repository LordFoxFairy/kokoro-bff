import { restoreRssTriggerParent } from "../scripts/rss-trigger-public-contract.mjs"
import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { load } from "js-yaml"
const source = restoreRssTriggerParent(readFileSync(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"))
test("Public19.3 exposes natural-idempotent current credit account initialization", () => {
  const doc = load(source)
  assert.equal(doc.info.version, "19.3.0")
  const op = doc.paths["/v1/billing/credit-account"]?.put
  assert.equal(op?.operationId, "initializeBillingCreditAccount")
  assert.equal(op["x-kokoro-idempotency"], "inherent")
  assert.equal(op.requestBody.required, true)
  assert.deepEqual(op.requestBody.content["application/json"].schema, { type: "object", additionalProperties: false, maxProperties: 0 })
})

import { createHash } from "node:crypto"
import {
  inspectBillingCreditAccountContract,
  restoreBillingCreditAccountParent,
  billingCreditAccountParentBaseline,
} from "../scripts/billing-credit-account-public-contract.mjs"
import { inspectScheduledRunsContract } from "../scripts/scheduled-task-runs-public-contract.mjs"
import { inspectClosureIntegrationContract } from "../scripts/verify-closure-integration-contract.mjs"
const inventory = JSON.parse(readFileSync(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
test("Public19.3 restores exact19.2 and delegates unchanged historical proofs", () => {
  assert.deepEqual(inspectBillingCreditAccountContract(source, inventory), [])
  const parent = restoreBillingCreditAccountParent(source)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "ef56014105cc187bd86da74eb5ba6eef5f54aacb934e2f86e007c98719ff02f6")
  assert.equal(billingCreditAccountParentBaseline(inventory).length, 167)
  assert.deepEqual(inspectScheduledRunsContract(source, inventory), [])
  assert.deepEqual(inspectClosureIntegrationContract(source, inventory), [])
})
for (const [from, to] of [
  ["operationId: initializeBillingCreditAccount", "operationId: initializeWrongAccount"],
  ["x-kokoro-permission: billing.credit_account.initialize", "x-kokoro-permission: billing.summary.read"],
  ["x-kokoro-idempotency: inherent", "x-kokoro-idempotency: required"],
  ["schema: { type: object, additionalProperties: false, maxProperties: 0 }", "schema: { type: object }"],
  ["billing_account_disabled", "billing_account_unknown"],
  ["required: [error, meta]", "required: [error]"],
  ["Current IAM-admitted Product identity projections.", "unapproved historical change"],
])
  test(`Public19.3 rejects new or historical byte drift: ${from}`, () => {
    assert.ok(source.includes(from))
    assert.ok(inspectBillingCreditAccountContract(source.replace(from, to), inventory).length > 0)
    assert.ok(inspectClosureIntegrationContract(source.replace(from, to), inventory).length > 0)
  })
test("Public19.3 cannot accept missing duplicate reordered or altered historical inventory", () => {
  for (const changed of [
    inventory.slice(1),
    inventory.slice(0, -1),
    [...inventory].reverse(),
    [...inventory, inventory[0]],
    billingCreditAccountParentBaseline(inventory),
    inventory.map((x) => (x.operation_id === "initializeBillingCreditAccount" ? { ...x, method: "POST" } : x)),
  ]) {
    assert.ok(inspectBillingCreditAccountContract(source, changed).length > 0)
    assert.ok(inspectClosureIntegrationContract(source, changed).length > 0)
  }
})
test("initialization closed status/error schemas bind metadata retryability and safe headers", () => {
  const doc = load(source),
    responses = doc.paths["/v1/billing/credit-account"].put.responses
  assert.deepEqual(Object.keys(responses).sort(), ["200", "400", "401", "403", "429", "502", "503"])
  for (const status of [400, 401, 403, 429, 502, 503]) {
    const response = responses[status]
    assert.equal(response.headers["Cache-Control"].schema.const, "no-store")
    assert.equal(response.headers["x-request-id"].required, true)
    const schema = doc.components.schemas[response.content["application/json"].schema.$ref.split("/").at(-1)]
    assert.equal(schema.additionalProperties, false)
    assert.deepEqual(schema.required, ["error", "meta"])
    assert.equal(schema.properties.error.additionalProperties, false)
    assert.deepEqual(schema.properties.error.required, ["code", "message", "retryable"])
    assert.equal(schema.properties.error.properties.retryable.const, status === 429 || status === 503)
    assert.equal(schema.properties.meta.$ref, "#/components/schemas/RequestMeta")
  }
  assert.equal(responses[429].headers["Retry-After"].required, true)
})
