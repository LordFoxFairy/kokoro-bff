import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import {
  restorePublic132SharedRevisionContract,
  inspectAgentControlSnapshot,
  inspectBffHistoricalOpenApi as inspectBffOpenApi,
} from "../../scripts/verify-openapi.ts"

import { parseOpenApiOperations } from "../../scripts/check-contract.mjs"

import { inspectSkillProductContract, stripSkillProductSource, skillProductParentBaseline } from "../../scripts/verify-skill-product-contract.mjs"

const openapiUrl = new URL("../../contract/tests/public11-historical.openapi.yaml", import.meta.url)
const baselineUrl = new URL("../../contract/tests/v1-operations.json", import.meta.url)
const agentControlSnapshotUrl = new URL("../../contract/external/kokoro-agent/control-receipt.v1.json", import.meta.url)
const platformV4Url = new URL("../../contract/vendor/kokoro-platform/263a28f1e55745bd1829a61f68228d775751adbc/execution-operations-v4/", import.meta.url)
const currentOpenapiUrl = new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url)
const SAFE_FAILURE_CODES = [
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
]

async function readContract() {
  const [openapi, baselineDocument] = await Promise.all([readFile(openapiUrl, "utf8"), readFile(baselineUrl, "utf8")])
  const baseline = JSON.parse(baselineDocument).operations
  assert.deepEqual(inspectSkillProductContract(openapi), [], "Historical Public11 fixture must pass before historical parent mutation proof")
  return { openapi: stripSkillProductSource(openapi), baseline: skillProductParentBaseline(openapi) }
}

test("current Skills responses admit only the owner-declared current and legacy canonical identities", async () => {
  const openapi = await readFile(currentOpenapiUrl, "utf8")
  assert.equal([...openapi.matchAll(/pattern: \^\(\?:skill-md-v1\|zip-v2\):sha256:\[a-f0-9\]\{64\}\$/gu)].length, 2)
  assert.equal([...openapi.matchAll(/pattern: \^zip-v2:sha256:\[a-f0-9\]\{64\}\$/gu)].length, 0)
})

function inspectChatFailureContract(openapi) {
  const errors = []
  const start = openapi.indexOf("    ChatMessage:\n")
  const end = openapi.indexOf("    InteractionValidation:\n", start)
  const message = start >= 0 && end > start ? openapi.slice(start, end) : ""
  const failureStart = message.indexOf("        failure:\n")
  const guardStart = message.indexOf("      allOf:\n", failureStart)
  const failure = failureStart >= 0 && guardStart > failureStart ? message.slice(failureStart, guardStart) : ""
  const guard = guardStart >= 0 ? message.slice(guardStart) : ""
  const require = (condition, label) => {
    if (!condition) errors.push(label)
  }

  require(/^info:\n(?:.*\n){0,3}?  version: 8\.10\.0$/mu.test(openapi), "public info.version must be 8.10.0")
  require(/^      required: \[message_id, role, content, status, created_at\]$/mu.test(message), "failure must stay optional")
  const roles = [...(message.match(/role:\n\s+type: string\n\s+enum: \[([^\]]+)\]/u)?.[1] ?? "").matchAll(/[a-z_]+/gu)].map((match) => match[0])
  require(JSON.stringify(roles) === JSON.stringify(["user", "assistant"]), "Message roles must equal user and assistant")
  require(new Set(roles).size === roles.length, "Message roles must not contain duplicates")
  require(/failure:\n\s+type: object\n\s+required: \[source, code, retryable\]\n\s+additionalProperties: false/u.test(
    failure,
  ), "failure must be closed and complete")
  require(/source: \{ type: string, const: agent \}/u.test(failure), "failure source must be agent")
  const codeLines = failure.match(/code:\n\s+type: string\n\s+enum:\n((?:\s+- [a-z_]+\n)+)/u)?.[1] ?? ""
  const codes = [...codeLines.matchAll(/^\s+- ([a-z_]+)$/gmu)].map((match) => match[1])
  require(JSON.stringify(codes) === JSON.stringify(SAFE_FAILURE_CODES), "failure codes must equal the ordered ten-code owner set")
  require(new Set(codes).size === codes.length, "failure codes must not contain duplicates")
  require(/retryable: \{ type: boolean \}/u.test(failure), "failure retryable must be boolean")
  require(/if:\n\s+properties:\n\s+retryable: \{ const: true \}\n\s+then:\n\s+properties:\n\s+code: \{ enum: \[model_unavailable, dependency_unavailable\] \}/u.test(
    failure,
  ), "retryable=true must allow exactly two codes")
  require(/allOf:\n\s+- if:\n\s+required: \[failure\]\n\s+then:\n\s+required: \[run_id\]\n\s+properties:\n\s+role: \{ const: assistant \}\n\s+status: \{ const: failed \}\n\s+run_id: \{ type: string, minLength: 1 \}/u.test(
    guard,
  ), "failure presence guard must require assistant failed and non-empty run")
  require((guard.match(/required: \[failure\]/gu) ?? []).length === 1, "failure presence must be one-way only")
  require(!/\n\s+else:/u.test(guard), "failure presence guard must not have a reverse else")
  return errors
}

test("the canonical BFF OpenAPI passes field and protocol invariants", async () => {
  const { openapi, baseline } = await readContract()

  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
})

test("ChatMessage publishes one closed optional Agent failure profile with the exact presence guard", async () => {
  const { openapi } = await readContract()

  assert.deepEqual(inspectChatFailureContract(openapi), [])
})

test("ChatMessage failure contract detects closed-shape, retryability, and presence-guard drift", async () => {
  const { openapi } = await readContract()
  assert.deepEqual(inspectChatFailureContract(openapi), [])
  const mutations = [
    openapi.replace("        required: [source, code, retryable]", "        required: [source, code]"),
    openapi.replace(
      "          additionalProperties: false\n          properties:\n            source: { type: string, const: agent }",
      "          additionalProperties: true\n          properties:\n            source: { type: string, const: agent }",
    ),
    openapi.replace(
      "code: { enum: [model_unavailable, dependency_unavailable] }",
      "code: { enum: [model_unavailable, dependency_unavailable, internal_error] }",
    ),
    openapi.replace("        required: [failure]", "        required: []"),
    openapi.replace("          role: { const: assistant }", "          role: { type: string }"),
    openapi.replace("          status: { const: failed }", "          status: { type: string }"),
    openapi.replace("        required: [run_id]", "        required: []"),
    openapi.replace("          run_id: { type: string, minLength: 1 }", "          run_id: { type: string, minLength: 0 }"),
    openapi.replace("                - model_access_denied", "                - model_access_denied\n                - unexpected_failure"),
    openapi.replace("                - internal_error", "                - internal_error\n                - internal_error"),
    openapi.replace("          enum: [user, assistant]", "          enum: [user, assistant, system]"),
    openapi.replace(
      "      required: [message_id, role, content, status, created_at]",
      "      required: [message_id, role, content, status, created_at, failure]",
    ),
    openapi.replace(
      "          run_id: { type: string, minLength: 1 }",
      `          run_id: { type: string, minLength: 1 }
        - if:
            required: [role, status, run_id]
            properties:
              role: { const: assistant }
              status: { const: failed }
          then:
            required: [failure]`,
    ),
  ]
  for (const [index, broken] of mutations.entries()) {
    assert.notEqual(broken, openapi, `mutation ${index} must change the contract`)
    assert.notDeepEqual(inspectChatFailureContract(broken), [], `mutation ${index} must be rejected`)
  }
})

test("Platform projection read gate detects status, cache and error-code drift", async () => {
  const { openapi, baseline } = await readContract()
  const list = openapi.slice(openapi.indexOf("  /v1/skills:\n"), openapi.indexOf("  /v1/skills/{skill_id}:\n"))
  const forbidden = openapi.slice(openapi.indexOf("    PlatformProjectionReadForbidden:\n"), openapi.indexOf("    PlatformProjectionReadRateLimited:\n"))
  const mutations = [
    openapi.replace(
      list,
      list.replace(
        "        '429': { $ref: '#/components/responses/PlatformProjectionReadRateLimited' }",
        "        '429': { $ref: '#/components/responses/PlatformProjectionReadRateLimited' }\n        '404': { $ref: '#/components/responses/PlatformProjectionReadBadGateway' }",
      ),
    ),
    openapi.replace(
      list,
      list.replace(
        "'403': { $ref: '#/components/responses/PlatformProjectionReadForbidden' }",
        "'403': { $ref: '#/components/responses/PlatformProjectionReadBadRequest' }",
      ),
    ),
    openapi.replace(list, list.replace("schema: { type: string, const: no-store }", "schema: { type: string, const: public }")),
    openapi.replace(forbidden, forbidden.replace("service_auth_failed, session_forbidden, product_tenant_forbidden", "service_auth_failed, session_invalid")),
  ]
  for (const [index, broken] of mutations.entries()) {
    assert.notEqual(broken, openapi, `mutation ${index} must change the contract`)
    assert.ok(
      inspectBffOpenApi(broken, baseline).some((error) => /Platform projection|PlatformProjectionRead|listSkills/u.test(error)),
      `mutation ${index}`,
    )
  }
})

test("Billing personal reads publish only the fixed Credit account and ledger contract", async () => {
  const { openapi, baseline } = await readContract()
  assert.ok(baseline.some(({ method, path, operation_id }) => method === "GET" && path === "/v1/billing/summary" && operation_id === "getBillingSummary"))
  assert.ok(baseline.some(({ method, path, operation_id }) => method === "GET" && path === "/v1/billing/ledger" && operation_id === "getBillingLedger"))
  const billing = openapi.slice(openapi.indexOf("  /v1/billing/summary:\n"), openapi.indexOf("  /v1/billing/checkout:\n"))
  assert.match(billing, /x-kokoro-permission: billing\.summary\.read/gu)
  assert.match(billing, /minimum: 1, maximum: 100, default: 50/u)
  assert.match(billing, /minLength: 1, maxLength: 2048/u)
  for (const field of ["credit_account_id", "available_micros", "held_micros", "journal_id", "delta_micros", "balance_after_micros"])
    assert.match(openapi, new RegExp(`\\b${field}:`, "u"))
  for (const removed of ["balance", "currency", "period", "usage"])
    assert.doesNotMatch(
      openapi.slice(openapi.indexOf("    BillingSummary:\n"), openapi.indexOf("    BillingSummaryResponse:\n")),
      new RegExp(`\\b${removed}:`, "u"),
    )
})

test("Billing personal read semantic gate rejects shape, pagination, permission and error drift", async () => {
  const { openapi, baseline } = await readContract()
  const billingPaths = openapi.slice(openapi.indexOf("  /v1/billing/summary:\n"), openapi.indexOf("  /v1/billing/checkout:\n"))
  const billingSchemas = openapi.slice(openapi.indexOf("    BillingSummary:\n"), openapi.indexOf("    BillingCheckoutRequest:\n"))
  const unavailable = openapi.slice(openapi.indexOf("    BillingReadUnavailable:\n"), openapi.indexOf("    SkillInstallationListSuccess:\n"))
  const mutations = [
    openapi.replace(billingSchemas, billingSchemas.replace("additionalProperties: false", "additionalProperties: true")),
    openapi.replace(billingSchemas, billingSchemas.replace("available_micros: { type: string", "available_micros: { type: number")),
    openapi.replace(billingSchemas, billingSchemas.replace("format: date-time, pattern: 'Z$'", "format: date-time")),
    openapi.replace(billingPaths, billingPaths.replace("maximum: 100, default: 50", "maximum: 1000, default: 50")),
    openapi.replace(billingPaths, billingPaths.replace("minLength: 1, maxLength: 2048", "minLength: 0, maxLength: 4096")),
    openapi.replace(billingPaths, billingPaths.replace("x-kokoro-permission: billing.summary.read", "x-kokoro-permission: billing.ledger.admin")),
    openapi.replace(billingPaths, billingPaths.replace("#/components/responses/BillingReadNotFound", "#/components/responses/NotFound")),
    openapi.replace(unavailable, unavailable.replace("billing_unavailable", "upstream_http_error")),
  ]
  for (const [index, broken] of mutations.entries()) {
    assert.notEqual(broken, openapi, `mutation ${index} must change the contract`)
    assert.ok(
      inspectBffOpenApi(broken, baseline).some((error) => error.includes("Billing personal read")),
      `mutation ${index} must be rejected by the Billing gate`,
    )
  }
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
  const uploadPath = openapi.slice(openapi.indexOf("  /v1/skills/{skill_id}/package-upload:"), openapi.indexOf("  /v1/skills/{name}/revisions:"))
  const operation = uploadPath.slice(0, uploadPath.indexOf("    post:"))
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
  const uploadPath = openapi.slice(openapi.indexOf("  /v1/skills/{skill_id}/package-upload:"), openapi.indexOf("  /v1/skills/{name}/revisions:"))
  const operation = uploadPath.slice(0, uploadPath.indexOf("    post:"))
  const getRate = openapi.slice(openapi.indexOf("    SkillPackageUploadGetRateLimited:"), openapi.indexOf("    SkillPackageUploadGetBadGateway:"))
  const getUnauthorized = openapi.slice(openapi.indexOf("    SkillPackageUploadGetUnauthorized:"), openapi.indexOf("    SkillPackageUploadGetForbidden:"))
  const getForbidden = openapi.slice(openapi.indexOf("    SkillPackageUploadGetForbidden:"), openapi.indexOf("    SkillPackageUploadGetNotFound:"))
  const getUnavailable = openapi.slice(openapi.indexOf("    SkillPackageUploadGetUnavailable:"), openapi.indexOf("    SkillPackageBeginBadRequest:"))
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
      getUnauthorized,
      getUnauthorized.replace(
        "code: { type: string, enum: [session_authentication_required, session_invalid] }",
        "code: { type: string, enum: [service_auth_failed, session_invalid] }",
      ),
    ),
    openapi.replace(
      getForbidden,
      getForbidden.replace(
        "code: { type: string, enum: [service_auth_failed, session_forbidden, product_tenant_forbidden] }",
        "code: { type: string, enum: [session_forbidden, product_tenant_not_configured] }",
      ),
    ),
    openapi.replace(
      getUnavailable,
      getUnavailable.replace(
        "code: { type: string, enum: [product_tenant_not_configured, iam_admission_unavailable, skill_dependency_unavailable] }",
        "code: { type: string, enum: [iam_admission_unavailable, skill_dependency_unavailable] }",
      ),
    ),
    openapi.replace(getRate, getRate.replace("          required: false", "          required: true")),
  ]
  for (const [index, broken] of mutations.entries()) {
    assert.notEqual(broken, openapi)
    assert.ok(
      inspectBffOpenApi(broken, baseline).some((error) => /getSkillPackageUpload|SkillPackageUpload/u.test(error)),
      `mutation ${index}`,
    )
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
    ["SkillPackageUploadGetUnauthorized", "session_authentication_required, session_invalid"],
    ["SkillPackageUploadGetForbidden", "service_auth_failed, session_forbidden, product_tenant_forbidden"],
    ["SkillPackageUploadGetNotFound", "skill_not_found"],
    ["SkillPackageUploadGetPreconditionFailed", "skill_precondition_failed"],
    ["SkillPackageUploadGetRateLimited", "session_rate_limited, skill_rate_limited"],
    ["SkillPackageUploadGetBadGateway", "skill_response_invalid"],
    ["SkillPackageUploadGetUnavailable", "product_tenant_not_configured, iam_admission_unavailable, skill_dependency_unavailable"],
  ]
  for (const [index, [name, codes]] of cases.entries()) {
    const block = openapi.slice(openapi.indexOf(`    ${name}:`), openapi.indexOf(`    ${cases[index + 1]?.[0] ?? "SkillDraftBadRequest"}:`))
    assert.match(block, /x-request-id:[\s\S]*Cache-Control:[\s\S]*const: no-store/u)
    assert.ok(block.includes("#/components/schemas/SkillPackageUploadGetErrorResponse"))
    assert.ok(block.includes(`code: { type: string, enum: [${codes}] }`))
    if (name === "SkillPackageUploadGetRateLimited") assert.match(block, /Retry-After:[\s\S]*required: false[\s\S]*pattern: '\^\[1-9\]\[0-9\]\{0,4\}\$'/u)
  }
})

test("BeginSkillPackageUpload publishes one inactive user-only command with a strict PUT reference", async () => {
  const { openapi, baseline } = await readContract()
  assert.ok(
    baseline.some(
      ({ method, path, operation_id }) => method === "POST" && path === "/v1/skills/{skill_id}/package-upload" && operation_id === "beginSkillPackageUpload",
    ),
  )
  const path = openapi.slice(openapi.indexOf("  /v1/skills/{skill_id}/package-upload:"), openapi.indexOf("  /v1/skills/{name}/revisions:"))
  const begin = path.slice(path.indexOf("    post:"))
  assert.match(begin, /default-closed candidate runtime route pinned to inactive Platform v4/u)
  assert.doesNotMatch(begin, /no BFF runtime route yet|future BFF runtime/u)
  for (const fragment of [
    "operationId: beginSkillPackageUpload",
    "x-kokoro-permission: product.skill.begin_package_upload",
    "x-kokoro-idempotency: required",
    "#/components/parameters/SkillPackageBeginIdempotencyKey",
    "#/components/schemas/BeginSkillPackageUploadRequest",
    "#/components/schemas/BeginSkillPackageUploadResponse",
    "'201':",
    "x-request-id:",
    "Cache-Control:",
    "const: no-store",
  ])
    assert.ok(begin.includes(fragment), fragment)
  for (const status of ["400", "401", "403", "404", "409", "412", "413", "429", "502", "503"])
    assert.ok(begin.includes(`'${status}': { $ref: '#/components/responses/SkillPackageBegin`), status)
  const request = openapi.slice(openapi.indexOf("    BeginSkillPackageUploadRequest:"), openapi.indexOf("    SkillPackageBeginTransferReference:"))
  assert.match(request, /required: \[filename, mime_type, size_bytes, content_sha256\]/u)
  assert.match(request, /additionalProperties: false/u)
  assert.match(request, /mime_type: \{ type: string, const: application\/zip \}/u)
  assert.match(request, /size_bytes: \{ type: integer, minimum: 1, maximum: 33554432 \}/u)
  assert.match(request, /replaces_attempt_id: \{ type: string, pattern:/u)
  const transfer = openapi.slice(openapi.indexOf("    SkillPackageBeginTransferReference:"), openapi.indexOf("    SkillPackageBeginResource:"))
  assert.match(transfer, /default-closed BFF candidate runtime matches an approved exact origin/u)
  assert.doesNotMatch(transfer, /future BFF runtime/u)
  assert.match(transfer, /required: \[url, method, required_headers, expires_at\]/u)
  assert.match(transfer, /method: \{ type: string, const: PUT \}/u)
  assert.match(transfer, /required_headers:[\s\S]*additionalProperties:/u)
  const resource = openapi.slice(openapi.indexOf("    SkillPackageBeginResource:"), openapi.indexOf("    BeginSkillPackageUploadResponse:"))
  assert.match(resource, /required: \[skill_id, attempt_id, attempt_epoch, upload_id, transfer_reference, replayed\]/u)
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
})

test("CompleteSkillPackageUpload publishes an inactive user-only strict command", async () => {
  const { openapi, baseline } = await readContract()
  assert.ok(
    baseline.some(
      ({ method, path, operation_id }) =>
        method === "POST" && path === "/v1/skills/{skill_id}/package-upload/complete" && operation_id === "completeSkillPackageUpload",
    ),
  )
  const operation = openapi.slice(openapi.indexOf("  /v1/skills/{skill_id}/package-upload/complete:"), openapi.indexOf("  /v1/skills/{name}/revisions:"))
  assert.match(operation, /real default-closed BFF Complete runtime route/u)
  assert.doesNotMatch(operation, /no BFF Complete runtime route exists yet/u)
  for (const fragment of [
    "operationId: completeSkillPackageUpload",
    "product.skill.complete_package_upload",
    "SkillPackageCompleteIdempotencyKey",
    "CompleteSkillPackageUploadRequest",
    "CompleteSkillPackageUploadResponse",
    "'200':",
    "x-request-id:",
    "Cache-Control:",
    "const: no-store",
  ])
    assert.ok(operation.includes(fragment), fragment)
  assert.doesNotMatch(operation, /asset_id|transfer_reference/u)
  const request = openapi.slice(openapi.indexOf("    CompleteSkillPackageUploadRequest:"), openapi.indexOf("    SkillPackageCompleteResource:"))
  assert.match(request, /required: \[attempt_id, upload_id, content_sha256, size_bytes\][\s\S]*additionalProperties: false/u)
  assert.match(request, /content_sha256: \{ type: string, pattern: '\^\[a-f0-9\]\{64\}\$' \}/u)
  assert.match(request, /size_bytes: \{ type: integer, minimum: 1, maximum: 33554432 \}/u)
  const resource = openapi.slice(openapi.indexOf("    SkillPackageCompleteResource:"), openapi.indexOf("    CompleteSkillPackageUploadResponse:"))
  assert.match(
    resource,
    /required: \[skill_id, attempt_id, attempt_epoch, upload_id, phase, replayed, content_sha256, scan_state\][\s\S]*additionalProperties: false/u,
  )
  assert.match(resource, /phase: \{ type: string, const: uploaded \}/u)
  assert.match(resource, /scan_state: \{ type: string, enum: \[clean, pending, unknown\] \}/u)
  assert.doesNotMatch(resource, /asset_id|transfer_reference/u)
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
})

test("CompleteSkillPackageUpload binds owner v4 digest version and all eleven frozen command vectors", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../contract/vendor/kokoro-platform/91bc3655ebd3648cb8f8ccddfacb5628bdeb1c5c/execution-operations-v5/manifest.json", import.meta.url),
      "utf8",
    ),
  )
  assert.equal(manifest.baseArtifact.artifactVersion, "4.0.0")
  assert.equal(manifest.baseArtifact.aggregateSha256, "902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79")
  assert.ok(manifest.baseArtifact.files.length > 0)
})
test("CompleteSkillPackageUpload semantic gate rejects request, response, status and legacy-reference drift", async () => {
  const { openapi, baseline } = await readContract()
  const mutations = [
    openapi.replace("required: [attempt_id, upload_id, content_sha256, size_bytes]", "required: [attempt_id, upload_id]"),
    openapi.replace("phase: { type: string, const: uploaded }", "phase: { type: string, const: validated }"),
    openapi.replace("scan_state: { type: string, enum: [clean, pending, unknown] }", "scan_state: { type: string, enum: [clean, infected] }"),
    openapi.replace(
      "'412': { $ref: '#/components/responses/SkillPackageCompletePreconditionFailed' }",
      "'412': { $ref: '#/components/responses/SkillPackageCompleteBadGateway' }",
    ),
    openapi.replace("#/components/parameters/SkillPackageCompleteIdempotencyKey", "#/components/parameters/IdempotencyKey"),
    openapi.replace("data: { $ref: '#/components/schemas/SkillPackageCompleteResource' }", "data: { $ref: '#/components/schemas/SkillPackageBeginResource' }"),
  ]
  for (const broken of mutations) {
    assert.notEqual(broken, openapi)
    assert.ok(inspectBffOpenApi(broken, baseline).some((error) => /completeSkillPackageUpload|SkillPackageComplete|CompleteSkillPackageUpload/u.test(error)))
  }
  const legacy = openapi.slice(openapi.indexOf("  /v1/me:"), openapi.indexOf("  /v1/team/members:"))
  for (const poisoned of [
    legacy.replace("#/components/schemas/CurrentUserResponse", "#/components/schemas/CompleteSkillPackageUploadResponse"),
    legacy.replace("#/components/responses/ServiceUnavailable", "#/components/responses/SkillPackageCompleteUnavailable"),
  ]) {
    assert.notEqual(poisoned, legacy)
    assert.ok(
      inspectBffOpenApi(
        openapi.replace(legacy, () => poisoned),
        baseline,
      ).some((error) => error.includes("GET /v1/me must not reference CompleteSkillPackageUpload")),
    )
  }
})

