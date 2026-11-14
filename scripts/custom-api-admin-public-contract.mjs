import { createHash } from "node:crypto"
import { restoreAdminIdentityAuditContract, adminIdentityAuditParentBaseline } from "./admin-identity-audit-public-contract.mjs"
const hash = (value) => createHash("sha256").update(value).digest("hex")
const parentSha = "f7e327f8281e7f65845dc24c0a226734ce3b0f4d16c7255a6b3beee8a7f04a3d"
const childSha = "45c54365e75a31684e1dbf841a0c68cd554bf022643919cac591c78ed4499509"
const expected = [
  { method: "GET", path: "/v1/admin/custom-apis", operation_id: "listAdminCustomApis" },
  { method: "GET", path: "/v1/admin/custom-apis/{profile_id}", operation_id: "getAdminCustomApi" },
  { method: "POST", path: "/v1/admin/custom-apis/{profile_id}/quarantine", operation_id: "quarantineAdminCustomApi" },
  { method: "POST", path: "/v1/admin/custom-apis/{profile_id}/restore", operation_id: "restoreAdminCustomApi" },
  { method: "POST", path: "/v1/admin/custom-apis/{profile_id}/revoke", operation_id: "revokeAdminCustomApi" },
  { method: "GET", path: "/v1/admin/custom-apis/{profile_id}/audit-events", operation_id: "listAdminCustomApiAuditEvents" },
]
// Build-time proof only. The 221-operation B10 candidate is an exact intermediate,
// not a re-signed released parent; its original complete 28.38 guard remains downstream.
export function restoreCustomApiAdminContract(source) {
  source = restoreAdminIdentityAuditContract(source)
  if (!source.includes("  # CUSTOM-API-ADMIN-PATHS-BEGIN\n")) return source
  if (hash(source) !== childSha) throw Error("Custom API Admin current Public29 child drift")
  const parent = source
    .replace(/^  # CUSTOM-API-ADMIN-PATHS-BEGIN\n[\s\S]*?^  # CUSTOM-API-ADMIN-PATHS-END\n/mu, "")
    .replace(/^    # CUSTOM-API-ADMIN-SCHEMAS-BEGIN\n[\s\S]*?^    # CUSTOM-API-ADMIN-SCHEMAS-END\n/mu, "")
  if (hash(parent) !== parentSha) throw Error("Custom API Admin complete 221-operation parent drift")
  return parent
}
export function customApiAdminParentBaseline(items) {
  items = adminIdentityAuditParentBaseline(items)
  const names = new Set(expected.map((item) => item.operation_id))
  const found = items.filter((item) => names.has(item.operation_id))
  if (found.length === 0) return items
  if (JSON.stringify(found) !== JSON.stringify(expected) || items.length !== 227) throw Error("Custom API Admin operation inventory drift")
  const parent = items.filter((item) => !names.has(item.operation_id))
  if (hash(`${JSON.stringify({ version: "v1", operations: parent }, null, 2)}\n`) !== "4cc4eb8f989ea4789fdea612caa2f0162157b300c962064a6833284cacf39fac")
    throw Error("Custom API Admin complete ordered 221-operation inventory drift")
  return parent
}
