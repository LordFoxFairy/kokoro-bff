import { restoreClosureMainContract } from "../scripts/verify-closure-integration-contract.mjs"
import { restorePublic153ArchivedTasksContract } from "../scripts/archived-tasks-public-contract.mjs"
import { restorePublic152SharedTasksContract } from "../scripts/shared-tasks-public-contract.mjs"
import { restorePublic151AccountProfileContract } from "../scripts/account-profile-public-contract.mjs"
import { restorePublic15AccountSessionContract } from "../scripts/account-session-public-contract.mjs"
import { inspectSkillProductContract, stripSkillProductSource } from "../scripts/verify-skill-product-contract.mjs"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, readdir, stat } from "node:fs/promises"
import { test } from "node:test"

import { compareOperationBaseline, inspectOpenApiGovernance } from "../scripts/check-contract.mjs"
import * as iamGenerator from "../scripts/generate-iam-http-client.mjs"
import * as schedulerGenerator from "../scripts/generate-scheduler-contracts.mjs"

const governedOperation = `openapi: 3.1.0
paths:
  /v1/projects:
    post:
      operationId: createProject
      x-kokoro-owner: kokoro-bff
      x-kokoro-visibility: public
      x-kokoro-stability: beta
      x-kokoro-idempotency: required
      x-kokoro-permission: project.create
      responses:
        '201':
          description: Created
`

test("OpenAPI governance accepts a fully classified public operation", () => {
  assert.deepEqual(inspectOpenApiGovernance(governedOperation), [])
})

test("OpenAPI governance rejects missing metadata and unsafe idempotency declarations", () => {
  const missing = governedOperation
    .replace("      x-kokoro-permission: project.create\n", "")
    .replace("      x-kokoro-idempotency: required", "      x-kokoro-idempotency: none")

  assert.deepEqual(inspectOpenApiGovernance(missing), [
    "POST /v1/projects must declare x-kokoro-permission",
    "POST /v1/projects must declare x-kokoro-idempotency=required",
  ])
})

test("only the six IAM-delegated Team mutations may declare no local receipt", () => {
  for (const [method, path, operationId] of [
    ["POST", "/v1/team/invitations", "createTeamInvitation"],
    ["POST", "/v1/team/invitations/{invitation_id}/resend", "resendTeamInvitation"],
    ["DELETE", "/v1/team/invitations/{invitation_id}", "cancelTeamInvitation"],
    ["PUT", "/v1/team/members/{member_id}/roles", "replaceTeamMemberRoles"],
    ["DELETE", "/v1/team/members/{member_id}", "removeTeamMember"],
    ["DELETE", "/v1/team/members/me", "leaveTeam"],
  ]) {
    const operation = governedOperation
      .replace("/v1/projects", path)
      .replace("    post:", `    ${method.toLowerCase()}:`)
      .replace("createProject", operationId)
      .replace("x-kokoro-idempotency: required", "x-kokoro-idempotency: none")
    assert.deepEqual(inspectOpenApiGovernance(operation), [], operationId)
    assert.match(inspectOpenApiGovernance(operation.replace(path, "/v1/projects")).join(" "), /idempotency=required/u)
    assert.match(inspectOpenApiGovernance(operation.replace(`    ${method.toLowerCase()}:`, "    patch:")).join(" "), /idempotency=required/u)
  }
  const unrelated = governedOperation.replace("createProject", "newMutation").replace("x-kokoro-idempotency: required", "x-kokoro-idempotency: none")
  assert.match(inspectOpenApiGovernance(unrelated).join(" "), /idempotency=required/u)
})

test("the breaking baseline rejects removed or renamed v1 operations", () => {
  const baseline = [
    { method: "POST", path: "/v1/projects", operation_id: "createProject" },
    { method: "GET", path: "/v1/projects", operation_id: "listProjects" },
  ]

  assert.deepEqual(compareOperationBaseline(governedOperation, baseline), ["breaking change: GET /v1/projects (listProjects) was removed"])
})

test("the repository canonical OpenAPI passes governance and its frozen v1 surface", async () => {
  const [openapi, baselineDocument] = await Promise.all([
    readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"),
    readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8"),
  ])
  const baseline = JSON.parse(baselineDocument).operations

  assert.deepEqual(inspectOpenApiGovernance(openapi), [])
  assert.deepEqual(compareOperationBaseline(openapi, baseline), [])
  assert.ok(baseline.some(({ method, path, operation_id }) => method === "GET" && path === "/v1/billing/summary" && operation_id === "getBillingSummary"))
  assert.ok(baseline.some(({ method, path, operation_id }) => method === "GET" && path === "/v1/billing/ledger" && operation_id === "getBillingLedger"))
})

