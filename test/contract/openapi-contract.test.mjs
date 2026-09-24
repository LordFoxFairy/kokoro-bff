import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import {
  inspectAgentControlSnapshot,
  inspectBffOpenApi,
} from "../../scripts/verify-openapi.ts"

const openapiUrl = new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url)
const baselineUrl = new URL("../../contract/tests/v1-operations.json", import.meta.url)
const agentControlSnapshotUrl = new URL("../../contract/external/kokoro-agent/control-receipt.v1.json", import.meta.url)

async function readContract() {
  const [openapi, baselineDocument] = await Promise.all([
    readFile(openapiUrl, "utf8"),
    readFile(baselineUrl, "utf8"),
  ])
  return { openapi, baseline: JSON.parse(baselineDocument).operations }
}

test("the canonical BFF OpenAPI passes field and protocol invariants", async () => {
  const { openapi, baseline } = await readContract()

  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
})

test("the public contract requires IAM bearer admission while Share and runtime manifest remain service-only", async () => {
  const { openapi, baseline } = await readContract()
  assert.match(openapi, /security:\n  - serviceHeader: \[\]\n    internalSecret: \[\]\n    userBearer: \[\]/u)
  assert.doesNotMatch(openapi, /^    (?:namespace|principalId):/mu)
  assert.match(openapi, /^    userBearer:\n      type: http\n      scheme: bearer/mu)

  const operationBlock = (operation) => {
    const start = openapi.indexOf(`      operationId: ${operation.operation_id}`)
    const next = baseline.map((candidate) => openapi.indexOf(`      operationId: ${candidate.operation_id}`, start + 1)).filter((index) => index > start)
    return openapi.slice(start, next.length === 0 ? openapi.indexOf("components:", start) : Math.min(...next))
  }
  for (const operation of baseline.filter(({ path }) => !["/healthz", "/readyz", "/v1/system/runtime-manifest", "/v1/shared/{shareId}"].includes(path))) {
    const block = operationBlock(operation)
    for (const status of ["401", "403", "429", "503"]) assert.match(block, new RegExp(`'${status}':`, "u"), `${operation.operation_id} ${status}`)
  }
  for (const operationId of ["getRuntimeManifest", "getSharedSessionSnapshot"]) {
    const block = operationBlock(baseline.find(({ operation_id }) => operation_id === operationId))
    assert.match(block, /security:\n        - serviceHeader: \[\]\n          internalSecret: \[\]/u)
    assert.doesNotMatch(block, /userBearer/u)
  }
})

test("ProjectInstructionRevision publishes snake_case RFC3339 fields and an aligned example", async () => {
  const { openapi } = await readContract()
  const revision = openapi.slice(
    openapi.indexOf("    ProjectInstructionRevision:"),
    openapi.indexOf("    CreateProjectRequest:"),
  )

  assert.match(revision, /required: \[id, instruction, updated_at, actor_name, current\]/u)
  assert.match(revision, /updated_at: \{ type: string, format: date-time \}/u)
  assert.match(revision, /actor_name: \{ type: string \}/u)
  assert.doesNotMatch(revision, /\bupdatedAt\b|\bactorName\b/u)
  assert.match(revision, /updated_at: '2026-01-01T00:00:00\.000Z'/u)
  assert.match(revision, /actor_name: You/u)
})

test("the contract gate catches a camelCase revision regression", async () => {
  const { openapi, baseline } = await readContract()
  const broken = openapi.replace(
    "required: [id, instruction, updated_at, actor_name, current]\n      properties:\n        id: { type: string }\n        instruction: { type: string }\n        updated_at: { type: string, format: date-time }\n        actor_name: { type: string }",
    "required: [id, instruction, updatedAt, actorName, current]\n      properties:\n        id: { type: string }\n        instruction: { type: string }\n        updatedAt: { type: string, format: date-time }\n        actorName: { type: string }",
  )

  assert.notEqual(broken, openapi)
  const errors = inspectBffOpenApi(broken, baseline)
  assert.ok(errors.some((error) => error.includes("updatedAt")))
  assert.ok(errors.some((error) => error.includes("actorName")))
})

