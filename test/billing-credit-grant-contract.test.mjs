import { meteringParentBaseline } from "../scripts/billing-metering-public-contract.mjs"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { restoreCreditGrantContract, creditGrantParentBaseline } from "../scripts/billing-credit-grant-public-contract.mjs"
import { restoreProviderModelDiscoveryContract } from "../scripts/provider-model-discovery-public-contract.mjs"
const source = () => readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
test("credit funding preserves all 182 preceding operations and the complete parent source", async () => {
  const raw = await source(),
    parent = restoreCreditGrantContract(raw)
  const proof = JSON.parse(await readFile(new URL("../contract/tests/billing-credit-grant.json", import.meta.url), "utf8"))
  assert.equal(createHash("sha256").update(parent).digest("hex"), proof.parent_sha256)
  assert.match(parent, /^  version: 22\.3\.0$/mu)
  assert.doesNotMatch(parent, /createAdminCreditGrant/u)
  assert.match(restoreProviderModelDiscoveryContract(raw), /^  version: 22\.2\.0$/mu)
  const inventory = meteringParentBaseline(JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations)
  assert.equal(inventory.length, 183)
  assert.equal(creditGrantParentBaseline(inventory).length, 182)
  for (const [from, to] of [
    ["x-kokoro-permission: admin.billing.credit_grant", "x-kokoro-permission: billing.self.write"],
    ["operationId: createAdminCreditGrant", "operationId: unknownCreditGrant"],
    ["/v1/admin/billing/credit-grants:", "/v1/billing/credit-grants:"],
    ["maxLength: 500", "maxLength: 501"],
  ]) {
    assert.notEqual(raw.replace(from, to), raw)
    assert.throws(() => restoreCreditGrantContract(raw.replace(from, to)))
  }
})