function inspectLibraryFileContract(openapi) {
  const start = openapi.indexOf("  /v1/library:")
  const end = openapi.indexOf("  /v1/billing/plans:", start)
  const operation = start < 0 || end < 0 ? "" : openapi.slice(start, end)
  const errors = []
  if (!operation.includes("operationId: listLibrary")) errors.push("GET /v1/library must retain operationId=listLibrary")
  for (const marker of [
    "required: true",
    "enum: [file, artifact]",
    "maximum: 100",
    "maxLength: 4096",
    "'200':",
    "'400':",
    "'502':",
    "'503':",
    "#/components/schemas/LibraryListResponse",
    "operationId: getLibraryArtifact",
    "operationId: downloadLibraryArtifact",
    "artifact_download_busy",
  ])
    if (!operation.includes(marker)) errors.push(`GET /v1/library missing ${marker}`)
  const file = openapi.split("    LibraryFileItem:")[1]?.split("    LibraryArtifactItem:")[0] ?? ""
  for (const marker of ["kind", "enum: [file]", "asset_id", "filename", "mime_type", "size_bytes", "content_sha256", "scan_state", "created_at"])
    if (!file.includes(marker)) errors.push(`LibraryFileItem missing ${marker}`)
  if (/artifact_id|session_id|download_url|upload_id/u.test(file))
    errors.push("Library file response must not impersonate Artifact or expose transfer references")
  const artifact = openapi.split("    LibraryArtifactItem:")[1]?.split("    LibraryArtifactResponse:")[0] ?? ""
  for (const marker of ["enum: [artifact]", "conversation_id", "artifact_id", "artifact_kind", "title", "source_run_id", "delivered_at"])
    if (!artifact.includes(marker)) errors.push(`LibraryArtifactItem missing ${marker}`)
  const page = openapi.split("    LibraryListResponse:")[1]?.split("    ProjectResourceListResponse:")[0] ?? ""
  for (const marker of ["oneOf", "#/components/schemas/LibraryEmptyPage", "#/components/schemas/LibraryFilePage", "#/components/schemas/LibraryArtifactPage"])
    if (!page.includes(marker)) errors.push(`LibraryListResponse missing ${marker}`)
  const variants = [
    ["LibraryEmptyPage", "LibraryFilePage", ["maxItems: 0", "next_cursor"]],
    ["LibraryFilePage", "LibraryArtifactPage", ["minItems: 1", "maxItems: 100", "items: { $ref: '#/components/schemas/LibraryFileItem' }", "next_cursor"]],
    [
      "LibraryArtifactPage",
      "LibraryListResponse",
      ["minItems: 1", "maxItems: 100", "items: { $ref: '#/components/schemas/LibraryArtifactItem' }", "next_cursor"],
    ],
  ]
  for (const [name, next, markers] of variants) {
    const shape = openapi.split(`    ${name}:`)[1]?.split(`    ${next}:`)[0] ?? ""
    for (const marker of markers) if (!shape.includes(marker)) errors.push(`${name} missing ${marker}`)
    if (shape.includes("oneOf:")) errors.push(`${name} must not allow mixed item kinds`)
  }
  if (operation.includes("storage_integration_unavailable")) errors.push("GET /v1/library retains fixed degraded response")
  return errors
}

test("Library publishes explicit personal file 200 and rejects contract drift", async () => {
  const openapi = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  assert.deepEqual(inspectLibraryFileContract(openapi), [])

  const libraryStart = openapi.indexOf("  /v1/library:")
  const libraryEnd = openapi.indexOf("  /v1/billing/plans:", libraryStart)
  const libraryOperation = openapi.slice(libraryStart, libraryEnd)
  const withoutFile = openapi.replace(libraryOperation, libraryOperation.replace("enum: [file, artifact]", "enum: [artifact]"))
  assert.ok(inspectLibraryFileContract(withoutFile).some((error) => error.includes("enum: [file, artifact]")))
  const filePage = openapi.split("    LibraryFilePage:")[1]?.split("    LibraryArtifactPage:")[0] ?? ""
  const mixedPage = openapi.replace(
    filePage,
    filePage.replace(
      "items: { $ref: '#/components/schemas/LibraryFileItem' }",
      "items:\n                oneOf:\n                  - $ref: '#/components/schemas/LibraryFileItem'\n                  - $ref: '#/components/schemas/LibraryArtifactItem'",
    ),
  )
  assert.ok(inspectLibraryFileContract(mixedPage).some((error) => error.includes("LibraryFilePage")))
})

