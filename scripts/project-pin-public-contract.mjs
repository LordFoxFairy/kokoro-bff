// Build/test-only complete Public28.5→28.4 inverse. Never imported by production.
import { createHash } from "node:crypto"
const hash = (value) => createHash("sha256").update(value).digest("hex")
const current = "109a2ae063b10699ae52776b09533c5622d906679c093d65730a289206043b1a"
const parent = "48aa9638d133223c9f78655e9398ddbb44159963f92a2db891a09212f3aa2726"
const blocks = {
  PATHS: "d7d11a69700816e64e26ef1070a701e5220c917139e52453a6935af0cde069ac",
  SCHEMAS: "e87990d51977c1313ba84a81e7403b8a3facecddfb4adb6ff3aa4c1295f0e03a",
  RESPONSES: "d66d6252ac572eec3ae241aa433aa7810fd51e4f7e17d6f2325d4fb5081ca549",
}
// S13 build/test-only inverse; closed to this exact two-field/version delta.
export const hubPublisherCurrentSha256 = "a020e849f740165fa20099f5ab041b76bc480c70a9bbc067955e57f5ec22ae02"
const hubPublisherDelta =
  '              product:\n                $ref: "#/components/schemas/Public9SkillProductFacts"\n                description: Same authorized current version owner product; absence is only the coordinated predecessor-reader transition, not an inferred publisher.\n              publisher_profile:\n                $ref: "#/components/schemas/SkillPublisherProfile"\n                description: Required exactly when product.publisher.kind is iam; kind and id match its iam ref. Omitted for unknown or verified GitHub publisher. Missing never substitutes a creator or default name.\n'
// S10 build/test-only inverse: exactly the discovery paths bound and version.
export const githubDiscoveryCurrentSha256 = "818dfe54d5eb50a72725983be136211c63bb17fa7392f94c5c1d46234db3ebd1"
const githubDiscoveryDelta = "                paths:\n                  type: array\n                  maxItems: 512\n"
// Project content build/test-only inverse: one exact path and the complete Public28.7 parent.
export const projectContentCurrentSha256 = "6376e2d2a5fa9efd8e6ce4d9d4aa3686ad73dda8babffd9ac5b7097073538498"
const projectContentDelta =
  "  /v1/projects/{projectId}/skill-installations/{installation_id}/package:\n    get:\n      tags: [Skills]\n      operationId: getProjectSkillInstallationPackage\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: none\n      x-kokoro-permission: product.skill.installation.read\n      summary: Inspect an exact Skill installation package in the currently visible Project\n      description: >-\n        Resolve the currently visible Project before and after the exact installed pin read.\n        Uses only InspectProjectSkillInstallationPackage with trusted Project transport, never personal or current catalog aliases.\n        Reject unknown or duplicate query keys, body, transfer-encoding and idempotency-key. The decoded identifier and optional\n        file_path are passed without trimming or a second decode. A single absolute ten-second budget covers admission, credentials,\n        OAuth HTTP, owner RPC, strict projection and final UTF-8 JSON encoding. The complete public JSON is at most 1,048,576 bytes;\n        responses are not truncated. For a file read, selected_file.path equals the requested file_path exactly.\n      parameters:\n        - name: projectId\n          in: path\n          required: true\n          schema: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }\n        - name: installation_id\n          in: path\n          required: true\n          schema: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }\n        - $ref: '#/components/parameters/SkillPackageInspectionFilePath'\n      responses:\n        '200': { $ref: '#/components/responses/SkillPackageInspectionOk' }\n        '400': { $ref: '#/components/responses/SkillPackageInspectionBadRequest' }\n        '401': { $ref: '#/components/responses/SkillPackageInspectionUnauthorized' }\n        '403': { $ref: '#/components/responses/SkillPackageInspectionForbidden' }\n        '404': { $ref: '#/components/responses/SkillPackageInspectionNotFound' }\n        '412': { $ref: '#/components/responses/SkillPackageInspectionPreconditionFailed' }\n        '429': { $ref: '#/components/responses/SkillPackageInspectionRateLimited' }\n        '502': { $ref: '#/components/responses/SkillPackageInspectionBadGateway' }\n        '503': { $ref: '#/components/responses/SkillPackageInspectionUnavailable' }\n"
