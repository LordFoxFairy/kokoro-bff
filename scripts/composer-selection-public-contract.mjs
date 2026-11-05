// Build/test-only exact additive private snapshot change; no runtime downgrade.
import { createHash } from "node:crypto"
import { restorePublic2819ProjectTasksContract } from "./project-tasks-public-contract.mjs"
const hash = (source) => createHash("sha256").update(source).digest("hex")

const accountProfileCurrentSha256 = "35a86f91e44beb1aeb6b17eca41d3bfdc79f11a43633662113a1778b4fab6082"
const accountProfileParentSha256 = "ea0031103488daa1fcc0cca45fdd13f4d4061546ac4525c745ec47105649f7e7"

export function restorePublic2821SteerContract(source) {
  if (!/^  version: 28\.22\.0$/mu.test(source)) return source
  if (hash(source) !== "a3d71aa845265084f7965c06dc903e2a5bf24c47d23bceb9a19bcd5d991c08b4") throw Error("Steer Public28.22 child drift")
  const field = "        message_id:\n          type: string\n          minLength: 1\n          description: Only present for run.steer; the BFF-owned user Message ID, not the client intent ID. Pending does not prove injection.\n"
  if (source.split(field).length !== 2) throw Error("Steer Public28.22 exact delta drift")
  const parent = source.replace(field, "").replace("  version: 28.22.0\n", "  version: 28.21.0\n")
  if (hash(parent) !== "a5ea4bb0ef1458a536e3b54e01049267aec2913d147f2ad7bb99a481197d0525") throw Error("Steer Public28.21 parent drift")
  return parent
}

export function restorePublic2820InterruptContract(source) {
  source = restorePublic2821SteerContract(source)
  if (!/^  version: 28\.21\.0$/mu.test(source)) return source
  if (hash(source) !== "a5ea4bb0ef1458a536e3b54e01049267aec2913d147f2ad7bb99a481197d0525") throw Error("Interrupt Public28.21 child drift")
  const field = "        interrupt_run_id:\n          type: string\n          minLength: 1\n          maxLength: 191\n          pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])'\n          description: >-\n            For an existing session, name its exact active Run to cancel while accepting this\n            FIFO successor. The same key and input return the original receipt. A stale target\n            or a Run already claimed by another interrupt returns 409 run_delivery_conflict\n            without accepting a new message. Acceptance does not prove cancellation or bypass FIFO.\n"
  if (source.split(field).length !== 2) throw Error("Interrupt Public28.21 exact delta drift")
  const parent = source.replace(field, "").replace("  version: 28.21.0\n", "  version: 28.20.0\n")
  if (hash(parent) !== "c5fc7225901fa5b815cdb7ee5286354d7c4cabed9919676e6e86651fb9910783") throw Error("Interrupt Public28.20 parent drift")
  return parent
}

export function restorePublic2818AccountProfileContract(source) {
  source = restorePublic2819ProjectTasksContract(restorePublic2820InterruptContract(source))
  if (/^  version: 28\.19\.0$/mu.test(source)) {
    if (hash(source) !== "27032917fb272601b6da8ba9227bab5324ac305682a72c94adca72e4f9e25577") throw Error("Context window Public28.19 child drift")
    const field = "                - context_window_exceeded\n"
    if (source.split(field).length !== 3) throw Error("Context window Public28.19 exact delta drift")
    source = source.replaceAll(field, "").replace("  version: 28.19.0\n", "  version: 28.18.0\n")
  }
  if (!/^  version: 28\.18\.0$/mu.test(source)) return source
  if (hash(source) !== accountProfileCurrentSha256) throw Error("Account profile Public28.18 child drift")
  const pathMatch = source.match(/^  \/v1\/account\/profile:\n    get:[\s\S]*?(?=    patch:)/mu)
  const schemaMatch = source.match(/^    AccountProfileReadResponse:\n[\s\S]*?(?=    AccountProfileError400:)/mu)
  if (pathMatch === null || schemaMatch === null) throw Error("Account profile Public28.18 exact delta drift")
  const parent = source
    .replace(pathMatch[0], "  /v1/account/profile:\n")
    .replace(schemaMatch[0], "")
    .replace(/^  version: 28\.18\.0$/mu, "  version: 28.17.0")
  if (hash(parent) !== accountProfileParentSha256) throw Error("Account profile Public28.17 parent drift")
  return parent
}

