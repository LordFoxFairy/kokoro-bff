import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import { inspectBffOpenApi } from "../../scripts/verify-openapi.ts"

const openapiUrl = new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url)
const baselineUrl = new URL("../../contract/tests/v1-operations.json", import.meta.url)

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
  assert.match(messageRequest, /additionalProperties: false/u)
  assert.match(messageRequest, /maxLength: 100000/u)
  assert.match(messageRequest, /pinned_skills:[\s\S]*items: \{ type: string, minLength: 1 \}/u)
  assert.match(messageRequest, /mcp_servers:[\s\S]*items: \{ type: string, minLength: 1 \}/u)
})