test("the IAM consumer pins the complete 0.14.0 owner artifact and generates only approved admission, human qualification, Skill, Team and invitation operations", async () => {
  const commit = "7cbe988d8f3868f293a15120135e1885de8516ff"
  const digest = "ab9c644e73bb3e89f11204035c1a2f78a828d493ff5029ba3ff85056bc01d9c5"
  const [manifestSource, vendor, config, lockfile, sdk, types] = await Promise.all([
    readFile(new URL("../contract/dependencies/iam-http.json", import.meta.url), "utf8"),
    readFile(new URL(`../contract/vendor/kokoro-iam/${commit}/iam.internal.v1.json`, import.meta.url)),
    readFile(new URL("../openapi-ts.iam.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../pnpm-lock.yaml", import.meta.url)),
    readFile(new URL("../src/generated/iam-http/sdk.gen.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/generated/iam-http/types.gen.ts", import.meta.url), "utf8"),
  ])
  const sha256 = (value) => createHash("sha256").update(value).digest("hex")
  const manifest = JSON.parse(manifestSource)
  const owner = JSON.parse(vendor.toString("utf8"))
  assert.equal(sha256(vendor), digest)
  assert.equal(owner.info.version, "0.14.0")
  const admissionSchema = owner.paths["/internal/v1/session-authorizations/verify"].post.responses["200"].content["application/json"].schema.properties.data
  assert.ok(admissionSchema.required.includes("platform_admin"))
  assert.deepEqual(admissionSchema.properties.platform_admin, { type: "boolean" })
  assert.match(types, /platform_admin: boolean/u)
  assert.ok(Object.keys(owner.paths).length > 1)
  assert.deepEqual(manifest.owner, {
    repository_path: "apps/kokoro-iam",
    repository_commit: commit,
    contract_version: "0.14.0",
    contract_path: "contract/openapi/iam.internal.v1.json",
    contract_sha256: digest,
  })
  assert.deepEqual(manifest.generator, {
    package: "@hey-api/openapi-ts",
    version: "0.99.0",
    config_path: "openapi-ts.iam.config.ts",
    config_sha256: sha256(config),
  })
  assert.deepEqual(manifest.runtime, {
    node: "22.22.2",
    pnpm: "11.25.0",
    zod: "4.5.4",
  })
  assert.equal(manifest.lockfile_sha256, sha256(lockfile))
  assert.equal(manifest.generated.length, 16)
  assert.match(sdk, /export const verifySessionAuthorization/u)
  for (const operation of [
    "listAccountSessions",
    "revokeAccountSession",
    "listTenantMembers",
    "listTenantInvitations",
    "listTenantRoles",
    "createTenantInvitation",
    "resendTenantInvitation",
    "cancelTenantInvitation",
    "replaceTenantMemberRoles",
    "removeTenantMember",
    "leaveTenant",
    "getTenantInvitationContext",
    "acceptTenantInvitation",
    "rejectTenantInvitation",
  ]) {
    assert.match(sdk, new RegExp(`export const ${operation}`, "u"))
  }
  assert.deepEqual([...sdk.matchAll(/^export const ([A-Za-z0-9_]+)\s*=/gmu)].map((match) => match[1]).sort(), [
    "acceptTenantInvitation",
    "cancelTenantInvitation",
    "checkAuthorization",
    "checkTenantSkillAuthorization",
    "createTenantInvitation",
    "getTenantInvitationContext",
    "leaveTenant",
    "listAccountSessions",
    "listTenantInvitations",
    "listTenantMembers",
    "listTenantRoles",
    "rejectTenantInvitation",
    "removeTenantMember",
    "replaceTenantMemberRoles",
    "resendTenantInvitation",
    "resolveTenantPublisherProfiles",
    "revokeAccountSession",
    "updateAccountProfile",
    "verifySessionAuthorization",
  ])
  assert.doesNotMatch(`${sdk}\n${types}`, /getMetrics|healthz|readyz/u)
  assert.match(config, /POST \/internal\/v1\/authorization\/check/u)
  assert.match(config, /POST \/internal\/v1\/session-authorizations\/verify/u)
  assert.doesNotMatch(config, /POST \/internal\/v1\/execution-authorizations\/verify/u)
  assert.doesNotMatch(config, /POST \/internal\/v1\/platform-workload-tokens\/introspect/u)
  for (const resource of ["members", "invitations", "roles"]) {
    assert.match(config, new RegExp(`GET /internal/v1/tenants/\\{tenant_id\\}/${resource}`, "u"))
  }
})

test("the IAM generator normalizer and generated-tree allowlist fail closed on drift", async () => {
  assert.equal(iamGenerator.replaceExactInSource("before TOKEN after", "TOKEN", "FIXED", 1, "fixture"), "before FIXED after")
  assert.throws(() => iamGenerator.replaceExactInSource("TOKEN", "TOKEN", "FIXED", 2, "fixture"), /expected 2 generator matches, found 1/u)
  const manifest = JSON.parse(await readFile(new URL("../contract/dependencies/iam-http.json", import.meta.url), "utf8"))
  const files = manifest.generated.map(({ path }) => path)
  assert.doesNotThrow(() => iamGenerator.assertGeneratedAllowlist(files, ["client", "core"], "fixture"))
  assert.throws(() => iamGenerator.assertGeneratedAllowlist([...files, "manual.ts"], ["client", "core"], "fixture"), /file allowlist drifted/u)
})

test("the public Platform projection reads expose strict native pages and error envelopes", async () => {
  const current = await readFile(new URL("../contract/tests/public11-historical.openapi.yaml", import.meta.url), "utf8")
  assert.deepEqual(inspectSkillProductContract(current), [])
  const openapi = stripSkillProductSource(current)
  for (const [start, end] of [
    ["  /v1/skills:\n", "  /v1/skills/{skill_id}:\n"],
    ["  /v1/skills/pool:\n", "  /v1/skills/catalog:\n"],
    ["  /v1/skills/catalog:\n", "  /v1/skills/quota:\n"],
    ["  /v1/mcp/servers:\n", "  /v1/mcp/servers/{name}/enable:\n"],
  ]) {
    const operation = openapi.slice(openapi.indexOf(start), openapi.indexOf(end)).split("\n    post:")[0]
    for (const [status, component] of [
      ["400", "BadRequest"],
      ["401", "Unauthorized"],
      ["403", "Forbidden"],
      ["502", "BadGateway"],
      ["503", "Unavailable"],
    ])
      assert.ok(operation.includes(`'${status}': { $ref: '#/components/responses/PlatformProjectionRead${component}' }`), `${start} ${status}`)
    assert.match(operation, /'429': \{ \$ref: '#\/components\/responses\/PlatformProjectionReadRateLimited' \}/u)
  }
  for (const [name, next] of [
    ["SkillListResponse", "SkillPoolResponse"],
    ["SkillPoolResponse", "SkillCatalogResponse"],
    ["SkillCatalogResponse", "SkillRevision"],
    ["McpServerListResponse", "McpServerResponse"],
  ]) {
    const schema = openapi.slice(openapi.indexOf(`    ${name}:\n`), openapi.indexOf(`    ${next}:\n`))
    assert.match(schema, /required: \[data\]/u)
    assert.match(schema, /additionalProperties: false/u)
    assert.doesNotMatch(schema, /meta:/u)
  }
  assert.match(openapi, /McpServerProjection:[\s\S]*?required: \[server_id, provider_key, server_identity, transport, declaration_digest, status\]/u)
  assert.match(openapi, /PlatformProjectionReadErrorResponse:[\s\S]*?required: \[error\]/u)
})

