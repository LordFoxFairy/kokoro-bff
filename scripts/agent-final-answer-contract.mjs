// Build/test-only inverse of the fixed Agent8.8 final-answer addition.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
const hash = (value) => createHash("sha256").update(value).digest("hex")
const deltas = [
  [
    '    "description": "Agent-owned execution admission, control, evidence and identity-scoped chat query boundary. The BFF consumes this contract; the Agent does not expose browser SSE or AG-UI.",\n    "version": "8.8.0"\n',
    '    "description": "Agent-owned execution admission, control, evidence and identity-scoped chat query boundary. The BFF consumes this contract; the Agent does not expose browser SSE or AG-UI.",\n    "version": "8.7.0"\n',
  ],
  [
    '            "activity": "#/components/schemas/ChatActivity",\n            "todo.updated": "#/components/schemas/ChatTodo",\n            "run.completed": "#/components/schemas/ChatRunCompleted"\n',
    '            "activity": "#/components/schemas/ChatActivity",\n            "todo.updated": "#/components/schemas/ChatTodo"\n',
  ],
  [
    '        "additionalProperties": false\n      },\n      "ChatRunCompleted": {\n        "type": "object",\n        "additionalProperties": false,\n        "required": [\n          "status"\n        ],\n        "properties": {\n          "status": {\n            "type": "string",\n            "enum": [\n              "completed",\n              "cancelled"\n            ]\n          },\n          "token_usage": {\n            "type": "object",\n            "additionalProperties": false,\n            "required": [\n              "input_tokens",\n              "output_tokens"\n            ],\n            "properties": {\n              "input_tokens": {\n                "type": "integer",\n                "minimum": 0\n              },\n              "output_tokens": {\n                "type": "integer",\n                "minimum": 0\n              }\n            }\n          },\n          "final_message_id": {\n            "type": "string",\n            "minLength": 1\n          }\n        },\n        "allOf": [\n          {\n            "if": {\n              "required": [\n                "final_message_id"\n              ]\n            },\n            "then": {\n              "properties": {\n                "status": {\n                  "const": "completed"\n                }\n              }\n            }\n          }\n        ]\n',
    '        "additionalProperties": false\n',
  ],
]
export function restoreAgent87FinalAnswerRaw(source) {
  source = restoreAgent88FinalDisplayRaw(source)
  if (!source.includes('"version": "8.8.0"')) return source
  assert.equal(hash(source), "fd8b2857ecbc9577bd98ca73234e4d81c53d4fe189ba86badcf35c774b9a6830", "Agent8.8 final answer child drift")
  for (const [child, parent] of deltas) {
    assert.equal(source.split(child).length, 2, "Agent8.8 final answer exact delta drift")
    source = source.replace(child, () => parent)
  }
  assert.equal(hash(source), "74fb43159ba559fe049f027a5fe4877d29524f5a73eae88c8d15913760cfb9fc", "Agent8.7 final answer parent drift")
  return source
}
export function restoreAgent87FinalAnswerContract(document) {
  document = restoreAgent88FinalDisplayContract(document)
  if (document.info?.version !== "8.8.0") return document
  const parent = structuredClone(document)
  delete parent.components.schemas.ChatRunCompleted
  delete parent.components.schemas.ChatEvent["x-kokoro-decoded-payloads"].mapping["run.completed"]
  parent.info.version = "8.7.0"
  assert.equal(hash(JSON.stringify(parent)), "c4b3f7b6070bdcbf6acea505255abb1957e24941c2c78bb8f0ba4f786a5f6ce1", "Agent8.7 final answer complete parent drift")
  return parent
}

export function restoreAgent88FinalDisplayRaw(source) {
  if (!source.includes('"version": "8.9.0"')) return source
  assert.equal(hash(source), "875545c23cf4cd055adfb4aedf6ea3c994eab6be10a25f1f68db248ffecb32c9", "Agent8.9 final display child drift")
  const field =
    ',\n          "final_message_id": {\n            "type": "string",\n            "pattern": "^msg_[0-9a-f]{32}(?![\\\\s\\\\S])",\n            "description": "Optional private read-only proof of a completed legacy Run\'s final public assistant message identity. Derived from a bounded reviewed native terminal and exact same-Run public body; never inferred from public ordering, never written back to historical events, and not an execution authority. Omitted when unproven. Consumers must bind their own exact ordered parts and revision before display."\n          }'
  assert.equal(source.split(field).length, 2, "Agent8.9 final display exact delta drift")
  source = source.replace(field, "").replace('"version": "8.9.0"', '"version": "8.8.0"')
  assert.equal(hash(source), "fd8b2857ecbc9577bd98ca73234e4d81c53d4fe189ba86badcf35c774b9a6830", "Agent8.8 final display parent drift")
  return source
}
export function restoreAgent88FinalDisplayContract(document) {
  if (document.info?.version !== "8.9.0") return document
  const parent = structuredClone(document)
  assert.deepEqual(
    parent.components.schemas.RunDisplay.properties.final_message_id,
    {
      type: "string",
      pattern: "^msg_[0-9a-f]{32}(?![\\s\\S])",
      description:
        "Optional private read-only proof of a completed legacy Run's final public assistant message identity. Derived from a bounded reviewed native terminal and exact same-Run public body; never inferred from public ordering, never written back to historical events, and not an execution authority. Omitted when unproven. Consumers must bind their own exact ordered parts and revision before display.",
    },
    "Agent8.9 final display shape drift",
  )
  delete parent.components.schemas.RunDisplay.properties.final_message_id
  parent.info.version = "8.8.0"
  assert.equal(hash(JSON.stringify(parent)), "f8917739db7545ebd0285f366b465849038ea561cb51c9cb40eae1f01ebd89ab", "Agent8.8 complete final display parent drift")
  return parent
}