test("ValidateSkillDraft describes one default-closed user-only attempt-bound command", async () => {
  const { openapi, baseline } = await readContract()
  assert.ok(
    baseline.some(({ method, path, operation_id }) => method === "POST" && path === "/v1/skills/{skill_id}/validate" && operation_id === "validateSkillDraft"),
  )
  const operation = openapi.slice(openapi.indexOf("  /v1/skills/{skill_id}/validate:"), openapi.indexOf("  /v1/skills/{name}/revisions:"))
  for (const fragment of [
    "operationId: validateSkillDraft",
    "default-closed BFF Validate runtime route",
    "not publicly activated",
    "product.skill.validate_draft",
    "SkillValidateIdempotencyKey",
    "ValidateSkillDraftRequest",
    "ValidateSkillDraftResponse",
    "'200':",
    "x-request-id:",
    "Cache-Control:",
    "const: no-store",
  ])
    assert.ok(operation.includes(fragment), fragment)
  assert.doesNotMatch(operation, /asset_id|upload_id|signed_url|transfer_reference/u)
  const request = openapi.slice(openapi.indexOf("    ValidateSkillDraftRequest:"), openapi.indexOf("    SkillValidateResource:"))
  assert.match(request, /required: \[attempt_id\][\s\S]*additionalProperties: false/u)
  assert.match(request, /attempt_id: \{ type: string, pattern: '\^\[A-Za-z0-9\]/u)
  const resource = openapi.slice(openapi.indexOf("    SkillValidateResource:"), openapi.indexOf("    ValidateSkillDraftResponse:"))
  assert.match(resource, /required: \[skill_id, series_id, valid, content_digest, manifest_identity, replayed\][\s\S]*additionalProperties: false/u)
  assert.match(resource, /valid: \{ type: boolean, const: true \}/u)
  assert.match(resource, /manifest_identity: \{ type: string, pattern: '\^zip-v2:sha256:/u)
  assert.doesNotMatch(resource, /asset_id|upload_id|transfer_reference/u)
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
})

test("ValidateSkillDraft pins owner v4 tag 7 and all eight command digest vectors", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../contract/vendor/kokoro-platform/91bc3655ebd3648cb8f8ccddfacb5628bdeb1c5c/execution-operations-v5/manifest.json", import.meta.url),
      "utf8",
    ),
  )
  assert.equal(manifest.baseArtifact.artifactVersion, "4.0.0")
  assert.equal(manifest.baseArtifact.aggregateSha256, "902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79")
  assert.ok(manifest.baseArtifact.files.length > 0)
})
test("ValidateSkillDraft semantic gate rejects schema, status, header and legacy-operation drift", async () => {
  const { openapi, baseline } = await readContract()
  for (const broken of [
    openapi.replace("default-closed BFF Validate runtime route", "active BFF Validate route"),
    openapi.replace("required: [attempt_id]\n      additionalProperties: false", "required: []\n      additionalProperties: false"),
    openapi.replace("valid: { type: boolean, const: true }", "valid: { type: boolean }"),
    openapi.replace("manifest_identity: { type: string, pattern: '^zip-v2:sha256:[a-f0-9]{64}$' }", "manifest_identity: { type: string }"),
    openapi.replace(
      "'412': { $ref: '#/components/responses/SkillValidatePreconditionFailed' }",
      "'412': { $ref: '#/components/responses/SkillValidateBadGateway' }",
    ),
    openapi.replace("#/components/parameters/SkillValidateIdempotencyKey", "#/components/parameters/IdempotencyKey"),
    openapi.replace("data: { $ref: '#/components/schemas/SkillValidateResource' }", "data: { $ref: '#/components/schemas/SkillDraftResource' }"),
  ]) {
    assert.notEqual(broken, openapi)
    assert.ok(inspectBffOpenApi(broken, baseline).some((error) => /validateSkillDraft|SkillValidate|ValidateSkillDraft/u.test(error)))
  }
  const legacy = openapi.slice(openapi.indexOf("  /v1/me:"), openapi.indexOf("  /v1/team/members:"))
  for (const poisoned of [
    legacy.replace("#/components/schemas/CurrentUserResponse", "#/components/schemas/ValidateSkillDraftResponse"),
    legacy.replace("#/components/responses/ServiceUnavailable", "#/components/responses/SkillValidateUnavailable"),
  ]) {
    assert.notEqual(poisoned, legacy)
    assert.ok(
      inspectBffOpenApi(
        openapi.replace(legacy, () => poisoned),
        baseline,
      ).some((error) => error.includes("GET /v1/me must not reference ValidateSkillDraft")),
    )
  }
})

test("PublishSkill exposes one default-closed user-only command with no request body", async () => {
  const { openapi, baseline } = await readContract()
  assert.ok(baseline.some(({ method, path, operation_id }) => method === "POST" && path === "/v1/skills/{skill_id}/publish" && operation_id === "publishSkill"))
  const start = openapi.indexOf("  /v1/skills/{skill_id}/publish:")
  const end = openapi.indexOf("  /v1/skills/{name}/revisions:", start)
  assert.ok(start >= 0 && end > start)
  const operation = openapi.slice(start, end)
  assert.match(operation, /operationId: publishSkill/u)
  assert.match(operation, /Default-closed BFF runtime candidate pinned to inactive Platform v4/u)
  assert.match(operation, /the named Publish route exists but the candidate is not publicly activated/u)
  for (const fragment of [
    "product.skill.publish",
    "SkillPublishIdempotencyKey",
    "PublishSkillResponse",
    "'200':",
    "x-request-id:",
    "Cache-Control:",
    "const: no-store",
    "exactly zero request-body bytes",
    "PERSONAL(1)",
  ])
    assert.ok(operation.includes(fragment), fragment)
  assert.match(operation, /x-kokoro-empty-body: required/u)
  assert.match(operation, /x-kokoro-fixed-visibility: personal/u)
  assert.doesNotMatch(operation, /requestBody:/u)
  assert.doesNotMatch(operation, /asset_id|manifest_identity|content_digest|tenant_ref/u)
  const resource = openapi.slice(openapi.indexOf("    SkillPublishResource:"), openapi.indexOf("    PublishSkillResponse:"))
  assert.match(resource, /required: \[source_ref, revision, status, event_id, replayed\][\s\S]*additionalProperties: false/u)
  assert.match(resource, /status: \{ type: string, const: active \}/u)
  assert.match(resource, /source_ref: \{ type: string, pattern: '\^skill:/u)
  assert.doesNotMatch(resource, /visibility|asset_id|manifest_identity|signed_url/u)
  const revision = openapi.slice(openapi.indexOf("    SkillPublishRevision:"), openapi.indexOf("    SkillPublishResource:"))
  const pattern = /pattern: '([^']+)'/u.exec(revision)?.[1]
  assert.ok(pattern)
  const bounded = new RegExp(pattern, "u")
  assert.ok(bounded.test("1"))
  assert.ok(bounded.test("18446744073709551615"))
  for (const invalid of ["0", "01", "18446744073709551616", "99999999999999999999"]) assert.equal(bounded.test(invalid), false, invalid)
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
})

test("PublishSkill pins the inactive owner v4 PERSONAL command and all eight digest vectors", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../contract/vendor/kokoro-platform/91bc3655ebd3648cb8f8ccddfacb5628bdeb1c5c/execution-operations-v5/manifest.json", import.meta.url),
      "utf8",
    ),
  )
  assert.equal(manifest.baseArtifact.artifactVersion, "4.0.0")
  assert.equal(manifest.baseArtifact.aggregateSha256, "902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79")
  assert.ok(manifest.baseArtifact.files.length > 0)
})
test("PublishSkill semantic gate rejects body, state, status and legacy-operation reference drift", async () => {
  const { openapi, baseline } = await readContract()
  const notFound = openapi.slice(openapi.indexOf("    SkillPublishNotFound:"), openapi.indexOf("    SkillPublishConflict:"))
  const rateLimited = openapi.slice(openapi.indexOf("    SkillPublishRateLimited:"), openapi.indexOf("    SkillPublishBadGateway:"))
  for (const broken of [
    openapi.replace("x-kokoro-empty-body: required", "x-kokoro-empty-body: optional"),
    openapi.replace("x-kokoro-fixed-visibility: personal", "x-kokoro-fixed-visibility: organization"),
    openapi.replace("      operationId: publishSkill", "      operationId: publishSkill\n      requestBody:\n        required: true"),
    openapi.replace(
      openapi.slice(openapi.indexOf("    SkillPublishResource:"), openapi.indexOf("    SkillPublishErrorDetail:")),
      openapi
        .slice(openapi.indexOf("    SkillPublishResource:"), openapi.indexOf("    SkillPublishErrorDetail:"))
        .replace("status: { type: string, const: active }", "status: { type: string, const: draft }"),
    ),
    openapi.replace(
      openapi.slice(openapi.indexOf("    SkillPublishResource:"), openapi.indexOf("    SkillPublishErrorDetail:")),
      openapi
        .slice(openapi.indexOf("    SkillPublishResource:"), openapi.indexOf("    SkillPublishErrorDetail:"))
        .replace("source_ref: { type: string, pattern: '^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }", "source_ref: { type: string }"),
    ),
    openapi.replace(
      "'412': { $ref: '#/components/responses/SkillPublishPreconditionFailed' }",
      "'412': { $ref: '#/components/responses/SkillPublishBadGateway' }",
    ),
    openapi.replace(notFound, notFound.replace("code: { type: string, enum: [skill_not_found] }", "code: { type: string, enum: [skill_response_invalid] }")),
    openapi.replace(rateLimited, rateLimited.replace("required: false", "required: true")),
    openapi.replace("#/components/parameters/SkillPublishIdempotencyKey", "#/components/parameters/IdempotencyKey"),
    openapi.replace("data: { $ref: '#/components/schemas/SkillPublishResource' }", "data: { $ref: '#/components/schemas/SkillDraftResource' }"),
  ]) {
    assert.notEqual(broken, openapi)
    assert.ok(inspectBffOpenApi(broken, baseline).some((error) => /publishSkill|SkillPublish|PublishSkill/u.test(error)))
  }
  const legacy = openapi.slice(openapi.indexOf("  /v1/me:"), openapi.indexOf("  /v1/team/members:"))
  for (const poisoned of [
    legacy.replace("#/components/schemas/CurrentUserResponse", "#/components/schemas/PublishSkillResponse"),
    legacy.replace("#/components/responses/ServiceUnavailable", "#/components/responses/SkillPublishUnavailable"),
    legacy.replace("#/components/parameters/IdempotencyKey", "#/components/parameters/SkillPublishIdempotencyKey"),
  ]) {
    if (poisoned === legacy) continue
    assert.ok(
      inspectBffOpenApi(
        openapi.replace(legacy, () => poisoned),
        baseline,
      ).some((error) => error.includes("GET /v1/me must not reference PublishSkill")),
    )
  }
  const oldPost = openapi.slice(openapi.indexOf("  /v1/skills/drafts:"), openapi.indexOf("  /v1/skills/{skill_id}/package-upload:"))
  const misplacedKey = oldPost.replace("#/components/parameters/SkillDraftIdempotencyKey", "#/components/parameters/SkillPublishIdempotencyKey")
  assert.notEqual(misplacedKey, oldPost)
  assert.ok(
    inspectBffOpenApi(
      openapi.replace(oldPost, () => misplacedKey),
      baseline,
    ).some((error) => error.includes("POST /v1/skills/drafts must not reference PublishSkill")),
  )
})

