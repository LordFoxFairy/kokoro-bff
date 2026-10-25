import { restorePublic24SkillDetailContract } from "./skill-detail-public-contract.mjs"
// Build/test-only exact inverse; never imported by runtime.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
const proof = JSON.parse(readFileSync(new URL("../contract/tests/billing-metering.json", import.meta.url), "utf8"))
const hash = (value) => createHash("sha256").update(value).digest("hex")
export function restoreMcpSelectionContract(source) {
  source = restorePublic24SkillDetailContract(source)
  if (/^  version: 24\.0\.0$/mu.test(source)) {
    if (hash(source) !== "f4caf11f3cd9255d2cd9daf69b74ff9988505d640e31c686ce495e6d8a578b2c") throw Error("Exact MCP selection current contract drift")
    source = source
      .replace(
        "        selected_mcp_connection_ids:\n          type: array\n          maxItems: 16\n          uniqueItems: true\n          x-kokoro-json-byte-limit: 4096\n          description: Exact ordered Platform MCP Connection IDs for this message. Omission or [] adds no connections. This is intent, not authorization; compact ASCII JSON is limited to 4096 bytes.\n          items:\n            type: string\n            minLength: 1\n            maxLength: 191\n            pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])'\n",
        "        mcp_servers:\n          type: array\n          items: { type: string, minLength: 1 }\n",
      )
      .replace("  version: 24.0.0", "  version: 23.1.0")
    if (hash(source) !== "703dba47da8a5c659b4236bb0a72317588ad29a4ca444ff9e5c99cfbcd00634b") throw Error("Exact MCP selection complete parent drift")
  }
  return source
}
export function restoreMeteringContract(source) {
  source = restoreMcpSelectionContract(source)
  if (/^  version: 23\.1\.0$/mu.test(source)) {
    if (hash(source) !== "703dba47da8a5c659b4236bb0a72317588ad29a4ca444ff9e5c99cfbcd00634b") throw Error("Settlement failure current contract drift")
    source = source.replace("                - model_settlement_pending\n", "").replace("  version: 23.1.0", "  version: 23.0.0")
    if (hash(source) !== "34ea71e0aa56256ca00fc5b3c40abd4d142bea82e664a6871190b8547ec2b9e6") throw Error("Settlement failure complete public parent drift")
  }
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
