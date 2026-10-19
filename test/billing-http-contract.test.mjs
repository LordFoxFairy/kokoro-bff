import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const root = new URL("../", import.meta.url)
const ownerSourceUrl = new URL("contract/vendor/kokoro-billing/3f5e0dacc25c1e24d87cbe0c59337d3b909466de/openapi.yaml", root)
const dependencyManifestUrl = new URL("contract/dependencies/billing-http.json", root)
const generatedSdkUrl = new URL("src/generated/billing-http/sdk.gen.ts", root)
const generatedZodUrl = new URL("src/generated/billing-http/zod.gen.ts", root)
const publicSourceUrl = new URL("contract/openapi/v1/openapi.yaml", root)
const fakeStoreUrl = new URL("test/doubles/bff-store.ts", root)
const mockRouteUrl = new URL("test/doubles/mock-route.ts", root)

const ownerSourceSha256 = "9ff84d5f473e2f161f5d0c496db4cee175e2b032e836e97c7e23b9576a0af3e6"
const creditAccountFields = ["credit_account_id", "status", "available_micros", "held_micros"]
const ledgerEntryFields = ["journal_id", "sequence", "delta_micros", "balance_after_micros", "source_kind", "source_ref", "created_at"]

function yamlBlock(source, header) {
  const lines = source.split("\n")
  const start = lines.indexOf(header)
  assert.notEqual(start, -1, `missing YAML block: ${header.trim()}`)
  const indent = header.length - header.trimStart().length
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end]
    if (line.trim() !== "" && line.length - line.trimStart().length <= indent) break
    end += 1
  }
  return lines.slice(start, end).join("\n")
}

function schemaProperties(block) {
  return [...block.matchAll(/^        ([a-z][a-z0-9_]*):/gmu)].map((match) => match[1])
}

function requiredFields(block) {
  return [...block.matchAll(/^        - ([a-z][a-z0-9_]*)$/gmu)].map((match) => match[1])
}

function generatedExportBlock(source, name) {
  const match = new RegExp(`export const ${name} = [\\s\\S]*?(?=\\n\\nexport (?:const|type)|$)`, "u").exec(source)
  assert.ok(match, `missing generated export: ${name}`)
  return match[0]
}

test("fixed Billing v1 source publishes the two reviewed personal Credit reads", async () => {
  const bytes = await readFile(ownerSourceUrl)
  assert.equal(createHash("sha256").update(bytes).digest("hex"), ownerSourceSha256)
  const source = bytes.toString("utf8")
  const accountOperation = yamlBlock(source, "  /v1/billing/me/credit-account:")
  const ledgerOperation = yamlBlock(source, "  /v1/billing/me/credit-ledger:")
  assert.match(accountOperation, /^      operationId: getMyCreditAccount$/mu)
  assert.match(accountOperation, /\$ref: "#\/components\/schemas\/CreditAccountResponse"/u)
  assert.match(ledgerOperation, /^      operationId: getMyCreditLedger$/mu)
  assert.match(ledgerOperation, /\$ref: "#\/components\/schemas\/CreditLedgerResponse"/u)
})

test("fixed Billing v1 source owns the exact decimal-string account and ledger fields", async () => {
  const source = await readFile(ownerSourceUrl, "utf8")
  const account = yamlBlock(source, "    CreditAccount:")
  const entry = yamlBlock(source, "    LedgerEntry:")
  assert.match(account, /^      additionalProperties: false$/mu)
  assert.deepEqual(requiredFields(account), creditAccountFields)
  assert.deepEqual(schemaProperties(account), creditAccountFields)
  assert.match(account, /available_micros:\n          \$ref: "#\/components\/schemas\/NonNegativeCreditMicros"/u)
  assert.match(account, /held_micros:\n          \$ref: "#\/components\/schemas\/NonNegativeCreditMicros"/u)
  assert.match(entry, /^      additionalProperties: false$/mu)
  assert.deepEqual(requiredFields(entry), ledgerEntryFields)
  assert.deepEqual(schemaProperties(entry), ledgerEntryFields)
  assert.match(entry, /delta_micros:\n          \$ref: "#\/components\/schemas\/CreditMicros"/u)
  assert.match(entry, /balance_after_micros:\n          \$ref: "#\/components\/schemas\/NonNegativeCreditMicros"/u)
})