// Private cancelled read inverse: exact closed schema delta; no runtime imports.
export const cancelledMessageCurrentSha256 = "b438a749c919d24c4e0f1dadfdbcbbb11e0ac755f5785c543a661336c2cbb354"
const cancelledMessageBefore =
  "    ChatMessageRead:\n      description: Private read only. Legacy and user bodies keep their original representation; proven ordered assistant bodies are read through their bound parts cursor.\n      oneOf:\n        - $ref: '#/components/schemas/ChatMessage'\n        - $ref: '#/components/schemas/OrderedAssistantMessageRead'\n    OrderedAssistantMessageRead:\n      type: object\n      required: [message_id, role, content, status, created_at, run_id, rendering]\n      additionalProperties: false\n      properties:\n        selected_skill_source_refs:\n          type: array\n          maxItems: 16\n          uniqueItems: true\n          items: { type: string, pattern: '^skill:(?!skill:)[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])' }\n        message_id: { type: string, minLength: 1 }\n        role:\n          type: string\n          const: assistant\n        content: { type: 'null', description: Body is not inlined; read the exact ordered Message parts. }\n        rendering: { $ref: '#/components/schemas/OrderedMessageRendering' }\n        status:\n          type: string\n          enum: [pending, streaming, completed, failed]\n        created_at: { type: string, format: date-time }\n        run_id: { type: string, minLength: 1 }\n        failure:\n          type: object\n          required: [source, code, retryable]\n          additionalProperties: false\n          properties:\n            source: { type: string, const: agent }\n            code:\n              type: string\n              enum:\n                - token_budget_exceeded\n                - recursion_limit_exceeded\n                - assembly_failed\n                - enqueue_failed\n                - dispatch_exhausted\n                - contract_incompatible\n                - internal_error\n                - model_unavailable\n                - dependency_unavailable\n                - model_access_denied\n                - model_settlement_pending\n            retryable: { type: boolean }\n          if:\n            properties:\n              retryable: { const: true }\n          then:\n            properties:\n              code: { enum: [model_unavailable, dependency_unavailable] }\n      allOf:\n        - if:\n            properties: { failure: {} }\n            required: [failure]\n          then:\n            required: [run_id]\n            properties:\n              role: { const: assistant }\n              status: { const: failed }\n              run_id: { type: string, minLength: 1 }\n"
const cancelledMessageAfter =
  "    ChatMessageRead:\n      description: Private read only. Legacy and user bodies keep their original representation; proven ordered assistant bodies are read through their bound parts cursor.\n      oneOf:\n        - $ref: '#/components/schemas/ChatMessage'\n        - $ref: '#/components/schemas/OrderedAssistantMessageRead'\n        - $ref: '#/components/schemas/CancelledAssistantMessageRead'\n    OrderedAssistantMessageRead:\n      type: object\n      required: [message_id, role, content, status, created_at, run_id, rendering]\n      additionalProperties: false\n      properties:\n        selected_skill_source_refs:\n          type: array\n          maxItems: 16\n          uniqueItems: true\n          items: { type: string, pattern: '^skill:(?!skill:)[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])' }\n        message_id: { type: string, minLength: 1 }\n        role:\n          type: string\n          const: assistant\n        content: { type: 'null', description: Body is not inlined; read the exact ordered Message parts. }\n        rendering: { $ref: '#/components/schemas/OrderedMessageRendering' }\n        terminal_status: { type: string, const: cancelled }\n        status:\n          type: string\n          enum: [pending, streaming, completed, failed]\n        created_at: { type: string, format: date-time }\n        run_id: { type: string, minLength: 1 }\n        failure:\n          type: object\n          required: [source, code, retryable]\n          additionalProperties: false\n          properties:\n            source: { type: string, const: agent }\n            code:\n              type: string\n              enum:\n                - token_budget_exceeded\n                - recursion_limit_exceeded\n                - assembly_failed\n                - enqueue_failed\n                - dispatch_exhausted\n                - contract_incompatible\n                - internal_error\n                - model_unavailable\n                - dependency_unavailable\n                - model_access_denied\n                - model_settlement_pending\n            retryable: { type: boolean }\n          if:\n            properties:\n              retryable: { const: true }\n          then:\n            properties:\n              code: { enum: [model_unavailable, dependency_unavailable] }\n      allOf:\n        - if:\n            properties: { failure: {} }\n            required: [failure]\n          then:\n            required: [run_id]\n            properties:\n              role: { const: assistant }\n              status: { const: failed }\n              run_id: { type: string, minLength: 1 }\n        - if:\n            required: [terminal_status]\n          then:\n            properties:\n              status: { const: failed }\n            not: { required: [failure] }\n    CancelledAssistantMessageRead:\n      description: Private inline assistant read with a proven durable cancellation. Does not assert empty or fully read content.\n      type: object\n      additionalProperties: false\n      required: [message_id, role, content, status, created_at, run_id, terminal_status]\n      properties:\n        message_id: { $ref: '#/components/schemas/ChatMessage/properties/message_id' }\n        role: { type: string, const: assistant }\n        content: { $ref: '#/components/schemas/ChatMessage/properties/content' }\n        status: { type: string, const: failed }\n        created_at: { $ref: '#/components/schemas/ChatMessage/properties/created_at' }\n        run_id: { type: string, minLength: 1 }\n        selected_skill_source_refs: { $ref: '#/components/schemas/ChatMessage/properties/selected_skill_source_refs' }\n        terminal_status: { type: string, const: cancelled }\n"
