import { restoreCustomApiAdminContract, customApiAdminParentBaseline } from "./custom-api-admin-public-contract.mjs"
import { createHash } from "node:crypto"
const hash = (value) => createHash("sha256").update(value).digest("hex")
export const projectGrantParentOpenApiSha = "d6927c3ae844303a5375cf196049a76db4119ab21478357314345cea0dbf13a1"
export const projectGrantParentSqlSha = "ad9a8500129ba74b394b10ad57e7d8e5481622a1a59d7e94de568b2f5653c9df"
const currentApiSha = "f7e327f8281e7f65845dc24c0a226734ce3b0f4d16c7255a6b3beee8a7f04a3d"
const currentSqlSha = "5d02adc16da062e69e8d88423d911f73b55bb02af4934bb9e2d209268e23d8c7"
export function restoreProjectGrantContract(source) {
  source = restoreCustomApiAdminContract(source)
  if (!/^  version: 29\.0\.0$/mu.test(source)) return source
  if (hash(source) !== currentApiSha) throw Error("Project Grant current Public29 drift")
  const parent = source
    .replace(/^([ ]*)# PROJECT-CHAT-SAFETY-BEGIN\n[\s\S]*?^\1# PROJECT-CHAT-SAFETY-END\n/gmu, "")
    .replace(
      /^        # PROJECT-ARTIFACT-READ-BEGIN\n[\s\S]*?^        # PROJECT-ARTIFACT-READ-END\n/mu,
      "        data: { $ref: '#/components/schemas/LibraryArtifactItem' }\n",
    )
    .replace(/^  # PROJECT-GRANT-PATHS-BEGIN\n[\s\S]*?^  # PROJECT-GRANT-PATHS-END\n/mu, "")
    .replace(/^    # PROJECT-GRANT-SCHEMAS-BEGIN\n[\s\S]*?^    # PROJECT-GRANT-SCHEMAS-END\n/mu, "")
    .replace(/^        # PROJECT-SCHEDULED-CAS-BEGIN\n[\s\S]*?^        # PROJECT-SCHEDULED-CAS-END\n/gmu, "")
    .replace(/^        # PROJECT-SCHEDULED-CAS-ERROR-BEGIN\n[\s\S]*?^        # PROJECT-SCHEDULED-CAS-ERROR-END\n/gmu, "")
    .replace(/^        # PROJECT-SCHEDULED-BINDING-BEGIN\n[\s\S]*?^        # PROJECT-SCHEDULED-BINDING-END\n/mu, "")
    .replace(/^      # PROJECT-SCHEDULED-CURRENT-BEGIN\n[\s\S]*?^      # PROJECT-SCHEDULED-CURRENT-END\n/mu, "      required: [scheduling_state]\n")
    .replace(/^          # PROJECT-CHAT-DELIVERY-CONTEXT-BEGIN\n[\s\S]*?^          # PROJECT-CHAT-DELIVERY-CONTEXT-END\n/mu, "")
    .replace(/^            # PROJECT-CHAT-ACCESS-BEGIN\n[\s\S]*?^            # PROJECT-CHAT-ACCESS-END\n/mu, "")
    .replace(
      /^              # PROJECT-CHAT-DELIVERY-READ-BEGIN\n[\s\S]*?^              # PROJECT-CHAT-DELIVERY-READ-END\n/mu,
      "              items: { $ref: '#/components/schemas/PrivateDelivery' }\n",
    )
    .replace("  version: 29.0.0\n", "  version: 28.38.0\n")
  if (hash(parent) !== projectGrantParentOpenApiSha) throw Error("Project Grant complete Public28.38 parent drift")
  return parent
}
export function projectGrantParentBaseline(items) {
  items = customApiAdminParentBaseline(items)
  const names = new Set(["getProjectAccess", "listProjectGrants", "setProjectGrant", "revokeProjectGrant"])
  const found = items.filter((item) => names.has(item.operation_id))
  if (found.length === 0) return items
  const expected = [
    {
      method: "GET",
      path: "/v1/projects/{projectId}/access",
      operation_id: "getProjectAccess",
    },
    {
      method: "GET",
      path: "/v1/projects/{projectId}/grants",
      operation_id: "listProjectGrants",
    },
    {
      method: "PUT",
      path: "/v1/projects/{projectId}/grants/{subject_id}",
      operation_id: "setProjectGrant",
    },
    {
      method: "DELETE",
      path: "/v1/projects/{projectId}/grants/{subject_id}",
      operation_id: "revokeProjectGrant",
    },
  ]
  if (JSON.stringify(found) !== JSON.stringify(expected)) throw Error("Project Grant operation inventory drift")
  return items.filter((item) => !names.has(item.operation_id))
}
export function restoreProjectGrantSchema(source) {
  if (hash(source) !== currentSqlSha) throw Error("Project Grant current SQL drift")
  const parent = source
    .replace(/^\n-- PROJECT-AGUI-SOURCE-SQL-BEGIN\n[\s\S]*?^-- PROJECT-AGUI-SOURCE-SQL-END\n/mu, "")
    .replace(/^-- PROJECT-GRANT-SQL-BEGIN\n[\s\S]*?^-- PROJECT-GRANT-SQL-END\n\n/mu, "")
    .replace(/^-- PROJECT-SCHEDULED-EXECUTION-SQL-BEGIN\n[\s\S]*?^-- PROJECT-SCHEDULED-EXECUTION-SQL-END\n\n/mu, "")
  if (hash(parent) !== projectGrantParentSqlSha) throw Error("Project Grant complete parent SQL drift")
  return parent
}