test("the contract gate rejects missing mutation idempotency and AG-UI status coverage", async () => {
  const { openapi, baseline } = await readContract()
  const messageStart = openapi.indexOf("  /v1/sessions/{id}/messages:")
  const eventStart = openapi.indexOf("  /v1/sessions/{id}/events:")
  const controlStart = openapi.indexOf("  /v1/sessions/{id}/runs/{runId}/control:")
  assert.ok(messageStart >= 0 && eventStart > messageStart && controlStart > eventStart)

  const messageBlock = openapi.slice(messageStart, eventStart)
  const eventBlock = openapi.slice(eventStart, controlStart)
  const withoutIdempotency = messageBlock.replace(
    "        - $ref: '#/components/parameters/IdempotencyKey'\n",
    "",
  )
  const withoutAgui503 = eventBlock.replace(
    "        '503': { $ref: '#/components/responses/ServiceUnavailable' }\n",
    "",
  )
  const broken = `${openapi.slice(0, messageStart)}${withoutIdempotency}${withoutAgui503}${openapi.slice(controlStart)}`

  assert.notEqual(broken, openapi)
  const errors = inspectBffOpenApi(broken, baseline)
  assert.ok(errors.some((error) => error.includes("createMessage") && error.includes("Idempotency-Key")))
  assert.ok(errors.some((error) => error.includes("streamSessionEvents") && error.includes("503")))
})

test("MessageCreateRequest and runtime failure statuses stay strict", async () => {
  const { openapi } = await readContract()
  const messageOperation = openapi.slice(
    openapi.indexOf("  /v1/sessions/{id}/messages:"),
    openapi.indexOf("  /v1/sessions/{id}/events:"),
  )
  const messageRequest = openapi.slice(
    openapi.indexOf("    MessageCreateRequest:"),
    openapi.indexOf("    MessageReceipt:"),
  )

  assert.match(messageOperation, /'413': \{ \$ref: '#\/components\/responses\/PayloadTooLarge' \}/u)
  assert.match(messageOperation, /'503': \{ \$ref: '#\/components\/responses\/ServiceUnavailable' \}/u)
  assert.match(messageOperation, /absent client-created conv_<UUID> session/u)
  assert.match(messageOperation, /Deleted or foreign session identifiers remain not found/u)
  assert.match(messageOperation, /Replaying the same idempotency key and request returns the original receipt/u)
  assert.match(messageRequest, /additionalProperties: false/u)
  assert.match(messageRequest, /maxLength: 100000/u)
  assert.match(messageRequest, /pinned_skills:[\s\S]*items: \{ type: string, minLength: 1 \}/u)
  assert.match(messageRequest, /mcp_servers:[\s\S]*items: \{ type: string, minLength: 1 \}/u)
})

test("semantic gates enforce Gone, admission overload, and control upstream failures", async () => {
  const { openapi, baseline } = await readContract()
  const controlStart = openapi.indexOf("  /v1/sessions/{id}/runs/{runId}/control:")
  const controlEnd = openapi.indexOf("  /v1/sessions/{id}/title:", controlStart)
  const control = openapi.slice(controlStart, controlEnd)
    .replace("        '502': { $ref: '#/components/responses/BadGateway' }\n", "")
    .replace("        '503': { $ref: '#/components/responses/ServiceUnavailable' }\n", "")
  const broken = openapi
    .replace("        '410': { $ref: '#/components/responses/Gone' }\n", "")
    .replace("        '413': { $ref: '#/components/responses/PayloadTooLarge' }\n", "")
    .replace(openapi.slice(controlStart, controlEnd), control)

  assert.notEqual(broken, openapi)
  const errors = inspectBffOpenApi(broken, baseline)
  assert.ok(errors.some((error) => error.includes("streamSessionEvents") && error.includes("410")))
  assert.ok(errors.some((error) => error.includes("createMessage") && error.includes("413")))
  assert.ok(errors.some((error) => error.includes("controlRun") && error.includes("502")))
  assert.ok(errors.some((error) => error.includes("controlRun") && error.includes("503")))
})

test("the pinned Agent ControlReceipt excludes BFF-projected run_id", async () => {
  const snapshot = JSON.parse(await readFile(agentControlSnapshotUrl, "utf8"))

  assert.deepEqual(inspectAgentControlSnapshot(snapshot), [])
  assert.deepEqual(snapshot.required, ["command_id", "request_digest", "status", "replayed"])
  assert.equal(Object.hasOwn(snapshot.properties, "run_id"), false)
  assert.equal(snapshot["x-kokoro-source"].commit, "70a38138f42f29e8a482fde7890fe0e2d0c27e34")
})
