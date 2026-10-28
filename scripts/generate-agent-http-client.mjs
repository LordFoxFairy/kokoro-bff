import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const output = path.join(root, "src/generated/agent-http")
const manifestPath = path.join(root, "contract/dependencies/agent-http.json")
const configPath = path.join(root, "openapi-ts.agent.config.ts")
const lockfilePath = path.join(root, "pnpm-lock.yaml")
const ownerCommit = "f31b60be27dd9b4dfddd7a1c3579b19e40db150d"
const vendorPath = path.join(root, `contract/vendor/kokoro-agent/${ownerCommit}/openapi.json`)
const provenancePath = path.join(root, `contract/vendor/kokoro-agent/${ownerCommit}/provenance.json`)
const ownerDigest = "239219e5a80427a74f8d89363c5a7a4fe2753f99c6b469b02bab7fba9ba44f52"
const provenanceDigest = "275f66d882ab85bf01c71347c0a9302b6c4bfc0d7bcd94ee6d01b8ce1219f230"
const ownerContractVersion = "8.4.0"
const failureCodes = [
  "token_budget_exceeded",
  "recursion_limit_exceeded",
  "assembly_failed",
  "enqueue_failed",
  "dispatch_exhausted",
  "contract_incompatible",
  "internal_error",
  "model_unavailable",
  "dependency_unavailable",
  "model_access_denied",
  "model_settlement_pending",
]
const retryableFailureCodes = ["model_unavailable", "dependency_unavailable"]
const generatedFiles = [
  "client.gen.ts",
  "client/client.gen.ts",
  "client/index.ts",
  "client/types.gen.ts",
  "client/utils.gen.ts",
  "core/auth.gen.ts",
  "core/bodySerializer.gen.ts",
  "core/params.gen.ts",
  "core/pathSerializer.gen.ts",
  "core/queryKeySerializer.gen.ts",
  "core/serverSentEvents.gen.ts",
  "core/types.gen.ts",
  "core/utils.gen.ts",
  "failure-profile.gen.ts",
  "process-profile.gen.ts",
  "sdk.gen.ts",
  "types.gen.ts",
  "zod.gen.ts",
]
const generatedDirectories = ["client", "core"]

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function record(value, label) {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${label} must be an object`)
  return value
}

export function assertFailureContractSchema(document) {
  const schemas = record(record(record(document, "Agent OpenAPI").components, "components").schemas, "components.schemas")
  assert.deepEqual(
    schemas.Failure,
    {
      type: "object",
      required: ["code", "retryable"],
      properties: {
        code: { type: "string", enum: failureCodes },
        retryable: { type: "boolean" },
      },
      if: { properties: { retryable: { const: true } } },
      then: { properties: { code: { enum: retryableFailureCodes } } },
    },
    "Failure schema drifted",
  )
  assert.deepEqual(
    schemas.ChatFailure,
    {
      allOf: [
        { $ref: "#/components/schemas/Failure" },
        {
          type: "object",
          required: ["status"],
          properties: { status: { type: "string", const: "failed" } },
        },
      ],
      unevaluatedProperties: false,
    },
    "ChatFailure schema drifted",
  )

  const chatEvent = record(schemas.ChatEvent, "ChatEvent")
  assert.equal(
    record(chatEvent["x-kokoro-decoded-payloads"], "ChatEvent decoded payloads").mapping?.["run.failed"],
    "#/components/schemas/ChatFailure",
    "ChatEvent run.failed mapping drifted",
  )
  return { failureCodes: [...failureCodes], retryableFailureCodes: [...retryableFailureCodes] }
}

// Decode only the published schema graph referenced by ChatEvent's payload mapping.
// The generator does not follow extension refs; derive these validators from the pinned bytes,
// rather than maintaining another editable schema or enabling every orphan owner component.
// Build/test-only raw inverse retains numeric lexemes and numeric-key source order exactly.
export function restoreAgent83ToolFactsRaw(source) {
  assert.equal(sha256(source), "239219e5a80427a74f8d89363c5a7a4fe2753f99c6b469b02bab7fba9ba44f52", "Agent8.4 complete raw child drift")
  const replacements = [
    [
      '    "description": "Agent-owned execution admission, control, evidence and identity-scoped chat query boundary. The BFF consumes this contract; the Agent does not expose browser SSE or AG-UI.",\n    "version": "8.4.0"\n  },\n',
      '    "description": "Agent-owned execution admission, control, evidence and identity-scoped chat query boundary. The BFF consumes this contract; the Agent does not expose browser SSE or AG-UI.",\n    "version": "8.3.0"\n  },\n',
    ],
    [
      '          "display_skills",\n          "tool_paths",\n          "tool_facts"\n        ],\n',
      '          "display_skills",\n          "tool_paths"\n        ],\n',
    ],
    [
      '            }\n          },\n          "tool_facts": {\n            "type": "array",\n            "maxItems": 128,\n            "x-kokoro-unique-by": "activity_id",\n            "items": {\n              "type": "object",\n              "required": [\n                "activity_id"\n              ],\n              "properties": {\n                "activity_id": {\n                  "type": "string",\n                  "minLength": 68,\n                  "maxLength": 68,\n                  "pattern": "^act_[0-9a-f]{64}(?![\\\\s\\\\S])"\n                },\n                "display_detail": {\n                  "type": "object",\n                  "required": [\n                    "kind",\n                    "name"\n                  ],\n                  "properties": {\n                    "kind": {\n                      "type": "string",\n                      "enum": [\n                        "mcp_tool"\n                      ]\n                    },\n                    "name": {\n                      "type": "string",\n                      "minLength": 1,\n                      "maxLength": 120,\n                      "x-kokoro-utf8-byte-limit": 480,\n                      "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs"\n                    }\n                  },\n                  "additionalProperties": false\n                },\n                "status": {\n                  "type": "string",\n                  "enum": [\n                    "failed"\n                  ]\n                }\n              },\n              "anyOf": [\n                {\n                  "required": [\n                    "display_detail"\n                  ]\n                },\n                {\n                  "required": [\n                    "status"\n                  ]\n                }\n              ],\n              "additionalProperties": false\n            },\n            "description": "Read-only exact original MCP activity facts: safe public names witnessed by successful same-Run calls, or independently proved failed journal outcomes. No source event or Run status mutation."\n          }\n',
      "            }\n          }\n",
    ],
  ]
  for (const [from, to] of replacements) {
    assert.equal(source.split(from).length - 1, 1, "Agent8.4 exact tool facts delta drift")
    source = source.replace(from, to)
  }
  assert.equal(sha256(source), "be642c2313fbaf447d4e37bda2a7920f867c3a06d39f7e0e82efaf212e7080d6", "Agent8.3 full raw parent drift")
  return source
}
export function restoreAgent82DisplayRaw(source) {
  assert.equal(sha256(source), "be642c2313fbaf447d4e37bda2a7920f867c3a06d39f7e0e82efaf212e7080d6", "Agent8.3 complete raw child drift")
  const replacements = [
    [
      '      }\n    },\n    "/v1/runs/{run_id}/display": {\n      "get": {\n        "tags": [\n          "runs"\n        ],\n        "summary": "Read bounded identity-scoped Run display facts",\n        "operationId": "getRunDisplay",\n        "security": [\n          {\n            "AgentServiceBearer": []\n          }\n        ],\n        "parameters": [\n          {\n            "name": "run_id",\n            "in": "path",\n            "required": true,\n            "schema": {\n              "type": "string",\n              "minLength": 1\n            }\n          },\n          {\n            "$ref": "#/components/parameters/RequestId"\n          },\n          {\n            "$ref": "#/components/parameters/TenantRef"\n          },\n          {\n            "$ref": "#/components/parameters/SubjectRef"\n          },\n          {\n            "$ref": "#/components/parameters/SubjectKind"\n          },\n          {\n            "$ref": "#/components/parameters/ActorRef"\n          },\n          {\n            "$ref": "#/components/parameters/ActorKind"\n          },\n          {\n            "$ref": "#/components/parameters/AssertionRef"\n          }\n        ],\n        "x-kokoro-owner": "kokoro-agent",\n        "x-kokoro-visibility": "internal-owner",\n        "x-kokoro-stability": "stable",\n        "x-kokoro-idempotency": "read-only",\n        "x-kokoro-permission": "agent-service",\n        "responses": {\n          "200": {\n            "description": "Safe recovered display facts, at most 1MiB.",\n            "content": {\n              "application/json": {\n                "schema": {\n                  "$ref": "#/components/schemas/RunDisplayEnvelope"\n                }\n              }\n            }\n          },\n          "401": {\n            "$ref": "#/components/responses/Unauthorized"\n          },\n          "404": {\n            "$ref": "#/components/responses/NotFound"\n          },\n          "503": {\n            "$ref": "#/components/responses/Unavailable"\n          },\n          "400": {\n            "$ref": "#/components/responses/BadRequest"\n          }\n        },\n        "x-kokoro-read-budget": {\n          "total_timeout_seconds": 5,\n          "checkpoint_locators": 32,\n          "native_input_bytes": 8388608,\n          "query_body": "forbidden; Content-Length, Transfer-Encoding and Idempotency-Key forbidden"\n        }\n      }\n    }\n',
      "      }\n    }\n",
    ],
    [
      '            "$ref": "#/components/schemas/PreparedModelCallSnapshot"\n          },\n          "meta": {\n            "$ref": "#/components/schemas/Meta"\n          }\n        },\n        "additionalProperties": false\n      },\n      "SkillDisplay": {\n        "type": "object",\n        "required": [\n          "source_ref",\n          "name",\n          "virtual_path"\n        ],\n        "properties": {\n          "source_ref": {\n            "type": "string",\n            "minLength": 7,\n            "maxLength": 197,\n            "pattern": "^skill:(?!skill:)[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\\\s\\\\S])"\n          },\n          "name": {\n            "type": "string",\n            "minLength": 1,\n            "maxLength": 120,\n            "x-kokoro-utf8-byte-limit": 480,\n            "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs"\n          },\n          "virtual_path": {\n            "type": "string",\n            "minLength": 1,\n            "maxLength": 4096,\n            "x-kokoro-utf8-byte-limit": 4096,\n            "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs",\n            "description": "Validated absolute virtual backend path; never a host path, URL, secret or unproven raw argument."\n          },\n          "revision": {\n            "type": "string",\n            "pattern": "^[1-9][0-9]{0,18}(?![\\\\s\\\\S])",\n            "x-kokoro-int64-decimal": true\n          }\n        },\n        "additionalProperties": false,\n        "x-kokoro-binding": "virtual_path must equal /.skills/{base64url(ASCII source_ref suffix)}/SKILL.md; revision only from this Run exact ResolvedSkill, absent if unproven"\n      },\n      "RunDisplay": {\n        "type": "object",\n        "required": [\n          "run_id",\n          "display_skills",\n          "tool_paths"\n        ],\n        "properties": {\n          "run_id": {\n            "type": "string",\n            "minLength": 1\n          },\n          "display_skills": {\n            "type": "array",\n            "maxItems": 16,\n            "items": {\n              "$ref": "#/components/schemas/SkillDisplay"\n            },\n            "x-kokoro-unique-by": "source_ref",\n            "x-kokoro-binding": "unique source_ref subset of original ready source_refs; no current catalog lookup"\n          },\n          "tool_paths": {\n            "type": "array",\n            "maxItems": 128,\n            "x-kokoro-unique-by": "activity_id",\n            "items": {\n              "type": "object",\n              "required": [\n                "activity_id",\n                "virtual_path"\n              ],\n              "properties": {\n                "activity_id": {\n                  "type": "string",\n                  "minLength": 68,\n                  "maxLength": 68,\n                  "pattern": "^act_[0-9a-f]{64}(?![\\\\s\\\\S])"\n                },\n                "virtual_path": {\n                  "type": "string",\n                  "minLength": 1,\n                  "maxLength": 4096,\n                  "x-kokoro-utf8-byte-limit": 4096,\n                  "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs",\n                  "description": "Validated absolute virtual backend path; never a host path, URL, secret or unproven raw argument."\n                }\n              },\n              "additionalProperties": false\n            }\n          }\n        },\n        "additionalProperties": false,\n        "description": "Recovered safe display facts only. Missing facts remain unknown; source events and execution authority are unchanged. No completeness assertion."\n      },\n      "RunDisplayEnvelope": {\n        "type": "object",\n        "required": [\n          "data",\n          "meta"\n        ],\n        "properties": {\n          "data": {\n            "$ref": "#/components/schemas/RunDisplay"\n          },\n',
      '            "$ref": "#/components/schemas/PreparedModelCallSnapshot"\n          },\n',
    ],
    [
      '              }\n            },\n            "allOf": [\n              {\n                "if": {\n                  "required": [\n                    "display_skills"\n                  ]\n                },\n                "then": {\n                  "properties": {\n                    "phase": {\n                      "const": "ready"\n                    }\n                  }\n                }\n              }\n            ]\n          }\n',
      "              }\n            }\n          }\n",
    ],
    [
      '                ]\n              },\n              "display_skills": {\n                "type": "array",\n                "maxItems": 16,\n                "items": {\n                  "$ref": "#/components/schemas/SkillDisplay"\n                },\n                "x-kokoro-unique-by": "source_ref",\n                "x-kokoro-binding": "unique source_ref subset of original ready source_refs; no current catalog lookup"\n              }\n',
      "                ]\n              }\n",
    ],
    [
      '                      ]\n                    },\n                    "display_detail": {\n                      "not": {\n                        "required": [\n                          "virtual_path"\n                        ]\n                      }\n                    }\n',
      "                      ]\n                    }\n",
    ],
    [
      '                    "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs"\n                  },\n                  "virtual_path": {\n                    "type": "string",\n                    "minLength": 1,\n                    "maxLength": 4096,\n                    "x-kokoro-utf8-byte-limit": 4096,\n                    "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs",\n                    "description": "Validated absolute virtual backend path; never a host path, URL, secret or unproven raw argument."\n                  }\n',
      '                    "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs"\n                  }\n',
    ],
    [
      '    "description": "Agent-owned execution admission, control, evidence and identity-scoped chat query boundary. The BFF consumes this contract; the Agent does not expose browser SSE or AG-UI.",\n    "version": "8.3.0"\n  },\n',
      '    "description": "Agent-owned execution admission, control, evidence and identity-scoped chat query boundary. The BFF consumes this contract; the Agent does not expose browser SSE or AG-UI.",\n    "version": "8.2.0"\n  },\n',
    ],
  ]
  for (const [from, to] of replacements) {
    assert.equal(source.split(from).length - 1, 1, "Agent8.3 exact raw delta drift")
    source = source.replace(from, to)
  }
  assert.equal(sha256(source), "8a0b9973661205b8e29020934c39e5c7ab629b4c42db4e79c845a410d96efa2a", "Agent8.2 full raw parent drift")
  return source
}
// Build/test-only strict full owner child inverse. Production generation requires the current exact blob above.
export function restoreAgent83ToolFactsContract(document) {
  if (document.info?.version !== "8.4.0" && !document.components?.schemas?.RunDisplay?.properties?.tool_facts) return document
  assert.equal(sha256(JSON.stringify(document)), "aece8b1ea4d83f63b224f0b219afba99e1c5646f4b698d2257562e36e0c36528", "Agent8.4 complete tool facts child drift")
  const parent = structuredClone(document)
  delete parent.components.schemas.RunDisplay.properties.tool_facts
  parent.components.schemas.RunDisplay.required = ["run_id", "display_skills", "tool_paths"]
  parent.info.version = "8.3.0"
  assert.equal(sha256(JSON.stringify(parent)), "055f99061318807d48f2a53a8e6290edfc31442623908c145d5cd6b67f0f8188", "Agent8.3 complete tool facts parent drift")
  return parent
}
export function restoreAgent82DisplayContract(document) {
  document = restoreAgent83ToolFactsContract(document)
  if (document.info?.version !== "8.3.0" && !document.components?.schemas?.RunDisplay) return document
  assert.equal(sha256(JSON.stringify(document)), "055f99061318807d48f2a53a8e6290edfc31442623908c145d5cd6b67f0f8188", "Agent8.3 complete display child drift")
  const parent = structuredClone(document),
    schemas = parent.components.schemas
  delete parent.paths["/v1/runs/{run_id}/display"]
  for (const name of ["SkillDisplay", "RunDisplay", "RunDisplayEnvelope"]) delete schemas[name]
  delete schemas.ChatActivity.oneOf[0].properties.display_detail.properties.virtual_path
  delete schemas.ChatActivity.oneOf[0].allOf[1].then.properties.display_detail
  delete schemas.ChatActivity.oneOf[2].properties.display_skills
  delete schemas.ChatActivity.oneOf[2].allOf
  parent.info.version = "8.2.0"
  assert.equal(sha256(JSON.stringify(parent)), "0599b6504973415a9410e09703b8ea890ad98ef20702192eb6d6d19eda544b3a", "Agent8.2 complete parent drift")
  return parent
}

export function assertInteractionContractSchema(document) {
  const currentDocument = document
  document = restoreAgent82DisplayContract(document)
  const schemas = record(document.components?.schemas, "Agent schemas")
  assert.deepEqual(schemas.ChatEvent["x-kokoro-decoded-payloads"], {
    discriminator: "event_type",
    property: "payload_json",
    mapping: {
      "run.failed": "#/components/schemas/ChatFailure",
      "interaction.state": "#/components/schemas/ChatInteractionState",
      activity: "#/components/schemas/ChatActivity",
      "todo.updated": "#/components/schemas/ChatTodo",
    },
  })
  assert.deepEqual(schemas.ChatEvent.properties.event_type.enum, [
    "run.started",
    "assistant.delta",
    "assistant.completed",
    "activity",
    "todo.updated",
    "interaction.state",
    "delivery",
    "run.completed",
    "run.failed",
  ])
  for (const [name, required] of [
    ["ChatInteractionState", ["interaction_revision", "pause_revision", "pause_ref", "phase", "groups", "action_result"]],
    ["InteractionGroup", ["group_id", "items"]],
    ["InteractionItem", ["item_id", "request_id", "kind", "allowed_decisions", "display"]],
    ["InteractionDisplay", ["name", "description", "editable", "input_schema"]],
    ["InteractionValidation", ["code", "instance_path"]],
    ["InteractionActionResult", ["command_id", "pause_revision", "kind"]],
    ["ResumeControl", ["kind", "session_id", "decisions", "expected_pause_revision", "pause_ref"]],
  ]) {
    assert.equal(schemas[name].additionalProperties, false, name + " must be closed")
    assert.deepEqual(schemas[name].required, required, name + " required fields drifted")
  }
  assert.deepEqual(schemas.ChatInteractionState.properties.phase.enum, ["active", "waiting", "resuming", "terminal"])
  assert.equal(schemas.ChatInteractionState.allOf.length, 3)
  assert.equal(schemas.InteractionDisplay.allOf.length, 1)
  assert.equal(schemas.InteractionItem.properties.allowed_decisions.uniqueItems, true)
  assert.equal(schemas.ResumeControl.properties.expected_pause_revision.minimum, 1)
  assert.equal(schemas.ResumeControl.properties.pause_ref.minLength, 1)
  assert.deepEqual(
    schemas.ResumeDecision.oneOf.map((branch) => branch.properties.type.const),
    ["approve", "edit", "reject", "respond", "submit"],
  )
  for (const branch of schemas.ResumeDecision.oneOf) assert.equal(branch.additionalProperties, false)
  assert.deepEqual(schemas.ResumeDecision.oneOf[0].properties.args.type, ["object", "null"])
  assert.deepEqual(schemas.ResumeDecision.oneOf[2].properties.reason.type, ["string", "null"])
  assert.equal(schemas.ChatTodo.additionalProperties, false)
  assert.deepEqual(schemas.ChatTodo.required, ["todos"])
  assert.equal(schemas.ChatTodo.properties.todos.maxItems, 100)
  assert.equal(schemas.ChatTodo["x-kokoro-json-byte-limit"], 65_536)
  assert.equal(schemas.ChatActivity.oneOf.length, 3)
  assert.deepEqual(
    schemas.ChatActivity.oneOf.map((branch) => branch.properties.activity.const),
    ["tool", "subagent", "skill"],
  )
  for (const branch of schemas.ChatActivity.oneOf) assert.equal(branch.additionalProperties, false)
  assert.deepEqual(
    schemas.ChatActivity.oneOf[0].properties.display_code,
    {
      type: "string",
      enum: [
        "tool.execution",
        "tool.file.read",
        "tool.mcp.discover",
        "tool.mcp.describe",
        "tool.mcp.call",
        "tool.web.search",
        "tool.web.fetch",
        "tool.file.write",
        "tool.file.deliver",
      ],
    },
    "Agent tool display closed set drifted",
  )
  assert.deepEqual(
    schemas.ChatActivity.oneOf[1].properties.display_code,
    { type: "string", const: "subagent.execution" },
    "Agent subagent display branch drifted",
  )
  const tool = schemas.ChatActivity.oneOf[0]
  assert.deepEqual(tool.required, ["activity", "activity_id", "segment_id", "status", "display_code"])
  assert.deepEqual(Object.keys(tool.properties), [...tool.required, "display_detail"])
  assert.deepEqual(
    tool.properties.display_detail,
    {
      type: "object",
      required: ["kind", "name"],
      properties: {
        kind: { type: "string", enum: ["file", "mcp_tool"] },
        name: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          "x-kokoro-utf8-byte-limit": 480,
          "x-kokoro-unicode-domain": "NFC Unicode scalars; no Cc, Cf or Cs",
        },
      },
      additionalProperties: false,
    },
    "Agent tool detail closed domain drifted",
  )
  assert.deepEqual(
    tool.allOf,
    [
      {
        if: { required: ["display_detail"], properties: { display_detail: { properties: { kind: { const: "file" } } } } },
        then: {
          properties: {
            display_code: { enum: ["tool.file.read", "tool.file.write", "tool.file.deliver"] },
            display_detail: { properties: { name: { pattern: "^(?!\\.{1,2}$)[^/\\\\:]+$" } } },
          },
        },
      },
      {
        if: { required: ["display_detail"], properties: { display_detail: { properties: { kind: { const: "mcp_tool" } } } } },
        then: { properties: { display_code: { enum: ["tool.mcp.describe", "tool.mcp.call"] } } },
      },
    ],
    "Agent tool detail category conditions drifted",
  )
  assert.deepEqual(Object.keys(schemas.ChatActivity.oneOf[1].properties), ["activity", "activity_id", "segment_id", "status", "display_code"])
  const skill = schemas.ChatActivity.oneOf[2]
  assert.equal(skill.properties.source_refs.minItems, 1)
  assert.equal(skill.properties.source_refs.maxItems, 16)
  assert.equal(skill.properties.source_refs.uniqueItems, true)
  assert.equal(skill.properties.source_refs["x-kokoro-json-byte-limit"], 4096)
  assert.deepEqual(skill.then, { required: ["error_code"] })
  assert.deepEqual(skill.else, { not: { required: ["error_code"] } })
  return currentDocument.components.schemas
}

function schemaZod(schema) {
  // The new owner RunDisplay adjunct uses required-only anyOf over shared closed fields.
  // Lower only this exact shape; do not turn generic required-only nodes into unknown unions.
  if (schema.type === "object" && schema.anyOf) {
    assert.deepEqual(Object.keys(schema.properties), ["activity_id", "display_detail", "status"], "Agent tool fact fields drifted")
    assert.deepEqual(schema.required, ["activity_id"], "Agent tool fact required identity drifted")
    assert.deepEqual(schema.anyOf, [{ required: ["display_detail"] }, { required: ["status"] }], "Agent tool fact evidence alternatives drifted")
    assert.equal(schema.additionalProperties, false, "Agent tool fact must be closed")
    const base = { ...schema }
    delete base.anyOf
    return (
      schemaZod(base) + '.refine((value) => value.display_detail !== undefined || value.status !== undefined, "Tool fact requires proved detail or failure")'
    )
  }
  if (schema.$ref) return "z" + schema.$ref.split("/").at(-1)
  if (schema.oneOf || schema.anyOf) return "z.union([" + (schema.oneOf ?? schema.anyOf).map(schemaZod).join(",") + "])"
  if (schema.const !== undefined) return "z.literal(" + JSON.stringify(schema.const) + ")"
  if (schema.enum) return "z.enum(" + JSON.stringify(schema.enum) + ")"
  if (Array.isArray(schema.type)) return "z.union([" + schema.type.map((type) => schemaZod({ ...schema, type })).join(",") + "])"
  if (schema.type === "null") return "z.null()"
  if (schema.type === "boolean") return "z.boolean()"
  if (schema.type === "string") return "z.string()" + (schema.minLength === undefined ? "" : ".min(" + schema.minLength + ")")
  if (schema.type === "integer") return "z.number().int().max(Number.MAX_SAFE_INTEGER)" + (schema.minimum === undefined ? "" : ".min(" + schema.minimum + ")")
  if (schema.type === "array") {
    return (
      "z.array(" +
      schemaZod(schema.items) +
      ")" +
      (schema.minItems === undefined ? "" : ".min(" + schema.minItems + ")") +
      (schema.maxItems === undefined ? "" : ".max(" + schema.maxItems + ")")
    )
  }
  if (schema.type === "object") {
    if (!schema.properties && schema.additionalProperties === true) return "z.record(z.string(),z.unknown())"
    const fields = Object.entries(schema.properties ?? {}).map(
      ([name, value]) => JSON.stringify(name) + ":" + schemaZod(value) + ((schema.required ?? []).includes(name) ? "" : ".optional()"),
    )
    return "z.object({" + fields.join(",") + "})" + (schema.additionalProperties === false ? ".strict()" : "")
  }
  throw new Error("Unsupported published interaction schema node: " + JSON.stringify(schema))
}

async function generateDecodedValidators(directory, document) {
  const schemas = assertInteractionContractSchema(document)
  const file = path.join(directory, "zod.gen.ts")
  let source = await readFile(file, "utf8")
  for (const name of ["CancelControl", "SteerControl", "ResumeDecision", "ResumeControl", "SkillDisplay", "RunDisplay", "RunDisplayEnvelope"]) {
    const start = source.indexOf("export const z" + name + " =")
    const end = source.indexOf("export const ", start + 1)
    assert.ok(start >= 0 && end > start, "generated control validator missing: " + name)
    source = source.slice(0, start) + "export const z" + name + " = " + schemaZod(schemas[name]) + ";\n\n" + source.slice(end)
  }
  for (const name of [
    "InteractionValidation",
    "InteractionDisplay",
    "InteractionItem",
    "InteractionGroup",
    "InteractionActionResult",
    "ChatInteractionState",
    "ChatTodo",
    "ChatActivity",
  ]) {
    assert.ok(!source.includes("export const z" + name + " ="), "decoded schema is already generated: " + name)
    source += "\nexport const z" + name + " = " + schemaZod(schemas[name]) + ";\n"
  }
  await writeFile(file, source)
  // The owner's oneOf uses const kind values; the generator incorrectly intersects
  // them with schema names when discriminator.mapping is absent.
  const typesFile = path.join(directory, "types.gen.ts")
  let types = await readFile(typesFile, "utf8")
  const start = types.indexOf("export type ControlRequest =")
  const end = types.indexOf("export type ", start + 1)
  assert.ok(start >= 0 && end > start, "generated ControlRequest is missing")
  const variants = schemas.ControlRequest.oneOf.map((variant) => variant.$ref.split("/").at(-1))
  assert.deepEqual(variants, ["CancelControl", "SteerControl", "ResumeControl"])
  types = types.slice(0, start) + "export type ControlRequest = " + variants.join(" | ") + ";\n\n" + types.slice(end)
  await writeFile(typesFile, types)
}

function failureProfileSource(document) {
  const profile = assertFailureContractSchema(document)
  return `// This file is generated from the fixed kokoro-agent ChatFailure schema. Do not edit.
import { z } from "zod"

export const AGENT_FAILURE_CODES = ${JSON.stringify(profile.failureCodes, null, 2)} as const
export const RETRYABLE_AGENT_FAILURE_CODES = ${JSON.stringify(profile.retryableFailureCodes, null, 2)} as const

export type AgentFailureCode = (typeof AGENT_FAILURE_CODES)[number]
export type AgentFailureProfile = { source: "agent"; code: AgentFailureCode; retryable: boolean }

const retryableCodes = new Set<AgentFailureCode>(RETRYABLE_AGENT_FAILURE_CODES)
const chatFailureSchema = z
  .object({ status: z.literal("failed"), code: z.enum(AGENT_FAILURE_CODES), retryable: z.boolean() })
  .strict()
  .refine((failure) => !failure.retryable || retryableCodes.has(failure.code), { message: "retryable Agent failure code is invalid" })

export function parseAgentFailure(value: unknown): AgentFailureProfile | null {
  const result = chatFailureSchema.safeParse(value)
  return result.success ? { source: "agent", code: result.data.code, retryable: result.data.retryable } : null
}
`
}

function processProfileSource(document) {
  const schemas = assertInteractionContractSchema(document)
  const todo = schemas.ChatTodo
  const todoItems = todo.properties.todos
  const todoContent = todoItems.items.properties.content
  const activities = schemas.ChatActivity.oneOf
  const tool = activities[0]
  const subagent = activities[1]
  const skill = activities[2]
  assert.deepEqual(tool.properties.activity_id, subagent.properties.activity_id)
  assert.deepEqual(tool.properties.activity_id, skill.properties.activity_id)
  assert.deepEqual(tool.properties.segment_id, subagent.properties.segment_id)
  const detailName = tool.properties.display_detail.properties.name
  const unicodeDomain = /^(NFC) Unicode scalars; no (Cc), (Cf) or (Cs)$/u.exec(detailName["x-kokoro-unicode-domain"])
  assert.ok(unicodeDomain, "Agent tool detail Unicode domain is unsupported")
  const profile = {
    display: {
      skill: schemas.SkillDisplay,
      read: schemas.RunDisplay,
      activitySkill: skill.properties.display_skills,
      virtualPath: tool.properties.display_detail.properties.virtual_path,
    },
    toolDetail: {
      minScalars: detailName.minLength,
      maxScalars: detailName.maxLength,
      utf8ByteLimit: detailName["x-kokoro-utf8-byte-limit"],
      fileNamePattern: tool.allOf[0].then.properties.display_detail.properties.name.pattern,
      normalization: unicodeDomain[1],
      forbiddenCategories: unicodeDomain.slice(2),
      codesByKind: Object.fromEntries(
        tool.allOf.map((condition) => [condition.if.properties.display_detail.properties.kind.const, condition.then.properties.display_code.enum]),
      ),
    },
    todo: {
      jsonByteLimit: todo["x-kokoro-json-byte-limit"],
      maxItems: todoItems.maxItems,
      content: {
        minScalars: todoContent.minLength,
        maxScalars: todoContent.maxLength,
        pattern: todoContent.pattern,
      },
    },
    activityId: {
      minLength: tool.properties.activity_id.minLength,
      maxLength: tool.properties.activity_id.maxLength,
      pattern: tool.properties.activity_id.pattern,
    },
    segmentId: {
      minLength: tool.properties.segment_id.minLength,
      maxLength: tool.properties.segment_id.maxLength,
      pattern: tool.properties.segment_id.pattern,
    },
    skill: {
      preflightId: {
        minLength: skill.properties.preflight_id.minLength,
        maxLength: skill.properties.preflight_id.maxLength,
        pattern: skill.properties.preflight_id.pattern,
      },
      sourceRefs: {
        minItems: skill.properties.source_refs.minItems,
        maxItems: skill.properties.source_refs.maxItems,
        uniqueItems: skill.properties.source_refs.uniqueItems,
        jsonByteLimit: skill.properties.source_refs["x-kokoro-json-byte-limit"],
        minLength: skill.properties.source_refs.items.minLength,
        maxLength: skill.properties.source_refs.items.maxLength,
        pattern: skill.properties.source_refs.items.pattern,
      },
      failedPhase: skill.if.properties.phase.const,
      errorCodes: skill.properties.error_code.enum,
    },
  }
  return `// This file is generated from the fixed kokoro-agent ChatTodo and ChatActivity schemas. Do not edit.
export const AGENT_PROCESS_CONSTRAINTS = ${JSON.stringify(profile, null, 2)} as const
`
}

async function verifyOwnerSources() {
  const tree = await generatedTree(path.dirname(vendorPath))
  assert.deepEqual(tree, { files: ["openapi.json", "provenance.json"], directories: [] }, "Agent HTTP vendor allowlist drifted")
  const [vendor, provenanceBytes] = await Promise.all([readFile(vendorPath), readFile(provenancePath)])
  assert.equal(sha256(vendor), ownerDigest, "vendored Agent HTTP contract digest drifted")
  assert.equal(sha256(provenanceBytes), provenanceDigest, "vendored Agent provenance digest drifted")
  const provenance = JSON.parse(provenanceBytes.toString("utf8"))
  assert.deepEqual(
    provenance.http_contract,
    {
      version: ownerContractVersion,
      path: "contract/openapi/v1/openapi.json",
      sha256: ownerDigest,
    },
    "Agent published HTTP provenance drifted",
  )
  const failureArtifact = provenance.generated_artifacts?.find((artifact) => artifact.path === "src/kokoro_agent/protocol/run_failure_generated.py")
  assert.equal(failureArtifact?.source, "contract/openapi/v1/openapi.json", "Agent failure artifact source path drifted")
  assert.equal(failureArtifact?.source_sha256, ownerDigest, "Agent failure artifact source digest drifted")
  restoreAgent82DisplayRaw(restoreAgent83ToolFactsRaw(vendor.toString("utf8")))
  const document = JSON.parse(vendor.toString("utf8"))
  assert.equal(document.info?.version, ownerContractVersion, "Agent HTTP contract version drifted")
  assertFailureContractSchema(document)
  assertInteractionContractSchema(document)
  return document
}

export function replaceExactInSource(source, from, to, expectedCount, label) {
  const count = source.split(from).length - 1
  assert.equal(count, expectedCount, `${label}: expected ${expectedCount} generator matches, found ${count}`)
  return source.replaceAll(from, to)
}

async function normalizeFile(directory, relativePath, replacements) {
  const filePath = path.join(directory, relativePath)
  let source = await readFile(filePath, "utf8")
  for (const [from, to, expectedCount, label] of replacements) {
    source = replaceExactInSource(source, from, to, expectedCount, `${relativePath} ${label}`)
  }
  await writeFile(filePath, source)
}

async function normalizeGeneratorCompatibility(directory) {
  await normalizeFile(directory, "client/client.gen.ts", [
    [
      `    const resolvedOpts = opts as typeof opts &
      ResolvedRequestOptions<TResponseStyle, ThrowOnError, Url>;`,
      `    const { serializedBody, ...requestOptions } = opts
    const resolvedOpts = {
      ...requestOptions,
      ...(serializedBody === undefined ? {} : { serializedBody }),
    } as ResolvedRequestOptions<TResponseStyle, ThrowOnError, Url>`,
      1,
      "optional serializedBody",
    ],
    [
      `    const { opts, url } = await beforeRequest(options);
    return createSseClient({
      ...opts,
      body: opts.body as BodyInit | null | undefined,`,
      `    const { opts, url } = await beforeRequest(options)
    const { body, ...sseOptions } = opts
    return createSseClient({
      ...sseOptions,
      ...(body === undefined ? {} : { body: body as BodyInit | null }),`,
      1,
      "optional SSE request body",
    ],
  ])
  await normalizeFile(directory, "client/utils.gen.ts", [
    [
      "            allowReserved: options.allowReserved,",
      "            ...(options.allowReserved === undefined ? {} : { allowReserved: options.allowReserved }),",
      3,
      "optional query allowReserved",
    ],
    ["    path: options.path,", "    ...(options.path === undefined ? {} : { path: options.path }),", 1, "optional URL path"],
    ["    query: options.query,", "    ...(options.query === undefined ? {} : { query: options.query }),", 1, "optional URL query"],
  ])
  await normalizeFile(directory, "core/params.gen.ts", [
    [
      `        map.set(config.key, {
          in: config.in,
          map: config.map,
        });`,
      `        map.set(config.key, {
          in: config.in,
          ...(config.map === undefined ? {} : { map: config.map }),
        });`,
      1,
      "optional parameter map",
    ],
  ])
  await normalizeFile(directory, "core/pathSerializer.gen.ts", [
    [
      `        allowReserved,
        name,`,
      `        ...(allowReserved === undefined ? {} : { allowReserved }),
        name,`,
      1,
      "optional array path allowReserved",
    ],
    [
      `        allowReserved,
        name:`,
      `        ...(allowReserved === undefined ? {} : { allowReserved }),
        name:`,
      1,
      "optional object path allowReserved",
    ],
  ])
  await normalizeFile(directory, "core/serverSentEvents.gen.ts", [
    [
      "          body: options.serializedBody,",
      "          ...(options.serializedBody === undefined ? {} : { body: options.serializedBody }),",
      1,
      "optional request body",
    ],
    ["                event: eventName,", "                ...(eventName === undefined ? {} : { event: eventName }),", 1, "optional event name"],
    ["                id: lastEventId,", "                ...(lastEventId === undefined ? {} : { id: lastEventId }),", 1, "optional event id"],
  ])
  await normalizeFile(directory, "client/types.gen.ts", [
    ["  // eslint-disable-next-line @typescript-eslint/no-unused-vars\n", "", 1, "unused generic suppression"],
  ])
  await normalizeFile(directory, "core/types.gen.ts", [
    ["// eslint-disable-next-line @typescript-eslint/no-empty-object-type\n", "", 1, "empty interface suppression"],
  ])
  const zodPath = path.join(directory, "zod.gen.ts")
  let zodSource = await readFile(zodPath, "utf8")
  for (const schema of ["Meta", "Error", "ErrorEnvelope", "LaunchReceipt", "LaunchReceiptEnvelope", "ChatEvent", "ReplayPage", "ReplayPageEnvelope"]) {
    const expression = new RegExp(`(export const z${schema} = z\\.object\\(\\{[\\s\\S]*?\\n)\\}\\);`)
    assert.match(zodSource, expression, `${schema} generated object was not found`)
    zodSource = zodSource.replace(expression, "$1}).strict();")
  }
  const int64 =
    /z\.coerce\.bigint\(\)\.gte\(BigInt\((\d+)\)\)\.max\(BigInt\('9223372036854775807'\), \{ error: 'Invalid value: Expected int64 to be <= 9223372036854775807' \}\)/g
  const matches = [...zodSource.matchAll(int64)]
  assert.equal(matches.length, 7, "generated int64 field count drifted")
  zodSource = zodSource.replace(int64, (_source, lower) => `z.number().int().min(${lower}).max(Number.MAX_SAFE_INTEGER)`)
  zodSource = replaceExactInSource(zodSource, ".default(BigInt(0))", ".default(0)", 2, "int64 default")
  await writeFile(zodPath, zodSource)
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options })
    child.once("error", reject)
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`))))
  })
}

