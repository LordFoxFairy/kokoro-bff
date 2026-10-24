import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { load } from "js-yaml"
const source = () => readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
test("formal billing metering management is an additive current-admin capability", async () => {
  const doc = load(await source())
  assert.equal(doc.info.version, "24.0.0")
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
    model_revision: { id: "22222222-2222-4222-8222-222222222222", content_digest: "b".repeat(64) },
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

test("an unbound or malformed technical revision is rejected, including nested extras, without a legacy fallback", async () => {
  const { parseMeteringCommand, parseMeteringResult } = await import("../dist/infrastructure/clients/owner/billing-metering-wire.js")
  const common = { effective_from: "2026-01-01T00:00:00.000Z", verified_at: "2026-01-01T00:00:00.000Z", source_ref: "QA" }
  const pair = { id: "22222222-2222-4222-8222-222222222222", content_digest: "b".repeat(64) }
  const commercial = {
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
  const body = (row) => ({ publication_id: "11111111-1111-4111-8111-111111111111", reason: "QA", configuration: { ...common, rates: [row] } })
  const valid = body({ ...commercial, model_revision: pair })
  assert.deepEqual(parseMeteringCommand("rate", Buffer.from(JSON.stringify(valid)), "original-key"), { kind: "rate", body: valid, key: "original-key" })
  for (const row of [
    commercial,
    ...[
      null,
      { ...pair, id: "DISPLAY_NAME" },
      { ...pair, content_digest: "b".repeat(63) },
      { ...pair, content_digest: "B".repeat(64) },
      { ...pair, extra: "not allowed" },
    ].map((model_revision) => ({ ...commercial, model_revision })),
  ]) {
    const invalid = body(row)
    assert.equal(parseMeteringCommand("rate", Buffer.from(JSON.stringify(invalid)), "original-key"), null)
    assert.equal(
      parseMeteringResult(
        { kind: "read" },
        {
          data: {
            rate_revision: { revision: "1", content_digest: "a".repeat(64), published_at: common.verified_at, configuration: invalid.configuration },
            policy_revision: null,
          },
        },
      ),
      null,
    )
  }
  assert.deepEqual(
    parseMeteringResult(
      { kind: "read" },
      {
        data: {
          rate_revision: { revision: "1", content_digest: "a".repeat(64), published_at: common.verified_at, configuration: valid.configuration },
          policy_revision: null,
        },
      },
    )?.rate_revision?.configuration,
    valid.configuration,
  )
})

test("required exact model pair is the only change from the complete preceding public publication", async () => {
  const raw = await source(),
    doc = load(raw)
  const pair = doc.components.schemas.MeteringRate.properties.model_revision
  assert.equal(doc.components.schemas.MeteringRate.required.includes("model_revision"), true)
  assert.equal(pair.additionalProperties, false)
  assert.deepEqual(pair.required, ["id", "content_digest"])
  const { restoreMeteringContract } = await import("../scripts/billing-metering-public-contract.mjs")
  for (const altered of [
    raw.replace("        - model_revision\n", ""),
    raw.replace("        - content_digest\n", ""),
    raw.replace("/v1/account/archived-tasks", "/v1/account/retired-tasks"),
  ])
    assert.throws(() => restoreMeteringContract(altered))
})

test("settlement pending is the only 23.1 failure delta and the complete parent remains exact", async () => {
  const { createHash } = await import("node:crypto")
  const { restoreMeteringContract, restoreMcpSelectionContract } = await import("../scripts/billing-metering-public-contract.mjs")
  const raw = await source()
  const parent = restoreMcpSelectionContract(raw).replace("                - model_settlement_pending\n", "").replace("  version: 23.1.0", "  version: 23.0.0")
  assert.equal(createHash("sha256").update(parent).digest("hex"), "34ea71e0aa56256ca00fc5b3c40abd4d142bea82e664a6871190b8547ec2b9e6")
  assert.equal(restoreMeteringContract(raw), restoreMeteringContract(parent))
  for (const mutation of [
    raw.replace("- model_settlement_pending", "- invented_failure"),
    raw.replace("- model_settlement_pending", "- model_settlement_pending\n                - model_settlement_pending"),
    raw.replace("  title:", "  unexpected_title:"),
    raw.replace("- model_unavailable", "- invented_failure"),
  ])
    assert.throws(() => restoreMeteringContract(mutation))
})

test("Public24 replaces only the trace-only MCP input and proves all Public23.1 bytes", async () => {
  const { createHash } = await import("node:crypto")
  const { restoreMcpSelectionContract } = await import("../scripts/billing-metering-public-contract.mjs")
  const raw = await source()
  const parent = restoreMcpSelectionContract(raw)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "703dba47da8a5c659b4236bb0a72317588ad29a4ca444ff9e5c99cfbcd00634b")
  for (const changed of [
    raw.replace("uniqueItems: true", "uniqueItems: false"),
    raw.replace("/v1/account/archived-tasks", "/v1/account/retired-tasks"),
    raw.replace("maxLength: 191", "maxLength: 999"),
  ]) {
    assert.notEqual(changed, raw)
    assert.throws(() => restoreMcpSelectionContract(changed))
  }
})