test("the public AG-UI contract exposes only durable opaque BFF cursors", async () => {
  const openapi = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const eventOperation = openapi.slice(openapi.indexOf("  /v1/sessions/{id}/events:"), openapi.indexOf("  /v1/sessions/{id}/runs/{runId}/control:"))
  const eventCursor = openapi.slice(openapi.indexOf("    EventCursor:"), openapi.indexOf("    RequestMeta:"))
  const eventStream = openapi.slice(openapi.indexOf("    SessionEventStream:"), openapi.indexOf("    RenameSessionRequest:"))

  assert.match(eventOperation, /'400': \{ \$ref: '#\/components\/responses\/BadRequest' \}/u)
  assert.match(eventOperation, /'410': \{ \$ref: '#\/components\/responses\/Gone' \}/u)
  assert.match(eventOperation, /'502': \{ \$ref: '#\/components\/responses\/BadGateway' \}/u)
  assert.match(eventOperation, /'503': \{ \$ref: '#\/components\/responses\/ServiceUnavailable' \}/u)
  assert.match(eventCursor, /type: string/u)
  assert.match(eventCursor, /pattern: '\^agui_\[0-9a-f\]\{32\}\$'/u)
  assert.match(eventCursor, /Clients must not parse or construct/u)
  assert.doesNotMatch(eventCursor, /type: integer/u)
  assert.match(eventStream, /id: agui_[0-9a-f]{32}/u)
  assert.match(eventStream, /"type":"RUN_FINISHED"/u)
  assert.doesNotMatch(eventStream, /"kind":"run\.completed"/u)
})

test("the repository exposes executable contract, schema, and strictness gates", async () => {
  const [packageDocument, tsconfigDocument, contractReadme] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../tsconfig.json", import.meta.url), "utf8"),
    readFile(new URL("../contract/README.md", import.meta.url), "utf8"),
  ])
  const packageJson = JSON.parse(packageDocument)
  const tsconfig = JSON.parse(tsconfigDocument)

  assert.equal(packageJson.packageManager, "pnpm@11.25.0")
  assert.match(packageJson.scripts["contract:lint"], /contract\/openapi\/v1\/openapi\.yaml/u)
  assert.equal(packageJson.scripts["contract:semantic"], "node scripts/verify-openapi.ts")
  assert.match(packageJson.scripts["contract:test"], /test\/contract\/openapi-contract\.test\.mjs/u)
  assert.match(packageJson.scripts["contract:test"], /test\/agent-control-adapter\.test\.ts/u)
  assert.match(packageJson.scripts["format:check"], /^prettier --check/u)
  assert.match(packageJson.scripts["format:check"], /src\/http\/routes\/platform-projection\.ts/u)
  assert.match(packageJson.scripts["format:check"], /src\/generated\/scheduler/u)
  assert.match(packageJson.scripts["format:check"], /src\/generated\/iam-http/u)
  assert.equal(packageJson.scripts["contract:check:agent"], "node scripts/generate-agent-http-client.mjs --check")
  assert.equal(packageJson.scripts["contract:check:billing"], "node scripts/generate-billing-http-client.mjs --check")
  assert.equal(packageJson.scripts["contract:check:platform-http"], "node scripts/generate-platform-http-client.mjs --check")
  assert.equal(packageJson.scripts["contract:generate:iam"], "node scripts/generate-iam-http-client.mjs --write")
  assert.equal(packageJson.scripts["contract:check:iam"], "node scripts/generate-iam-http-client.mjs --check")
  assert.equal(packageJson.scripts["contract:generate:system"], "node scripts/generate-system-http-client.mjs --write")
  assert.equal(packageJson.scripts["contract:check:system"], "node scripts/generate-system-http-client.mjs --check")
  assert.equal(packageJson.scripts["contract:check:skill-download"], "node --import tsx scripts/generate-skill-download-policy.mjs --check")
  assert.equal(packageJson.scripts["contract:generate:scheduler"], "node scripts/generate-scheduler-contracts.mjs --write")
  assert.equal(packageJson.scripts["contract:check:scheduler"], "node scripts/generate-scheduler-contracts.mjs --check")
  assert.equal(packageJson.scripts["contract:check:connector-command-errors"], "node --import tsx scripts/generate-connector-command-errors.mjs")
  assert.deepEqual(
    packageJson.scripts["contract:check"].split(" && ").sort(),
    [
      "pnpm contract:check:connector-command-errors",
      "pnpm contract:check:project-execution",
      "pnpm contract:check:agent",
      "pnpm contract:check:billing",
      "pnpm contract:check:platform-http",
      "pnpm contract:check:iam",
      "pnpm contract:check:system",
      "pnpm contract:check:iam-relay",
      "pnpm contract:check:skill-download",
      "pnpm contract:check:scheduler",
      "pnpm contract:check:platform",
      "pnpm contract:check:storage",
      "pnpm contract:lint",
      "pnpm contract:semantic",
      "pnpm contract:test",
    ].sort(),
  )
  assert.equal(packageJson.devDependencies["@hey-api/openapi-ts"], "0.99.0")
  assert.equal(packageJson.devDependencies.prettier, "3.9.6")
  assert.equal(packageJson.devDependencies.typescript, "5.9.3")
  assert.equal(packageJson.dependencies.zod, "4.5.4")
  assert.equal(packageJson.scripts["db:apply-schema"], "node scripts/apply-schema.mjs")
  assert.equal(tsconfig.compilerOptions.useUnknownInCatchVariables, true)
  for (const heading of ["Owner", "Visibility", "Version", "Generation", "Breaking policy", "Provenance"]) {
    assert.match(contractReadme, new RegExp(`^## ${heading}$`, "mu"), heading)
  }
})