async function generatedTree(directory, prefix = "") {
  const files = []
  const directories = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      directories.push(relativePath)
      const nested = await generatedTree(path.join(directory, entry.name), relativePath)
      files.push(...nested.files)
      directories.push(...nested.directories)
    } else {
      assert.ok(entry.isFile(), `generated output contains unsupported entry: ${relativePath}`)
      files.push(relativePath)
    }
  }
  return { files: files.sort(), directories: directories.sort() }
}

export function assertGeneratedAllowlist(files, directories, label) {
  assert.deepEqual(files.slice().sort(), generatedFiles.slice().sort(), `${label} file allowlist drifted`)
  assert.deepEqual(directories.slice().sort(), generatedDirectories.slice().sort(), `${label} directory allowlist drifted`)
}

async function generateMcpSelectionValidator(directory, document) {
  const schema = document.components.schemas.LaunchRequest.properties.selected_mcp_connection_ids
  assert.equal(schema.type, "array")
  assert.equal(schema.items.type, "string")
  assert.equal(schema.uniqueItems, true)
  assert.equal(schema["x-kokoro-json-byte-limit"], 4096)
  const file = path.join(directory, "zod.gen.ts")
  let source = await readFile(file, "utf8")
  const property = /^[ \t]*selected_mcp_connection_ids:\s*z\.array\([^\r\n]*$/gmu
  const matches = [...source.matchAll(property)]
  assert.equal(matches.length, 1, "generated exact MCP selection property drifted")
  const item = schema.items
  const expression = `selected_mcp_connection_ids: z.array(z.string().min(${item.minLength}).max(${item.maxLength}).regex(new RegExp(${JSON.stringify(item.pattern)}, "u"))).max(${schema.maxItems}).refine(values => new Set(values).size === values.length && new TextEncoder().encode(JSON.stringify(values)).byteLength <= ${schema["x-kokoro-json-byte-limit"]}).optional(),`
  source = source.replace(property, () => expression)
  await writeFile(file, source)
}

async function generate(directory) {
  const cli = path.join(root, "node_modules/@hey-api/openapi-ts/bin/run.js")
  await run(process.execPath, [cli, "--silent", "-f", configPath], { env: { ...process.env, AGENT_HTTP_CLIENT_OUTPUT: directory } })
  const ownerDocument = JSON.parse(await readFile(vendorPath, "utf8"))
  await writeFile(path.join(directory, "failure-profile.gen.ts"), failureProfileSource(ownerDocument))
  await writeFile(path.join(directory, "process-profile.gen.ts"), processProfileSource(ownerDocument))
  const tree = await generatedTree(directory)
  assertGeneratedAllowlist(tree.files, tree.directories, "generated")
  await normalizeGeneratorCompatibility(directory)
  await generateDecodedValidators(directory, ownerDocument)
  await generateMcpSelectionValidator(directory, ownerDocument)
  const sdk = await readFile(path.join(directory, "sdk.gen.ts"), "utf8")
  assert.deepEqual(
    [...sdk.matchAll(/^export const (\w+) =/gmu)].map((match) => match[1]).sort(),
    ["controlRun", "createRun", "getRunDisplay", "replaySessionEvents"],
    "Agent HTTP generated operation surface drifted",
  )
  const prettier = path.join(root, "node_modules/prettier/bin/prettier.cjs")
  await run(process.execPath, [prettier, "--no-semi", "--print-width", "160", "--write", directory])
}

async function manifestFor(directory) {
  const [vendor, provenance, config, lockfile, packageDocument, nodeVersion] = await Promise.all([
    readFile(vendorPath),
    readFile(provenancePath),
    readFile(configPath),
    readFile(lockfilePath),
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, ".node-version"), "utf8"),
  ])
  const packageJson = JSON.parse(packageDocument)
  assert.equal(sha256(vendor), ownerDigest, "vendored AGENT contract digest drifted")
  assert.equal(sha256(provenance), provenanceDigest, "vendored AGENT provenance digest drifted")
  assert.equal(nodeVersion, "22.22.2\n", ".node-version must pin Node 22.22.2")
  assert.equal(packageJson.packageManager, "pnpm@11.25.0")
  assert.equal(packageJson.devDependencies["@hey-api/openapi-ts"], "0.99.0")
  assert.equal(packageJson.devDependencies.prettier, "3.9.6")
  assert.equal(packageJson.devDependencies.typescript, "5.9.3")
  assert.equal(packageJson.dependencies.zod, "4.5.4")
  return {
    schema_version: 1,
    status: "generated",
    owner: {
      repository_path: "apps/kokoro-agent",
      repository_commit: ownerCommit,
      contract_version: ownerContractVersion,
      contract_path: "contract/openapi/v1/openapi.json",
      contract_sha256: ownerDigest,
      provenance_path: "contract/provenance.json",
      provenance_sha256: provenanceDigest,
    },
    generator: {
      package: "@hey-api/openapi-ts",
      version: "0.99.0",
      config_path: "openapi-ts.agent.config.ts",
      config_sha256: sha256(config),
    },
    runtime: { node: "22.22.2", pnpm: "11.25.0", zod: "4.5.4" },
    lockfile_sha256: sha256(lockfile),
    generated: await Promise.all(
      generatedFiles.map(async (file) => ({
        path: file,
        ...(["failure-profile.gen.ts", "process-profile.gen.ts"].includes(file) ? { source_sha256: ownerDigest } : {}),
        sha256: sha256(await readFile(path.join(directory, file))),
      })),
    ),
  }
}

