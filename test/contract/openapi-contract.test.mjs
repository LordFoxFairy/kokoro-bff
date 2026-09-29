import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import { inspectAgentControlSnapshot, inspectBffOpenApi } from "../../scripts/verify-openapi.ts"

const openapiUrl = new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url)
const baselineUrl = new URL("../../contract/tests/v1-operations.json", import.meta.url)
const agentControlSnapshotUrl = new URL("../../contract/external/kokoro-agent/control-receipt.v1.json", import.meta.url)

async function readContract() {
  const [openapi, baselineDocument] = await Promise.all([readFile(openapiUrl, "utf8"), readFile(baselineUrl, "utf8")])
  return { openapi, baseline: JSON.parse(baselineDocument).operations }
}

test("the canonical BFF OpenAPI passes field and protocol invariants", async () => {
  const { openapi, baseline } = await readContract()

  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
})

test("CreateSkillDraft publishes the strict user-only candidate contract without legacy meta", async () => {
  const { openapi, baseline } = await readContract()
  assert.ok(baseline.some(({ method, path, operation_id }) => method === "POST" && path === "/v1/skills/drafts" && operation_id === "createSkillDraft"))
  const start = openapi.indexOf("  /v1/skills/drafts:")
  const end = openapi.indexOf("  /v1/skills/{name}/revisions:", start)
  assert.ok(start >= 0 && end > start)
  const operation = openapi.slice(start, end)
  for (const assertion of [
    /operationId: createSkillDraft/u,
    /x-kokoro-permission: product\.skill\.create_draft/u,
    /x-kokoro-idempotency: required/u,
    /'201':/u,
    /'400':/u,
    /'401':/u,
    /'403':/u,
    /'409':/u,
    /'412':/u,
    /'429':/u,
    /'502':/u,
    /'503':/u,
    /Cache-Control:/u,
    /x-request-id:/u,
  ])
    assert.match(operation, assertion)
  assert.match(operation, /\$ref: '#\/components\/parameters\/SkillDraftIdempotencyKey'/u)
  const request = openapi.slice(openapi.indexOf("    CreateSkillDraftRequest:"), openapi.indexOf("    SkillDraftResource:"))
  assert.match(request, /required: \[display_name, summary, tags\]/u)
  assert.match(request, /additionalProperties: false/u)
  assert.match(request, /display_name:[\s\S]*maxLength: 255/u)
  assert.match(request, /summary:[\s\S]*maxLength: 65535/u)
  assert.match(request, /tags:[\s\S]*maxItems: 100[\s\S]*uniqueItems: true/u)
  const response = openapi.slice(openapi.indexOf("    CreateSkillDraftResponse:"), openapi.indexOf("    SkillDraftErrorDetail:"))
  assert.match(response, /required: \[data\]/u)
  assert.doesNotMatch(response, /\bmeta\b/u)
  const error = openapi.slice(openapi.indexOf("    SkillDraftErrorDetail:"), openapi.indexOf("    SkillDraftErrorResponse:"))
  assert.match(error, /required: \[code, message, retryable\]/u)
  assert.match(error, /additionalProperties: false/u)
})

test("the semantic gate rejects legacy Skill draft envelopes and the generic idempotency header", async () => {
  const { openapi, baseline } = await readContract()
  const broken = openapi
    .replace(
      "required: [data]\n      additionalProperties: false\n      properties:\n        data: { $ref: '#/components/schemas/SkillDraftResource' }",
      "required: [data, meta]\n      additionalProperties: false\n      properties:\n        data: { $ref: '#/components/schemas/SkillDraftResource' }\n        meta: { $ref: '#/components/schemas/RequestMeta' }",
    )
    .replace("#/components/parameters/SkillDraftIdempotencyKey", "#/components/parameters/IdempotencyKey")
  assert.notEqual(broken, openapi)
  const errors = inspectBffOpenApi(broken, baseline)
  assert.ok(errors.some((error) => error.includes("CreateSkillDraftResponse") && error.includes("data-only")))
  assert.ok(errors.some((error) => error.includes("createSkillDraft") && error.includes("Idempotency-Key")))
})