test("BeginSkillPackageUpload candidate names the exact inactive owner v4 command and digest version", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../contract/vendor/kokoro-platform/91bc3655ebd3648cb8f8ccddfacb5628bdeb1c5c/execution-operations-v5/manifest.json", import.meta.url),
      "utf8",
    ),
  )
  assert.equal(manifest.baseArtifact.artifactVersion, "4.0.0")
  assert.equal(manifest.baseArtifact.aggregateSha256, "902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79")
  assert.ok(manifest.baseArtifact.files.length > 0)
})
test("BeginSkillPackageUpload semantic gate rejects transfer, envelope, status and legacy-reference drift", async () => {
  const { openapi, baseline } = await readContract()
  for (const broken of [
    openapi.replace("method: { type: string, const: PUT }", "method: { type: string, const: GET }"),
    openapi.replace("required: [url, method, required_headers, expires_at]", "required: [url, method, expires_at]"),
    openapi.replace(
      "required: [skill_id, attempt_id, attempt_epoch, upload_id, transfer_reference, replayed]",
      "required: [skill_id, attempt_id, attempt_epoch, upload_id, replayed]",
    ),
    openapi.replace(
      "'409': { $ref: '#/components/responses/SkillPackageBeginConflict' }",
      "'409': { $ref: '#/components/responses/SkillPackageBeginBadGateway' }",
    ),
    openapi.replace("#/components/parameters/SkillPackageBeginIdempotencyKey", "#/components/parameters/IdempotencyKey"),
    openapi.replace("#/components/schemas/BeginSkillPackageUploadResponse", "#/components/schemas/CreateSkillDraftResponse"),
  ]) {
    assert.notEqual(broken, openapi)
    assert.ok(inspectBffOpenApi(broken, baseline).some((error) => /beginSkillPackageUpload|SkillPackageBegin|BeginSkillPackageUpload/u.test(error)))
  }
  const legacy = openapi.slice(openapi.indexOf("  /v1/me:"), openapi.indexOf("  /v1/team/members:"))
  for (const poisoned of [
    legacy.replace("#/components/schemas/CurrentUserResponse", "#/components/schemas/BeginSkillPackageUploadResponse"),
    legacy.replace("#/components/responses/ServiceUnavailable", "#/components/responses/SkillPackageBeginUnavailable"),
    legacy.replace("#/components/schemas/CurrentUserResponse", "#/components/schemas/SkillPackageBeginTransferReference"),
  ]) {
    assert.notEqual(poisoned, legacy)
    assert.ok(
      inspectBffOpenApi(
        openapi.replace(legacy, () => poisoned),
        baseline,
      ).some((error) => error.includes("GET /v1/me")),
    )
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
  assert.match(openapi, /CurrentUserIdentity:\n\s+type: object\n\s+required: \[user_id, tenant_id, platform_admin\]\n\s+additionalProperties: false/u)
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
  assert.match(messageRequest, /selected_skill_source_refs:[\s\S]*maxItems: 16[\s\S]*uniqueItems: true/u)
  assert.doesNotMatch(messageRequest, /pinned_skills/u)
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
  const eventsStart = openapi.indexOf("  /v1/sessions/{id}/events:")
  const eventsEnd = openapi.indexOf("  /v1/sessions/{id}/runs/{runId}/control:", eventsStart)
  const brokenEvents = openapi.slice(eventsStart, eventsEnd).replace("        '410': { $ref: '#/components/responses/Gone' }\n", "")
  const broken = openapi
    .replace(openapi.slice(eventsStart, eventsEnd), () => brokenEvents)
    .replace("        '413': { $ref: '#/components/responses/PayloadTooLarge' }\n", "")
    .replace(openapi.slice(controlStart, controlEnd), () => control)

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

test("GetPublishedPersonalSkill is an inactive strict personal ACTIVE read candidate", async () => {
  const { openapi, baseline } = await readContract()
  assert.ok(
    baseline.some(({ method, path, operation_id }) => method === "GET" && path === "/v1/skills/{skill_id}" && operation_id === "getPublishedPersonalSkill"),
  )
  const operation = openapi.slice(openapi.indexOf("  /v1/skills/{skill_id}:"), openapi.indexOf("  /v1/skills/pool:"))
  for (const fragment of [
    "operationId: getPublishedPersonalSkill",
    "product.skill.read_published_personal",
    "x-kokoro-idempotency: none",
    "PublishedPersonalSkillId",
    "PublishedPersonalSkillOk",
    "PublishedPersonalSkillNotFound",
    "PublishedPersonalSkillRateLimited",
  ])
    assert.ok(operation.includes(fragment), fragment)
  for (const status of ["200", "400", "401", "403", "404", "429", "502", "503"]) assert.match(operation, new RegExp(`'${status}':`, "u"))
  assert.doesNotMatch(operation, /requestBody:|Idempotency-Key|CapabilitySkill|source_selector|secret_ref/u)
  const resource = openapi.slice(openapi.indexOf("    PublishedPersonalSkillResource:"), openapi.indexOf("    PublishedPersonalSkillResponse:"))
  assert.match(resource, /required: \[skill_id, source_ref, revision, status, name, summary, tags, skill_updated_at, example_prompts\]/u)
  assert.match(resource, /additionalProperties: false/u)
  assert.match(resource, /status: \{ type: string, const: active \}/u)
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
})

test("GetPublishedPersonalSkill semantic gate rejects envelope, field, input, status, and header drift", async () => {
  const { openapi, baseline } = await readContract()
  const operation = openapi.slice(openapi.indexOf("  /v1/skills/{skill_id}:"), openapi.indexOf("  /v1/skills/pool:"))
  const resource = openapi.slice(openapi.indexOf("    PublishedPersonalSkillResource:"), openapi.indexOf("    PublishedPersonalSkillResponse:"))
  const success = openapi.slice(openapi.indexOf("    PublishedPersonalSkillResponse:"), openapi.indexOf("    PublishedPersonalSkillErrorDetail:"))
  const errorDetail = openapi.slice(openapi.indexOf("    PublishedPersonalSkillErrorDetail:"), openapi.indexOf("    PublishedPersonalSkillErrorResponse:"))
  const badRequest = openapi.slice(openapi.indexOf("    PublishedPersonalSkillBadRequest:"), openapi.indexOf("    PublishedPersonalSkillUnauthorized:"))
  const ok = openapi.slice(openapi.indexOf("    PublishedPersonalSkillOk:"), openapi.indexOf("    PublishedPersonalSkillBadRequest:"))
  const legacy = openapi.slice(openapi.indexOf("  /v1/me:"), openapi.indexOf("  /v1/team/members:"))
  const mutations = [
    openapi.replace("required: [skill_id, source_ref, revision, status, name, summary, tags, skill_updated_at, example_prompts]", "required: [skill_id, name]"),
    openapi.replace(operation, operation.replace("#/components/parameters/PublishedPersonalSkillId", "#/components/parameters/CapabilityCursor")),
    openapi.replace(operation, operation.replace("#/components/parameters/PublishedPersonalSkillId", "#/components/parameters/IdempotencyKey")),
    openapi.replace(
      operation,
      operation.replace(
        "        - $ref: '#/components/parameters/PublishedPersonalSkillId'",
        "        - $ref: '#/components/parameters/PublishedPersonalSkillId'\n        - name: cursor\n          in: query\n          required: false\n          schema: { type: string }",
      ),
    ),
    openapi.replace(
      operation,
      operation.replace(
        "        - $ref: '#/components/parameters/PublishedPersonalSkillId'",
        "        - $ref: '#/components/parameters/PublishedPersonalSkillId'\n        - { name: cursor, in: query, schema: { type: string } }",
      ),
    ),
    openapi.replace(resource, resource.replace("revision: { type: string, pattern: '^[1-9][0-9]*$' }", "revision: { type: string }")),
    openapi.replace(success, success.replace("#/components/schemas/PublishedPersonalSkillResource", "#/components/schemas/SkillDraftResource")),
    openapi.replace(errorDetail, errorDetail.replace("retryable: { type: boolean }", "retryable: { type: string }")),
    openapi.replace(badRequest, badRequest.replace("invalid_skill_request", "skill_response_invalid")),
    openapi.replace(ok, ok.replace("required: true", "required: false")),
    openapi.replace(ok, ok.replace("maxLength: 128", "maxLength: 255")),
    openapi.replace(legacy, legacy.replace("#/components/schemas/CurrentUserResponse", "#/components/schemas/PublishedPersonalSkillResponse")),
    openapi.replace("      operationId: getPublishedPersonalSkill", "      operationId: getPublishedPersonalSkill\n      requestBody: { required: false }"),
    openapi.replace(
      "        '404': { $ref: '#/components/responses/PublishedPersonalSkillNotFound' }",
      "        '404': { $ref: '#/components/responses/PublishedPersonalSkillBadGateway' }",
    ),
    openapi.replace("        '502': { $ref: '#/components/responses/PublishedPersonalSkillBadGateway' }\n", ""),
    openapi
      .replace("    PublishedPersonalSkillOk:\n      description:", "    PublishedPersonalSkillOk:\n      x-request-id-removed: true\n      description:")
      .replace(/(    PublishedPersonalSkillOk:[\s\S]*?)        x-request-id:/u, "$1        x-request-id-removed:"),
    openapi.replace("    PublishedPersonalSkillId:\n      name: skill_id", "    PublishedPersonalSkillId:\n      name: source_ref"),
    openapi.replace(
      "    PublishedPersonalSkillResponse:\n      type: object\n      required: [data]",
      "    PublishedPersonalSkillResponse:\n      type: object\n      required: [data, meta]",
    ),
  ]
  for (const [index, broken] of mutations.entries()) {
    assert.notEqual(broken, openapi, `mutation ${index}`)
    assert.ok(
      inspectBffOpenApi(broken, baseline).some((error) => /getPublishedPersonalSkill|PublishedPersonalSkill/u.test(error)),
      `mutation ${index}`,
    )
  }
})

test("personal Skill installations replace legacy name toggles with exact five-operation resource", async () => {
  const openapi = await readFile(openapiUrl, "utf8")
  assert.equal(openapi.includes("/v1/skills/{name}/enable:"), false)
  assert.equal(openapi.includes("/v1/skills/{name}/disable:"), false)
  for (const operation of [
    "installPersonalSkill",
    "listPersonalSkillInstallations",
    "getPersonalSkillInstallation",
    "removePersonalSkillInstallation",
    "setPersonalSkillInstallationEnabled",
  ])
    assert.ok(openapi.includes(`operationId: ${operation}`), operation)
  for (const field of ["display_name", "summary", "source_status"])
    assert.match(openapi.slice(openapi.indexOf("    SkillInstallation:"), openapi.indexOf("    SkillInstallationMutation:")), new RegExp(`\\b${field}\\b`, "u"))
  for (const forbidden of ["package_asset_ref", "content_digest", "execution_proof", "target_owner_scope"])
    assert.equal(openapi.slice(openapi.indexOf("  /v1/skill-installations:"), openapi.indexOf("  /v1/skills/github/preview:")).includes(forbidden), false)
})

test("personal Skill installation gate binds stable error.code enums to each HTTP status", async () => {
  const { openapi, baseline } = await readContract()
  for (const mutation of [
    ["enum: [skill_installation_not_found]", "enum: [skill_installation_forbidden]"],
    ["enum: [skill_installation_idempotency_conflict, skill_installation_command_in_progress]", "enum: [skill_installation_idempotency_conflict]"],
    ["enum: [skill_installation_dependency_timeout]", "enum: [skill_installation_dependency_unavailable]"],
    ["enum: [request_body_too_large]", "enum: [invalid_skill_installation_request]"],
    [
      "'413': { $ref: '#/components/responses/SkillInstallationPayloadTooLarge' }",
      "'400': { $ref: '#/components/responses/SkillInstallationPayloadTooLarge' }",
    ],
  ]) {
    const broken = openapi.replace(...mutation)
    assert.notEqual(broken, openapi)
    assert.ok(
      inspectBffOpenApi(broken, baseline).some((error) => /(?:SkillInstallation.*constrain error\.code|installation response status set)/u.test(error)),
      mutation.join(" -> "),
    )
  }
})

test("public7 retains the closed full execution head, five current-locator decisions and full interaction CUSTOM", async () => {
  const { createRequire } = await import("node:module")
  // Parse with the YAML implementation already locked by the contract linter.
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { openapi } = await readContract()
  const document = load(openapi)
  const schemas = document.components.schemas
  assert.equal(document.info.version, "8.10.0")
  const snapshot = schemas.SessionSnapshotResponse.properties.data
  assert.equal(Object.hasOwn(snapshot.properties, "active_run"), false)
  assert.equal(Object.hasOwn(snapshot.properties, "pending_pauses"), false)
  assert.deepEqual(snapshot.properties.execution_head, {
    $ref: "#/components/schemas/ExecutionHead",
  })
  assert.equal(schemas.ExecutionHead.additionalProperties, false)
  assert.deepEqual(schemas.ExecutionHead.required, ["run_id", "state", "pending_pauses"])
  assert.deepEqual(schemas.ExecutionHead.properties.state.enum, ["queued", "active", "waiting", "resuming"])
  assert.deepEqual(schemas.ExecutionHead.properties.pending_pauses, {
    type: "array",
    items: { $ref: "#/components/schemas/PendingPause" },
    maxItems: 1,
  })
  assert.equal(schemas.ExecutionHead.allOf[0].then.properties.pending_pauses.minItems, 1)
  assert.equal(schemas.ExecutionHead.allOf[0].else.properties.pending_pauses.maxItems, 0)
  assert.equal(schemas.ChatInteractionState.additionalProperties, false)
  assert.deepEqual(schemas.ChatInteractionState.required, ["interaction_revision", "pause_revision", "pause_ref", "phase", "groups", "action_result"])
  assert.equal(schemas.ChatInteractionState.properties.interaction_revision.maximum, Number.MAX_SAFE_INTEGER)
  assert.equal(schemas.ChatInteractionState.properties.pause_revision.maximum, Number.MAX_SAFE_INTEGER)
  assert.equal(schemas.RunResumeRequest.additionalProperties, false)
  assert.deepEqual(schemas.RunResumeRequest.required, ["kind", "decisions", "expected_pause_revision", "pause_ref"])
  assert.equal(schemas.RunResumeRequest.properties.expected_pause_revision.minimum, 1)
  assert.equal(schemas.RunResumeRequest.properties.expected_pause_revision.maximum, Number.MAX_SAFE_INTEGER)
  const owner = JSON.parse(
    await readFile(new URL("../../contract/vendor/kokoro-agent/79bf98c5aa63b9bace207afdf42d8c7aefee4fe8/openapi.json", import.meta.url), "utf8"),
  )
  assert.deepEqual(schemas.ResumeDecision, owner.components.schemas.ResumeDecision)
  assert.equal(schemas.SessionEventStream["x-kokoro-custom-event-values"]["kokoro.interaction.state"].$ref, "#/components/schemas/ChatInteractionState")
  const operation = document.paths["/v1/sessions/{id}/runs/{runId}/control"].post
  assert.equal(operation.requestBody.content["application/json"].examples.resume.value.decisions[0].item_id, "item_01J")
  assert.equal(operation.requestBody.content["application/json"].examples.resume.value.expected_pause_revision, 1)
  assert.equal(operation.requestBody.content["application/json"].examples.resume.value.pause_ref, "pause_01J")
})

test("public6 defines the single Conversation collection all, direct and project filter boundary", async () => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { openapi } = await readContract()
  const document = load(openapi)
  const operation = document.paths["/v1/sessions"].get
  const parameterRefs = operation.parameters.map((parameter) => parameter.$ref)

  assert.deepEqual(parameterRefs, [
    "#/components/parameters/DirectScopeQuery",
    "#/components/parameters/ProjectRefQuery",
    "#/components/parameters/LimitQuery",
    "#/components/parameters/CursorQuery",
  ])
  assert.match(operation.description, /Omitted or empty scope lists every active Conversation/u)
  assert.match(operation.description, /Explicit scope=direct lists only Conversations without a project_ref/u)
  assert.match(operation.description, /mutually exclusive and return invalid_scope before Project lookup/u)
  assert.match(operation.description, /discarding the previous cursor/u)
  assert.deepEqual(operation.responses["400"], {
    $ref: "#/components/responses/BadRequest",
  })
  assert.deepEqual(document.components.parameters.DirectScopeQuery.schema.enum, ["", "direct"])
  assert.match(document.components.parameters.DirectScopeQuery.description, /project_ref IS NULL/u)
  assert.match(document.components.parameters.DirectScopeQuery.description, /resource routes it does not alter/u)
  assert.match(document.components.parameters.ProjectRefQuery.description, /cannot be combined with scope=direct on GET \/v1\/sessions/u)
})

async function r71ScheduledCreateSource() {
  const { tsImport } = await import("tsx/esm/api")
  return tsImport("../../src/application/scheduled/input.ts", import.meta.url)
}

function r71ScheduledCreatePayload() {
  return {
    title: "Independent scheduled task",
    prompt: "Summarize the next steps",
    frequency: "daily",
    time: "08:00",
    timezone: "UTC",
    recurrence_anchor_at: "2026-10-03T08:00:00.000Z",
    expires_at: "2026-11-03T08:00:00.000Z",
    auto_approve: false,
  }
}

async function r71ScheduledCreateSchema() {
  const { createRequire } = await import("node:module")
  // Reuse the installed YAML loader already used by this file's public4 assertions.
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { openapi } = await readContract()
  const schema = load(openapi).components.schemas.CreateScheduledTaskRequest
  assert.ok(schema !== undefined, "the canonical ScheduledTask creation schema must exist")
  return schema
}

function r71AssertScheduledInput(input, payload) {
  assert.ok(input !== null, "the production source parser must accept the legal control")
  assert.equal(input.title, payload.title)
  assert.equal(input.prompt, payload.prompt)
  assert.equal(input.frequency, payload.frequency)
  assert.equal(input.time, payload.time)
  assert.equal(input.timezone, payload.timezone)
  assert.equal(input.recurrenceAnchorAt.toISOString(), payload.recurrence_anchor_at)
  assert.equal(input.expiresAt.toISOString(), payload.expires_at)
  assert.equal(input.autoApprove, payload.auto_approve)
  assert.equal(Object.hasOwn(input, "conversationId"), false)
  assert.equal(Object.hasOwn(input, "sessionId"), false)
}

// Load production TypeScript, not a possibly stale dist parser.
test("R71 independent ScheduledTask creation needs neither Project nor Conversation", async () => {
  const { scheduledCreateInput } = await r71ScheduledCreateSource()
  const payload = r71ScheduledCreatePayload()
  const input = scheduledCreateInput(payload)
  r71AssertScheduledInput(input, payload)
  assert.equal(Object.hasOwn(input, "projectId"), false)
  const schema = await r71ScheduledCreateSchema()
  assert.equal(schema.type, "object")
  assert.equal(schema.additionalProperties, false)
  for (const field of ["project_id", "conversation_id", "session_id"]) assert.equal((schema.required ?? []).includes(field), false)
  for (const field of ["conversation_id", "conversation_ref", "session_id", "session_ref"]) assert.equal(Object.hasOwn(schema.properties, field), false)
})

test("R71 source parser preserves the optional Project reference without changing independent task fields", async () => {
  const { scheduledCreateInput } = await r71ScheduledCreateSource()
  const payload = {
    ...r71ScheduledCreatePayload(),
    project_id: "project_owned",
  }
  // Match the public route's existing second argument, rather than inventing a parser overload.
  const linked = scheduledCreateInput(payload, typeof payload.project_id === "string" ? payload.project_id : undefined)
  r71AssertScheduledInput(linked, payload)
  assert.equal(linked.projectId, "project_owned")
  const { projectId: _projectId, ...withoutProject } = linked
  assert.deepEqual(withoutProject, scheduledCreateInput(r71ScheduledCreatePayload()))
})

test("R71 closed ScheduledTask creation schema declares optional nonempty project_id accepted by the source parser", async () => {
  const { scheduledCreateInput } = await r71ScheduledCreateSource()
  const payload = {
    ...r71ScheduledCreatePayload(),
    project_id: "project_owned",
  }
  const linked = scheduledCreateInput(payload, payload.project_id)
  r71AssertScheduledInput(linked, payload)
  assert.equal(linked.projectId, payload.project_id)
  const schema = await r71ScheduledCreateSchema()
  assert.equal(schema.additionalProperties, false)
  const properties = Object.keys(schema.properties).sort()
  assert.deepEqual(
    properties,
    ["title", "prompt", "frequency", "time", "timezone", "recurrence_anchor_at", "expires_at", "auto_approve", "project_id"].sort(),
    "closed public6 creation schema retains optional project_id while excluding create-only state controls and Conversation linkage",
  )
  const project = schema.properties.project_id
  assert.ok(project !== undefined, "project_id must be declared, not admitted by opening the schema")
  assert.equal(project.type, "string")
  assert.equal(project.minLength, 1)
  assert.notEqual(project.nullable, true)
  assert.equal(project.oneOf, undefined)
  assert.equal(project.anyOf, undefined)
  for (const field of ["project_id", "conversation_id", "session_id"]) assert.equal((schema.required ?? []).includes(field), false)
})

// R73 target comes from the current D0 prefixes, not from interpreting absent query declarations.
async function r73ScheduledContract() {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { openapi } = await readContract()
  return load(openapi)
}

test("R73 create retains the closed independent-task contract and optional nonnullable Project reference", async () => {
  const document = await r73ScheduledContract()
  const schema = document.components.schemas.CreateScheduledTaskRequest
  assert.equal(schema.type, "object")
  assert.equal(schema.additionalProperties, false)
  assert.equal((schema.required ?? []).includes("project_id"), false)
  assert.equal(schema.properties.project_id.type, "string")
  assert.equal(schema.properties.project_id.minLength, 1)
  assert.notEqual(schema.properties.project_id.nullable, true)
  assert.equal(schema.properties.auto_approve.type, "boolean")
  for (const field of ["conversation_id", "session_id", "tenant_id", "owner_id"]) assert.equal(Object.hasOwn(schema.properties, field), false)
})

test("R73 create no longer advertises caller-set enabled/status or silent-ignore fields", async () => {
  const schema = (await r73ScheduledContract()).components.schemas.CreateScheduledTaskRequest
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    ["title", "prompt", "frequency", "time", "timezone", "recurrence_anchor_at", "expires_at", "auto_approve", "project_id"].sort(),
  )
})

test("R73 Project reference schema rejects empty and all edge whitespace without excluding legal IDs or slugs", async () => {
  const project = (await r73ScheduledContract()).components.schemas.CreateScheduledTaskRequest.properties.project_id
  assert.equal(typeof project.pattern, "string", "the published reference policy must express edge-whitespace rejection")
  const pattern = new RegExp(project.pattern, "u")
  for (const value of ["project_owned", "owned-project-slug", "a", "项目"]) assert.equal(pattern.test(value), true, JSON.stringify(value))
  for (const value of [
    "",
    "   ",
    "\t",
    " project_owned",
    "project_owned ",
    "\nproject_owned",
    "project_owned\n",
    "\u00a0project_owned",
    "project_owned\ufeff",
  ]) {
    assert.equal(pattern.test(value), false, JSON.stringify(value))
  }
})

test("R73 create documents the existing invisible Project 404 alongside admission and idempotency responses", async () => {
  const document = await r73ScheduledContract()
  const operation = document.paths["/v1/scheduled-tasks"].post
  for (const status of ["200", "400", "401", "403", "404", "409", "429", "503"]) assert.ok(operation.responses[status], `create response ${status}`)
  const response = operation.responses["404"]
  const resolved = response.$ref === undefined ? response : document.components.responses[response.$ref.split("/").at(-1)]
  assert.ok(resolved.content["application/json"].schema)
})

test("R73 create still declares no query input and keeps the existing PATCH contract separate", async () => {
  const document = await r73ScheduledContract()
  const collection = document.paths["/v1/scheduled-tasks"]
  const parameters = [...(collection.parameters ?? []), ...(collection.post.parameters ?? [])].map((parameter) =>
    parameter.$ref === undefined ? parameter : document.components.parameters[parameter.$ref.split("/").at(-1)],
  )
  assert.equal(
    parameters.some((parameter) => parameter.in === "query"),
    false,
  )
  const patch = document.paths["/v1/scheduled-tasks/{id}"].patch
  assert.equal(patch.requestBody.content["application/json"].schema.$ref, "#/components/schemas/ScheduledTaskPatchRequest")
  const patchSchema = document.components.schemas.ScheduledTaskPatchRequest
  assert.equal(patchSchema.type, "object")
  assert.equal(patchSchema.additionalProperties, false)
  assert.deepEqual(Object.keys(patchSchema.properties).sort(), [
    "auto_approve",
    "enabled",
    "expires_at",
    "frequency",
    "prompt",
    "recurrence_anchor_at",
    "status",
    "time",
    "timezone",
    "title",
  ])
  assert.equal(Object.hasOwn(patchSchema.properties, "next_run_at"), false)
  assert.deepEqual(patchSchema.properties.recurrence_anchor_at, {
    type: "string",
    format: "date-time",
  })
})

function r75RequiredScheduledPayload() {
  return {
    title: "R75 independent task",
    prompt: "Review the next steps.",
    frequency: "daily",
    time: "08:00",
    timezone: "UTC",
  }
}

test("R75 creation schema requires exactly the five production-required properties on both creation operations", async () => {
  const document = await r73ScheduledContract()
  const schema = document.components.schemas.CreateScheduledTaskRequest
  assert.deepEqual([...(schema.required ?? [])].sort(), ["title", "prompt", "frequency", "time", "timezone"].sort())
  for (const field of ["project_id", "recurrence_anchor_at", "expires_at", "auto_approve"]) {
    assert.equal(schema.required.includes(field), false, `${field} must remain optional`)
    assert.ok(Object.hasOwn(schema.properties, field), `${field} must remain declared`)
  }
  for (const path of ["/v1/scheduled-tasks", "/v1/projects/{projectId}/scheduled-tasks"]) {
    const requestBody = document.paths[path].post.requestBody
    assert.equal(requestBody.required, true)
    assert.equal(requestBody.content["application/json"].schema.$ref, "#/components/schemas/CreateScheduledTaskRequest")
  }
})

test("R255 ScheduledTask publishes an anchor-only input and a required nullable Scheduler-confirmed next instant", async () => {
  const document = await r73ScheduledContract()
  const create = document.components.schemas.CreateScheduledTaskRequest
  const patch = document.components.schemas.ScheduledTaskPatchRequest
  const task = document.components.schemas.ScheduledTask

  for (const input of [create, patch]) {
    assert.equal(Object.hasOwn(input.properties, "next_run_at"), false)
    assert.deepEqual(input.properties.recurrence_anchor_at, {
      type: "string",
      format: "date-time",
    })
  }
  assert.equal(create.additionalProperties, false)
  assert.equal(patch.additionalProperties, false)
  assert.ok(task.required.includes("next_run_at"))
  assert.deepEqual(task.properties.next_run_at, {
    type: ["string", "null"],
    format: "date-time",
  })
})

test("R255 ScheduledTask semantic gate rejects anchor aliases, date-time drift, and a nonnullable or optional next projection", async () => {
  const { openapi, baseline } = await readContract()
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
  const mutations = [
    openapi.replace("next_run_at: { type: [string, 'null'], format: date-time }", "next_run_at: { type: string, format: date-time }"),
    openapi.replaceAll("recurrence_anchor_at: { type: string, format: date-time }", "next_run_at: { type: string, format: date-time }"),
    openapi.replace("recurrence_anchor_at: { type: string, format: date-time }", "recurrence_anchor_at: { type: string }"),
    openapi.replace(
      "required: [id, title, prompt, frequency, time, timezone, next_run_at, auto_approve, enabled, status]",
      "required: [id, title, prompt, frequency, time, timezone, auto_approve, enabled, status]",
    ),
  ]
  for (const [index, mutation] of mutations.entries()) {
    assert.notEqual(mutation, openapi, `mutation ${index} must change the canonical contract`)
    assert.notDeepEqual(inspectBffOpenApi(mutation, baseline), [], `mutation ${index} must be rejected`)
  }
})

test("R75 production accepts an independent task with only the five required properties", async () => {
  const { scheduledCreateInput: parse } = await r71ScheduledCreateSource()
  const payload = r75RequiredScheduledPayload()
  const input = parse(payload)
  assert.ok(input !== null)
  for (const field of ["title", "prompt", "frequency", "time", "timezone"]) assert.equal(input[field], payload[field])
  assert.equal(input.autoApprove, false)
  assert.ok(input.recurrenceAnchorAt instanceof Date)
  assert.ok(Number.isFinite(input.recurrenceAnchorAt.getTime()))
  for (const field of ["projectId", "expiresAt", "conversationId", "sessionId"]) assert.equal(Object.hasOwn(input, field), false)
})

for (const field of ["title", "prompt", "frequency", "time", "timezone"]) {
  test(`R75 production rejects creation without required ${field}`, async () => {
    const { scheduledCreateInput: parse } = await r71ScheduledCreateSource()
    const payload = r75RequiredScheduledPayload()
    delete payload[field]
    assert.equal(parse(payload), null)
  })
}

test("R75 production rejects an empty creation object despite a present HTTP body", async () => {
  const { scheduledCreateInput: parse } = await r71ScheduledCreateSource()
  assert.equal(parse({}), null)
})

test("R124 public7 publishes nullable snapshot process and the anchored Run process page as closed schemas", async () => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { openapi } = await readContract()
  const document = load(openapi)
  assert.equal(document.info.version, "8.10.0")
  const snapshot = document.components.schemas.SessionSnapshotResponse.properties.data
  assert.ok(snapshot.required.includes("execution_process"))
  assert.deepEqual(snapshot.properties.execution_process, {
    oneOf: [{ $ref: "#/components/schemas/RunExecutionProcess" }, { type: "null" }],
  })
  const snapshotProcess = document.components.schemas.RunExecutionProcess
  assert.equal(snapshotProcess.additionalProperties, false)
  assert.deepEqual(snapshotProcess.required, ["run_id", "todos", "activities", "next_cursor"])
  const exampleData = document.components.schemas.SessionSnapshotResponse.example.data
  assert.equal(typeof exampleData.event_watermark, "string")
  assert.ok(exampleData.event_watermark.length > 0)
  assert.deepEqual(exampleData.execution_process, {
    run_id: exampleData.execution_head.run_id,
    todos: null,
    activities: [],
    next_cursor: null,
  })
  const page = document.components.schemas.RunProcessPage
  assert.equal(page.additionalProperties, false)
  assert.deepEqual(page.required, ["run_id", "todos", "activities", "next_cursor", "event_watermark"])
  assert.equal(page.properties.activities.maxItems, 100)
  const operation = document.paths["/v1/sessions/{id}/runs/{runId}/process"].get
  assert.equal(operation.operationId, "getRunProcess")
  assert.equal(operation["x-kokoro-permission"], "session.read")
  const parameters = Object.fromEntries(operation.parameters.map((parameter) => [parameter.name, parameter]))
  assert.equal(parameters.watermark.required, true)
  assert.equal(parameters.cursor.required, false)
  assert.equal(parameters.limit.schema.default, 100)
  assert.equal(parameters.limit.schema.minimum, 1)
  assert.equal(parameters.limit.schema.maximum, 100)
  for (const status of ["200", "400", "401", "403", "404", "410", "429", "503"]) assert.ok(operation.responses[status])
})