export function restorePublic288CancelledMessageContract(source) {
  if (!/^  version: 28\.9\.0$/mu.test(source)) {
    if (source.includes("    CancelledAssistantMessageRead:")) throw Error("Cancelled Message version drift")
    return source
  }
  if (hash(source) !== cancelledMessageCurrentSha256 || source.split(cancelledMessageAfter).length !== 2) throw Error("Cancelled Message exact current drift")
  const restored = source.replace(cancelledMessageAfter, cancelledMessageBefore).replace(/^  version: 28\.9\.0$/mu, "  version: 28.8.0")
  if (hash(restored) !== projectContentCurrentSha256) throw Error("Cancelled Message complete Public28.8 drift")
  return restored
}

export function restorePublic287ProjectContentContract(source) {
  source = restorePublic288CancelledMessageContract(source)
  if (!/^  version: 28\.8\.0$/mu.test(source)) {
    if (source.includes("  /v1/projects/{projectId}/skill-installations/{installation_id}/package:")) throw Error("Project content version drift")
    return source
  }
  if (hash(source) !== projectContentCurrentSha256 || source.split(projectContentDelta).length !== 2) throw Error("Project content exact current drift")
  const restored = source.replace(projectContentDelta, "").replace(/^  version: 28\.8\.0$/mu, "  version: 28.7.0")
  if (hash(restored) !== githubDiscoveryCurrentSha256) throw Error("Project content complete Public28.7 drift")
  return restored
}

export function restorePublic286GithubDiscoveryContract(source) {
  source = restorePublic287ProjectContentContract(source)
  if (!/^  version: 28\.7\.0$/mu.test(source)) {
    if (source.includes(githubDiscoveryDelta)) throw Error("GitHub discovery version drift")
    return source
  }
  if (hash(source) !== githubDiscoveryCurrentSha256 || source.split(githubDiscoveryDelta).length !== 2) throw Error("GitHub discovery exact current drift")
  const restored = source.replace(githubDiscoveryDelta, githubDiscoveryDelta.replace("512", "128")).replace(/^  version: 28\.7\.0$/mu, "  version: 28.6.0")
  if (hash(restored) !== hubPublisherCurrentSha256) throw Error("GitHub discovery complete Public28.6 drift")
  return restored
}