test("the semantic gate binds every Skill draft request, response and header component", async () => {
  const { openapi, baseline } = await readContract()
  const mutations = [
    openapi.replace("'400': { $ref: '#/components/responses/SkillDraftBadRequest' }", "'400': { $ref: '#/components/responses/BadRequest' }"),
    openapi.replace("schema: { $ref: '#/components/schemas/CreateSkillDraftResponse' }", "schema: { $ref: '#/components/schemas/OkResponse' }"),
    openapi.replace("schema: { $ref: '#/components/schemas/SkillDraftErrorResponse' }", "schema: { $ref: '#/components/schemas/ErrorEnvelope' }"),
    openapi.replaceAll("Cache-Control:", "Removed-Cache-Control:"),
    openapi.replace("        maxLength: 128\n        pattern: '^[\\x21-\\x2B\\x2D-\\x7E]+$'", "        maxLength: 1024\n        pattern: '.*'"),
    openapi.replace("      required: [display_name, summary, tags]", "      required: [display_name]"),
    openapi.replace("status: { type: string, enum: [draft] }", "status: { type: string, enum: [published] }"),
    openapi.replace("required: [skill_id, series_id, revision, status, replayed]", "required: [skill_id, series_id, revision, status]"),
    openapi.replace(
      "    SkillDraftErrorResponse:\n      type: object\n      required: [error]\n      additionalProperties: false",
      "    SkillDraftErrorResponse:\n      type: object\n      required: [error]\n      additionalProperties: true",
    ),
    openapi.replace(/enum: \[invalid_skill_request, idempotency_key_required,[^\n]+\]/u, "enum: [invalid_skill_request]"),
  ]
  for (const broken of mutations) {
    assert.notEqual(broken, openapi)
    assert.ok(inspectBffOpenApi(broken, baseline).some((error) => /createSkillDraft|SkillDraft|CreateSkillDraft/u.test(error)))
  }
})

test("GetSkillPackageUpload is a user-only inactive candidate with a strict read envelope", async () => {
  const { openapi, baseline } = await readContract()
  assert.ok(
    baseline.some(
      ({ method, path, operation_id }) => method === "GET" && path === "/v1/skills/{skill_id}/package-upload" && operation_id === "getSkillPackageUpload",
    ),
  )
  const operation = openapi.slice(openapi.indexOf("  /v1/skills/{skill_id}/package-upload:"), openapi.indexOf("  /v1/skills/{name}/revisions:"))
  for (const expected of [
    "operationId: getSkillPackageUpload",
    "x-kokoro-permission: product.skill.get_package_upload",
    "x-kokoro-idempotency: none",
    "#/components/parameters/SkillPackageUploadSkillId",
    "#/components/schemas/GetSkillPackageUploadResponse",
    "x-request-id:",
    "Cache-Control:",
    "const: no-store",
  ])
    assert.ok(operation.includes(expected), expected)
  const responseRefs = new Map([
    ["400", "SkillPackageUploadGetBadRequest"],
    ["401", "SkillPackageUploadGetUnauthorized"],
    ["403", "SkillPackageUploadGetForbidden"],
    ["404", "SkillPackageUploadGetNotFound"],
    ["412", "SkillPackageUploadGetPreconditionFailed"],
    ["429", "SkillPackageUploadGetRateLimited"],
    ["502", "SkillPackageUploadGetBadGateway"],
    ["503", "SkillPackageUploadGetUnavailable"],
  ])
  for (const [status, component] of responseRefs) assert.ok(operation.includes(`'${status}': { $ref: '#/components/responses/${component}' }`), status)
  assert.doesNotMatch(operation, /Idempotency-Key|requestBody:|\bmeta:|signed_url|asset_id|content_hash/u)
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
})