test("the Scheduler consumer pins immutable producer-owned control and webhook contracts", async () => {
  const ownerCommit = "3bb7ff61b0d72418aa048ca35b8c3f144a33f13e"
  const ownerDigest = "d349eae8bba207074b1edf91acd9f08e94f39a27363441f45186c1799159c999"
  const [manifestDocument, vendor, config, lockfile, packageDocument] = await Promise.all([
    readFile(new URL("../contract/dependencies/scheduler.json", import.meta.url), "utf8"),
    readFile(new URL(`../contract/vendor/kokoro-scheduler/${ownerCommit}/openapi.yaml`, import.meta.url)),
    readFile(new URL("../openapi-ts.scheduler.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../pnpm-lock.yaml", import.meta.url)),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ])
  const sha256 = (value) => createHash("sha256").update(value).digest("hex")
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
    "sdk.gen.ts",
    "types.gen.ts",
    "zod.gen.ts",
  ]
  const generated = await Promise.all(
    generatedFiles.map(async (file) => ({
      path: file,
      sha256: sha256(await readFile(new URL(`../src/generated/scheduler/${file}`, import.meta.url))),
    })),
  )
  assert.deepEqual(JSON.parse(manifestDocument), {
    schema_version: 1,
    status: "generated",
    owner: {
      repository_path: "apps/kokoro-scheduler",
      repository_commit: ownerCommit,
      contract_version: "3.0.0",
      contract_path: "contract/openapi/v1/openapi.yaml",
      contract_sha256: ownerDigest,
    },
    generator: {
      package: "@hey-api/openapi-ts",
      version: "0.99.0",
      config_path: "openapi-ts.scheduler.config.ts",
      config_sha256: sha256(config),
    },
    runtime: { node: "22.22.2", pnpm: "11.25.0", zod: "4.5.4" },
    lockfile_sha256: sha256(lockfile),
    generated,
  })
  assert.equal(sha256(vendor), ownerDigest)
  // The owner publishes JSON bytes as valid YAML; preserve them without reserialization.
  const owner = JSON.parse(vendor.toString("utf8"))
  assert.equal(owner.info.version, "3.0.0")
  const control = owner.paths["/internal/scheduler/v1/schedules/{name}"]
  assert.equal(control.get.operationId, "getCurrentSchedule")
  assert.equal(control.post.operationId, "createSchedule")
  assert.equal(control.put.operationId, "replaceSchedule")
  assert.equal(control.delete.operationId, "deleteSchedule")
  assert.deepEqual(control.post["x-kokoro-control-error-codes"], {
    409: ["schedule_already_exists"],
  })
  assert.deepEqual(control.put["x-kokoro-control-error-codes"], {
    404: ["schedule_not_found"],
    409: ["schedule_changed"],
  })
  assert.deepEqual(control.delete["x-kokoro-control-error-codes"], {
    404: ["schedule_not_found"],
  })
  assert.equal(
    Object.keys(owner.paths).some((name) => name.includes(`/${["jo", "bs"].join("")}`)),
    false,
  )
  const parameters = owner.components.parameters
  for (const method of ["post", "put"]) {
    const webhook = owner.webhooks.scheduleOccurrenceDispatch[method]
    assert.equal(webhook["x-kokoro-owner"], "kokoro-scheduler")
    assert.equal(webhook["x-kokoro-visibility"], "event-protocol")
    assert.equal(webhook["x-kokoro-idempotency"], "stable-occurrence-key")
    assert.deepEqual(webhook["x-kokoro-retryable-statuses"], [408, 425, 429, "5xx"])
    assert.deepEqual(
      webhook.parameters.map(({ $ref }) => parameters[$ref.split("/").at(-1)].name),
      ["X-Kokoro-Tenant-Id", "X-Kokoro-Scheduler-Schedule", "X-Kokoro-Scheduler-Occurrence", "X-Request-Id", "Idempotency-Key", "traceparent"],
    )
    assert.ok(webhook.parameters.every(({ $ref }) => parameters[$ref.split("/").at(-1)].required === true))
    assert.deepEqual(webhook.requestBody.content["application/json"].schema, {
      type: "object",
    })
  }
  const packageJson = JSON.parse(packageDocument)
  assert.equal(packageJson.devDependencies["@hey-api/openapi-ts"], "0.99.0")
  assert.equal(packageJson.devDependencies.typescript, "5.9.3")
  assert.equal(packageJson.dependencies.zod, "4.5.4")
  assert.equal(packageJson.packageManager, "pnpm@11.25.0")
  assert.equal(packageJson.dependencies["@hey-api/client-fetch"], undefined)
  assert.match(lockfile.toString("utf8"), /@hey-api\/openapi-ts[\s\S]*?specifier: 0\.99\.0/u)
  assert.match(config, new RegExp(ownerCommit, "u"))
  assert.doesNotThrow(() => schedulerGenerator.assertGeneratedAllowlist(generatedFiles, ["client", "core"], "fixture"))
  assert.throws(() => schedulerGenerator.assertGeneratedAllowlist(generatedFiles.slice(1), ["client", "core"], "fixture"), /file allowlist drifted/u)
})

