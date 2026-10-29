// Build/test-only exact additive private snapshot change; no runtime downgrade.
import { createHash } from "node:crypto"
const hash = (source) => createHash("sha256").update(source).digest("hex")
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
