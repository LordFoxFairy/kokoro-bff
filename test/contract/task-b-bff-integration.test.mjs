import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import test from "node:test"
import { restoreIntegrationParent, restoreIntegrationBaseline } from "../../scripts/task-b-bff-integration-public-contract.mjs"
import { parseOpenApiOperations } from "../../scripts/check-contract.mjs"
const source = readFileSync(new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
const baseline = JSON.parse(readFileSync(new URL("../../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
const hash = (value) => createHash("sha256").update(value).digest("hex")
for (const [parent, digest, count] of [
  ["approved", "ea0031103488daa1fcc0cca45fdd13f4d4061546ac4525c745ec47105649f7e7", 199],
  ["rss", "6574930b3a893a208596e6f27c2f9e09122e759d111a7fdbf2d54c294efc0e8f", 168],
]) {
  test(`Public29 preserves complete exact ${parent} parent bytes and ordered inventory`, () => {
    const restored = restoreIntegrationParent(source, parent)
    assert.equal(hash(restored), digest)
    assert.equal(parseOpenApiOperations(restored).length, count)
    assert.equal(restoreIntegrationBaseline(baseline, parent).length, count)
  })
  test(`Public29 ${parent} projection rejects unrelated drift and ordered inventory drift`, () => {
    assert.throws(() => restoreIntegrationParent(source.replace("title:", "title: changed"), parent))
    assert.throws(() => restoreIntegrationParent(source.replace("version: 29.0.0", "version: 29.0.1"), parent))
    assert.throws(() => restoreIntegrationBaseline([...baseline].reverse(), parent))
  })
}
test("current canonical is Public29 and 200 unique operations", () => {
  assert.match(source, /^  version: 29\.0\.0$/mu)
  const operations = parseOpenApiOperations(source)
  assert.equal(operations.length, 200)
  assert.equal(new Set(operations.map((x) => `${x.method} ${x.path}`)).size, 200)
  assert.equal(operations.filter((x) => x.fields.get("operationId") === "initializeBillingCreditAccount").length, 1)
  assert.equal(
    operations.some((x) => x.path.startsWith("/v1/projects/") && x.path.includes("/resources/") && x.path.endsWith("/content")),
    false,
  )
})

test("integrated SQL restores both complete exact canonical parents and refuses drift", async () => {
  const { restoreIntegrationSchema } = await import("../../scripts/task-b-bff-integration-public-contract.mjs")
  const schema = readFileSync(new URL("../../database/schema.sql", import.meta.url), "utf8")
  assert.equal(hash(restoreIntegrationSchema(schema, "approved")), "8444edf810bba34c55a10d3ea56a266be605898f269327b16e4f51b713039043")
  for (const parent of ["approved", "rss"]) {
    assert.throws(() => restoreIntegrationSchema(schema + "\n-- drift", parent))
    assert.throws(() => restoreIntegrationSchema(schema.replace("trigger_epoch", "trigger_unknown"), parent))
  }
})
