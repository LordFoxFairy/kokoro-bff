// Exact Public20 -> Public19 proof; not a runtime compatibility layer.
import { createHash } from "node:crypto"
const digest = (value) => createHash("sha256").update(value).digest("hex")
const currentDigest = "c5e89c7e56663d05d821c7c19115afb0cc913d617a35c6fd96162b13d201514f"
const parentDigest = "955412b680bf7a2529c4c35f553ff272d7361769ea95bb441ba820b552ffc564"
const inventoryDigest = "463376c78cf549fc35ded0d27ec4fe322edda42109867818a740300b81f15452"
const inverse = [
  {
    current: "  version: 20.0.0\n",
    previous: "  version: 19.0.0\n",
  },
  {
    current: "        - request_model\n        - connection\n",
    previous: "        - transport\n        - gateway_model_name\n",
  },
  {
    current: "        request_model:\n",
    previous: "        transport:\n          type: string\n          const: litellm\n        gateway_model_name:\n",
  },
  {
    current:
      "        connection:\n          type: object\n          additionalProperties: false\n          required: [protocol, connection_type, base_url, secret_handle_ref]\n          properties:\n            protocol:\n              type: string\n              const: openai_chat_completions\n            connection_type:\n              type: string\n              enum: [direct, litellm]\n            base_url:\n              type: string\n              minLength: 1\n              maxLength: 2048\n              pattern: '^https?:\\/\\/[^\\s\\\\?#]+$'\n            secret_handle_ref:\n              type: string\n              minLength: 1\n              maxLength: 255\n              pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'\n",
    previous: "",
  },
]
export function restorePublic19SystemModelConnectionContract(source) {
  if (!/^  version: 20\.0\.0$/mu.test(source)) return source
  if (digest(source) !== currentDigest) throw Error("Public20 complete model connection source drift")
  for (const change of [...inverse].reverse()) {
    if (source.split(change.current).length !== 2) throw Error("Public20 exact connection inverse hunk drift")
    source = source.replace(change.current, change.previous)
  }
  if (digest(source) !== parentDigest) throw Error("Public20 complete Public19 inverse drift")
  return source
}
export function inspectSystemModelConnectionContract(source, baseline) {
  try {
    if (!/^  version: 20\.0\.0$/mu.test(source)) throw Error("current public artifact must be Public20.0.0")
    restorePublic19SystemModelConnectionContract(source)
    if (digest(JSON.stringify(baseline)) !== inventoryDigest) throw Error("Public20 unchanged165 ordered inventory drift")
    return []
  } catch (error) {
    return [error.message]
  }
}