export function restorePublic285HubPublisherContract(source) {
  source = restorePublic286GithubDiscoveryContract(source)
  if (!/^  version: 28\.6\.0$/mu.test(source)) {
    if (source.includes(hubPublisherDelta)) throw Error("Hub publisher version drift")
    return source
  }
  if (hash(source) !== hubPublisherCurrentSha256 || source.split(hubPublisherDelta).length !== 2) throw Error("Hub publisher exact current drift")
  const restored = source.replace(hubPublisherDelta, "").replace(/^  version: 28\.6\.0$/mu, "  version: 28.5.0")
  if (hash(restored) !== current) throw Error("Hub publisher complete Public28.5 drift")
  return restored
}

export function restorePublic284ProjectPinContract(source) {
  source = restorePublic285HubPublisherContract(source)
  if (!/^  version: 28\.5\.0$/mu.test(source)) return source
  if (hash(source) !== current) throw Error("Project pin full current drift")
  let restored = source
  for (const [kind, digest] of Object.entries(blocks)) {
    const indent = kind === "PATHS" ? "  " : "    "
    const pattern = new RegExp(`^${indent}# PROJECT-PIN-${kind}-BEGIN\n[\\s\\S]*?^${indent}# PROJECT-PIN-${kind}-END\n`, "mu")
    const block = restored.match(pattern)?.[0]
    if (!block || hash(block) !== digest) throw Error("Project pin exact delta drift")
    restored = restored.replace(block, "")
  }
  restored = restored.replace(/^  version: 28\.5\.0$/mu, "  version: 28.4.0")
  if (hash(restored) !== parent) throw Error("Project pin complete Public28.4 drift")
  return restored
}
export function projectPinParentInventory(inventory) {
  inventory = projectContentParentInventory(inventory)
  const hasPin = inventory.some((item) => ["listSelfProjectPins", "setProjectPin"].includes(item.operation_id))
  if (inventory.length !== 194) {
    if (hasPin) throw Error("Project pin inventory drift")
    return inventory
  }
  if (hash(JSON.stringify(inventory)) !== "2dcd50ad0f38b76904c2c4b8b478a12b74ee78395bc741b74ada8ad482ff6d61")
    throw Error("Project pin complete current inventory drift")
  const restored = inventory.filter((item) => !["listSelfProjectPins", "setProjectPin"].includes(item.operation_id))
  if (hash(JSON.stringify(restored)) !== "804e1bf56c3b66fb7da55024031aac235aab789c7aac21509eca37ed3e433180")
    throw Error("Project pin complete parent inventory drift")
  return restored
}

export function restoreProjectPinSchema(source) {
  if (!source.includes("-- PROJECT-PIN-SQL-BEGIN")) return source
  if (hash(source) !== "82b67bc5f8bb18deaa78821c9c4f59962f3d8ca5c986120544b84f9e9c8d13d0") throw Error("Project pin complete current SQL drift")
  const block = source.match(/^-- PROJECT-PIN-SQL-BEGIN\n[\s\S]*?^-- PROJECT-PIN-SQL-END\n\n/mu)?.[0]
  if (!block || hash(block) !== "4e76d896282166ae587e3d443a8448d560b72aa926f23c50b0e66b5114ac5eae") throw Error("Project pin SQL exact delta drift")
  const restored = source.replace(block, "")
  if (hash(restored) !== "70f6933f3bf0542d4c8babc6ced7ab7f4c128c0cc0a570ab195309850373e993") throw Error("Project pin complete SQL parent drift")
  return restored
}

export function projectContentParentInventory(inventory) {
  const added = inventory.filter((item) => item.operation_id === "getProjectSkillInstallationPackage")
  if (inventory.length !== 195) {
    if (added.length) throw Error("Project content inventory drift")
    return inventory
  }
  if (hash(JSON.stringify(inventory)) !== "c3d96610855b56fe8826f242e53eca4abb181317eec2df077b2f25c7a91246d4" || added.length !== 1)
    throw Error("Project content complete current inventory drift")
  const restored = inventory.filter((item) => item.operation_id !== "getProjectSkillInstallationPackage")
  if (hash(JSON.stringify(restored)) !== "2dcd50ad0f38b76904c2c4b8b478a12b74ee78395bc741b74ada8ad482ff6d61")
    throw Error("Project content complete parent inventory drift")
  return restored
}
