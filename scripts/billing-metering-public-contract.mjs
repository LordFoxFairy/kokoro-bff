// Build/test-only exact inverse; never imported by runtime.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/billing-metering.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
export function restoreMeteringContract(source) {
  if (/^  version: 23\.0\.0$/mu.test(source)) {
    if (hash(source) !== "34ea71e0aa56256ca00fc5b3c40abd4d142bea82e664a6871190b8547ec2b9e6") throw Error("Exact model binding contract drift")
    source = source
      .replace("        - model_revision\n", "")
      .replace(
        "        model_revision:\n          type: object\n          additionalProperties: false\n          required:\n            - id\n            - content_digest\n          properties:\n            id:\n              type: string\n              format: uuid\n              pattern: ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$(?![\\s\\S])\n            content_digest:\n              type: string\n              pattern: ^[0-9a-f]{64}$(?![\\s\\S])\n",
        "",
      )
      .replace("  version: 23.0.0", "  version: 22.5.0")
    if (hash(source) !== proof.current_sha256) throw Error("Exact model binding complete parent drift")
  }
  if (!/^  version: 22\.5\.0$/mu.test(source)) return source
  if (hash(source) !== proof.current_sha256) throw Error("Metering contract drift")
  const parent = source.replace(proof.path_block, "").replace(proof.schema_block, "").replace("  version: 22.5.0", "  version: 22.4.0")
  if (hash(parent) !== proof.parent_sha256) throw Error("Metering complete parent drift")
  return parent
}
export function meteringParentBaseline(inventory) {
  if (inventory.length !== 186) return inventory
  if (hash(JSON.stringify(inventory)) !== proof.current_inventory_sha256) throw Error("Metering inventory drift")
  const parent = inventory.filter((item) => !["getAdminMeteringPricing", "publishAdminMeteringRate", "publishAdminMeteringPolicy"].includes(item.operation_id))
  if (hash(JSON.stringify(parent)) !== proof.parent_inventory_sha256) throw Error("Metering preceding inventory drift")
  return parent
}