test("generated Billing dependency is fixed and exposes Catalog and the two personal reads", async () => {
  const manifest = JSON.parse(await readFile(dependencyManifestUrl, "utf8"))
  assert.deepEqual(manifest.owner, {
    repository_path: "apps/kokoro-billing",
    repository_commit: "3f5e0dacc25c1e24d87cbe0c59337d3b909466de",
    contract_version: "4.0.0-experimental.2",
    contract_path: "contract/openapi/v1/openapi.yaml",
    contract_sha256: ownerSourceSha256,
  })
  const sdk = await readFile(generatedSdkUrl, "utf8")
  assert.deepEqual([...sdk.matchAll(/^export const (\w+) =/gmu)].map((match) => match[1]).sort(), ["getCatalog", "getMyCreditAccount", "getMyCreditLedger"])
  const zod = await readFile(generatedZodUrl, "utf8")
  for (const name of [
    "zErrorResponse",
    "zCatalogItem",
    "zCatalogResponse",
    "zPage",
    "zCreditAccount",
    "zCreditAccountResponse",
    "zLedgerEntry",
    "zCreditLedgerResponse",
  ]) {
    assert.match(generatedExportBlock(zod, name), /\.strict\(\)$/u)
  }
  assert.equal([...generatedExportBlock(zod, "zErrorResponse").matchAll(/\.strict\(\)/gu)].length, 2)
  assert.equal([...generatedExportBlock(zod, "zCreditLedgerResponse").matchAll(/\.strict\(\)/gu)].length, 2)
  assert.deepEqual(
    manifest.generated.map((entry) => entry.path).sort(),
    [
      "client.gen.ts",
      "client/client.gen.ts",
      "client/index.ts",
      "client/types.gen.ts",
      "client/utils.gen.ts",
      "core/auth.gen.ts",
      "core/bodySerializer.gen.ts",
      "core/params.gen.ts",
      "core/pathSerializer.gen.ts",
      "core/queryKeySerializer.gen.ts",
      "core/serverSentEvents.gen.ts",
      "core/types.gen.ts",
      "core/utils.gen.ts",
      "sdk.gen.ts",
      "types.gen.ts",
      "zod.gen.ts",
    ].sort(),
  )
})

test("public summary consumes the exact owner Credit account instead of a float projection", async () => {
  const source = await readFile(publicSourceUrl, "utf8")
  const summary = yamlBlock(source, "    BillingSummary:")
  assert.match(summary, /^      additionalProperties: false$/mu)
  assert.deepEqual(schemaProperties(summary), creditAccountFields)
})

test("public contract exposes the fixed owner Credit ledger fields", async () => {
  const source = await readFile(publicSourceUrl, "utf8")
  const operation = yamlBlock(source, "  /v1/billing/ledger:")
  assert.match(operation, /^      operationId: getBillingLedger$/mu)
  const entry = yamlBlock(source, "    BillingLedgerEntry:")
  assert.match(entry, /^      additionalProperties: false$/mu)
  assert.deepEqual(schemaProperties(entry), ledgerEntryFields)
})

test("public Billing summary rejects the removed float and cash-like fields", async () => {
  const source = await readFile(publicSourceUrl, "utf8")
  const summary = yamlBlock(source, "    BillingSummary:")
  const oldFields = ["balance", "currency", "period", "usage"]
  assert.deepEqual(
    schemaProperties(summary).filter((field) => oldFields.includes(field)),
    [],
  )
})

test("BFF test doubles no longer provide the fake 100-Credit summary", async () => {
  const [source, route] = await Promise.all([readFile(fakeStoreUrl, "utf8"), readFile(mockRouteUrl, "utf8")])
  assert.equal(
    source.includes('readonly billing: BillingSummary = { balance: 100, currency: "USD", period: "2026-01", usage: 0 }'),
    false,
    "the legacy fake balance is still wired",
  )
  assert.doesNotMatch(route, /segments\[1\] === "summary"[\s\S]*store\.billing/u)
})

test("Catalog generated response is fully closed and key comes only from the owner", async () => {
  const zod = await readFile(generatedZodUrl, "utf8")
  assert.equal([...generatedExportBlock(zod, "zCatalogResponse").matchAll(/\.strict\(\)/gu)].length, 2)
  assert.match(generatedExportBlock(zod, "zCatalogItem"), /offer_key: z\.string\(\)\.min\(1\)\.max\(255\)/u)
})
