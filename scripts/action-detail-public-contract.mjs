// Build/test-only exact Public28.4→28.3 inverse. Never imported by production.
import { createHash } from "node:crypto"
const hash = (source) => createHash("sha256").update(source).digest("hex")
export const actionDetailCurrentSha256 = "48aa9638d133223c9f78655e9398ddbb44159963f92a2db891a09212f3aa2726"
export const actionDetailParentSha256 = "85a1b51cd151581b51d7ea7992d85e04462c03fafb36d0527e1df352dd85223a"
const sharedField = "            execution_process: { type: 'null' }\n"
const parentField =
  "            execution_process:\n              oneOf:\n                - $ref: '#/components/schemas/RunExecutionProcess'\n                - type: 'null'\n"

const sharedExample = "          execution_process: null\n"
const parentExample =
  "          execution_process:\n            run_id: run_01JASYNC\n            todos: null\n            activities: []\n            next_cursor: null\n"

const toolDetailDelta =
  "        display_detail:\n          type: object\n          required: [kind, name]\n          additionalProperties: false\n          properties:\n            kind: { type: string, enum: [file, mcp_tool] }\n            name:\n              type: string\n              minLength: 1\n              maxLength: 120\n              x-kokoro-utf8-byte-limit: 480\n              x-kokoro-unicode-domain: 'NFC Unicode scalars; no Cc, Cf or Cs'\n      allOf:\n        - if:\n            required: [display_detail]\n            properties:\n              display_detail:\n                properties: { kind: { const: file } }\n          then:\n            properties:\n              display_code: { enum: [tool.file.read, tool.file.write, tool.file.deliver] }\n              display_detail:\n                properties:\n                  name:\n                    pattern: '^(?!\\.{1,2}$)[^/\\\\:]+$'\n        - if:\n            required: [display_detail]\n            properties:\n              display_detail:\n                properties: { kind: { const: mcp_tool } }\n          then:\n            properties:\n              display_code: { enum: [tool.mcp.describe, tool.mcp.call] }\n"

export function restorePublic283ActionDetailContract(source) {
  if (!/^  version: 28\.4\.0$/mu.test(source)) {
    if (source.includes(sharedField)) throw Error("Action detail public version drift")
    return source
  }
  if (hash(source) !== actionDetailCurrentSha256) throw Error("Action detail complete Public28.4 candidate drift")
  const block = source.match(/^    SessionSnapshotResponse:\n[\s\S]*?(?=^    WorkspaceFile:)/mu)?.[0]
  if (!block || block.split(sharedField).length !== 2 || source.split(sharedField).length !== 2) throw Error("Action detail Share null exact delta drift")
  const tool = source.match(/^    RunToolActivity:\n[\s\S]*?(?=^    RunSubagentActivity:)/mu)?.[0]
  if (!tool || tool.split(toolDetailDelta).length !== 2 || source.split(toolDetailDelta).length !== 2) throw Error("Action detail tool exact delta drift")
  if (block.split(sharedExample).length !== 2) throw Error("Action detail Share example exact delta drift")
  const parent = source
    .replace(tool, () => tool.replace(toolDetailDelta, ""))
    .replace(block, () => block.replace(sharedField, parentField).replace(sharedExample, parentExample))
    .replace(/^  version: 28\.4\.0$/mu, "  version: 28.3.0")
  if (hash(parent) !== actionDetailParentSha256) throw Error("Action detail complete Public28.3 parent drift")
  return parent
}