test("R124 operation inventory has one governed public Run process page and no legacy process alias", async () => {
  const [openapi, baselineDocument] = await Promise.all([
    readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"),
    readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8"),
  ])
  const baseline = JSON.parse(baselineDocument).operations
  const matches = baseline.filter(
    ({ method, path, operation_id }) => method === "GET" && path === "/v1/sessions/{id}/runs/{runId}/process" && operation_id === "getRunProcess",
  )
  assert.equal(matches.length, 1)
  assert.equal(
    baseline.some(({ path }) => /process-(?:latest|legacy)|execution-process/u.test(path)),
    false,
  )
  assert.deepEqual(inspectOpenApiGovernance(openapi), [])
  assert.deepEqual(compareOperationBaseline(openapi, baseline), [])
})

test("R257 personalization CAS none exception requires the exact method path and operation identity", () => {
  const exact = governedOperation
    .replace("/v1/projects:", "/v1/preferences/personalization:")
    .replace("    post:", "    put:")
    .replace("operationId: createProject", "operationId: replaceSelfPersonalization")
    .replace("x-kokoro-idempotency: required", "x-kokoro-idempotency: none")
    .replace("project.create", "personalization.self.write")
  assert.deepEqual(inspectOpenApiGovernance(exact), [])
  for (const changed of [
    exact.replace("    put:", "    patch:"),
    exact.replace("/v1/preferences/personalization:", "/v1/preferences/knowledge:"),
    exact.replace("replaceSelfPersonalization", "replaceOtherPersonalization"),
  ])
    assert.match(inspectOpenApiGovernance(changed).join("\n"), /idempotency=required/u)
})

test("R267 lifecycle operations remain frozen in the current public 8.10 inventory", async () => {
  const openapi = await readFile(new URL("../contract/tests/public11-historical.openapi.yaml", import.meta.url), "utf8")
  assert.match(openapi, /^  version: 11\.0\.0$/mu)
  assert.equal((openapi.match(/operationId: createPersonalSkillVersion/gu) ?? []).length, 1)
  assert.equal((openapi.match(/operationId: withdrawPersonalSkill/gu) ?? []).length, 1)
})

test("R345 public 8.9 adds one required UTC Skill update instant to exactly four closed schemas and keeps 111 operations", async () => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const openapi = await readFile(new URL("../contract/tests/public11-historical.openapi.yaml", import.meta.url), "utf8")
  const { stripSkillExamplePromptsAdditions } = await import("../scripts/verify-skill-example-prompts-contract.mjs")
  const document = stripSkillExamplePromptsAdditions(load(stripSkillProductSource(openapi)))
  assert.equal(document.info.version, "8.9.0")
  const operations = Object.values(document.paths).flatMap((pathItem) =>
    Object.keys(pathItem).filter((method) => ["get", "post", "put", "patch", "delete", "head", "options", "trace"].includes(method)),
  )
  assert.equal(operations.length, 111)
  const profiles = {
    Skill: {
      required: ["source_ref", "name", "description", "content_hash", "scope", "revision", "enabled", "categories", "skill_updated_at"],
      properties: ["source_ref", "name", "description", "content_hash", "scope", "revision", "enabled", "installed", "categories", "skill_updated_at"],
    },
    ManagedPersonalSkillResource: {
      required: ["skill_id", "source_ref", "series_id", "revision", "name", "summary", "tags", "status", "skill_updated_at"],
      properties: ["skill_id", "source_ref", "series_id", "revision", "name", "summary", "tags", "status", "skill_updated_at"],
    },
    PublishedPersonalSkillResource: {
      required: ["skill_id", "source_ref", "revision", "status", "name", "summary", "tags", "skill_updated_at"],
      properties: ["skill_id", "source_ref", "revision", "status", "name", "summary", "tags", "skill_updated_at"],
    },
    SkillInstallation: {
      required: [
        "installation_id",
        "source_ref",
        "series_id",
        "revision",
        "installed",
        "enabled",
        "installed_at",
        "updated_at",
        "display_name",
        "summary",
        "source_status",
        "skill_updated_at",
      ],
      properties: [
        "installation_id",
        "source_ref",
        "series_id",
        "revision",
        "installed",
        "enabled",
        "installed_at",
        "updated_at",
        "removed_at",
        "display_name",
        "summary",
        "source_status",
        "skill_updated_at",
      ],
    },
  }
  for (const [name, profile] of Object.entries(profiles)) {
    const schema = document.components.schemas[name]
    assert.equal(schema.additionalProperties, false, `${name} remains closed`)
    assert.deepEqual([...schema.required].sort(), [...profile.required].sort(), `${name} required fields`)
    assert.deepEqual(Object.keys(schema.properties).sort(), [...profile.properties].sort(), `${name} exact properties`)
    assert.deepEqual(schema.properties.skill_updated_at, { type: "string", format: "date-time", pattern: "Z$" }, `${name} UTC instant`)
  }
})