test("GetSkillPackageUpload semantic gate rejects changed fields, envelopes, headers, statuses and input", async () => {
  const { openapi, baseline } = await readContract()
  const operation = openapi.slice(openapi.indexOf("  /v1/skills/{skill_id}/package-upload:"), openapi.indexOf("  /v1/skills/{name}/revisions:"))
  const mutations = [
    openapi.replace("required: [skill_id, attempt_epoch, phase]", "required: [skill_id, phase]"),
    openapi.replace(
      "phase: { type: string, enum: [none, intent, upload_pending, uploaded, validated, aborted] }",
      "phase: { type: string, enum: [none, uploaded] }",
    ),
    openapi.replace("attempt_epoch: { type: string }", "attempt_epoch: { type: number }"),
    openapi.replace("data: { $ref: '#/components/schemas/SkillPackageUploadState' }", "data: { $ref: '#/components/schemas/SkillDraftResource' }"),
    openapi.replace(
      "error: { $ref: '#/components/schemas/SkillPackageUploadGetErrorDetail' }",
      "error: { $ref: '#/components/schemas/SkillDraftErrorDetail' }",
    ),
    openapi.replace(
      "'404': { $ref: '#/components/responses/SkillPackageUploadGetNotFound' }",
      "'404': { $ref: '#/components/responses/SkillPackageUploadGetBadGateway' }",
    ),
    openapi.replace("      operationId: getSkillPackageUpload", "      operationId: getSkillPackageUpload\n      requestBody: { required: false }"),
    openapi.replace("#/components/parameters/SkillPackageUploadSkillId", "#/components/parameters/IdempotencyKey"),
    openapi.replace(operation, operation.replace("x-request-id:", "x-trace-id:")),
    openapi.replace(operation, operation.replace("Cache-Control:", "X-Cache-Control:")),
    openapi.replace("            attempt_id: false", "            attempt_id: { type: string }"),
    openapi.replace("            upload_id: false", "            upload_id: { type: string }"),
    openapi.replace("attempt_epoch: { const: '0' }", "attempt_epoch: { const: '1' }"),
    openapi.replace("        - required: [attempt_id]", "        - required: []"),
    openapi.replace("        - required: [attempt_id, upload_id]", "        - required: [attempt_id]"),
    openapi.replace(
      "        - required: [attempt_id]\n          properties:\n            phase: { const: aborted }",
      "        - properties:\n            phase: { const: aborted }",
    ),
    openapi.replace("            phase: { const: aborted }", "            phase: { const: validated }"),
    openapi.replace("18446744073709551615)$'", "18446744073709551616)$'"),
    openapi.replace("code: { type: string, enum: [skill_not_found] }", "code: { type: string, enum: [skill_response_invalid] }"),
    openapi.replace(
      "          required: true\n          schema: { type: string, pattern: '^[1-9][0-9]{0,4}$' }",
      "          required: false\n          schema: { type: string, pattern: '^[1-9][0-9]{0,4}$' }",
    ),
  ]
  for (const broken of mutations) {
    assert.notEqual(broken, openapi)
    assert.ok(inspectBffOpenApi(broken, baseline).some((error) => /getSkillPackageUpload|SkillPackageUpload/u.test(error)))
  }
})

