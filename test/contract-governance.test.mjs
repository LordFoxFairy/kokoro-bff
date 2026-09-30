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

test("the IAM consumer pins the complete 0.7.0 owner artifact and generates only approved admission, Skill, Team and invitation operations", async () => {
  const commit = "e3c035b99cf9479ac8357c7d38147f1541dcbcac"
  const digest = "c8d7af8a365ad5d13eaabccf7f31133e0918ef198bdc3e7c790d90933eae91b2"
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
  assert.equal(owner.info.version, "0.7.0")
  assert.ok(Object.keys(owner.paths).length > 1)
  assert.deepEqual(manifest.owner, {
    repository_path: "apps/kokoro-iam",
    repository_commit: commit,
    contract_version: "0.7.0",
    contract_path: "contract/openapi/iam.internal.v1.json",
    contract_sha256: digest,
  })
  assert.deepEqual(manifest.generator, {
    package: "@hey-api/openapi-ts",
    version: "0.99.0",
    config_path: "openapi-ts.iam.config.ts",
    config_sha256: sha256(config),
  })
  assert.deepEqual(manifest.runtime, { node: "22.22.2", pnpm: "11.25.0", zod: "4.5.4" })
  assert.equal(manifest.lockfile_sha256, sha256(lockfile))
  assert.equal(manifest.generated.length, 16)
  assert.match(sdk, /export const verifySessionAuthorization/u)
  for (const operation of [
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
    "checkTenantSkillAuthorization",
    "createTenantInvitation",
    "getTenantInvitationContext",
    "leaveTenant",
    "listTenantInvitations",
    "listTenantMembers",
    "listTenantRoles",
    "rejectTenantInvitation",
    "removeTenantMember",
    "replaceTenantMemberRoles",
    "resendTenantInvitation",
    "verifySessionAuthorization",
  ])
  assert.doesNotMatch(`${sdk}\n${types}`, /getMetrics|healthz|readyz/u)
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
  const openapi = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  for (const [start, end] of [
    ["  /v1/skills:\n", "  /v1/skills/{skill_id}:\n"],
    ["  /v1/skills/pool:\n", "  /v1/skills/catalog:\n"],
    ["  /v1/skills/catalog:\n", "  /v1/skills/quota:\n"],
    ["  /v1/mcp/servers:\n", "  /v1/mcp/servers/{name}/enable:\n"],
  ]) {
    const operation = openapi.slice(openapi.indexOf(start), openapi.indexOf(end)).split("\n    post:")[0]
    for (const [status, component] of [["400", "BadRequest"], ["401", "Unauthorized"], ["403", "Forbidden"], ["502", "BadGateway"], ["503", "Unavailable"]])
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
  assert.equal(packageJson.scripts["contract:check:platform-http"], "node scripts/generate-platform-http-client.mjs --check")
  assert.equal(packageJson.scripts["contract:generate:iam"], "node scripts/generate-iam-http-client.mjs --write")
  assert.equal(packageJson.scripts["contract:check:iam"], "node scripts/generate-iam-http-client.mjs --check")
  assert.equal(packageJson.scripts["contract:generate:scheduler"], "node scripts/generate-scheduler-contracts.mjs --write")
  assert.equal(packageJson.scripts["contract:check:scheduler"], "node scripts/generate-scheduler-contracts.mjs --check")
  assert.equal(
    packageJson.scripts["contract:check"],
    "pnpm contract:check:agent && pnpm contract:check:platform-http && pnpm contract:check:iam && pnpm contract:check:iam-relay && pnpm contract:check:scheduler && pnpm contract:check:platform && pnpm contract:check:storage && pnpm contract:lint && pnpm contract:semantic && pnpm contract:test",
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
  const ownerCommit = "92bf9e7e6724c591bab4b7fa27f08d694b59a67e"
  const ownerDigest = "6ec2f6d5d71efa60b92bba1eb2dd0c81b7439734e2bc4450caa221e952e24183"
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
      contract_version: "1.0.0",
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
  assert.equal(owner.info.version, "1.0.0")
  const control = owner.paths["/internal/scheduler/v1/schedules/{name}"]
  assert.equal(control.post.operationId, "createSchedule")
  assert.equal(control.put.operationId, "replaceSchedule")
  assert.equal(control.delete.operationId, "deleteSchedule")
  assert.deepEqual(control.post["x-kokoro-control-error-codes"], { 409: "schedule_already_exists" })
  assert.deepEqual(control.put["x-kokoro-control-error-codes"], { 404: "schedule_not_found" })
  assert.deepEqual(control.delete["x-kokoro-control-error-codes"], { 404: "schedule_not_found" })
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
    assert.deepEqual(webhook.requestBody.content["application/json"].schema, { type: "object" })
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