test("R345 dedicated Skill update checker rejects each local shape drift without relying only on version or historical hash", async () => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { inspectSkillUpdatedAtDocument } = await import("../scripts/verify-skill-updated-at-contract.mjs")
  const openapi = await readFile(new URL("../contract/tests/public11-historical.openapi.yaml", import.meta.url), "utf8")
  assert.deepEqual(inspectSkillProductContract(openapi), [])
  const document = load(stripSkillProductSource(openapi))
  assert.deepEqual(inspectSkillUpdatedAtDocument(document), [])
  const schemas = ["Skill", "ManagedPersonalSkillResource", "PublishedPersonalSkillResource", "SkillInstallation"]
  for (const name of schemas) {
    const mutations = [
      ["required", (schema) => (schema.required = schema.required.filter((field) => field !== "skill_updated_at"))],
      ["property", (schema) => delete schema.properties.skill_updated_at],
      ["extra property", (schema) => (schema.properties.unreviewed = { type: "string" })],
      ["open object", (schema) => (schema.additionalProperties = true)],
      ["string", (schema) => (schema.properties.skill_updated_at.type = "integer")],
      ["format", (schema) => delete schema.properties.skill_updated_at.format],
      ["UTC Z", (schema) => (schema.properties.skill_updated_at.pattern = ".*")],
    ]
    for (const [label, mutate] of mutations) {
      const candidate = structuredClone(document)
      mutate(candidate.components.schemas[name])
      assert.match(inspectSkillUpdatedAtDocument(candidate).join("\n"), new RegExp(`R345 Skill updatedAt ${name}.*${label}`, "u"))
    }
  }
  const historical = structuredClone(document)
  historical.paths["/healthz"].get.summary = "Changed historical summary"
  assert.match(inspectSkillUpdatedAtDocument(historical).join("\n"), /parsed public 8\.8 surface drifted/u)
})

test("R342 Skill package inspection checker rejects route, closed-shape, uint64, nullable, error and old-surface drift", async () => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { inspectSkillPackageInspectionDocument } = await import("../scripts/verify-skill-package-inspection-contract.mjs")
  const openapi = await readFile(new URL("../contract/tests/public11-historical.openapi.yaml", import.meta.url), "utf8")
  assert.deepEqual(inspectSkillProductContract(openapi), [])
  const document = load(stripSkillProductSource(openapi))
  assert.deepEqual(inspectSkillPackageInspectionDocument(document), [])

  const mutations = [
    [
      "method",
      (candidate) => {
        candidate.paths["/v1/self/skills/{skill_id}/package"].post = candidate.paths["/v1/self/skills/{skill_id}/package"].get
        delete candidate.paths["/v1/self/skills/{skill_id}/package"].get
      },
    ],
    ["permission", (candidate) => (candidate.paths["/v1/self/skills/{skill_id}/package"].get["x-kokoro-permission"] = "product.skill.admin")],
    ["required field", (candidate) => candidate.components.schemas.SkillPackageInspectionData.required.splice(1, 1)],
    ["open shape", (candidate) => (candidate.components.schemas.SkillPackageInspectionData.additionalProperties = true)],
    ["extra field", (candidate) => (candidate.components.schemas.SkillPackageInspectionData.properties.secret = { type: "string" })],
    ["uint64", (candidate) => (candidate.components.schemas.SkillPackageInspectionData.properties.revision.pattern = "^[1-9][0-9]*$")],
    ["directory null", (candidate) => candidate.components.schemas.SkillPackageInspectionData.properties.selected_file.oneOf.shift()],
    [
      "unstable file code",
      (candidate) =>
        (candidate.components.responses.SkillPackageInspectionNotFound.content["application/json"].schema.allOf[1].properties.error.properties.code.enum = [
          "skill_package_file_not_found",
        ]),
    ],
    [
      "limit retryability",
      (candidate) =>
        (candidate.components.responses.SkillPackageInspectionRateLimited.content[
          "application/json"
        ].schema.allOf[1].oneOf[1].properties.error.properties.retryable.const = true),
    ],
    [
      "dependency retryability",
      (candidate) =>
        (candidate.components.responses.SkillPackageInspectionUnavailable.content[
          "application/json"
        ].schema.allOf[1].properties.error.properties.retryable.const = false),
    ],
    ["budget", (candidate) => (candidate.paths["/v1/self/skills/{skill_id}/package"].get.description = "Inspect a package.")],
    ["old surface", (candidate) => (candidate.paths["/healthz"].get.summary = "Changed historical summary")],
  ]
  for (const [name, mutate] of mutations) {
    const candidate = structuredClone(document)
    mutate(candidate)
    assert.notDeepEqual(inspectSkillPackageInspectionDocument(candidate), [], `${name} drift must fail closed`)
  }
})