test("R146 Move is one strict additive public command with a durable synchronous receipt", async () => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { openapi, baseline } = await readContract()
  const document = load(openapi)
  const resolve = (value) => {
    if (value?.$ref === undefined) return value
    assert.match(value.$ref, /^#\/components\/(?:schemas|parameters|responses)\/[^/]+$/u)
    const [, , section, name] = value.$ref.split("/")
    const resolved = document.components[section][name]
    assert.ok(resolved, `missing ${value.$ref}`)
    return resolved
  }
  const canonicalConversation = "conv_12345678-1234-1234-1234-123456789abc"
  const canonicalProject = "project_12345678-1234-1234-1234-123456789abc"
  const path = "/v1/sessions/{id}/move"
  const pathItem = document.paths[path]
  assert.ok(pathItem, "Move must be one named /v1/sessions/{id}/move path")
  assert.deepEqual(
    Object.keys(pathItem).filter((key) => ["get", "post", "put", "patch", "delete"].includes(key)),
    ["post"],
  )
  assert.equal(document.info.version, "8.10.0", "the additive Skills package reads advance the only public contract without a path alias")
  assert.ok(baseline.some((entry) => entry.method === "POST" && entry.path === path && entry.operation_id === "moveSession"))

  const operation = pathItem.post
  assert.equal(operation.operationId, "moveSession")
  assert.equal(operation["x-kokoro-owner"], "kokoro-bff")
  assert.equal(operation["x-kokoro-visibility"], "public")
  assert.equal(operation["x-kokoro-stability"], "beta")
  assert.equal(operation["x-kokoro-idempotency"], "required")
  assert.equal(operation["x-kokoro-permission"], "chat.session.update")
  assert.match(operation.description, /running|Run|streaming/iu)
  assert.match(operation.description, /next|subsequent|后续/iu)
  assert.match(operation.description, /replay|重放/iu)
  assert.match(operation.description, /current IAM|重新 IAM|re-admission/iu)

  const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map(resolve)
  assert.equal(parameters.filter((parameter) => parameter.in === "query").length, 0, "Move has no project_ref or source query alias")
  assert.equal(parameters.length, 2, "only canonical path ID and one Idempotency-Key header")
  const pathParameter = parameters.find((parameter) => parameter.in === "path")
  assert.equal(pathParameter?.name, "id")
  assert.equal(pathParameter.required, true)
  assert.ok(new RegExp(pathParameter.schema.pattern, "u").test(canonicalConversation))
  assert.equal(new RegExp(pathParameter.schema.pattern, "u").test("session_slug"), false)
  const key = parameters.find((parameter) => parameter.in === "header")
  assert.equal(key?.name, "Idempotency-Key")
  assert.equal(key.required, true)
  assert.equal(key.schema.minLength, 1)
  assert.equal(key.schema.maxLength, 128)
  assert.match(key.description, /exactly once|single|单值/iu)
  const keyPattern = new RegExp(key.schema.pattern, "u")
  assert.equal(keyPattern.test("move-key-1"), true)
  for (const invalid of ["", "two, keys", "with space", "bad\nkey"]) assert.equal(keyPattern.test(invalid), false)

  assert.equal(operation.requestBody.required, true)
  assert.deepEqual(Object.keys(operation.requestBody.content), ["application/json"])
  const request = resolve(operation.requestBody.content["application/json"].schema)
  assert.equal(request.type, "object")
  assert.equal(request.additionalProperties, false)
  assert.deepEqual(request.required, ["target_project_id"])
  assert.deepEqual(Object.keys(request.properties), ["target_project_id"])
  const target = request.properties.target_project_id
  assert.equal(target.oneOf.length, 2)
  const project = target.oneOf.find((variant) => variant.type === "string")
  assert.ok(target.oneOf.some((variant) => variant.type === "null"))
  assert.ok(project)
  const projectPattern = new RegExp(project.pattern, "u")
  assert.equal(projectPattern.test(canonicalProject), true)
  for (const invalid of ["project_slug", "project_", " other", "", "12345678-1234-1234-1234-123456789abc"]) assert.equal(projectPattern.test(invalid), false)

  assert.deepEqual(Object.keys(operation.responses).sort(), ["200", "400", "401", "403", "404", "409", "429", "503"])
  const success = resolve(operation.responses["200"])
  const receipt = resolve(success.content?.["application/json"]?.schema)
  assert.equal(receipt.type, "object")
  assert.equal(receipt.additionalProperties, false)
  assert.deepEqual(receipt.required, ["data"])
  assert.deepEqual(Object.keys(receipt.properties), ["data"], "request ID is a header, never JSON meta")
  const data = resolve(receipt.properties.data)
  assert.equal(data.type, "object")
  assert.equal(data.additionalProperties, false)
  assert.deepEqual(data.required, ["session_id", "project_ref"])
  assert.deepEqual(Object.keys(data.properties).sort(), ["project_ref", "session_id"])
  assert.equal(data.properties.session_id.type, "string")
  assert.ok(data.properties.project_ref.oneOf.some((variant) => variant.type === "null"))
  const responseProject = data.properties.project_ref.oneOf.find((variant) => variant.type === "string")
  assert.ok(responseProject)
  const responseProjectPattern = new RegExp(responseProject.pattern, "u")
  assert.equal(responseProjectPattern.test(canonicalProject), true, "the published 200 schema must accept a real canonical target Project ID")
  const uuidParts = canonicalProject.slice("project_".length).split("-")
  assert.deepEqual(
    uuidParts.map((part) => part.length),
    [8, 4, 4, 4, 12],
  )
  for (let omitted = 0; omitted < uuidParts.length; omitted += 1) {
    const malformed = `project_${uuidParts.filter((_, index) => index !== omitted).join("-")}`
    assert.equal(responseProjectPattern.test(malformed), false, `a 200 Project ID missing UUID segment ${omitted + 1} must be rejected`)
  }

  const codeEnums = (value) => {
    const schema = resolve(value)
    if (schema === undefined) return []
    const local = schema.properties?.error?.properties?.code?.enum
    if (local !== undefined) return local
    for (const branch of [...(schema.allOf ?? [])].reverse()) {
      const narrowed = codeEnums(branch)
      if (narrowed.length > 0) return narrowed
    }
    return (schema.oneOf ?? []).flatMap(codeEnums)
  }
  for (const [status, responseRef] of Object.entries(operation.responses)) {
    const response = resolve(responseRef)
    const requestId = resolve(response.headers?.["x-request-id"]?.schema)
    const cache = resolve(response.headers?.["Cache-Control"]?.schema)
    assert.equal(response.headers?.["x-request-id"]?.required, true, `${status} requires x-request-id`)
    assert.equal(requestId.type, "string")
    assert.equal(requestId.minLength, 1)
    assert.equal(requestId.maxLength, 128)
    assert.equal(response.headers?.["Cache-Control"]?.required, true, `${status} requires no-store`)
    assert.ok(cache.const === "no-store" || ((cache.enum ?? []).length === 1 && cache.enum[0] === "no-store"))
    if (status === "200") continue
    const codes = codeEnums(response.content?.["application/json"]?.schema)
    assert.ok(codes.length > 0, `${status} must narrow stable error codes, not reuse untyped ErrorEnvelope`)
    assert.equal(new Set(codes).size, codes.length)
  }
  assert.ok(codeEnums(resolve(operation.responses["404"]).content["application/json"].schema).includes("session_not_found"))
  assert.ok(codeEnums(resolve(operation.responses["409"]).content["application/json"].schema).includes("idempotency_conflict"))
  const retry = resolve(operation.responses["429"]).headers["Retry-After"]
  assert.equal(retry.required, false)
  assert.equal(new RegExp(retry.schema.pattern, "u").test("1"), true)
  assert.equal(new RegExp(retry.schema.pattern, "u").test("0"), false)
  assert.equal(new RegExp(retry.schema.pattern, "u").test("999999"), false)
})

test("R146 Move semantic gate rejects local drift without relaxing older operations", async () => {
  const { openapi, baseline } = await readContract()
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
  const moveStart = openapi.indexOf("  /v1/sessions/{id}/move:")
  const moveEnd = openapi.indexOf("  /v1/sessions/{id}/title:", moveStart)
  const requestStart = openapi.indexOf("    MoveSessionRequest:")
  const requestEnd = openapi.indexOf("    MoveSessionResponse:", requestStart)
  const successStart = requestEnd
  const successEnd = openapi.indexOf("    MoveSessionErrorResponse:", successStart)
  const responseStart = openapi.indexOf("    MoveSessionNotFound:")
  const responseEnd = openapi.indexOf("    MoveSessionConflict:", responseStart)
  assert.ok(
    moveStart >= 0 &&
      moveEnd > moveStart &&
      requestStart >= 0 &&
      requestEnd > requestStart &&
      successEnd > successStart &&
      responseStart >= 0 &&
      responseEnd > responseStart,
  )
  const replaceBlock = (start, end, oldText, newText) => {
    const block = openapi.slice(start, end)
    assert.ok(block.includes(oldText), `mutation marker missing: ${oldText}`)
    return `${openapi.slice(0, start)}${block.replace(oldText, newText)}${openapi.slice(end)}`
  }
  const mutations = [
    replaceBlock(moveStart, moveEnd, "operationId: moveSession", "operationId: moveConversationAlias"),
    replaceBlock(moveStart, moveEnd, "#/components/parameters/MoveSessionIdempotencyKey", "#/components/parameters/IdempotencyKey"),
    replaceBlock(moveStart, moveEnd, "'404': { $ref: '#/components/responses/MoveSessionNotFound' }", "'404': { $ref: '#/components/responses/NotFound' }"),
    replaceBlock(requestStart, requestEnd, "required: [target_project_id]", "required: []"),
    replaceBlock(requestStart, requestEnd, "additionalProperties: false", "additionalProperties: true"),
    replaceBlock(requestStart, requestEnd, "type: 'null'", "type: string"),
    replaceBlock(
      successStart,
      successEnd,
      "pattern: '^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'",
      "pattern: '^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'",
    ),
    replaceBlock(responseStart, responseEnd, "code: { type: string, enum: [session_not_found] }", "code: { type: string, enum: [idempotency_conflict] }"),
    openapi.replace("'200': { $ref: '#/components/responses/MoveSessionSuccess' }", "'200': { $ref: '#/components/responses/MoveSessionNotFound' }"),
  ]
  for (const [index, broken] of mutations.entries()) {
    assert.notEqual(broken, openapi)
    assert.ok(
      inspectBffOpenApi(broken, baseline).some((error) => /moveSession|MoveSession/u.test(error)),
      `Move mutation ${index} must fail closed`,
    )
  }
})

test("R240 rename contract remains one strict name PATCH beside the approved Billing read replacement", async () => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { openapi, baseline } = await readContract()
  const document = load(openapi)
  assert.equal(document.info.version, "8.10.0")
  const route = "/v1/projects/{projectId}/name"
  const path = document.paths[route]
  assert.ok(path)
  assert.deepEqual(Object.keys(path), ["parameters", "patch"])
  const priorPaths = { ...document.paths }
  priorPaths["/v1/projects/{projectId}"] = { ...priorPaths["/v1/projects/{projectId}"] }
  delete priorPaths["/v1/projects/{projectId}"].delete // R277 adds only the governed Project deletion command.
  delete priorPaths["/v1/projects/{projectId}/deletion"] // R277 separately governs the deletion status read.
  delete priorPaths[route]
  delete priorPaths["/v1/self/mcp/connectors"]
  delete priorPaths["/v1/self/mcp/connectors/{connector_id}"]
  delete priorPaths["/v1/self/mcp/connectors/{connector_id}/connections"]
  delete priorPaths["/v1/self/mcp/connections/{connection_id}"]
  delete priorPaths["/v1/mcp/connections"] // R257 adds only this independently governed read.
  delete priorPaths["/v1/self/skills"] // R266 separately governs managed personal Skill reads.
  delete priorPaths["/v1/self/skills/{skill_id}"]
  delete priorPaths["/v1/self/skills/{skill_id}/package"] // R342 separately governs managed package inspection.
  delete priorPaths["/v1/skill-installations/{installation_id}/package"] // R342 separately governs installed package inspection.
  delete priorPaths["/v1/self/skills/{skill_id}/versions"]
  delete priorPaths["/v1/self/skills/{skill_id}/withdraw"]
  delete priorPaths["/v1/preferences/personalization"] // R257 separately governs the new caller-owned CAS resource.
  delete priorPaths["/v1/admin/model-routing"] // R256 separately governs the current-tenant admin read.
  delete priorPaths["/v1/admin/model-labels"]
  delete priorPaths["/v1/admin/model-revisions"]
  delete priorPaths["/v1/admin/model-routing/{label_id}"]
  assert.equal(
    createHash("sha256").update(JSON.stringify(priorPaths)).digest("hex"),
    "0a609a0020b6a0d6914c585621275899cc4beece19240a94dd5092fa7f4006ba",
    "all non-rename path definitions stay byte-semantically frozen after the Billing read replacement",
  )
  assert.equal(
    baseline.filter(
      (item) =>
        ![
          "listSelfMcpConnections",
          "listPersonalMcpConnectors",
          "getPersonalMcpConnector",
          "listPersonalMcpConnections",
          "getPersonalMcpConnection",
          "listManagedPersonalSkills",
          "getManagedPersonalSkill",
          "getManagedPersonalSkillPackage",
          "getPersonalSkillInstallationPackage",
          "createPersonalSkillVersion",
          "withdrawPersonalSkill",
          "getSelfPersonalization",
          "replaceSelfPersonalization",
          "listAdminModelRouting",
          "listAdminModelLabels",
          "listAdminModelRevisions",
          "replaceAdminModelRouting",
          "deleteProject",
          "getProjectDeletion",
        ].includes(item.operation_id),
    ).length,
    92,
  )
  assert.deepEqual(
    baseline.filter((item) => item.operation_id === "renameProject"),
    [{ method: "PATCH", path: route, operation_id: "renameProject" }],
  )
  assert.equal(document.paths["/v1/projects/{projectId}"].patch.operationId, "updateProjectInstruction")
  const resolve = (value) => {
    if (!value?.$ref) return value
    const [, , section, name] = value.$ref.split("/")
    assert.ok(document.components[section]?.[name], value.$ref)
    return document.components[section][name]
  }
  const operation = path.patch
  for (const [key, value] of Object.entries({
    operationId: "renameProject",
    "x-kokoro-owner": "kokoro-bff",
    "x-kokoro-visibility": "public",
    "x-kokoro-stability": "beta",
    "x-kokoro-permission": "project.update",
    "x-kokoro-idempotency": "required",
  }))
    assert.equal(operation[key], value)
  const parameters = [...path.parameters, ...operation.parameters].map(resolve)
  assert.equal(parameters.length, 2)
  const id = parameters.find((item) => item.in === "path")
  assert.equal(id.name, "projectId")
  assert.equal(id.required, true)
  const canonical = "project_12345678-1234-1234-1234-123456789abc"
  const pattern = new RegExp(id.schema.pattern, "u")
  assert.equal(pattern.test(canonical), true)
  for (const invalid of ["project_slug", canonical.toUpperCase(), "project_12345678-1234-1234-123456789abc", ""]) assert.equal(pattern.test(invalid), false)
  const key = parameters.find((item) => item.in === "header")
  assert.equal(key.name, "Idempotency-Key")
  assert.equal(key.required, true)
  assert.equal(key.schema.minLength, 1)
  assert.equal(key.schema.maxLength, 128)
  assert.match(key.description, /exactly once/u)
  const keyPattern = new RegExp(key.schema.pattern, "u")
  assert.equal(keyPattern.test("A".repeat(128)), true)
  for (const invalid of ["", "A".repeat(129), " ", "a,b", "a\tb", "a\nb", "中文"]) assert.equal(keyPattern.test(invalid), false)
  assert.equal(operation.requestBody.required, true)
  assert.deepEqual(Object.keys(operation.requestBody.content), ["application/json"])
  const request = resolve(operation.requestBody.content["application/json"].schema)
  assert.equal(request.type, "object")
  assert.equal(request.additionalProperties, false)
  assert.deepEqual(request.required, ["name"])
  assert.deepEqual(Object.keys(request.properties), ["name"])
  const name = request.properties.name
  assert.equal(name.type, "string")
  assert.equal(name.maxLength, undefined, "the bound applies after trim, not to raw code points")
  assert.match(name.description, /ECMAScript trim/u)
  assert.match(name.description, /1\.\.160 UTF-16 code units/u)
  assert.match(name.description, /U\+0000/u)
  const namePattern = new RegExp(name.pattern, "u")
  assert.equal(namePattern.test("a\u0000b"), false)
  for (const valid of [" 中文 ", "x".repeat(160), "😀".repeat(80), ` ${"x".repeat(160)} `]) assert.equal(namePattern.test(valid), true)
  // JSON Schema cannot model trim plus UTF-16 length: these are semantic clauses,
  // not a fake parser implementation or evidence that the runtime endpoint exists.
  for (const clause of [
    /65536/u,
    /duplicate JSON keys/u,
    /no query/u,
    /current IAM/u,
    /last legal serialized commit/u,
    /no-op/u,
    /old key/u,
    /unknown COMMIT/u,
  ])
    assert.match(operation.description, clause)
  const statuses = ["200", "400", "401", "403", "404", "409", "429", "503"]
  assert.deepEqual(Object.keys(operation.responses).sort(), statuses)
  const success = resolve(resolve(operation.responses["200"]).content["application/json"].schema)
  assert.equal(success.additionalProperties, false)
  assert.deepEqual(success.required, ["data"])
  assert.deepEqual(Object.keys(success.properties), ["data"])
  assert.equal(success.properties.data.additionalProperties, false)
  assert.deepEqual(success.properties.data.required, ["project_id", "name"])
  assert.deepEqual(Object.keys(success.properties.data.properties), ["project_id", "name"])
  assert.equal(success.properties.data.properties.project_id.pattern, id.schema.pattern)
  assert.equal(success.properties.data.properties.name.minLength, 1)
  assert.equal(success.properties.data.properties.name.maxLength, 160)
  const error = document.components.schemas.RenameProjectErrorResponse
  assert.equal(error.additionalProperties, false)
  assert.deepEqual(error.required, ["error"])
  assert.deepEqual(Object.keys(error.properties), ["error"])
  assert.equal(error.properties.error.additionalProperties, false)
  assert.deepEqual(error.properties.error.required, ["code", "message", "retryable"])
  assert.deepEqual(Object.keys(error.properties.error.properties), ["code", "message", "retryable"])
  const codes = {
    400: ["invalid_project_rename", "idempotency_key_required"],
    401: ["session_authentication_required", "session_invalid"],
    403: ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"],
    404: ["project_not_found"],
    409: ["idempotency_conflict"],
    429: ["session_rate_limited"],
    503: ["business_store_unavailable", "iam_admission_unavailable", "product_tenant_not_configured"],
  }
  assert.deepEqual(error.properties.error.properties.code.enum, Object.values(codes).flat())
  for (const status of statuses) {
    const response = resolve(operation.responses[status])
    assert.deepEqual(response.headers["x-request-id"], {
      required: true,
      schema: { type: "string", minLength: 1, maxLength: 128 },
    })
    assert.deepEqual(response.headers["Cache-Control"], {
      required: true,
      schema: { type: "string", const: "no-store" },
    })
    if (status === "200") continue
    const schema = response.content["application/json"].schema
    assert.equal(schema.allOf[0].$ref, "#/components/schemas/RenameProjectErrorResponse")
    const narrowed = schema.allOf[1].properties.error.properties
    assert.deepEqual(narrowed.code.enum, codes[status])
    assert.equal(narrowed.retryable.const, status === "429" || status === "503")
  }
  const retry = resolve(operation.responses["429"]).headers["Retry-After"]
  assert.equal(retry.required, false)
  assert.equal(new RegExp(retry.schema.pattern, "u").test("86400"), true)
  for (const invalid of ["0", "86401", "99999", "-1", "1.2", "1\n"]) assert.equal(new RegExp(retry.schema.pattern, "u").test(invalid), false)
})