test("GetSkillPackageUpload machine state partitions phases and bounds decimal uint64", async () => {
  const { openapi } = await readContract()
  const state = openapi.slice(openapi.indexOf("    SkillPackageUploadState:"), openapi.indexOf("    GetSkillPackageUploadResponse:"))
  assert.match(state, /required: \[skill_id, attempt_epoch, phase\][\s\S]*additionalProperties: false/u)
  assert.match(state, /oneOf:[\s\S]*phase: \{ const: none \}[\s\S]*attempt_epoch: \{ const: '0' \}[\s\S]*attempt_id: false[\s\S]*upload_id: false/u)
  assert.match(state, /required: \[attempt_id\][\s\S]*phase: \{ const: intent \}[\s\S]*upload_id: false/u)
  assert.match(state, /required: \[attempt_id, upload_id\][\s\S]*phase: \{ enum: \[upload_pending, uploaded, validated\] \}/u)
  assert.match(state, /required: \[attempt_id\][\s\S]*phase: \{ const: aborted \}/u)
  assert.match(state, /attempt_id: \{ type: string, pattern: '\^\[A-Za-z0-9\]/u)
  assert.match(state, /upload_id: \{ type: string, pattern: '\^\[A-Za-z0-9\]/u)
  const idPatterns = [...state.matchAll(/(?:attempt_id|upload_id): \{ type: string, pattern: '([^']+)' \}/gu)].map((match) => new RegExp(match[1], "u"))
  assert.equal(idPatterns.length, 2)
  for (const pattern of idPatterns) {
    for (const accepted of ["b297e109-a17a-452f-93ee-923727729b96", "upload_1", "a".repeat(191)]) assert.equal(pattern.test(accepted), true, accepted)
    for (const rejected of ["", " ", " attempt", "upload id", "a".repeat(192)]) assert.equal(pattern.test(rejected), false, rejected)
  }
  const epoch = state.match(/SkillPackageUploadPositiveEpoch:[\s\S]*?pattern: '([^']+)'/u)?.[1]
  assert.ok(epoch)
  const pattern = new RegExp(epoch, "u")
  for (const accepted of ["1", "18446744073709551614", "18446744073709551615"]) assert.equal(pattern.test(accepted), true, accepted)
  for (const rejected of ["0", "01", "18446744073709551616", "99999999999999999999", "-1", " "]) assert.equal(pattern.test(rejected), false, rejected)
})

test("GetSkillPackageUpload error components constrain codes per status and rate limit retry", async () => {
  const { openapi } = await readContract()
  const cases = [
    ["SkillPackageUploadGetBadRequest", "invalid_skill_request"],
    ["SkillPackageUploadGetUnauthorized", "service_auth_failed, session_authentication_required, session_invalid"],
    ["SkillPackageUploadGetForbidden", "session_forbidden, product_tenant_not_configured, product_tenant_forbidden"],
    ["SkillPackageUploadGetNotFound", "skill_not_found"],
    ["SkillPackageUploadGetPreconditionFailed", "skill_precondition_failed"],
    ["SkillPackageUploadGetRateLimited", "session_rate_limited, skill_rate_limited"],
    ["SkillPackageUploadGetBadGateway", "skill_response_invalid"],
    ["SkillPackageUploadGetUnavailable", "iam_admission_unavailable, skill_dependency_unavailable"],
  ]
  for (const [index, [name, codes]] of cases.entries()) {
    const block = openapi.slice(openapi.indexOf(`    ${name}:`), openapi.indexOf(`    ${cases[index + 1]?.[0] ?? "SkillDraftBadRequest"}:`))
    assert.match(block, /x-request-id:[\s\S]*Cache-Control:[\s\S]*const: no-store/u)
    assert.ok(block.includes("#/components/schemas/SkillPackageUploadGetErrorResponse"))
    assert.ok(block.includes(`code: { type: string, enum: [${codes}] }`))
    if (name === "SkillPackageUploadGetRateLimited") assert.match(block, /Retry-After:[\s\S]*required: true[\s\S]*pattern: '\^\[1-9\]\[0-9\]\{0,4\}\$'/u)
  }
})

test("legacy operations cannot reuse the Get-only strict envelopes", async () => {
  const { openapi, baseline } = await readContract()
  const legacy = openapi.slice(openapi.indexOf("  /v1/me:"), openapi.indexOf("  /v1/team/members:"))
  for (const brokenLegacy of [
    legacy.replace("#/components/schemas/CurrentUserResponse", "#/components/schemas/GetSkillPackageUploadResponse"),
    legacy.replace("#/components/responses/ServiceUnavailable", "#/components/responses/SkillPackageUploadGetUnavailable"),
  ]) {
    assert.notEqual(brokenLegacy, legacy)
    const errors = inspectBffOpenApi(
      openapi.replace(legacy, () => brokenLegacy),
      baseline,
    )
    assert.ok(errors.some((error) => error.includes("GET /v1/me must not reference GetSkillPackageUpload strict envelope components")))
  }
})

test("current Product identity is a narrow public self-read contract", async () => {
  const { openapi, baseline } = await readContract()
  assert.ok(baseline.some((operation) => operation.method === "GET" && operation.path === "/v1/me" && operation.operation_id === "getCurrentUser"))
  const start = openapi.indexOf("  /v1/me:")
  const end = openapi.indexOf("  /v1/team/members:", start)
  assert.ok(start >= 0 && end > start)
  const operation = openapi.slice(start, end)
  assert.match(operation, /operationId: getCurrentUser/u)
  assert.match(operation, /x-kokoro-permission: identity\.self\.read/u)
  for (const status of ["200", "400", "401", "403", "429", "503"]) assert.match(operation, new RegExp(`'${status}':`, "u"))
  assert.match(operation, /x-request-id:/u)
  assert.match(operation, /Cache-Control:/u)
  assert.match(openapi, /CurrentUserIdentity:\n\s+type: object\n\s+required: \[user_id, tenant_id\]\n\s+additionalProperties: false/u)
  assert.match(openapi, /CurrentUserResponse:\n\s+type: object\n\s+required: \[data, meta\]\n\s+additionalProperties: false/u)
})

test("the public snapshot contract binds Message facts and AG-UI watermark to one database read snapshot", async () => {
  const { openapi } = await readContract()
  const start = openapi.indexOf("      operationId: getSessionSnapshot")
  const end = openapi.indexOf("  /v1/sessions/{id}/messages:", start)
  assert.ok(start >= 0 && end > start)
  const operation = openapi.slice(start, end)
  assert.match(operation, /owner-scoped session, the latest 100 durable Message facts in chronological/u)
  assert.match(operation, /up to 100 most recent durable Artifact deliveries/u)
  assert.match(operation, /AG-UI event watermark/u)
  assert.match(operation, /one PostgreSQL read snapshot/u)
  assert.match(operation, /latest committed public\s+ledger cursor/u)
  const snapshot = openapi.slice(openapi.indexOf("    SessionSnapshotResponse:"), openapi.indexOf("    MessageCreateRequest:"))
  assert.match(snapshot, /deliveries_has_more: \{ type: boolean \}/u)
  assert.match(snapshot, /required: \[conversation_id, artifact_id, asset_id, artifact_kind, title, mime, size, run_id, created_at\]/u)
  assert.doesNotMatch(snapshot, /required: \[content_hash, path, title, mime, size, run_id, created_at\]/u)
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
  const revision = openapi.slice(openapi.indexOf("    ProjectInstructionRevision:"), openapi.indexOf("    CreateProjectRequest:"))

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
  const withoutIdempotency = messageBlock.replace("        - $ref: '#/components/parameters/IdempotencyKey'\n", "")
  const withoutAgui503 = eventBlock.replace("        '503': { $ref: '#/components/responses/ServiceUnavailable' }\n", "")
  const broken = `${openapi.slice(0, messageStart)}${withoutIdempotency}${withoutAgui503}${openapi.slice(controlStart)}`

  assert.notEqual(broken, openapi)
  const errors = inspectBffOpenApi(broken, baseline)
  assert.ok(errors.some((error) => error.includes("createMessage") && error.includes("Idempotency-Key")))
  assert.ok(errors.some((error) => error.includes("streamSessionEvents") && error.includes("503")))
})

test("MessageCreateRequest and runtime failure statuses stay strict", async () => {
  const { openapi } = await readContract()
  const messageOperation = openapi.slice(openapi.indexOf("  /v1/sessions/{id}/messages:"), openapi.indexOf("  /v1/sessions/{id}/events:"))
  const messageRequest = openapi.slice(openapi.indexOf("    MessageCreateRequest:"), openapi.indexOf("    MessageReceipt:"))

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
  const control = openapi
    .slice(controlStart, controlEnd)
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
