import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import { inspectAgentControlSnapshot, inspectBffOpenApi } from "../../scripts/verify-openapi.ts"

const openapiUrl = new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url)
const baselineUrl = new URL("../../contract/tests/v1-operations.json", import.meta.url)
const agentControlSnapshotUrl = new URL("../../contract/external/kokoro-agent/control-receipt.v1.json", import.meta.url)
const platformV4Url = new URL("../../contract/vendor/kokoro-platform/263a28f1e55745bd1829a61f68228d775751adbc/execution-operations-v4/", import.meta.url)

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
      "code: { type: string, enum: [session_authentication_required, session_invalid] }",
      "code: { type: string, enum: [service_auth_failed, session_invalid] }",
    ),
    openapi.replace(
      "code: { type: string, enum: [service_auth_failed, session_forbidden, product_tenant_forbidden] }",
      "code: { type: string, enum: [session_forbidden, product_tenant_not_configured] }",
    ),
    openapi.replace(
      "code: { type: string, enum: [product_tenant_not_configured, iam_admission_unavailable, skill_dependency_unavailable] }",
      "code: { type: string, enum: [iam_admission_unavailable, skill_dependency_unavailable] }",
    ),
    openapi.replace(
      "          required: false\n          schema: { type: string, pattern: '^[1-9][0-9]{0,4}$' }",
      "          required: true\n          schema: { type: string, pattern: '^[1-9][0-9]{0,4}$' }",
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
  const fixture = JSON.parse(await readFile(new URL("vectors/command-projection.json", platformV4Url), "utf8"))
  const schema = JSON.parse(await readFile(new URL("command-schemas.json", platformV4Url), "utf8"))
  const vectors = fixture.vectors.filter(({ operation }) => operation === "skill.complete_package_upload")
  assert.equal(fixture.artifactVersion, "3.0.0")
  assert.equal(schema.artifactVersion, "3.0.0")
  assert.equal(schema.schemas["skill.complete_package_upload"].properties.command_digest_version.const, "3.0.0")
  assert.equal(schema.schemas["skill.complete_package_upload"].properties.fq_method.const, "kokoro.platform.v1.SkillCatalogService/CompleteSkillPackageUpload")
  assert.equal(vectors.length, 11)
  for (const vector of vectors) {
    const raw = JSON.parse(Buffer.from(vector.rawBase64, "base64").toString("utf8"))
    if (vector.expectedError === "none") {
      assert.equal(raw.command_digest_version, "3.0.0")
      const canonical = Buffer.from(vector.canonicalBase64, "base64")
      assert.equal(createHash("sha256").update(canonical).digest("hex"), vector.sha256)
      const projection = JSON.parse(canonical.toString("utf8"))
      assert.deepEqual(projection, vector.projection)
      assert.equal(projection.fq_method, "kokoro.platform.v1.SkillCatalogService/CompleteSkillPackageUpload")
    } else assert.equal(vector.canonicalBase64, undefined)
  }
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
  assert.match(resource, /manifest_identity: \{ type: string, pattern: '\^zip-v1:sha256:/u)
  assert.doesNotMatch(resource, /asset_id|upload_id|transfer_reference/u)
  assert.deepEqual(inspectBffOpenApi(openapi, baseline), [])
})

test("ValidateSkillDraft pins owner v4 tag 7 and all eight command digest vectors", async () => {
  const fixture = JSON.parse(await readFile(new URL("vectors/command-projection.json", platformV4Url), "utf8"))
  const schema = JSON.parse(await readFile(new URL("command-schemas.json", platformV4Url), "utf8"))
  const vectors = fixture.vectors.filter(({ operation }) => operation === "skill.validate_draft")
  assert.equal(fixture.artifactVersion, "3.0.0")
  assert.equal(schema.artifactVersion, "3.0.0")
  assert.equal(schema.schemas["skill.validate_draft"].properties.command_digest_version.const, "3.0.0")
  assert.equal(schema.schemas["skill.validate_draft"].properties.fq_method.const, "kokoro.platform.v1.SkillCatalogService/ValidateSkillDraft")
  assert.deepEqual(schema.schemas["skill.validate_draft"].properties.command.required, ["skill_id", "product_context", "attempt_id"])
  assert.equal(vectors.length, 8)
  for (const vector of vectors) {
    const raw = JSON.parse(Buffer.from(vector.rawBase64, "base64").toString("utf8"))
    if (vector.expectedError === "none") {
      assert.equal(raw.command_digest_version, "3.0.0")
      assert.equal(raw.fq_method, "kokoro.platform.v1.SkillCatalogService/ValidateSkillDraft")
      const canonical = Buffer.from(vector.canonicalBase64, "base64")
      assert.equal(createHash("sha256").update(canonical).digest("hex"), vector.sha256)
      assert.deepEqual(JSON.parse(canonical.toString("utf8")), vector.projection)
    } else assert.equal(vector.canonicalBase64, undefined)
  }
  const proto = await readFile(new URL("../proto/kokoro/platform/v1/platform_runtime.proto", platformV4Url), "utf8")
  assert.match(proto, /message ValidateSkillDraftRequest \{[\s\S]*?string attempt_id = 7;[\s\S]*?\}/u)
  const generated = await readFile(new URL("../../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts", import.meta.url), "utf8")
  assert.match(generated, /ValidateSkillDraftRequest[\s\S]*?field: string attempt_id = 7;/u)
})

test("ValidateSkillDraft semantic gate rejects schema, status, header and legacy-operation drift", async () => {
  const { openapi, baseline } = await readContract()
  for (const broken of [
    openapi.replace("default-closed BFF Validate runtime route", "active BFF Validate route"),
    openapi.replace("required: [attempt_id]\n      additionalProperties: false", "required: []\n      additionalProperties: false"),
    openapi.replace("valid: { type: boolean, const: true }", "valid: { type: boolean }"),
    openapi.replace("manifest_identity: { type: string, pattern: '^zip-v1:sha256:[a-f0-9]{64}$' }", "manifest_identity: { type: string }"),
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

test("PublishSkill exposes one inactive user-only command with no request body", async () => {
  const { openapi, baseline } = await readContract()
  assert.ok(baseline.some(({ method, path, operation_id }) => method === "POST" && path === "/v1/skills/{skill_id}/publish" && operation_id === "publishSkill"))
  const start = openapi.indexOf("  /v1/skills/{skill_id}/publish:")
  const end = openapi.indexOf("  /v1/skills/{name}/revisions:", start)
  assert.ok(start >= 0 && end > start)
  const operation = openapi.slice(start, end)
  assert.match(operation, /operationId: publishSkill/u)
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
  const [manifest, identities, schemas, fixture, proto] = await Promise.all([
    ...["manifest.json", "command-identities.json", "command-schemas.json", "vectors/command-projection.json"].map(async (file) =>
      JSON.parse(await readFile(new URL(file, platformV4Url), "utf8")),
    ),
    readFile(new URL("../proto/kokoro/platform/v1/platform_runtime.proto", platformV4Url), "utf8"),
  ])
  assert.equal(manifest.artifactVersion, "4.0.0")
  assert.equal(manifest.status, "inactive")
  assert.equal(manifest.routable, false)
  assert.equal(identities.commandDigestVersion, "3.0.0")
  const command = identities.commands.find(({ operation }) => operation === "skill.publish")
  assert.equal(command.fqMethod, "kokoro.platform.v1.SkillCatalogService/PublishSkill")
  assert.deepEqual(
    command.commandMembers.map(({ wireField }) => wireField),
    ["skill_id", "product_context", "visibility"],
  )
  assert.deepEqual(schemas.schemas["skill.publish"].properties.command.required, ["skill_id", "product_context", "visibility"])
  assert.match(proto, /SKILL_SCOPE_KIND_PERSONAL = 1;/u)
  assert.match(proto, /SKILL_STATUS_ACTIVE = 2;/u)
  assert.match(
    proto,
    /message PublishSkillRequest \{[\s\S]*?SkillId skill_id = 3;[\s\S]*?SkillScopeKind visibility = 4;[\s\S]*?ProductCatalogContext product_context = 5;/u,
  )
  assert.match(
    proto,
    /message PublishSkillResponse \{[\s\S]*?SkillSourceRef source_ref = 1;[\s\S]*?uint64 revision = 2;[\s\S]*?SkillStatus status = 3;[\s\S]*?string event_id = 4;[\s\S]*?bool replayed = 5;/u,
  )
  const vectors = fixture.vectors.filter(({ operation }) => operation === "skill.publish")
  assert.equal(vectors.length, 8)
  for (const vector of vectors) {
    const raw = JSON.parse(Buffer.from(vector.rawBase64, "base64").toString("utf8"))
    if (vector.expectedError === "none") {
      assert.equal(raw.command_digest_version, "3.0.0")
      assert.equal(raw.fq_method, command.fqMethod)
      const canonical = Buffer.from(vector.canonicalBase64, "base64")
      assert.equal(createHash("sha256").update(canonical).digest("hex"), vector.sha256)
      assert.deepEqual(JSON.parse(canonical.toString("utf8")), vector.projection)
      if (vector.name === "skill.publish.wire.valid") assert.equal(vector.projection.command.visibility, 1)
    } else assert.equal(vector.canonicalBase64, undefined)
  }
})

test("PublishSkill semantic gate rejects body, state, status and legacy-operation reference drift", async () => {
  const { openapi, baseline } = await readContract()
  const notFound = openapi.slice(openapi.indexOf("    SkillPublishNotFound:"), openapi.indexOf("    SkillPublishConflict:"))
  const rateLimited = openapi.slice(openapi.indexOf("    SkillPublishRateLimited:"), openapi.indexOf("    SkillPublishBadGateway:"))
  for (const broken of [
    openapi.replace("x-kokoro-empty-body: required", "x-kokoro-empty-body: optional"),
    openapi.replace("x-kokoro-fixed-visibility: personal", "x-kokoro-fixed-visibility: organization"),
    openapi.replace("      operationId: publishSkill", "      operationId: publishSkill\n      requestBody:\n        required: true"),
    openapi.replace("status: { type: string, const: active }", "status: { type: string, const: draft }"),
    openapi.replace("source_ref: { type: string, pattern: '^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }", "source_ref: { type: string }"),
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
  const [manifest, identities, schemas, projections] = await Promise.all(
    ["manifest.json", "command-identities.json", "command-schemas.json", "vectors/command-projection.json"].map(async (file) =>
      JSON.parse(await readFile(new URL(file, platformV4Url), "utf8")),
    ),
  )
  assert.equal(manifest.artifactVersion, "4.0.0")
  assert.equal(manifest.status, "inactive")
  assert.equal(manifest.routable, false)
  assert.equal(identities.commandDigestVersion, "3.0.0")
  const begin = identities.commands.find((command) => command.operation === "skill.begin_package_upload")
  assert.equal(begin?.fqMethod, "kokoro.platform.v1.SkillCatalogService/BeginSkillPackageUpload")
  assert.deepEqual(
    begin.commandMembers.map(({ wireField }) => wireField),
    ["skill_id", "product_context", "filename", "mime_type", "size_bytes", "content_sha256", "replaces_attempt_id"],
  )
  assert.equal(schemas.schemas["skill.begin_package_upload"].properties.command_digest_version.const, "3.0.0")
  assert.equal(projections.vectors.filter((vector) => vector.operation === "skill.begin_package_upload").length, 14)
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