test("R240 rename semantic gate rejects input, receipt, status and header drift", async () => {
  const { openapi, baseline } = await readContract()
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
  const mutate = (startMarker, endMarker, before, after) => {
    const start = openapi.indexOf(startMarker)
    const end = openapi.indexOf(endMarker, start + startMarker.length)
    assert.ok(start >= 0 && end > start, startMarker)
    const block = openapi.slice(start, end)
    assert.ok(block.includes(before), before)
    return openapi.slice(0, start) + block.replace(before, after) + openapi.slice(end)
  }
  const route = (before, after) => mutate("  /v1/projects/{projectId}/name:", "  /v1/projects/{projectId}:", before, after)
  const request = (before, after) => mutate("    RenameProjectRequest:", "    RenameProjectResponse:", before, after)
  const success = (before, after) => mutate("    RenameProjectResponse:", "    RenameProjectErrorResponse:", before, after)
  const mutations = [
    openapi.replace("  version: 8.10.0", "  version: 7.1.0"),
    route("    patch:", "    post:"),
    route("operationId: renameProject", "operationId: renameProjectAlias"),
    route("x-kokoro-permission: project.update", "x-kokoro-permission: project.read"),
    route("#/components/parameters/RenameProjectIdempotencyKey", "#/components/parameters/IdempotencyKey"),
    route("#/components/parameters/RenameProjectId", "#/components/parameters/ProjectId"),
    route("required: true", "required: false"),
    route("'409': { $ref: '#/components/responses/RenameProjectConflict' }", "'409': { $ref: '#/components/responses/Conflict' }"),
    request("required: [name]", "required: []"),
    request("additionalProperties: false", "additionalProperties: true"),
    request("type: string", "type: integer"),
    request("type: string", "type: string\n          maxLength: 160"),
    request("pattern: '^[^\\u0000]*$'", "pattern: '^.*$'"),
    success("required: [project_id, name]", "required: [project_id]"),
    success("additionalProperties: false", "additionalProperties: true"),
    success("          project_id:", "          slug:"),
    mutate("    RenameProjectIdempotencyKey:", "    ProjectId:", "maxLength: 128", "maxLength: 129"),
    mutate("    RenameProjectErrorResponse:", "    MoveSessionRequest:", "required: [error]", "required: [error, meta]"),
    mutate(
      "    RenameProjectUnavailable:",
      "    MoveSessionSuccess:",
      "business_store_unavailable, iam_admission_unavailable, product_tenant_not_configured",
      "business_store_unavailable, iam_admission_unavailable",
    ),
    mutate(
      "    RenameProjectConflict:",
      "    RenameProjectRateLimited:",
      "retryable: { type: boolean, const: false }",
      "retryable: { type: boolean, const: true }",
    ),
    mutate("    RenameProjectRateLimited:", "    RenameProjectUnavailable:", "86400", "99999"),
    // Strict envelopes belong only to rename; older operation envelopes retain their contracts.
    openapi.replace("'200': { $ref: '#/components/responses/MoveSessionSuccess' }", "'200': { $ref: '#/components/responses/RenameProjectSuccess' }"),
  ]
  const responseNames = ["Success", "BadRequest", "Unauthorized", "Forbidden", "NotFound", "Conflict", "RateLimited", "Unavailable"]
  for (const [index, name] of responseNames.entries()) {
    const start = `    RenameProject${name}:`
    const end = index === responseNames.length - 1 ? "    MoveSessionSuccess:" : `    RenameProject${responseNames[index + 1]}:`
    mutations.push(mutate(start, end, "x-request-id: { required: true", "x-request-id: { required: false"))
    mutations.push(mutate(start, end, "const: no-store", "const: public"))
  }
  for (const [index, broken] of mutations.entries()) {
    assert.notEqual(broken, openapi)
    assert.ok(
      inspectBffOpenApi(broken, baseline).some((error) => /renameProject|RenameProject/u.test(error)),
      `rename mutation ${index} must fail closed`,
    )
  }
})

test("R257 self MCP connection contract rejects Server substitution and error-profile widening", async () => {
  const { openapi, baseline } = await readContract()
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
  const start = openapi.indexOf("  /v1/mcp/connections:\n")
  const end = openapi.indexOf("  /v1/mcp/servers:\n", start)
  const route = openapi.slice(start, end)
  assert.equal(baseline.length, 111)
  assert.deepEqual(
    baseline.filter((item) => item.operation_id === "listSelfMcpConnections"),
    [
      {
        method: "GET",
        path: "/v1/mcp/connections",
        operation_id: "listSelfMcpConnections",
      },
    ],
  )
  assert.match(route, /operationId: listSelfMcpConnections/u)
  assert.match(route, /name: connection_id/u)
  assert.doesNotMatch(route, /post:|requestBody:/u)
  for (const broken of [
    openapi.replace(route, route.replace("McpConnectionListResponse", "McpServerListResponse")),
    openapi.replace(route, route.replace("McpConnectionReadBadGateway", "PlatformProjectionReadBadGateway")),
    openapi.replace(
      "required: [connection_id, connector_id, server_id, provider_key, transport, status]",
      "required: [server_id, provider_key, transport, status]",
    ),
    openapi.replace(
      "status: { type: string, enum: [active] }\n    McpConnectionListResponse:",
      "status: { type: string, enum: [registered] }\n    McpConnectionListResponse:",
    ),
    openapi.replace("next_cursor: { type: string, minLength: 1, maxLength: 2048 }", "next_cursor: { type: [string, 'null'] }"),
  ]) {
    assert.notEqual(broken, openapi)
    assert.notDeepEqual(inspectBffOpenApi(broken, baseline), [])
  }
})

test("current administrator projection rejects missing, optional, nullable and non-boolean public contracts", async () => {
  const { openapi, baseline } = await readContract()
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
  const field = "        platform_admin: { type: boolean }"
  assert.ok(openapi.includes(field))
  for (const changed of [
    openapi.replace("required: [user_id, tenant_id, platform_admin]", "required: [user_id, tenant_id]"),
    openapi.replace(field, ""),
    openapi.replace(field, "        platform_admin: { type: string }"),
    openapi.replace(field, "        platform_admin: { type: boolean, nullable: true }"),
  ]) {
    assert.ok(inspectBffOpenApi(changed, baseline).some((error) => error.includes("CurrentUserIdentity")))
  }
})

test("R257 personalization contract binds the two exact closed caller operations and safe CAS", async () => {
  const { openapi, baseline } = await readContract()
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
  for (const [before, after, expected] of [
    ["expected_revision: { type: integer, minimum: 0, maximum: 9007199254740991 }", "expected_revision: { type: integer, minimum: 0 }", /safe integer CAS/u],
    [
      "required: [expected_revision, nickname, occupation, about, instructions]",
      "required: [nickname, occupation, about, instructions]",
      /closed and complete/u,
    ],
    ["nickname: { type: string, maxLength: 128", "nickname: { type: string, maxLength: 129", /nickname/u],
    ["revision: { type: integer, const: 0 }", "revision: { type: integer, minimum: 0 }", /null\/zero/u],
    ["PersonalizationReadSuccess'", "PersonalizationSaveSuccess'", /component drifted/u],
  ]) {
    assert.ok(openapi.includes(before), before)
    assert.match(inspectBffOpenApi(openapi.replace(before, after), baseline).join("\n"), expected)
  }
  const begin = openapi.indexOf("    PersonalizationReadSuccess:")
  const end = openapi.indexOf("\n    PersonalizationSaveSuccess:", begin)
  const block = openapi.slice(begin, end)
  const broken = openapi.replace(block, block.replace("const: no-store", "const: public"))
  assert.match(inspectBffOpenApi(broken, baseline).join("\n"), /strict schema and headers/u)
})

test("R256 admin model routing publishes closed pages, bounded CAS and exact transport profiles", async () => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { openapi } = await readContract()
  const document = load(openapi)
  const operations = [
    document.paths["/v1/admin/model-routing"].get,
    document.paths["/v1/admin/model-labels"].get,
    document.paths["/v1/admin/model-revisions"].get,
    document.paths["/v1/admin/model-routing/{label_id}"].put,
  ]
  assert.deepEqual(
    operations.map((operation) => operation.operationId),
    ["listAdminModelRouting", "listAdminModelLabels", "listAdminModelRevisions", "replaceAdminModelRouting"],
  )
  for (const operation of operations.slice(0, 3)) {
    const limit = operation.parameters.find((parameter) => parameter.$ref.endsWith("/AdminModelRoutingLimit"))
    assert.ok(limit)
    assert.deepEqual(Object.keys(operation.responses), ["200", "400", "401", "403", "429", "502", "503"])
  }
  assert.deepEqual(document.components.parameters.AdminModelRoutingLimit.schema, { type: "integer", minimum: 1, maximum: 100, default: 50 })
  assert.deepEqual(document.components.parameters.AdminModelRoutingCursor.schema, { type: "string", minLength: 1, maxLength: 2048 })
  assert.equal(document.components.parameters.AdminModelRoutingIdempotencyKey.schema.minLength, 1)
  assert.equal(document.components.parameters.AdminModelRoutingIdempotencyKey.schema.maxLength, 128)
  for (const schema of ["AdminModelRoutingListResponse", "AdminModelLabelListResponse", "AdminModelRevisionListResponse"]) {
    assert.equal(document.components.schemas[schema].properties.data.type, "array")
    assert.equal(document.components.schemas[schema].additionalProperties, false)
  }
  assert.equal(document.components.schemas.AdminModelRoutingWrite.properties.priority.minimum, 0)
  assert.equal(document.components.schemas.AdminModelRoutingWrite.properties.priority.maximum, 100000)
  assert.deepEqual(Object.keys(operations[3].responses), ["200", "400", "401", "403", "404", "409", "428", "429", "502", "503"])
  for (const responseName of [
    "AdminModelRoutingListSuccess",
    "AdminModelRoutingBadRequest",
    "AdminModelRoutingRateLimited",
    "AdminModelRoutingInvalidResponse",
    "AdminModelRoutingUnavailable",
  ]) {
    const response = document.components.responses[responseName]
    assert.equal(response.headers["x-request-id"].required, true)
    assert.equal(response.headers["Cache-Control"].required, true)
    assert.equal(response.headers["Cache-Control"].schema.const, "no-store")
  }
  const errorCodes = (responseName) =>
    document.components.responses[responseName].content["application/json"].schema.allOf[1].properties.error.properties.code.enum
  assert.deepEqual(errorCodes("AdminModelRoutingUnauthorized"), ["session_authentication_required", "session_invalid"])
  assert.deepEqual(errorCodes("AdminModelRoutingForbidden"), [
    "service_auth_failed",
    "product_tenant_forbidden",
    "session_forbidden",
    "admin_model_routing_forbidden",
  ])
  assert.deepEqual(errorCodes("AdminModelRoutingUnavailable"), [
    "product_tenant_not_configured",
    "iam_admission_unavailable",
    "admin_model_routing_unavailable",
  ])
  const reject = (mutated) => {
    const candidate = load(mutated)
    return (
      candidate.components.schemas.AdminModelRoutingListResponse.properties.data.type !== "array" ||
      candidate.components.parameters.AdminModelRoutingLimit.schema.default !== 50 ||
      candidate.components.schemas.AdminModelRoutingWrite.properties.priority.maximum !== 100000 ||
      candidate.paths["/v1/admin/model-routing"].get.responses["502"] === undefined
    )
  }
  for (const mutated of [
    openapi.replace(
      "        data:\n          type: array\n          items:\n            $ref: '#/components/schemas/AdminModelRouting'",
      "        data:\n          type: object",
    ),
    openapi.replace(
      "AdminModelRoutingLimit:\n      name: limit\n      in: query\n      required: false\n      schema:\n        type: integer\n        minimum: 1\n        maximum: 100\n        default: 50",
      "AdminModelRoutingLimit:\n      name: limit\n      in: query\n      required: false\n      schema:\n        type: integer\n        minimum: 1\n        maximum: 100\n        default: 20",
    ),
    openapi.replace(
      "        priority:\n          type: integer\n          minimum: 0\n          maximum: 100000",
      "        priority:\n          type: integer",
    ),
    openapi.replace("        '502':\n          $ref: '#/components/responses/AdminModelRoutingInvalidResponse'\n", ""),
  ])
    assert.equal(reject(mutated), true)
})

test("R266 managed personal Skill contract rejects route, envelope, status-code and Retry-After drift", async () => {
  const { openapi, baseline } = await readContract()
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
  const mutate = (startMarker, endMarker, before, after) => {
    const start = openapi.indexOf(startMarker)
    const end = endMarker === "" ? openapi.length : openapi.indexOf(endMarker, start + startMarker.length)
    assert.ok(start >= 0 && end > start, startMarker)
    const block = openapi.slice(start, end)
    assert.ok(block.includes(before), before)
    return openapi.slice(0, start) + block.replace(before, after) + openapi.slice(end)
  }
  const listRoute = (before, after) => mutate("  /v1/self/skills:\n", "  /v1/self/skills/{skill_id}:\n", before, after)
  const detailRoute = (before, after) => mutate("  /v1/self/skills/{skill_id}:\n", "  /v1/skills:\n", before, after)
  const error = (before, after) => mutate("    ManagedPersonalSkillErrorResponse:\n", "    PublishedPersonalSkillResource:\n", before, after)
  const response = (name, next, before, after) =>
    mutate(
      `    ManagedPersonalSkill${name}:\n`,
      next === "PublishedPersonalSkillOk" ? "    PublishedPersonalSkillOk:\n" : `    ManagedPersonalSkill${next}:\n`,
      before,
      after,
    )
  const mutations = [
    listRoute("operationId: listManagedPersonalSkills", "operationId: listSkills"),
    detailRoute("    get:", "    post:"),
    listRoute("x-kokoro-permission: product.skill.read_managed_personal", "x-kokoro-permission: capability.skill.read"),
    listRoute(
      "'429': { $ref: '#/components/responses/ManagedPersonalSkillRateLimited' }",
      "'429': { $ref: '#/components/responses/PlatformProjectionReadRateLimited' }",
    ),
    detailRoute("'404': { $ref: '#/components/responses/ManagedPersonalSkillNotFound' }", "'404': { $ref: '#/components/responses/NotFound' }"),
    error("required: [error, meta]", "required: [error]"),
    error("additionalProperties: false", "additionalProperties: true"),
    error("        meta: { $ref: '#/components/schemas/RequestMeta' }", "        retryable: { type: boolean }"),
    response("BadRequest", "Unauthorized", "enum: [invalid_skill_request]", "enum: [invalid_query_parameter]"),
    response("RateLimited", "BadGateway", "enum: [session_rate_limited]", "enum: [session_rate_limited, skill_rate_limited]"),
    response("BadGateway", "Unavailable", "enum: [skill_response_invalid]", "enum: [skill_dependency_unavailable]"),
    response(
      "Unavailable",
      "PublishedPersonalSkillOk",
      "product_tenant_not_configured, iam_admission_unavailable, skill_dependency_unavailable",
      "product_tenant_not_configured, skill_dependency_unavailable",
    ),
    response("ListOk", "DetailOk", "required: true", "required: false"),
  ]
  for (const [index, broken] of mutations.entries()) {
    assert.notEqual(broken, openapi)
    assert.ok(
      inspectBffOpenApi(broken, baseline).some((message) => /managed personal Skill|ManagedPersonalSkill/u.test(message)),
      `managed mutation ${index} must fail closed`,
    )
  }
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const document = load(openapi)
  const pattern = document.components.responses.ManagedPersonalSkillRateLimited.headers["Retry-After"].schema.pattern
  const retry = new RegExp(pattern, "u")
  for (const valid of ["1", "86400"]) assert.equal(retry.test(valid), true, valid)
  for (const invalid of ["0", "86401", "99999", "1\n"]) assert.equal(retry.test(invalid), false, JSON.stringify(invalid))
})

test("R267 createPersonalSkillVersion publishes one governed strict personal version command", async () => {
  const { openapi, baseline } = await readContract()
  const operation = baseline.find(
    ({ method, path, operation_id }) => method === "POST" && path === "/v1/self/skills/{skill_id}/versions" && operation_id === "createPersonalSkillVersion",
  )
  assert.ok(operation, "createPersonalSkillVersion must be registered in the operation inventory")
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const document = load(openapi)
  const route = document.paths?.["/v1/self/skills/{skill_id}/versions"]?.post
  assert.ok(route, "createPersonalSkillVersion route must exist")
  assert.equal(route.operationId, "createPersonalSkillVersion")
  assert.equal(route["x-kokoro-owner"], "kokoro-bff")
  assert.equal(route["x-kokoro-visibility"], "public")
  assert.equal(route["x-kokoro-stability"], "beta")
  assert.equal(route["x-kokoro-permission"], "product.skill.manage_personal")
  assert.ok(route.parameters.some(({ $ref }) => $ref === "#/components/parameters/CreatePersonalSkillVersionIdempotencyKey"))
  const requestRef = route.requestBody?.content?.["application/json"]?.schema?.$ref
  assert.equal(requestRef, "#/components/schemas/CreatePersonalSkillVersionRequest")
  const request = document.components.schemas.CreatePersonalSkillVersionRequest
  assert.deepEqual(request.required, ["display_name", "summary", "tags"])
  assert.equal(request.additionalProperties, false)
  assert.deepEqual(Object.keys(request.properties), ["example_prompts", "display_name", "summary", "tags"])
  const responseRef = route.responses?.["201"]?.content?.["application/json"]?.schema?.$ref
  assert.equal(responseRef, "#/components/schemas/CreatePersonalSkillVersionResponse")
  const resource = document.components.schemas.CreatePersonalSkillVersionResource
  assert.deepEqual(resource.required, ["skill_id", "series_id", "revision", "status", "replayed"])
  assert.equal(resource.additionalProperties, false)
  assert.equal(resource.properties.status.const, "draft")
  assert.equal(resource.properties.revision.type, "string")
  const revision = new RegExp(resource.properties.revision.pattern, "u")
  for (const valid of ["2", "18446744073709540000", "18446744073709550000", "18446744073709551615"]) assert.equal(revision.test(valid), true, valid)
  for (const invalid of ["0", "1", "01", "-2", "2.0", "2\n", "18446744073709551616"]) assert.equal(revision.test(invalid), false, JSON.stringify(invalid))
})

test("R267 withdrawPersonalSkill publishes one governed strict personal withdrawal command", async () => {
  const { openapi, baseline } = await readContract()
  const operation = baseline.find(
    ({ method, path, operation_id }) => method === "POST" && path === "/v1/self/skills/{skill_id}/withdraw" && operation_id === "withdrawPersonalSkill",
  )
  assert.ok(operation, "withdrawPersonalSkill must be registered in the operation inventory")
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const document = load(openapi)
  const route = document.paths?.["/v1/self/skills/{skill_id}/withdraw"]?.post
  assert.ok(route, "withdrawPersonalSkill route must exist")
  assert.equal(route.operationId, "withdrawPersonalSkill")
  assert.equal(route["x-kokoro-owner"], "kokoro-bff")
  assert.equal(route["x-kokoro-visibility"], "public")
  assert.equal(route["x-kokoro-stability"], "beta")
  assert.equal(route["x-kokoro-permission"], "product.skill.manage_personal")
  assert.ok(route.parameters.some(({ $ref }) => $ref === "#/components/parameters/WithdrawPersonalSkillIdempotencyKey"))
  const requestRef = route.requestBody?.content?.["application/json"]?.schema?.$ref
  assert.equal(requestRef, "#/components/schemas/WithdrawPersonalSkillRequest")
  const request = document.components.schemas.WithdrawPersonalSkillRequest
  assert.deepEqual(request.required, ["reason"])
  assert.equal(request.additionalProperties, false)
  assert.deepEqual(Object.keys(request.properties), ["reason"])
  assert.equal(request.properties.reason.minLength, 1)
  assert.equal(request.properties.reason.maxLength, 2048)
  const reason = new RegExp(request.properties.reason.pattern, "u")
  for (const valid of ["kept", " kept ", "\nlegitimate"]) assert.equal(reason.test(valid), true, JSON.stringify(valid))
  for (const invalid of ["", "   ", "\n\t"]) assert.equal(reason.test(invalid), false, JSON.stringify(invalid))
  const responseRef = route.responses?.["200"]?.content?.["application/json"]?.schema?.$ref
  assert.equal(responseRef, "#/components/schemas/WithdrawPersonalSkillResponse")
  const resource = document.components.schemas.WithdrawPersonalSkillResource
  assert.deepEqual(resource.required, ["source_ref", "status", "event_id", "replayed"])
  assert.equal(resource.additionalProperties, false)
  assert.equal(resource.properties.status.const, "withdrawn")
  assert.equal(resource.properties.event_id.pattern, "^evt:[a-f0-9]{64}$")
  const errorResponses = {
    400: "BadRequest",
    401: "Unauthorized",
    403: "Forbidden",
    404: "NotFound",
    409: "Conflict",
    412: "PreconditionFailed",
    413: "PayloadTooLarge",
    429: "RateLimited",
    502: "BadGateway",
    503: "Unavailable",
  }
  for (const [status, suffix] of Object.entries(errorResponses))
    assert.equal(route.responses?.[status]?.$ref, `#/components/responses/PersonalSkillLifecycle${suffix}`)
})

