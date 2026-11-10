// Build-time exact additive inverse; never a runtime downgrade.
import { createHash } from "node:crypto"
const hash = (source) => createHash("sha256").update(source).digest("hex")
export function restorePublic2824FinalAnswerResourceContract(source) {
  if (!/^  version: 28\.25\.0$/mu.test(source)) return source
  if (hash(source) !== "008667f501044dc186e615b83370f96a7401de8027f25e7635248724fb165759") throw Error("Final-answer resource Public28.25 child drift")
  const parent = source
    .replace("  version: 28.25.0\n", "  version: 28.24.0\n")
    .replace("              kind: { type: string, enum: [asset, artifact, final_answer] }\n", "              kind: { type: string, enum: [asset, artifact] }\n")
    .replace(" For final_answer, resource_id is the opaque assistant Message ID; no text, scope, segment, revision or digest is accepted.", "")
  if (hash(parent) !== "921c4b7273580a5c64cf6a220808472e828239d4abfbc7b5b93138ecc055a429")
    throw Error("Final-answer resource complete Public28.24 parent drift")
  return parent
}
export function restorePublic2823MessageResourceContract(source) {
  source = restorePublic2824FinalAnswerResourceContract(source)
  if (!/^  version: 28\.24\.0$/mu.test(source)) return source
  if (hash(source) !== "921c4b7273580a5c64cf6a220808472e828239d4abfbc7b5b93138ecc055a429") throw Error("Message resources Public28.24 child drift")
  const field =
    "        selected_resource_refs:\n          type: array\n          maxItems: 16\n          uniqueItems: true\n          x-kokoro-json-byte-limit: 4096\n          description: Ordered opaque resource intent for this message. Omission or [] selects none. Compact UTF-8 JSON is limited to 4096 bytes. Owner scope and exact bytes are resolved by BFF; version_id is not accepted.\n          items:\n            type: object\n            additionalProperties: false\n            required: [kind, resource_id]\n            properties:\n              kind: { type: string, enum: [asset, artifact] }\n              resource_id:\n                type: string\n                minLength: 1\n                maxLength: 191\n                pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])'\n"
  if (source.split(field).length !== 2) throw Error("Message resource exact delta drift")
  const parent = source.replace(field, "").replace("  version: 28.24.0\n", "  version: 28.23.0\n")
  if (hash(parent) !== "0abd300ffc5d50d3aefa19832a32feb53ea358933bcc4df655202517554a7504") throw Error("Message resources complete Public28.23 parent drift")
  return parent
}