export function restorePublic2815ComposerSelectionContract(source) {
  source = restorePublic2816CustomApiSelectionContract(source)
  if (!/^  version: 28\.16\.0$/mu.test(source)) return source
  if (hash(source) !== "82485c2b7be17ad04f56d3656a58b42ea8d308c9dc22db5807a09ab706418a77") throw Error("Composer selection Public28.16 child drift")
  const field =
    "            composer_selection:\n              type: object\n              additionalProperties: false\n              required: [source_message_id, selected_mcp_connection_ids]\n              description: Latest accepted normal user Message selection in this private session. Unsent changes are not persisted. Absent when no source can be proven; [] means that request selected no MCP connections. Not execution authorization. Regeneration does not replace this baseline.\n              properties:\n                source_message_id: { type: string, minLength: 1 }\n                selected_mcp_connection_ids:\n                  type: array\n                  maxItems: 16\n                  uniqueItems: true\n                  x-kokoro-json-byte-limit: 4096\n                  description: Exact ordered Platform MCP Connection IDs for this message. Omission or [] adds no connections. This is intent, not authorization; compact ASCII JSON is limited to 4096 bytes.\n                  items:\n                    type: string\n                    minLength: 1\n                    maxLength: 191\n                    pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])'\n"
  if (source.split(field).length !== 2) throw Error("Composer selection exact delta drift")
  source = source.replace(field, "").replace("  version: 28.16.0\n", "  version: 28.15.0\n")
  if (hash(source) !== "8a56966d2d9a4a380b29dadeb9f79f5db8ef9975e8e2bbac4b1748ef03a70234") throw Error("Composer selection Public28.15 parent drift")
  return source
}

// The API selection adds only two optional safe-ref fields; all parent bytes remain fixed.
export function restorePublic2816CustomApiSelectionContract(source) {
  source = restorePublic2818AccountProfileContract(source)
  if (!/^  version: 28\.17\.0$/mu.test(source)) return source
  if (hash(source) !== "ea0031103488daa1fcc0cca45fdd13f4d4061546ac4525c745ec47105649f7e7") throw Error("Custom API selection Public28.17 child drift")
  for (const field of [
    "        selected_custom_api_profiles:\n          type: array\n          maxItems: 32\n          uniqueItems: true\n          x-kokoro-unique-by: profile_id\n          description: Exact ordered Custom API profile/version references for this message. Omission or [] selects none. Selection is intent, not authorization; values and credentials are never included.\n          items:\n            type: object\n            additionalProperties: false\n            required: [profile_id, expected_state_version]\n            properties:\n              profile_id:\n                type: string\n                minLength: 1\n                maxLength: 191\n                pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])'\n              expected_state_version:\n                type: integer\n                minimum: 1\n                maximum: 2147483647\n",
    "                selected_custom_api_profiles:\n                  type: array\n                  maxItems: 32\n                  uniqueItems: true\n                  x-kokoro-unique-by: profile_id\n                  description: Exact ordered Custom API profile/version references for this message. Omission or [] selects none. Selection is intent, not authorization; values and credentials are never included.\n                  items:\n                    type: object\n                    additionalProperties: false\n                    required: [profile_id, expected_state_version]\n                    properties:\n                      profile_id:\n                        type: string\n                        minLength: 1\n                        maxLength: 191\n                        pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])'\n                      expected_state_version:\n                        type: integer\n                        minimum: 1\n                        maximum: 2147483647\n",
  ]) {
    if (source.split(field).length !== 2) throw Error("Custom API selection exact delta drift")
    source = source.replace(field, "")
  }
  source = source.replace("  version: 28.17.0\n", "  version: 28.16.0\n")
  if (hash(source) !== "82485c2b7be17ad04f56d3656a58b42ea8d308c9dc22db5807a09ab706418a77") throw Error("Custom API selection Public28.16 parent drift")
  return source
}