test("R267 personal Skill lifecycle schemas reject boundary and closed-envelope drift", async () => {
  const { openapi, baseline } = await readContract()
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
  const mutate = (startMarker, endMarker, before, after) => {
    const start = openapi.indexOf(startMarker)
    const end = openapi.indexOf(endMarker, start + startMarker.length)
    assert.ok(start >= 0 && end > start, startMarker)
    const block = openapi.slice(start, end)
    assert.ok(block.includes(before), before)
    return openapi.slice(0, start) + block.replace(before, after) + openapi.slice(end)
  }
  const mutations = [
    mutate(
      "    CreatePersonalSkillVersionRequest:\n",
      "    CreatePersonalSkillVersionResource:\n",
      "required: [display_name, summary, tags]",
      "required: [summary, tags]",
    ),
    mutate(
      "    CreatePersonalSkillVersionResource:\n",
      "    CreatePersonalSkillVersionResponse:\n",
      "status: { type: string, const: draft }",
      "status: { type: string, const: active }",
    ),
    mutate(
      "    WithdrawPersonalSkillResource:\n",
      "    WithdrawPersonalSkillResponse:\n",
      "event_id: { type: string, pattern: '^evt:[a-f0-9]{64}$' }",
      "event_id: { type: string }",
    ),
    mutate("    PersonalSkillLifecycleErrorResponse:\n", "  responses:\n", "required: [error, meta]", "required: [error, meta, retryable]"),
    mutate(
      "  /v1/self/skills/{skill_id}/withdraw:\n",
      "components:\n",
      "'429': { $ref: '#/components/responses/PersonalSkillLifecycleRateLimited' }",
      "'429': { $ref: '#/components/responses/PlatformProjectionReadRateLimited' }",
    ),
  ]
  for (const broken of mutations) {
    assert.notEqual(broken, openapi)
    assert.ok(inspectBffOpenApi(broken, baseline).some((message) => /personal Skill lifecycle/u.test(message)))
  }
})

test("R267 final lifecycle path stops at the real top-level components boundary", async () => {
  const { openapi, baseline } = await readContract()
  const withdrawStart = openapi.indexOf("  /v1/self/skills/{skill_id}/withdraw:\n")
  const componentsStart = openapi.indexOf("components:\n", withdrawStart)
  assert.ok(withdrawStart >= 0 && componentsStart > withdrawStart)
  assert.equal(openapi.slice(withdrawStart, componentsStart).includes("'503': { $ref: '#/components/responses/PersonalSkillLifecycleUnavailable' }"), true)
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
})

test("R267 final lifecycle path rejects a 503 response drift before components", async () => {
  const { openapi, baseline } = await readContract()
  const withdrawStart = openapi.indexOf("  /v1/self/skills/{skill_id}/withdraw:\n")
  const componentsStart = openapi.indexOf("components:\n", withdrawStart)
  assert.ok(withdrawStart >= 0 && componentsStart > withdrawStart)
  const route = openapi.slice(withdrawStart, componentsStart)
  const expected = "'503': { $ref: '#/components/responses/PersonalSkillLifecycleUnavailable' }"
  assert.equal(route.includes(expected), true)
  const brokenRoute = route.replace(expected, "'503': { $ref: '#/components/responses/PersonalSkillLifecycleBadGateway' }")
  assert.notEqual(brokenRoute, route)
  const broken = openapi.slice(0, withdrawStart) + brokenRoute + openapi.slice(componentsStart)
  assert.ok(inspectBffOpenApi(broken, baseline).some((message) => message === "personal Skill lifecycle withdrawPersonalSkill 503 response drifted"))
})

function inspectR277ProjectDeletion(document) {
  const errors = []
  const require = (condition, message) => {
    if (!condition) errors.push(message)
  }
  const resolve = (value) => {
    if (!value?.$ref) return value
    const [, , section, name] = value.$ref.split("/")
    return document.components?.[section]?.[name]
  }
  const responseSchema = (response) => resolve(response)?.content?.["application/json"]?.schema
  const requiredHeader = (response, name) => {
    const header = resolve(response)?.headers?.[name]
    return header?.required === true ? header : undefined
  }
  const errorCodes = (response) => {
    const schema = responseSchema(response)
    const constrained = schema?.allOf?.[1] ?? schema
    if (Array.isArray(constrained?.oneOf)) return constrained.oneOf.map((entry) => entry?.properties?.error?.properties?.code?.const)
    return constrained?.properties?.error?.properties?.code?.enum
  }
  const errorRetryable = (response) => {
    const schema = responseSchema(response)
    return schema?.allOf?.[1]?.properties?.error?.properties?.retryable?.const
  }

  require(document.info?.version === "8.10.0", "R277 public info.version must be 8.10.0")
  const projectPath = document.paths?.["/v1/projects/{projectId}"]
  const statusPath = document.paths?.["/v1/projects/{projectId}/deletion"]
  const deletion = projectPath?.delete
  const status = statusPath?.get
  require(deletion?.operationId === "deleteProject", "R277 deleteProject operation is missing")
  require(status?.operationId === "getProjectDeletion", "R277 getProjectDeletion operation is missing")
  require(Object.keys(statusPath ?? {}).join(",") === "parameters,get", "R277 deletion status path must expose only parameters and GET")
  require(projectPath?.parameters?.some(({ $ref }) => $ref === "#/components/parameters/ProjectId"), "R277 existing Project path parameter drifted")
  require(deletion?.parameters?.some(({ $ref }) => $ref === "#/components/parameters/ProjectDeletionId") &&
    statusPath?.parameters?.some(
      ({ $ref }) => $ref === "#/components/parameters/ProjectDeletionId",
    ), "R277 both new operations must use the canonical ProjectDeletionId override")

  for (const [operation, name, permission, idempotency] of [
    [deletion, "deleteProject", "project.update", "required"],
    [status, "getProjectDeletion", "project.read", "none"],
  ]) {
    require(operation?.["x-kokoro-owner"] === "kokoro-bff", `R277 ${name} owner drifted`)
    require(operation?.["x-kokoro-visibility"] === "public", `R277 ${name} visibility drifted`)
    require(operation?.["x-kokoro-stability"] === "beta", `R277 ${name} stability drifted`)
    require(operation?.["x-kokoro-permission"] === permission, `R277 ${name} permission drifted`)
    require(operation?.["x-kokoro-idempotency"] === idempotency, `R277 ${name} idempotency drifted`)
  }
  require(deletion?.requestBody === undefined, "R277 deleteProject must not publish a request body")
  require(status?.requestBody === undefined, "R277 getProjectDeletion must not publish a request body")
  require(deletion?.parameters?.some(
    ({ $ref }) => $ref === "#/components/parameters/ProjectDeletionIdempotencyKey",
  ), "R277 deleteProject must require its operation-specific Idempotency-Key")
  const key = document.components?.parameters?.ProjectDeletionIdempotencyKey
  require(key?.name === "Idempotency-Key" && key?.in === "header" && key?.required === true, "R277 deletion key header drifted")
  require(key?.schema?.minLength === 1 && key?.schema?.maxLength === 128, "R277 deletion key bounds drifted")
  require(key?.schema?.type === "string" && typeof key?.schema?.pattern === "string", "R277 deletion key type/pattern drifted")
  require(key?.schema?.pattern === "^[\\x21-\\x2B\\x2D-\\x7E]{1,128}(?![\\s\\S])", "R277 deletion key absolute pattern drifted")
  if (key?.schema?.pattern) {
    const keyPattern = new RegExp(key.schema.pattern, "u")
    for (const valid of ["a", "A".repeat(128), "project-delete:01"]) require(keyPattern.test(valid), `R277 valid key rejected: ${valid}`)
    for (const invalid of ["", "A".repeat(129), " ", "a,b", "a\tb", "a\nb", "中文"])
      require(!keyPattern.test(invalid), `R277 invalid key accepted: ${JSON.stringify(invalid)}`)
  }
  const id = document.components?.parameters?.ProjectDeletionId
  require(id?.name === "projectId" && id?.in === "path" && id?.required === true, "R277 ProjectDeletionId placement drifted")
  require(id?.schema?.type === "string" && typeof id?.schema?.pattern === "string", "R277 ProjectDeletionId type/pattern drifted")
  require(id?.schema?.pattern ===
    "^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\\s\\S])", "R277 ProjectDeletionId absolute pattern drifted")
  if (id?.schema?.pattern) {
    const idPattern = new RegExp(id.schema.pattern, "u")
    const canonical = "project_12345678-1234-1234-1234-123456789abc"
    require(idPattern.test(canonical), "R277 canonical Project ID rejected")
    for (const invalid of ["project_slug", canonical.toUpperCase(), `${canonical}\n`, ` ${canonical}`, ""])
      require(!idPattern.test(invalid), `R277 invalid Project ID accepted: ${JSON.stringify(invalid)}`)
  }

  const expectedDeleteResponses = {
    202: "ProjectDeletionAccepted",
    400: "ProjectDeletionBadRequest",
    401: "ProjectDeletionUnauthorized",
    403: "ProjectDeletionForbidden",
    404: "ProjectDeletionNotFound",
    409: "ProjectDeletionConflict",
    429: "ProjectDeletionRateLimited",
    503: "ProjectDeletionUnavailable",
  }
  const expectedStatusResponses = {
    200: "ProjectDeletionStatusSuccess",
    400: "ProjectDeletionStatusBadRequest",
    401: "ProjectDeletionUnauthorized",
    403: "ProjectDeletionForbidden",
    404: "ProjectDeletionNotFound",
    429: "ProjectDeletionRateLimited",
    503: "ProjectDeletionUnavailable",
  }
  for (const [operation, expected, name] of [
    [deletion, expectedDeleteResponses, "deleteProject"],
    [status, expectedStatusResponses, "getProjectDeletion"],
  ]) {
    require(JSON.stringify(Object.keys(operation?.responses ?? {})) === JSON.stringify(Object.keys(expected)), `R277 ${name} status set drifted`)
    for (const [code, component] of Object.entries(expected))
      require(operation?.responses?.[code]?.$ref === `#/components/responses/${component}`, `R277 ${name} ${code} response drifted`)
  }

  for (const name of new Set([...Object.values(expectedDeleteResponses), ...Object.values(expectedStatusResponses)])) {
    const response = document.components?.responses?.[name]
    const requestId = requiredHeader(response, "x-request-id")
    require(requestId?.schema?.type === "string" &&
      requestId.schema.minLength === 1 &&
      requestId.schema.maxLength === 128, `R277 ${name} must require a bounded nonempty string x-request-id`)
    require(requiredHeader(response, "Cache-Control")?.schema?.const === "no-store", `R277 ${name} must require no-store`)
    if (!["ProjectDeletionAccepted", "ProjectDeletionStatusSuccess"].includes(name))
      require(responseSchema(response)?.allOf?.[0]?.$ref ===
        "#/components/schemas/ProjectDeletionErrorResponse", `R277 ${name} must retain the ProjectDeletionErrorResponse base`)
  }
  const accepted = document.components?.responses?.ProjectDeletionAccepted
  require(requiredHeader(accepted, "Location") !== undefined, "R277 202 must require Location")
  require(requiredHeader(accepted, "Location")?.schema?.pattern ===
    "^/v1/projects/project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/deletion(?![\\s\\S])", "R277 202 Location must identify the canonical deletion resource")
  if (requiredHeader(accepted, "Location")?.schema?.pattern) {
    const locationPattern = new RegExp(requiredHeader(accepted, "Location").schema.pattern, "u")
    const valid = "/v1/projects/project_12345678-1234-1234-1234-123456789abc/deletion"
    require(locationPattern.test(valid), "R277 canonical Location rejected")
    for (const invalid of [`${valid}\n`, `${valid}/`, "/v1/projects/project_slug/deletion"])
      require(!locationPattern.test(invalid), `R277 invalid Location accepted: ${JSON.stringify(invalid)}`)
  }

  const acceptedEnvelope = resolve(responseSchema(accepted))
  const statusEnvelope = resolve(responseSchema(document.components?.responses?.ProjectDeletionStatusSuccess))
  for (const [envelope, resourceRef, name] of [
    [acceptedEnvelope, "#/components/schemas/ProjectDeletionAcceptedResource", "accepted"],
    [statusEnvelope, "#/components/schemas/ProjectDeletionStatusResource", "status"],
  ]) {
    require(envelope?.additionalProperties === false, `R277 ${name} envelope must be closed`)
    require(JSON.stringify(envelope?.required) === JSON.stringify(["data"]), `R277 ${name} envelope fields drifted`)
    require(JSON.stringify(Object.keys(envelope?.properties ?? {})) === JSON.stringify(["data"]), `R277 ${name} must contain data only`)
    require(envelope?.properties?.data?.$ref === resourceRef, `R277 ${name} data ref drifted`)
  }
  const acceptedResource = document.components?.schemas?.ProjectDeletionAcceptedResource
  const statusResource = document.components?.schemas?.ProjectDeletionStatusResource
  for (const [resource, name] of [
    [acceptedResource, "accepted"],
    [statusResource, "status"],
  ]) {
    require(resource?.additionalProperties === false, `R277 ${name} resource must be closed`)
    require(JSON.stringify(resource?.required) ===
      JSON.stringify(["project_id", "logical_release_state", "physical_cleanup_state"]), `R277 ${name} resource fields drifted`)
    require(JSON.stringify(Object.keys(resource?.properties ?? {})) ===
      JSON.stringify(["project_id", "logical_release_state", "physical_cleanup_state"]), `R277 ${name} resource must not expose optional internal fields`)
    require(resource?.properties?.physical_cleanup_state?.const === "pending", `R277 ${name} physical cleanup must stay pending`)
  }
  require(acceptedResource?.properties?.logical_release_state?.const === "pending", "R277 DELETE ACK must stay pending")
  require(JSON.stringify(statusResource?.properties?.logical_release_state?.enum) ===
    JSON.stringify(["pending", "blocked", "released"]), "R277 status must expose exactly three logical release states")

  const error = document.components?.schemas?.ProjectDeletionErrorResponse
  require(error?.additionalProperties === false, "R277 error envelope must be closed")
  require(JSON.stringify(error?.required) === JSON.stringify(["error"]), "R277 error envelope fields drifted")
  require(JSON.stringify(Object.keys(error?.properties ?? {})) === JSON.stringify(["error"]), "R277 error envelope must contain error only")
  require(error?.properties?.error?.additionalProperties === false, "R277 error detail must be closed")
  require(JSON.stringify(error?.properties?.error?.required) === JSON.stringify(["code", "message", "retryable"]), "R277 error detail fields drifted")
  require(error?.properties?.error?.properties?.retryable?.type === "boolean", "R277 error retryable must be boolean")
  const profiles = {
    ProjectDeletionBadRequest: ["invalid_project_deletion_request", "idempotency_key_required", "invalid_idempotency_key"],
    ProjectDeletionStatusBadRequest: ["invalid_project_deletion_request"],
    ProjectDeletionUnauthorized: ["session_authentication_required", "session_invalid"],
    ProjectDeletionForbidden: ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"],
    ProjectDeletionNotFound: ["project_not_found"],
    ProjectDeletionConflict: ["idempotency_conflict", "idempotency_in_progress"],
    ProjectDeletionRateLimited: ["session_rate_limited"],
    ProjectDeletionUnavailable: ["product_tenant_not_configured", "iam_admission_unavailable", "business_store_unavailable"],
  }
  const allCodes = [...new Set(Object.values(profiles).flat())]
  require(JSON.stringify(error?.properties?.error?.properties?.code?.enum) === JSON.stringify(allCodes), "R277 error code union drifted")
  for (const [name, codes] of Object.entries(profiles))
    require(JSON.stringify(errorCodes(document.components?.responses?.[name])) === JSON.stringify(codes), `R277 ${name} code tuple drifted`)
  for (const name of [
    "ProjectDeletionBadRequest",
    "ProjectDeletionStatusBadRequest",
    "ProjectDeletionUnauthorized",
    "ProjectDeletionForbidden",
    "ProjectDeletionNotFound",
  ])
    require(errorRetryable(document.components?.responses?.[name]) === false, `R277 ${name} retryable must be false`)
  for (const name of ["ProjectDeletionRateLimited", "ProjectDeletionUnavailable"])
    require(errorRetryable(document.components?.responses?.[name]) === true, `R277 ${name} retryable must be true`)
  const conflictConstraint = responseSchema(document.components?.responses?.ProjectDeletionConflict)?.allOf?.[1]
  require(Array.isArray(conflictConstraint?.oneOf) && conflictConstraint.oneOf.length === 2, "R277 conflict must distinguish retryability by code")
  const conflictProfiles = (conflictConstraint?.oneOf ?? []).map((entry) => ({
    code: entry?.properties?.error?.properties?.code?.const,
    retryable: entry?.properties?.error?.properties?.retryable?.const,
  }))
  require(JSON.stringify(conflictProfiles) ===
    JSON.stringify([
      { code: "idempotency_conflict", retryable: false },
      { code: "idempotency_in_progress", retryable: true },
    ]), "R277 conflict code/retryable profiles drifted")
  const retry = resolve(document.components?.responses?.ProjectDeletionRateLimited)?.headers?.["Retry-After"]
  require(retry?.required === false, "R277 429 must publish only the optional bounded Retry-After profile")
  require(retry?.schema?.type === "string" && typeof retry.schema.pattern === "string", "R277 Retry-After type/pattern drifted")
  if (retry?.schema?.pattern) {
    const pattern = new RegExp(retry.schema.pattern, "u")
    require(pattern.test("1") && pattern.test("86400"), "R277 Retry-After legal bounds drifted")
    require(!pattern.test("0") && !pattern.test("86401") && !pattern.test("1\n"), "R277 Retry-After illegal bounds accepted")
  }
  require(/original 202 pending/u.test(deletion?.description ?? ""), "R277 DELETE must promise immutable pending replay")
  require(/new key[\s\S]*404/u.test(deletion?.description ?? ""), "R277 DELETE must close tombstone new-key lookup")
  require(/current[\s\S]*status GET/u.test(deletion?.description ?? ""), "R277 DELETE must direct current state to status GET")
  return errors
}

test("R277 deleteProject publishes one empty-body owner command with immutable pending replay", async () => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { openapi, baseline } = await readContract()
  const document = load(openapi)
  assert.equal(document.info.version, "8.10.0")
  assert.equal(baseline.length, 111)
  assert.deepEqual(
    baseline.filter(({ operation_id }) => operation_id === "deleteProject"),
    [{ method: "DELETE", path: "/v1/projects/{projectId}", operation_id: "deleteProject" }],
  )
  assert.deepEqual(inspectR277ProjectDeletion(document), [])
})

test("R277 getProjectDeletion publishes only the three logical states and never claims physical completion", async () => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { openapi, baseline } = await readContract()
  const document = load(openapi)
  assert.deepEqual(
    baseline.filter(({ operation_id }) => operation_id === "getProjectDeletion"),
    [{ method: "GET", path: "/v1/projects/{projectId}/deletion", operation_id: "getProjectDeletion" }],
  )
  assert.deepEqual(inspectR277ProjectDeletion(document), [])
})

