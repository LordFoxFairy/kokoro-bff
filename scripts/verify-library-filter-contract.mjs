import { restorePublic18McpPackageContract } from "./verify-mcp-package-admin-contract.mjs"
import { createHash } from "node:crypto"
import { load } from "js-yaml"
// Historical release inverse, never a second runtime query schema or cursor decoder.
const parentBlock =
  "  /v1/library:\n    get:\n      tags: [Library]\n      operationId: listLibrary\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: none\n      x-kokoro-permission: storage.library.read\n      summary: List private library files or delivered Artifacts\n      description: A required kind selects either the admitted subject's CLEAN personal ASSET files or FINAL CLEAN Artifacts linked to their active Conversations. Artifact pages revalidate Storage metadata and bind the opaque cursor to kind, tenant, subject and limit; a cursor never grants access.\n      parameters:\n        - name: kind\n          in: query\n          required: true\n          schema: { type: string, enum: [file, artifact] }\n        - name: limit\n          in: query\n          schema: { type: integer, minimum: 1, maximum: 100, default: 50 }\n        - name: cursor\n          in: query\n          schema: { type: string, minLength: 1, maxLength: 4096 }\n      responses:\n        '200':\n          description: Bounded private file or Artifact page, selected by kind\n          headers:\n            x-request-id:\n              schema: { type: string }\n              description: Request correlation ID\n            Cache-Control:\n              schema: { type: string, const: no-store }\n              description: Private uncached page\n          content:\n            application/json:\n              schema: { $ref: '#/components/schemas/LibraryListResponse' }\n        '400': { $ref: '#/components/responses/BadRequest' }\n        '403': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '502':\n          description: Storage owner page did not match the pinned v2 contract\n          content:\n            application/json:\n              schema: { $ref: '#/components/schemas/ErrorEnvelope' }\n        '503': { $ref: '#/components/responses/ServiceUnavailable' }\n        '401': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '429':\n          description: IAM session admission is rate limited\n          headers:\n            Retry-After:\n              description: Bounded delay in seconds before retrying admission\n              schema: { type: string, pattern: '^[1-9][0-9]{0,4}$' }\n          content:\n            application/json:\n              schema: { $ref: '#/components/schemas/ErrorEnvelope' }\n"
const currentBlockDigest = "8de33573293e13bf5e29b9ee7cbdf1b218c433fc87c472e51296fe9375750f1d"
const parentDigest = "ffc655e893b6ac90ee553acd368abbd68c7a3e77ed3a33a872643bf0d5a2a21f"
const digest = (value) => createHash("sha256").update(value).digest("hex")
export function restorePublic17LibraryFilterContract(source) {
  source = restorePublic18McpPackageContract(source)
  if (!/^  version: 18\.0\.0$/mu.test(source)) return source
  const start = source.indexOf("  /v1/library:\n"),
    end = source.indexOf("  /v1/library/files:\n", start)
  if (start < 0 || end < 0 || digest(source.slice(start, end)) !== currentBlockDigest) throw Error("Library filter current block drift")
  const parent = (source.slice(0, start) + parentBlock + source.slice(end)).replace("  version: 18.0.0", "  version: 17.0.0")
  if (digest(parent) !== parentDigest) throw Error("Library filter complete Public17 parent inverse drift")
  return parent
}
export function inspectLibraryFilterContract(source) {
  try {
    source = restorePublic18McpPackageContract(source)
    if (load(source).info.version !== "18.0.0") throw Error("Library filter current version drift")
    restorePublic17LibraryFilterContract(source)
    return []
  } catch (error) {
    return [error.message]
  }
}