test("R342 Skill package inspection checker binds response paths to the exact requested Skill and file", async (t) => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { inspectSkillPackageInspectionDocument } = await import("../scripts/verify-skill-package-inspection-contract.mjs")
  const openapi = await readFile(new URL("../contract/tests/public11-historical.openapi.yaml", import.meta.url), "utf8")
  assert.deepEqual(inspectSkillProductContract(openapi), [])
  const document = load(stripSkillProductSource(openapi))

  const cases = [
    {
      name: "managed source_ref must bind the decoded path skill_id",
      mutate(candidate) {
        const operation = candidate.paths["/v1/self/skills/{skill_id}/package"].get
        operation.description = operation.description.replace("source_ref equals skill:<skill_id> for the decoded path skill_id.", "")
      },
      expected: /getManagedPersonalSkillPackage.*source_ref.*path skill_id/u,
    },
    ...[
      ["managed", "/v1/self/skills/{skill_id}/package", "getManagedPersonalSkillPackage"],
      ["installation", "/v1/skill-installations/{installation_id}/package", "getPersonalSkillInstallationPackage"],
    ].map(([label, path, operationId]) => ({
      name: `${label} selected_file.path must bind the exact requested file_path`,
      mutate(candidate) {
        const operation = candidate.paths[path].get
        operation.description = operation.description.replace("For a file read, selected_file.path equals the requested file_path exactly.", "")
      },
      expected: new RegExp(`${operationId}.*selected_file\\.path.*requested file_path`, "u"),
    })),
    ...[
      ["directory", "SkillPackageInspectionFile", "file entry"],
      ["selected", "SkillPackageInspectionSelectedFile", "selected file"],
    ].flatMap(([label, schemaName, errorLabel]) => [
      {
        name: `${label} path rejects a non-string schema`,
        mutate(candidate) {
          candidate.components.schemas[schemaName].properties.path.type = "integer"
        },
        expected: new RegExp(`${errorLabel} path.*string`, "u"),
      },
      {
        name: `${label} path remains nonempty`,
        mutate(candidate) {
          delete candidate.components.schemas[schemaName].properties.path.minLength
        },
        expected: new RegExp(`${errorLabel} path.*nonempty`, "u"),
      },
      {
        name: `${label} path retains the complete safe-path semantics`,
        mutate(candidate) {
          const pathSchema = candidate.components.schemas[schemaName].properties.path
          pathSchema.description = pathSchema.description.replace("same safe-path rules as file_path", "")
        },
        expected: new RegExp(`${errorLabel} path.*safe-path`, "u"),
      },
    ]),
  ]

  for (const { name, mutate, expected } of cases) {
    await t.test(name, () => {
      const candidate = structuredClone(document)
      mutate(candidate)
      const errors = inspectSkillPackageInspectionDocument(candidate)
      assert.match(errors.join("\n"), expected)
      assert.doesNotMatch(errors.join("\n"), /parsed public 8\.7 surface drifted/u)
    })
  }
})

test("R350 public examples have strict six profiles and restore complete immutable 8.9 parent", async () => {
  const { createRequire } = await import("node:module")
  const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
  const { inspectSkillExamplePromptsDocument } = await import("../scripts/verify-skill-example-prompts-contract.mjs")
  const source = await readFile(new URL("../contract/tests/public11-historical.openapi.yaml", import.meta.url), "utf8")
  assert.deepEqual(inspectSkillProductContract(source), [])
  const doc = load(stripSkillProductSource(source))
  assert.deepEqual(inspectSkillExamplePromptsDocument(doc), [])
  for (const change of [
    (d) => delete d.components.schemas.Skill.properties.example_prompts,
    (d) => d.components.schemas.Skill.required.splice(d.components.schemas.Skill.required.indexOf("example_prompts"), 1),
    (d) => d.components.schemas.CreateSkillDraftRequest.required.push("example_prompts"),
    (d) => (d.components.schemas.Skill.properties.example_prompts.items.maxLength = 1001),
    (d) => (d.components.schemas.Skill.properties.example_prompts.uniqueItems = true),
    (d) => (d.components.schemas.Skill.properties.example_prompts.type = ["array", "null"]),
    (d) => (d.components.schemas.Skill.properties.name.type = "integer"),
    (d) => delete d.paths["/v1/skills/drafts"],
    (d) => (d.info.version = "8.9.0"),
  ]) {
    const changed = structuredClone(doc)
    change(changed)
    assert.ok(inspectSkillExamplePromptsDocument(changed).length > 0)
  }
})

test("SET13 actual builtin permission fields are declared by the public contract", async () => {
  const { load } = await import("js-yaml")
  const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const permissions = load(source).components.schemas.TeamRole.properties.permissions
  assert.deepEqual(permissions.properties.platform.items.enum, ["execute"])
  assert.equal(permissions.properties.skill.items.enum.length, 15)
  assert.equal(permissions.additionalProperties, false)
})

test("SET13 rejects closed permission and non-Team historical drift", async () => {
  const { restorePublic15TeamPermissionsContract } = await import("../scripts/verify-openapi.ts")
  const source = restorePublic15AccountSessionContract(
    restorePublic151AccountProfileContract(
      restorePublic152SharedTasksContract(
        restorePublic153ArchivedTasksContract(
          restoreClosureMainContract(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")),
        ),
      ),
    ),
  )
  const parent = restorePublic15TeamPermissionsContract(source)
  assert.match(parent, /^  version: 14\.7\.0$/mu)
  const mutations = [
    source.replace("            platform: { type: array, minItems: 1, items: { type: string, enum: [execute] } }\n", ""),
    source.replace(/(    TeamRole:[\s\S]*?)            skill: \{/u, "$1            unknown_domain: {"),
    source.replace("enum: [execute]", "enum: [unknown_action]"),
    source.replace("platform: { type: array, minItems: 1", "platform: { type: array, minItems: 0"),
    source.replace("title: Kokoro Business API", "title: Changed non-Team API"),
    source.replace("version: 15.0.0", "version: 14.8.0"),
  ]
  for (const mutation of mutations) assert.throws(() => restorePublic15TeamPermissionsContract(mutation), /SET13/u)
})