test("R277 Project deletion machine profile rejects method, permission, replay, state, envelope and header drift", async () => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { openapi } = await readContract()
  const document = load(openapi)
  assert.deepEqual(inspectR277ProjectDeletion(document), [])
  const mutations = [
    (candidate) => {
      candidate.paths["/v1/projects/{projectId}"].post = candidate.paths["/v1/projects/{projectId}"].delete
      delete candidate.paths["/v1/projects/{projectId}"].delete
    },
    (candidate) => (candidate.paths["/v1/projects/{projectId}"].delete["x-kokoro-permission"] = "project.read"),
    (candidate) => (candidate.paths["/v1/projects/{projectId}/deletion"].get["x-kokoro-permission"] = "project.update"),
    (candidate) => (candidate.paths["/v1/projects/{projectId}/deletion"].parameters = [{ $ref: "#/components/parameters/ProjectId" }]),
    (candidate) => (candidate.paths["/v1/projects/{projectId}"].delete.parameters = [{ $ref: "#/components/parameters/ProjectDeletionIdempotencyKey" }]),
    (candidate) => (candidate.paths["/v1/projects/{projectId}"].delete.requestBody = { required: false }),
    (candidate) => (candidate.components.parameters.ProjectDeletionId.schema.pattern = "^project_.+$"),
    (candidate) => (candidate.components.parameters.ProjectDeletionIdempotencyKey.schema.pattern = "^.+$"),
    (candidate) =>
      (candidate.components.schemas.ProjectDeletionAcceptedResource.properties.logical_release_state = { type: "string", enum: ["pending", "released"] }),
    (candidate) => candidate.components.schemas.ProjectDeletionStatusResource.properties.logical_release_state.enum.push("completed"),
    (candidate) => (candidate.components.schemas.ProjectDeletionStatusResource.properties.physical_cleanup_state.const = "released"),
    (candidate) => (candidate.components.schemas.ProjectDeletionStatusResource.properties.internal_attempt_count = { type: "integer" }),
    (candidate) => (candidate.components.schemas.ProjectDeletionAcceptedResponse.properties.meta = { $ref: "#/components/schemas/RequestMeta" }),
    (candidate) => (candidate.components.schemas.ProjectDeletionErrorResponse.additionalProperties = true),
    (candidate) => delete candidate.components.schemas.ProjectDeletionErrorResponse.properties.error.properties.retryable,
    (candidate) => candidate.components.schemas.ProjectDeletionErrorResponse.properties.error.properties.code.enum.push("internal_error"),
    (candidate) => delete candidate.components.responses.ProjectDeletionAccepted.headers.Location,
    (candidate) => (candidate.components.responses.ProjectDeletionAccepted.headers.Location.schema.pattern = "^/v1/projects/.+/deletion$"),
    (candidate) => (candidate.components.responses.ProjectDeletionStatusSuccess.headers["Cache-Control"].schema.const = "public"),
    (candidate) => (candidate.components.responses.ProjectDeletionUnauthorized.headers["x-request-id"].schema.minLength = 0),
    (candidate) => candidate.components.responses.ProjectDeletionUnavailable.content["application/json"].schema.allOf.shift(),
    (candidate) =>
      (candidate.components.responses.ProjectDeletionUnavailable.content["application/json"].schema.allOf[1].properties.error.properties.code.enum = [
        "business_store_unavailable",
      ]),
    (candidate) => delete candidate.components.responses.ProjectDeletionRateLimited.headers["Retry-After"].schema.pattern,
    (candidate) =>
      (candidate.components.responses.ProjectDeletionRateLimited.content["application/json"].schema.allOf[1].properties.error.properties.retryable.const =
        false),
    (candidate) =>
      (candidate.components.responses.ProjectDeletionConflict.content["application/json"].schema.allOf[1].oneOf[1].properties.error.properties.retryable.const =
        false),
    (candidate) => (candidate.paths["/v1/projects/{projectId}"].delete.description = "Replay returns the current result."),
  ]
  for (const [index, mutate] of mutations.entries()) {
    const candidate = structuredClone(document)
    mutate(candidate)
    assert.notDeepEqual(inspectR277ProjectDeletion(candidate), [], `R277 mutation ${index} must fail closed`)
  }
})

// R323: Product personal MCP contract only; production routes and credentials remain a later slice.
for (const entry of [
  {
    path: "/v1/self/mcp/connectors",
    operation: "listPersonalMcpConnectors",
    query: ["cursor", "limit", "status"],
    schema: "PersonalMcpConnectorListResponse",
    field: "items",
    item: "PersonalMcpConnector",
    notFound: false,
  },
  {
    path: "/v1/self/mcp/connectors/{connector_id}",
    operation: "getPersonalMcpConnector",
    query: [],
    schema: "PersonalMcpConnectorDetailResponse",
    field: "connector",
    item: "PersonalMcpConnector",
    notFound: true,
  },
  {
    path: "/v1/self/mcp/connectors/{connector_id}/connections",
    operation: "listPersonalMcpConnections",
    query: ["cursor", "limit"],
    schema: "PersonalMcpConnectionListResponse",
    field: "items",
    item: "PersonalMcpConnection",
    notFound: true,
  },
  {
    path: "/v1/self/mcp/connections/{connection_id}",
    operation: "getPersonalMcpConnection",
    query: [],
    schema: "PersonalMcpConnectionDetailResponse",
    field: "connection",
    item: "PersonalMcpConnection",
    notFound: true,
  },
]) {
  test(`R323 missing personal MCP public GET contract: ${entry.operation}`, async () => {
    const { createRequire } = await import("node:module")
    const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
    const { openapi } = await readContract()
    const document = load(openapi)
    const pathItem = document.paths[entry.path]
    assert.ok(pathItem, `missing formal personal MCP resource ${entry.path}`)
    assert.deepEqual(Object.keys(pathItem), ["get"])
    const operation = pathItem.get
    assert.equal(operation.operationId, entry.operation)
    assert.equal(operation["x-kokoro-owner"], "kokoro-bff")
    assert.equal(operation["x-kokoro-visibility"], "public")
    assert.equal(operation["x-kokoro-stability"], "beta")
    assert.equal(operation["x-kokoro-idempotency"], "none")
    assert.equal(operation["x-kokoro-permission"], "product.mcp.read_personal")
    assert.equal(operation.requestBody, undefined)
    assert.match(operation.description, /unknown|未知/u)
    assert.match(operation.description, /duplicate|重复/u)
    assert.match(operation.description, /idempotency-key/iu)
    const parameters = (operation.parameters ?? []).map((parameter) =>
      parameter.$ref ? document.components.parameters[parameter.$ref.split("/").at(-1)] : parameter,
    )
    assert.deepEqual(
      parameters
        .filter((parameter) => parameter.in === "query")
        .map((parameter) => parameter.name)
        .sort(),
      entry.query,
    )
    assert.equal(
      parameters.some((parameter) => parameter.in === "header"),
      false,
    )
    const pathId = entry.path.includes("{connector_id}") ? "connector_id" : entry.path.includes("{connection_id}") ? "connection_id" : undefined
    assert.deepEqual(
      parameters.filter((parameter) => parameter.in === "path").map((parameter) => parameter.name),
      pathId ? [pathId] : [],
    )
    for (const parameter of parameters) {
      if (parameter.in === "path") {
        assert.equal(parameter.required, true)
        assert.equal(parameter.schema.type, "string")
        const pattern = new RegExp(parameter.schema.pattern, "u")
        for (const accepted of ["mcp-1", "a".repeat(191)]) assert.equal(pattern.test(accepted), true)
        for (const rejected of ["", "a".repeat(192), "a/b", " a", "a\n"]) assert.equal(pattern.test(rejected), false)
      } else {
        assert.notEqual(parameter.required, true)
        if (parameter.name === "limit") assert.deepEqual(parameter.schema, { type: "integer", minimum: 1, maximum: 100, default: 50 })
        if (parameter.name === "status") assert.deepEqual(parameter.schema, { type: "string", enum: ["pending", "active", "error", "revoked"] })
        if (parameter.name === "cursor") {
          assert.equal(parameter.schema.type, "string")
          assert.equal(parameter.schema.minLength, 1)
          assert.equal(parameter.schema.maxLength, 2048)
          const pattern = new RegExp(parameter.schema.pattern, "u")
          assert.equal(pattern.test("abc_-01"), true)
          for (const rejected of ["", "a=", "a\n", "a b"]) assert.equal(pattern.test(rejected), false)
        }
      }
    }
    const resolve = (value) => (value.$ref ? document.components.schemas[value.$ref.split("/").at(-1)] : value)
    const closed = (value, fields) => {
      assert.equal(value.type, "object")
      assert.equal(value.additionalProperties, false)
      assert.deepEqual([...value.required].sort(), [...fields].sort())
      assert.deepEqual(Object.keys(value.properties).sort(), [...fields].sort())
    }
    const expectedErrors = {
      400: ["invalid_mcp_personal_request"],
      401: ["session_authentication_required", "session_invalid"],
      403: ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"],
      ...(entry.notFound ? { 404: ["mcp_personal_not_found"] } : {}),
      429: ["session_rate_limited"],
      502: ["mcp_personal_response_invalid"],
      503: ["product_tenant_not_configured", "iam_admission_unavailable", "mcp_personal_dependency_unavailable"],
    }
    assert.deepEqual(Object.keys(operation.responses).sort(), ["200", ...Object.keys(expectedErrors)].sort())
    for (const [status, rawResponse] of Object.entries(operation.responses)) {
      const response = rawResponse.$ref ? document.components.responses[rawResponse.$ref.split("/").at(-1)] : rawResponse
      assert.equal(response.headers["Cache-Control"].required, true)
      assert.equal(response.headers["Cache-Control"].schema.const, "no-store")
      assert.equal(response.headers["x-request-id"].required, true)
      assert.equal(response.headers["x-request-id"].schema.type, "string")
      assert.ok(response.headers["x-request-id"].schema.minLength >= 1)
      const schema = resolve(response.content["application/json"].schema)
      if (status === "200") {
        assert.equal(response.content["application/json"].schema.$ref, `#/components/schemas/${entry.schema}`)
        closed(schema, ["data"])
        const data = resolve(schema.properties.data)
        closed(data, entry.field === "items" ? ["items", "next_cursor"] : [entry.field])
        const value = data.properties[entry.field]
        if (entry.field === "items") {
          assert.equal(value.type, "array")
          assert.equal(value.maxItems, 100)
          assert.equal(value.items.$ref, `#/components/schemas/${entry.item}`)
          const alternatives = data.properties.next_cursor.oneOf
          assert.equal(alternatives.length, 2)
          assert.ok(alternatives.some((option) => option.type === "null"))
          const cursor = alternatives.find((option) => option.type === "string")
          assert.equal(cursor.minLength, 1)
          assert.equal(cursor.maxLength, 2048)
        } else assert.equal(value.$ref, `#/components/schemas/${entry.item}`)
      } else {
        closed(schema, ["error"])
        const error = resolve(schema.properties.error)
        closed(error, ["code", "message", "retryable"])
        assert.deepEqual(error.properties.code.enum, expectedErrors[status])
        assert.equal(error.properties.message.type, "string")
        assert.equal(error.properties.retryable.const, ["429", "503"].includes(status))
      }
    }
    const item = document.components.schemas[entry.item]
    const connector = entry.item === "PersonalMcpConnector"
    closed(
      item,
      connector
        ? ["connector_id", "connector_type", "provider_key", "status", "approved_scopes"]
        : ["connection_id", "connector_id", "server_id", "allowed_selectors", "policy_digest", "status"],
    )
    assert.deepEqual(item.properties.status.enum, connector ? ["pending", "active", "error", "revoked"] : ["active", "revoked"])
    if (connector) assert.deepEqual(item.properties.connector_type.enum, ["builtin", "byok", "mcp"])
    const strings = item.properties[connector ? "approved_scopes" : "allowed_selectors"]
    assert.equal(strings.type, "array")
    assert.equal(strings.uniqueItems, true)
    assert.equal(strings.items.type, "string")
    assert.equal(strings.items.minLength, 1)
    assert.equal(strings.items.maxLength, connector ? 128 : 256)
    const stringPattern = new RegExp(strings.items.pattern, "u")
    assert.equal(stringPattern.test("tools/read"), true)
    for (const rejected of ["", " x", "x ", "x\n"]) assert.equal(stringPattern.test(rejected), false)
    for (const whitespace of [" ", "\t", "\n", "\r", "\u00a0", "\u2028", "\u2029", "\ufeff"]) {
      assert.equal(stringPattern.test(`read${whitespace}write`), !connector)
    }
  })
}

// R323 machine drift controls; these are not runtime or IAM integration evidence.
test("R323 personal MCP fixed checker rejects permission, query, safe-field and error drift", async () => {
  const { openapi, baseline } = await readContract()
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
  const mutations = [
    ["permission", "x-kokoro-permission: product.mcp.read_personal", "x-kokoro-permission: product.mcp.admin"],
    ["method", "/v1/self/mcp/connectors:\n    get:", "/v1/self/mcp/connectors:\n    post:"],
    ["query", "operationId: listPersonalMcpConnectors", "operationId: listPersonalMcpConnectors\n      requestBody: {}"],
    ["nested safe shape", "        approved_scopes:\n", "      approved_scopes:\n"],
    ["scope whitespace", "pattern: '^\\S+(?![\\s\\S])'", "pattern: '^[\\s\\S]+$'"],
    ["scope bound", "maxLength: 128, pattern: '^\\S+", "maxLength: 129, pattern: '^\\S+"],
    [
      "safe shape",
      "required: [connector_id, connector_type, provider_key, status, approved_scopes]",
      "required: [connector_id, connector_type, provider_key, status, approved_scopes, secret]",
    ],
    ["foreign leak", "enum: [mcp_personal_not_found]", "enum: [mcp_personal_foreign_owner]"],
    ["error tuple", "enum: [mcp_personal_response_invalid]", "enum: [mcp_personal_dependency_unavailable]"],
    [
      "caller-live cancellation",
      "enum: [product_tenant_not_configured, iam_admission_unavailable, mcp_personal_dependency_unavailable]",
      "enum: [product_tenant_not_configured, iam_admission_unavailable, canceled]",
    ],
    ["cursor empty", "- { type: string, minLength: 1, maxLength: 2048", "- { type: string, minLength: 0, maxLength: 2048"],
  ]
  for (const [name, original, replacement] of mutations) {
    assert.ok(openapi.includes(original), `${name} mutation must reach the real contract`)
    const mutated = openapi.replace(original, replacement)
    assert.notEqual(mutated, openapi)
    assert.ok(
      inspectBffOpenApi(mutated, baseline).some((error) => error.startsWith("personal MCP ")),
      name,
    )
  }
})

// R323 review: only the new personal response, never the historical Retry-After contracts.
test("R323 personal MCP Retry-After is canonical decimal 1 through 86400 without trailing LF", async () => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { openapi } = await readContract()
  const document = load(openapi)
  const header = document.components.responses.PersonalMcpRateLimited.headers["Retry-After"]
  assert.equal(header.required, false)
  assert.equal(header.schema.type, "string")
  const pattern = new RegExp(header.schema.pattern, "u")
  for (const accepted of ["1", "9", "10", "9999", "10000", "79999", "80000", "85999", "86000", "86399", "86400"]) {
    assert.equal(pattern.test(accepted), true, `Retry-After must accept ${accepted}`)
  }
  for (const rejected of ["86401", "99999", "100000", "0", "01", "+1", "1.0", "1e2", " 1", "1 ", "1\n", "86400\n", "", "١"]) {
    assert.equal(pattern.test(rejected), false, `Retry-After must reject ${JSON.stringify(rejected)}`)
  }
})

// R342: Product Skill package inspection contract only; production routes remain a later slice.
for (const entry of [
  {
    path: "/v1/self/skills/{skill_id}/package",
    operation: "getManagedPersonalSkillPackage",
    pathParameter: "skill_id",
    permission: "product.skill.read_managed_personal",
  },
  {
    path: "/v1/skill-installations/{installation_id}/package",
    operation: "getPersonalSkillInstallationPackage",
    pathParameter: "installation_id",
    permission: "product.skill.installation.read",
  },
]) {
  test(`R342 Skill package inspection public GET contract: ${entry.operation}`, async () => {
    const { createRequire } = await import("node:module")
    const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
    const { openapi } = await readContract()
    const document = load(openapi)
    const resolve = (value) => {
      if (!value?.$ref) return value
      const [, , section, name] = value.$ref.split("/")
      return document.components?.[section]?.[name]
    }
    const closed = (value, fields, label) => {
      assert.equal(value?.type, "object", `${label} must be an object`)
      assert.equal(value?.additionalProperties, false, `${label} must reject undeclared fields`)
      assert.deepEqual([...(value?.required ?? [])].sort(), [...fields].sort(), `${label} must require every public field`)
      assert.deepEqual(Object.keys(value?.properties ?? {}).sort(), [...fields].sort(), `${label} must publish only approved fields`)
    }
    const assertUint64 = (schema, { allowZero, label }) => {
      assert.equal(schema?.type, "string", `${label} must use a decimal string`)
      assert.equal(typeof schema?.pattern, "string", `${label} must publish an absolute decimal pattern`)
      const pattern = new RegExp(schema.pattern, "u")
      for (const accepted of allowZero ? ["0", "1", "18446744073709551615"] : ["1", "18446744073709551615"])
        assert.equal(pattern.test(accepted), true, `${label} must accept ${accepted}`)
      for (const rejected of ["", "00", "01", "+1", "-1", "1.0", "1e3", "18446744073709551616", "1\n"])
        assert.equal(pattern.test(rejected), false, `${label} must reject ${JSON.stringify(rejected)}`)
      if (!allowZero) assert.equal(pattern.test("0"), false, `${label} must reject zero`)
    }
    const requiredHeader = (response, name) => {
      const header = resolve(response)?.headers?.[name]
      assert.equal(header?.required, true, `${entry.operation} ${name} must be required`)
      return header
    }

    const pathItem = document.paths?.[entry.path]
    assert.ok(pathItem, `missing formal Skill package inspection resource ${entry.path}`)
    assert.deepEqual(Object.keys(pathItem), ["get"])
    const operation = pathItem.get
    assert.equal(operation.operationId, entry.operation)
    assert.equal(operation["x-kokoro-owner"], "kokoro-bff")
    assert.equal(operation["x-kokoro-visibility"], "public")
    assert.equal(operation["x-kokoro-stability"], "beta")
    assert.equal(operation["x-kokoro-idempotency"], "none")
    assert.equal(operation["x-kokoro-permission"], entry.permission)
    assert.equal(operation.requestBody, undefined)
    assert.match(operation.description, /unknown|未知/u)
    assert.match(operation.description, /duplicate|重复/u)
    assert.match(operation.description, /body/iu)
    assert.match(operation.description, /transfer-encoding/iu)
    assert.match(operation.description, /idempotency-key/iu)
    assert.match(operation.description, /single absolute ten-second|single absolute 10-second/iu)
    assert.match(operation.description, /1,048,576|1048576/u)
    assert.match(operation.description, /UTF-8/u)
    assert.match(operation.description, /not trim|without trimming/iu)
    assert.match(operation.description, /not truncat|without truncat/iu)

    const parameters = (operation.parameters ?? []).map(resolve)
    assert.deepEqual(
      parameters.map(({ name, in: location }) => [name, location]).sort(),
      [
        ["file_path", "query"],
        [entry.pathParameter, "path"],
      ].sort(),
    )
    const identifier = parameters.find(({ name, in: location }) => name === entry.pathParameter && location === "path")
    assert.equal(identifier.required, true)
    assert.equal(identifier.schema.type, "string")
    const identifierPattern = new RegExp(identifier.schema.pattern, "u")
    for (const accepted of ["a", "skill-1", "a".repeat(191)]) assert.equal(identifierPattern.test(accepted), true)
    for (const rejected of ["", "a".repeat(192), "a/b", " a", "a ", "a\n"]) assert.equal(identifierPattern.test(rejected), false)
    const filePath = parameters.find(({ name, in: location }) => name === "file_path" && location === "query")
    assert.notEqual(filePath.required, true)
    assert.equal(filePath.schema.type, "string")
    assert.match(filePath.description, /NFC/u)
    assert.match(filePath.description, /UTF-8/u)
    assert.match(filePath.description, /256/u)
    assert.match(filePath.description, /decoded once|single decode/iu)

    const expectedProfiles = {
      400: [{ code: "invalid_skill_package_request", retryable: false }],
      401: [
        { code: "session_authentication_required", retryable: false },
        { code: "session_invalid", retryable: false },
      ],
      403: [
        { code: "service_auth_failed", retryable: false },
        { code: "session_forbidden", retryable: false },
        { code: "product_tenant_forbidden", retryable: false },
      ],
      404: [{ code: "skill_package_not_found", retryable: false }],
      412: [{ code: "skill_package_precondition_failed", retryable: false }],
      429: [
        { code: "session_rate_limited", retryable: true },
        { code: "skill_package_limit_exceeded", retryable: false },
      ],
      502: [{ code: "skill_package_response_invalid", retryable: false }],
      503: [
        { code: "product_tenant_not_configured", retryable: true },
        { code: "iam_admission_unavailable", retryable: true },
        { code: "skill_package_dependency_unavailable", retryable: true },
      ],
    }
    assert.deepEqual(Object.keys(operation.responses).sort(), ["200", ...Object.keys(expectedProfiles)].sort())
    for (const rawResponse of Object.values(operation.responses)) {
      const response = resolve(rawResponse)
      const requestId = requiredHeader(response, "x-request-id")
      assert.equal(requestId.schema.type, "string")
      assert.equal(requestId.schema.minLength, 1)
      assert.equal(requestId.schema.maxLength, 128)
      assert.equal(requiredHeader(response, "Cache-Control").schema.const, "no-store")
      assert.deepEqual(Object.keys(response.content), ["application/json"])
    }

    const successResponse = resolve(operation.responses["200"])
    const successEnvelope = resolve(successResponse.content["application/json"].schema)
    closed(successEnvelope, ["data"], `${entry.operation} success envelope`)
    const data = resolve(successEnvelope.properties.data)
    closed(data, ["source_ref", "revision", "files", "selected_file"], `${entry.operation} data`)
    assert.equal(data.properties.source_ref.type, "string")
    const sourceRefPattern = new RegExp(data.properties.source_ref.pattern, "u")
    assert.equal(sourceRefPattern.test("skill:example-1"), true)
    for (const rejected of ["", "skill:", "skill:/bad", "example-1", "skill:example\n"])
      assert.equal(sourceRefPattern.test(rejected), false, `source_ref must reject ${JSON.stringify(rejected)}`)
    assertUint64(data.properties.revision, { allowZero: false, label: `${entry.operation} revision` })
    assert.equal(data.properties.files.type, "array")
    assert.equal(data.properties.files.maxItems, 128)
    const file = resolve(data.properties.files.items)
    closed(file, ["path", "size_bytes"], `${entry.operation} file entry`)
    assert.equal(file.properties.path.type, "string")
    assertUint64(file.properties.size_bytes, { allowZero: true, label: `${entry.operation} file size` })
    const selectedAlternatives = data.properties.selected_file.oneOf
    assert.equal(selectedAlternatives?.length, 2)
    assert.equal(
      selectedAlternatives.some((candidate) => candidate.type === "null"),
      true,
    )
    const selected = resolve(selectedAlternatives.find((candidate) => candidate.type !== "null"))
    closed(selected, ["path", "text"], `${entry.operation} selected file`)
    assert.equal(selected.properties.path.type, "string")
    assert.deepEqual(selected.properties.text, { type: "string" })
    assert.match(data.description, /selected_file.*null|directory.*null/iu)
    assert.match(data.description, /empty text|empty string/iu)
    assert.match(data.description, /BOM/iu)
    assert.match(data.description, /deterministic|sorted/iu)
    assert.match(data.description, /unique/iu)
    assert.match(data.description, /size_bytes/iu)

    let baseErrorRef
    for (const [status, expected] of Object.entries(expectedProfiles)) {
      const response = resolve(operation.responses[status])
      const schema = response.content["application/json"].schema
      assert.equal(schema.allOf?.length, 2, `${entry.operation} ${status} must combine one closed error base with one exact profile`)
      assert.equal(typeof schema.allOf[0].$ref, "string")
      baseErrorRef ??= schema.allOf[0].$ref
      assert.equal(schema.allOf[0].$ref, baseErrorRef, `${entry.operation} ${status} must retain the shared package error envelope`)
      const constrained = schema.allOf[1]
      const actual = (constrained.oneOf ?? [constrained]).flatMap((profile) => {
        const error = profile.properties?.error?.properties
        const codes = error?.code?.enum ?? (typeof error?.code?.const === "string" ? [error.code.const] : [])
        return codes.map((code) => ({ code, retryable: error?.retryable?.const }))
      })
      assert.deepEqual(actual, expected, `${entry.operation} ${status} error tuple drifted`)
      if (status !== "429") assert.equal(resolve(response).headers?.["Retry-After"], undefined)
    }
    const errorEnvelope = resolve({ $ref: baseErrorRef })
    closed(errorEnvelope, ["error"], `${entry.operation} error envelope`)
    const error = resolve(errorEnvelope.properties.error)
    closed(error, ["code", "message", "retryable"], `${entry.operation} error detail`)
    assert.equal(error.properties.code.type, "string")
    assert.equal(error.properties.message.type, "string")
    assert.equal(error.properties.message.minLength, 1)
    assert.equal(error.properties.retryable.type, "boolean")
    assert.equal(JSON.stringify(expectedProfiles).includes("skill_package_file_not_found"), false)

    const rateLimit = resolve(operation.responses["429"])
    const retryAfter = rateLimit.headers["Retry-After"]
    assert.equal(retryAfter.required, false)
    assert.equal(retryAfter.schema.type, "string")
    const retryAfterPattern = new RegExp(retryAfter.schema.pattern, "u")
    for (const accepted of ["1", "86400"]) assert.equal(retryAfterPattern.test(accepted), true)
    for (const rejected of ["", "0", "01", "86401", "+1", "1.0", "1\n"])
      assert.equal(retryAfterPattern.test(rejected), false, `Retry-After must reject ${JSON.stringify(rejected)}`)
    assert.match(rateLimit.description, /session.*Retry-After/iu)
    assert.match(rateLimit.description, /skill_package_limit_exceeded.*omit|limit.*without.*Retry-After/iu)
  })
}