async function main() {
  const mode = process.argv[2]
  assert.ok(mode === "--write" || mode === "--check", "expected --write or --check")
  await verifyOwnerSources()
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "kokoro-agent-http-"))
  const temporaryOutput = path.join(temporaryRoot, "generated")
  const repeatedOutput = path.join(temporaryRoot, "generated-again")
  try {
    await generate(temporaryOutput)
    const expectedManifest = await manifestFor(temporaryOutput)
    if (mode === "--write") {
      await rm(output, { recursive: true, force: true })
      await cp(temporaryOutput, output, { recursive: true })
      await writeFile(manifestPath, `${JSON.stringify(expectedManifest, null, 2)}\n`)
      console.log(`WROTE AGENT HTTP client (${generatedFiles.length} files)`)
      return
    }
    await generate(repeatedOutput)
    const repeatedTree = await generatedTree(repeatedOutput)
    assertGeneratedAllowlist(repeatedTree.files, repeatedTree.directories, "repeated generated")
    for (const file of generatedFiles) {
      assert.deepEqual(
        await readFile(path.join(repeatedOutput, file)),
        await readFile(path.join(temporaryOutput, file)),
        `non-deterministic generation: ${file}`,
      )
    }
    const committedTree = await generatedTree(output)
    assertGeneratedAllowlist(committedTree.files, committedTree.directories, "committed generated")
    for (const file of generatedFiles) {
      assert.deepEqual(await readFile(path.join(output, file)), await readFile(path.join(temporaryOutput, file)), file)
    }
    assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), expectedManifest, "AGENT HTTP dependency manifest drifted")
    console.log(`PASS AGENT HTTP client drift check (${generatedFiles.length} files, two byte-identical generations)`)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href
if (invokedPath === import.meta.url) await main()
