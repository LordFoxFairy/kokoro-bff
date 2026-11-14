import { createHash } from "node:crypto"

const hash = (value) => createHash("sha256").update(value).digest("hex")
export const adminIdentityAuditParentOpenApiSha = "45c54365e75a31684e1dbf841a0c68cd554bf022643919cac591c78ed4499509"
const childSha = "dea9f3b6dfc03daab3a6fe3b4009635cd0aecf03517c05e7ce42ae116162c925"
const parentInventorySha = "d3aa6cffb1e791f99e8671a9bee04fb2a9d8da1a0c1db8b0f071eb97a8d3f2c8"
const operation = { method: "GET", path: "/v1/admin/identity/audit-events", operation_id: "listAdminIdentityAuditEvents" }

/** Build/test inverse only. The released Public29 raw bytes and old guards remain unchanged. */
export function restoreAdminIdentityAuditContract(source) {
  if (!source.includes("  # IDENTITY-AUDIT-PATHS-BEGIN\n")) return source
  if (hash(source) !== childSha) throw Error("Admin identity audit Public29.1 child drift")
  const parent = source
    .replace(/^  # IDENTITY-AUDIT-PATHS-BEGIN\n[\s\S]*?^  # IDENTITY-AUDIT-PATHS-END\n/mu, "")
    .replace(/^    # IDENTITY-AUDIT-SCHEMAS-BEGIN\n[\s\S]*?^    # IDENTITY-AUDIT-SCHEMAS-END\n/mu, "")
    .replace("  version: 29.1.0\n", "  version: 29.0.0\n")
  if (hash(parent) !== adminIdentityAuditParentOpenApiSha) throw Error("Admin identity audit complete Public29 parent drift")
  return parent
}

export function adminIdentityAuditParentBaseline(items) {
  const found = items.filter((item) => item.operation_id === operation.operation_id)
  if (found.length === 0) return items
  if (items.length !== 228 || JSON.stringify(items.at(-1)) !== JSON.stringify(operation)) throw Error("Admin identity audit ordered operation drift")
  const parent = items.slice(0, -1)
  if (hash(`${JSON.stringify({ version: "v1", operations: parent }, null, 2)}\n`) !== parentInventorySha)
    throw Error("Admin identity audit complete ordered Public29 inventory drift")
  return parent
}
