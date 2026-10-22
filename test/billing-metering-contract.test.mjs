import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { load } from "js-yaml"
const source = () => readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
test("formal billing metering management is an additive current-admin capability", async () => {
  const doc = load(await source())
  assert.equal(doc.info.version, "22.5.0")
  for (const [method, path, id] of [
    ["get", "/v1/admin/billing/metering/pricing", "getAdminMeteringPricing"],
    ["post", "/v1/admin/billing/metering/rate-revisions", "publishAdminMeteringRate"],
    ["post", "/v1/admin/billing/metering/policy-revisions", "publishAdminMeteringPolicy"],
  ]) {
    assert.equal(doc.paths[path]?.[method]?.operationId, id)
    assert.equal(doc.paths[path]?.[method]?.["x-kokoro-permission"], "admin.billing.metering.manage")
  }
})
test("price and budget configuration is a closed tenant-free command, not a manual usage charge", async () => {
  const doc = load(await source())
  assert.deepEqual(doc.components.schemas.AdminMeteringPolicyPublishRequest?.required, ["publication_id", "reason", "configuration"])
  assert.equal(doc.components.schemas.MeteringPolicyConfiguration?.properties.max_attempt_credits.type, "string")
})

test("the entire preceding public contract and all 183 ordered operations are preserved", async () => {
  const { createHash } = await import("node:crypto"),
    { restoreMeteringContract, meteringParentBaseline } = await import("../scripts/billing-metering-public-contract.mjs")
  const raw = await source(),
    parent = restoreMeteringContract(raw)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "f6b8f3bd250c144a2d648af94c9fd5fe068db33991a4289b849a077eef009f32")
  const current = JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
  assert.equal(current.length, 186)
  assert.equal(meteringParentBaseline(current).length, 183)
  assert.throws(() => restoreMeteringContract(raw.replace("admin.billing.metering.manage", "billing.self.write")))
})
test("generated metering validators reject unknown nested fields rather than stripping intent", async () => {
  const z = await import("../dist/generated/billing-http/zod.gen.js")
  const common = { effective_from: "2026-01-01T00:00:00.000Z", verified_at: "2026-01-01T00:00:00.000Z", source_ref: "QA" }
  const row = {
    provider_ref: "provider",
    environment: "test",
    pricing_account_ref: "account",
    model_ref: "model",
    model_version: "1",
    bucket: "input_total",
    unit: "token",
    applicability: { kind: "all" },
    currency_code: "USD",
    minor_per_unit: { numerator: "1", denominator: "1000" },
  }
  const command = { publication_id: "11111111-1111-4111-8111-111111111111", reason: "QA", configuration: { ...common, rates: [row] } }
  assert.equal(z.zAdminMeteringRatePublishRequest.safeParse(command).success, true)
  for (const value of [
    { ...command, tenant_id: "other" },
    { ...command, configuration: { ...command.configuration, extra: true } },
    { ...command, configuration: { ...command.configuration, rates: [{ ...row, extra: true }] } },
    { ...command, configuration: { ...command.configuration, rates: [{ ...row, applicability: { kind: "all", extra: true } }] } },
    { ...command, configuration: { ...command.configuration, rates: [{ ...row, minor_per_unit: { ...row.minor_per_unit, float: 1 } }] } },
  ])
    assert.equal(z.zAdminMeteringRatePublishRequest.safeParse(value).success, false)
  assert.equal(z.zAdminMeteringPricingResponse.safeParse({ data: { rate_revision: null, policy_revision: null, extra: true } }).success, false)
})