test("Public10 binds the actual Skills Product operations, closed schemas and preserved Public8.10 parent", async () => {
  const openapi = await readFile(openapiUrl, "utf8"),
    baseline = parseOpenApiOperations(openapi).map((operation) => ({
      method: operation.method,
      path: operation.path,
      operation_id: operation.fields.get("operationId"),
    }))
  const module = await import("../../scripts/verify-skill-product-contract.mjs").catch(() => ({}))
  assert.equal(typeof module.inspectSkillProductContract, "function")
  assert.deepEqual(module.inspectSkillProductContract(openapi, baseline), [])
})

test("Public10 rejects new operation removal, current closed schema widening and unrelated parent mutation", async () => {
  const raw = await readFile(openapiUrl, "utf8")
  for (const changed of [
    raw.replace("operationId: updateSkillDraft", "operationId: unexpectedDraft"),
    raw.replace(
      "    SkillUsageResponse:\n      type: object\n      additionalProperties: false",
      "    SkillUsageResponse:\n      type: object\n      additionalProperties: true",
    ),
    raw.replace("  version: 11.0.0", "  version: 8.10.0"),
    raw.replace("title: Kokoro Business API", "title: Altered Business API"),
  ]) {
    assert.notEqual(changed, raw)
    assert.notDeepEqual(inspectSkillProductContract(changed), [])
  }
})

test("Public10 Publish requires exact audience/CAS JSON and preserves the full Public9 historical parent", async () => {
  const raw = await readFile(openapiUrl, "utf8")
  const start = raw.indexOf("  /v1/skills/{skill_id}/publish:\n")
  const end = raw.indexOf("  /v1/skill-installations:\n", start)
  const publication = raw.slice(start, end)
  assert.match(publication, /requestBody:\n        required: true/u)
  assert.match(publication, /\$ref: '#\/components\/schemas\/SkillAudienceRequest'/u)
  assert.doesNotMatch(publication, /x-kokoro-empty-body/u)
  for (const changed of [
    raw.replace(publication, publication.replace("        required: true", "        required: false")),
    raw.replace(publication, publication.replace("SkillAudienceRequest", "SkillReasonRequest")),
    raw.replace(publication, publication.replace("      requestBody:", "      x-kokoro-empty-body: required\n      requestBody:")),
    raw.replace(publication, publication.replace("product.skill.publish", "product.skill.read")),
    raw.replace("        - expected_state_version\n        - audience", "        - audience"),
    raw.replace("title: Kokoro Business API", "title: Changed Business API"),
  ]) {
    assert.notEqual(changed, raw)
    assert.notDeepEqual(inspectSkillProductContract(changed), [])
  }
  assert.equal(parseOpenApiOperations(raw).length, 132)
})

test("Public11 ordinary lifecycle uses metadata-only CreateVersion and required Withdraw CAS with exact Public10 parent", async () => {
  const raw = await readFile(openapiUrl, "utf8")
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const document = load(raw)
  assert.equal(document.info.version, "11.0.0")
  const schemas = document.components.schemas
  assert.equal(schemas.CreatePersonalSkillVersionRequest.additionalProperties, false)
  assert.deepEqual(Object.keys(schemas.CreatePersonalSkillVersionRequest.properties), ["example_prompts", "display_name", "summary", "tags", "category_keys"])
  assert.deepEqual(schemas.WithdrawPersonalSkillRequest.required, ["reason", "expected_state_version"])
  assert.equal(schemas.WithdrawPersonalSkillRequest.additionalProperties, false)
  assert.equal(schemas.WithdrawPersonalSkillRequest.properties.expected_state_version.type, "string")
  assert.deepEqual(inspectSkillProductContract(raw), [])
  const createStart = raw.indexOf("    CreatePersonalSkillVersionRequest:\n")
  const createEnd = raw.indexOf("    CreatePersonalSkillVersionResource:\n", createStart)
  const withdrawStart = raw.indexOf("    WithdrawPersonalSkillRequest:\n")
  const withdrawEnd = raw.indexOf("    WithdrawPersonalSkillResource:\n", withdrawStart)
  const create = raw.slice(createStart, createEnd),
    withdraw = raw.slice(withdrawStart, withdrawEnd)
  for (const changed of [
    raw.replace(create, create.replace("      properties:", "      properties:\n        expected_state_version: { type: string }")),
    raw.replace(create, create.replace("additionalProperties: false", "additionalProperties: true")),
    raw.replace(withdraw, withdraw.replace("        - expected_state_version\n", "")),
    raw.replace(withdraw, withdraw.replace("type: string", "type: [string, 'null']")),
    raw.replace("  version: 11.0.0", "  version: 10.0.0"),
    raw.replace("title: Kokoro Business API", "title: Changed Business API"),
  ]) {
    assert.notEqual(changed, raw)
    assert.notDeepEqual(inspectSkillProductContract(changed), [])
  }
  assert.equal(parseOpenApiOperations(raw).length, 132)
  assert.equal(createHash("sha256").update(stripSkillProductSource(raw)).digest("hex"), "640f47f9c70341aa49934eec319a4dcc5bab76bba83e4407d6a9e0c3ab0ac389")
})

test("Public13 requires CAS only for the three package commands and exactly restores Public12", async () => {
  const { load, dump } = await import("js-yaml")
  const { inspectPublic13CasContract, restorePublic12CasContract } = await import("../../scripts/verify-skill-product-contract.mjs")
  const current = await readFile(currentOpenapiUrl, "utf8")
  const { restorePublic13SkillAuthorizationContract } = await import("../../scripts/verify-skill-product-contract.mjs")
  const { restorePublic131GithubPathContract } = await import("../../scripts/verify-skill-product-contract.mjs")
  const source = restorePublic13SkillAuthorizationContract(restorePublic131GithubPathContract(restorePublic132SharedRevisionContract(current)))
  assert.deepEqual(inspectPublic13CasContract(source), [])
  const document = load(source)
  assert.equal(document.info.version, "13.0.0")
  for (const name of ["BeginSkillPackageUploadRequest", "CompleteSkillPackageUploadRequest", "ValidateSkillDraftRequest"]) {
    assert.ok(document.components.schemas[name].required.includes("expected_state_version"))
    const changed = structuredClone(document)
    changed.components.schemas[name].required = changed.components.schemas[name].required.filter((key) => key !== "expected_state_version")
    assert.ok(inspectPublic13CasContract(dump(changed)).some((error) => error.includes(name)))
  }
  assert.ok(!Object.hasOwn(document.components.schemas.CreatePersonalSkillVersionRequest.properties, "expected_state_version"))
  for (const name of [
    "SkillAudienceRequest",
    "WithdrawPersonalSkillRequest",
    "SkillUpdateDraftRequest",
    "SkillBeginCoverRequest",
    "SkillCompleteCoverRequest",
    "SkillOfficialPublishRequest",
    "SkillAdminVersionRequest",
    "SkillDiscardRequest",
  ])
    assert.ok(document.components.schemas[name].required.includes("expected_state_version"))
  assert.deepEqual(inspectSkillProductContract(restorePublic12CasContract(source)), [])
  const { inspectBffOpenApi: inspectCurrentBffOpenApi } = await import("../../scripts/verify-openapi.ts")
  const baseline = JSON.parse(await readFile(baselineUrl, "utf8")).operations
  assert.deepEqual(inspectCurrentBffOpenApi(current, baseline), [])
  assert.ok(inspectCurrentBffOpenApi(restorePublic12CasContract(source), baseline).some((error) => error.includes("version")))

  assert.ok(inspectPublic13CasContract(source.replace("maximum: 33554432", "maximum: 33554431")).some((error) => error.includes("parent inverse")))
})

test("Public13.1 exposes skill_forbidden only on the actual Skill action 403 families", async () => {
  const { load } = await import("js-yaml")
  const document = load(await readFile(currentOpenapiUrl, "utf8"))
  const schemas = document.components.schemas,
    responses = document.components.responses
  const baseNames = [
    "SkillDraftErrorDetail",
    "SkillPackageBeginErrorDetail",
    "SkillPackageCompleteErrorDetail",
    "SkillValidateErrorDetail",
    "SkillPublishErrorDetail",
  ]
  for (const name of baseNames) assert.ok(schemas[name].properties.code.enum.includes("skill_forbidden"), name)
  const narrowNames = [
    "SkillPackageBeginForbidden",
    "SkillPackageCompleteForbidden",
    "SkillValidateForbidden",
    "SkillPublishForbidden",
    "PersonalSkillLifecycleForbidden",
    "SkillInstallationMutationForbidden",
  ]
  for (const name of narrowNames) {
    const narrow = responses[name].content["application/json"].schema.allOf[1].properties.error.properties.code.enum
    assert.ok(narrow.includes("skill_forbidden"), name)
    assert.equal(narrow.includes("invalid_skill_request"), false, name)
    assert.equal(narrow.includes("iam_admission_unavailable"), false, name)
  }
  for (const name of ["SkillPackageUploadGetErrorDetail", "ManagedPersonalSkillErrorDetail", "SkillPackageInspectionErrorDetail"])
    assert.equal(schemas[name].properties.code.enum.includes("skill_forbidden"), false, name)
  for (const name of ["SkillPackageUploadGetForbidden", "ManagedPersonalSkillForbidden", "SkillPackageInspectionForbidden", "SkillInstallationForbidden"])
    assert.equal(JSON.stringify(responses[name]).includes("skill_forbidden"), false, name)
  for (const [path, item] of Object.entries(document.paths))
    for (const [method, operation] of Object.entries(item)) {
      if (!path.startsWith("/v1/skill-installations") || !["get", "post", "put", "delete"].includes(method)) continue
      if (!operation.responses["403"].$ref.includes("SkillInstallation")) continue
      assert.equal(
        operation.responses["403"].$ref,
        `#/components/responses/${method === "get" ? "SkillInstallationForbidden" : "SkillInstallationMutationForbidden"}`,
      )
    }
})

test("Public13.1 guards every actual Skill action route, status family and the exact Public13 parent", async () => {
  const { load } = await import("js-yaml")
  const { skillActionForRequest } = await import("../../src/auth/user-admission.ts")
  const { inspectPublic131SkillAuthorizationContract, restorePublic13SkillAuthorizationContract } =
    await import("../../scripts/verify-skill-product-contract.mjs")
  const { restorePublic131GithubPathContract } = await import("../../scripts/verify-skill-product-contract.mjs")
  const source = restorePublic131GithubPathContract(restorePublic132SharedRevisionContract(await readFile(currentOpenapiUrl, "utf8"))),
    document = load(source)
  assert.deepEqual(inspectPublic131SkillAuthorizationContract(source), [])
  assert.deepEqual(inspectSkillProductContract(restorePublic13SkillAuthorizationContract(source)), [])
  const resolve = (value) =>
    value?.$ref
      ? value.$ref
          .split("/")
          .slice(1)
          .reduce((current, key) => current[key], document)
      : value
  const allowsCode = (value, code) => {
    const schema = resolve(value)
    if (!schema) return false
    if (schema.allOf) return schema.allOf.every((part) => allowsCode(part, code))
    if (schema.properties?.error) return allowsCode(schema.properties.error, code)
    if (schema.properties?.code) return allowsCode(schema.properties.code, code)
    return schema.enum === undefined || schema.enum.includes(code)
  }
  let actionRoutes = 0
  for (const [path, item] of Object.entries(document.paths))
    for (const [method, operation] of Object.entries(item)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue
      const parts = path.split("/").filter(Boolean)
      if (parts[0] === "v1") parts.shift()
      if (skillActionForRequest(method.toUpperCase(), parts) === null) continue
      actionRoutes++
      const forbidden = resolve(operation.responses["403"])
      assert.ok(forbidden, `${method} ${path} must publish its actual 403`)
      assert.ok(allowsCode(forbidden.content["application/json"].schema, "skill_forbidden"), `${method} ${path}`)
    }
  assert.equal(actionRoutes, 26)
  for (const name of [
    "SkillDraftErrorDetail",
    "SkillPackageBeginErrorDetail",
    "SkillPackageCompleteErrorDetail",
    "SkillValidateErrorDetail",
    "SkillPublishErrorDetail",
  ]) {
    const block = new RegExp(`^    ${name}:\\n[\\s\\S]*?(?=^    [A-Za-z0-9]+:)`, "mu").exec(source)[0]
    const changed = source.replace(block, block.replace(", skill_forbidden]", "]"))
    assert.ok(inspectPublic131SkillAuthorizationContract(changed).some((error) => error.includes(name)))
  }
  for (const name of [
    "SkillPackageBeginForbidden",
    "SkillPackageCompleteForbidden",
    "SkillValidateForbidden",
    "SkillPublishForbidden",
    "PersonalSkillLifecycleForbidden",
    "SkillInstallationMutationForbidden",
  ]) {
    const block = new RegExp(`^    ${name}:\\n[\\s\\S]*?(?=^    [A-Za-z0-9]+:)`, "mu").exec(source)[0]
    const changed = source.replace(block, block.replace(", skill_forbidden]", ", invalid_skill_request, skill_forbidden]"))
    assert.ok(inspectPublic131SkillAuthorizationContract(changed).some((error) => error.includes("parent inverse")))
  }
  const widenedRead = source.replace("#/components/responses/SkillInstallationForbidden", "#/components/responses/SkillInstallationMutationForbidden")
  assert.ok(inspectPublic131SkillAuthorizationContract(widenedRead).some((error) => error.includes("read forbidden boundary")))
  const wrongStatus = source.replace("#/components/responses/SkillValidateBadRequest", "#/components/responses/SkillValidateForbidden")
  assert.ok(inspectPublic131SkillAuthorizationContract(wrongStatus).some((error) => error.includes("parent inverse")))
})

for (const [label, path] of [
  ["preview input", ["GithubSkillRequest", "properties", "path"]],
  ["import selector", ["GithubSkillImportRequest", "properties", "path"]],
  ["preview selector", ["GithubSkillResponse", "properties", "data", "oneOf", 0, "properties", "selector", "properties", "path"]],
  ["preview repository", ["GithubSkillResponse", "properties", "data", "oneOf", 0, "properties", "repository", "properties", "path"]],
  ["preview candidates", ["GithubSkillResponse", "properties", "data", "oneOf", 1, "properties", "paths", "items"]],
]) {
  test(`GitHub path current ${label} matches the existing 256-character parser`, async () => {
    const { load } = await import("js-yaml")
    const document = load(await readFile(currentOpenapiUrl, "utf8"))
    const constraint = path.reduce((value, key) => value[key], document.components.schemas)
    assert.equal(constraint.maxLength, 256)
  })
}

test("GitHub path Public13.2 restores the exact immutable Public13.1 parent and guards all five constraints", async () => {
  const { inspectPublic132GithubPathContract, restorePublic131GithubPathContract } = await import("../../scripts/verify-skill-product-contract.mjs")
  const current = restorePublic132SharedRevisionContract(await readFile(currentOpenapiUrl, "utf8"))
  assert.deepEqual(inspectPublic132GithubPathContract(current), [])
  assert.equal(createHash("sha256").update(restorePublic131GithubPathContract(current)).digest("hex"), "418db9504b179d29113385f334628d304130491d4bbc86169e20c712cf2cd045")
  assert.deepEqual(inspectSkillProductContract(restorePublic131GithubPathContract(current)), [])
  const matches = [...current.matchAll(/maxLength: 256/gu)].filter((match) => {
    const changed = current.slice(0, match.index) + current.slice(match.index).replace("maxLength: 256", "maxLength: 257")
    return inspectPublic132GithubPathContract(changed).some((error) => error.startsWith("GitHub path"))
  })
  assert.equal(matches.length, 5)
  for (const match of matches) {
    for (const replacement of ["255", "257", "2048"]) {
      const changed = current.slice(0, match.index) + current.slice(match.index).replace("maxLength: 256", `maxLength: ${replacement}`)
      assert.ok(inspectPublic132GithubPathContract(changed).some((error) => error.startsWith("GitHub path")))
      if (replacement !== "2048") assert.ok(inspectPublic132GithubPathContract(changed).some((error) => error.includes("parent inverse")))
    }
  }
  assert.ok(inspectPublic132GithubPathContract(current.replace("maximum: 33554432", "maximum: 33554431")).some((error) => error.includes("parent inverse")))
  assert.ok(inspectPublic132GithubPathContract(current.replace("  version: 13.2.0", "  version: 13.1.0")).some((error) => error.includes("version")))
  assert.notDeepEqual(inspectPublic132GithubPathContract(`${current}openapi: 3.1.0\n`), [])
})

test("GitHub path inverse must not restore a tampered repository URL bound", async () => {
  const { inspectPublic132GithubPathContract } = await import("../../scripts/verify-skill-product-contract.mjs")
  const current = restorePublic132SharedRevisionContract(await readFile(currentOpenapiUrl, "utf8"))
  const changed = current.replace(/(GithubSkillRequest:\n[\s\S]*?repository_url:\n\s+type: string\n\s+maxLength: )2048/u, "$1256")
  assert.notEqual(changed, current)
  assert.ok(inspectPublic132GithubPathContract(changed).some((error) => error.includes("parent inverse")))
})

test("Public13.3 shared exact summary preserves complete137 and exact13.2 parent", async () => {
  const { inspectBffOpenApi } = await import("../../scripts/verify-openapi.ts")
  const source = await readFile(currentOpenapiUrl, "utf8"),
    baseline = JSON.parse(await readFile(baselineUrl, "utf8")).operations
  assert.deepEqual(inspectBffOpenApi(source, baseline), [])
  assert.equal(parseOpenApiOperations(source).length, 137)
  assert.equal(parseOpenApiOperations(restorePublic132SharedRevisionContract(source)).length, 136)
  for (const changed of [
    source.replace("operationId: getSharedSkillRevision", "operationId: resolveSkillShare"),
    source.replace("source_kind: { type: string, enum: [personal, official, third_party] }", "source_kind: { type: string }"),
    source.replace("required: [user_id, display_name]", "required: [user_id]"),
    source.replace("maximum: 33554432", "maximum: 33554431"),
  ])
    assert.notDeepEqual(inspectBffOpenApi(changed, baseline), [])
})
