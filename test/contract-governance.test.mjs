import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, readdir, stat } from "node:fs/promises"
import { test } from "node:test"

import { compareOperationBaseline, inspectOpenApiGovernance } from "../scripts/check-contract.mjs"
import * as capabilityGenerator from "../scripts/generate-capability-http-client.mjs"
import * as schedulerGenerator from "../scripts/generate-scheduler-contracts.mjs"

const { replaceExactInSource } = capabilityGenerator

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

test("the Capability consumer pins the accepted owner artifact and generated runtime", async () => {
  const ownerCommit = "7f89a267d745cbb9870f52d6edb23dec1a3c469b"
  const ownerDigest = "e0b7c4b57ac030efb73878b51da2a3595ec0172bce0608a88ea925b57a69761a"
  const vendorPath = `../contract/vendor/kokoro-capability/${ownerCommit}/capability-http.openapi.json`
  const [manifestDocument, vendorDocument, configSource, lockfile] = await Promise.all([
    readFile(new URL("../contract/dependencies/capability-http.json", import.meta.url), "utf8"),
    readFile(new URL(vendorPath, import.meta.url)),
    readFile(new URL("../openapi-ts.capability.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../pnpm-lock.yaml", import.meta.url)),
  ])
  const manifest = JSON.parse(manifestDocument)
  const openapi = JSON.parse(vendorDocument.toString("utf8"))
  const sha256 = (value) => createHash("sha256").update(value).digest("hex")

  assert.deepEqual(Object.keys(manifest).sort(), ["generated", "generator", "lockfile_sha256", "owner", "runtime", "schema_version", "status"])
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
  const generatedSources = await Promise.all(generatedFiles.map((file) => readFile(new URL(`../src/generated/capability-http/${file}`, import.meta.url))))
  const generated = generatedFiles.map((file, index) => ({
    path: file,
    sha256: sha256(generatedSources[index]),
  }))
  assert.deepEqual(manifest, {
    schema_version: 1,
    status: "generated",
    owner: {
      repository_path: "apps/kokoro-capability",
      repository_commit: ownerCommit,
      contract_version: "2.0.0",
      contract_path: "contract/openapi/capability-http.openapi.json",
      contract_sha256: ownerDigest,
    },
    generator: {
      package: "@hey-api/openapi-ts",
      version: "0.99.0",
      config_path: "openapi-ts.capability.config.ts",
      config_sha256: sha256(configSource),
    },
    runtime: { node: "22.22.2", pnpm: "11.25.0", zod: "4.5.4" },
    lockfile_sha256: sha256(lockfile),
    generated,
  })
  assert.equal(sha256(vendorDocument), ownerDigest)
  assert.equal(openapi.info.version, "2.0.0")
  assert.deepEqual(Object.keys(openapi.paths).sort(), ["/v1/mcp/servers", "/v1/skills", "/v1/skills/catalog", "/v1/skills/pool"])
  for (const pathItem of Object.values(openapi.paths)) {
    assert.deepEqual(Object.keys(pathItem), ["get"])
  }
  assert.equal(openapi.components.parameters.SkillQuery.name, "query")
  assert.equal(
    Object.values(openapi.components.parameters).some((parameter) => parameter.name === "q"),
    false,
  )
  assert.equal(openapi.components.parameters.RequestId.name, "x-kokoro-request-id")
  for (const responseName of ["SkillList", "McpServerList", "Error"]) {
    const responseHeaders = openapi.components.responses[responseName].headers
    assert.deepEqual(Object.keys(responseHeaders), ["x-kokoro-request-id"], responseName)
    assert.deepEqual(
      Object.entries(responseHeaders)
        .filter(([, header]) => header.required === true)
        .map(([name]) => name),
      ["x-kokoro-request-id"],
      `${responseName} must require exactly the canonical request-id response header`,
    )
  }
  assert.equal(JSON.stringify(openapi).includes("/bff/"), false)
  for (const source of generatedSources) {
    assert.doesNotMatch(source.toString("utf8"), /@ts-[^\s]+|eslint-disable(?:-next-line)?/u)
  }
  const generatedRoot = new URL("../src/generated/capability-http/", import.meta.url)
  const regularFiles = []
  for (const file of await readdir(generatedRoot, { recursive: true })) {
    if ((await stat(new URL(file, generatedRoot))).isFile()) regularFiles.push(file)
  }
  assert.deepEqual(regularFiles.sort(), generatedFiles.slice().sort())
})

test("the Capability generator compatibility normalizer fails closed on template drift", () => {
  assert.equal(replaceExactInSource("before TOKEN after", "TOKEN", "FIXED", 1, "fixture"), "before FIXED after")
  assert.throws(() => replaceExactInSource("TOKEN", "TOKEN", "FIXED", 2, "fixture"), /fixture: expected 2 generator matches, found 1/u)
  assert.throws(() => replaceExactInSource("no marker", "TOKEN", "FIXED", 1, "fixture"), /fixture: expected 1 generator matches, found 0/u)
})

test("the Capability generated allowlist rejects missing files, every extra extension, and extra directories", async () => {
  const manifest = JSON.parse(await readFile(new URL("../contract/dependencies/capability-http.json", import.meta.url), "utf8"))
  const files = manifest.generated.map(({ path }) => path)
  const assertGeneratedAllowlist = capabilityGenerator.assertGeneratedAllowlist
  assert.equal(typeof assertGeneratedAllowlist, "function")
  assert.doesNotThrow(() => assertGeneratedAllowlist(files, ["client", "core"], "fixture"))
  assert.throws(() => assertGeneratedAllowlist(files.slice(1), ["client", "core"], "fixture"), /file allowlist drifted/u)
  assert.throws(() => assertGeneratedAllowlist([...files, "manual.md"], ["client", "core"], "fixture"), /file allowlist drifted/u)
  assert.throws(() => assertGeneratedAllowlist(files, ["client", "core", "manual"], "fixture"), /directory allowlist drifted/u)
})

test("the public Capability facade documents only canonical query parameters and stable gateway failures", async () => {
  const openapi = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  for (const [start, end] of [
    ["  /v1/skills:\n", "  /v1/skills/pool:\n"],
    ["  /v1/skills/pool:\n", "  /v1/skills/catalog:\n"],
    ["  /v1/skills/catalog:\n", "  /v1/skills/quota:\n"],
    ["  /v1/mcp/servers:\n", "  /v1/mcp/servers/{name}/enable:\n"],
  ]) {
    const operation = openapi.slice(openapi.indexOf(start), openapi.indexOf(end))
    assert.match(operation, /'400': \{ \$ref: '#\/components\/responses\/BadRequest' \}/u)
    assert.match(operation, /'502': \{ \$ref: '#\/components\/responses\/BadGateway' \}/u)
    assert.match(operation, /'503': \{ \$ref: '#\/components\/responses\/ServiceUnavailable' \}/u)
    assert.doesNotMatch(operation, /name: q\b/u)
  }
  assert.match(openapi, /name: query\n\s+in: query\n\s+required: false\n\s+schema:\n\s+type: string\n\s+minLength: 1\n\s+maxLength: 1024/u)
  assert.match(openapi, /name: tags\n\s+in: query[\s\S]*?style: form\n\s+explode: true/u)
  assert.match(openapi, /name: provider_key\n\s+in: query[\s\S]*?maxLength: 191/u)

  const schema = (name, next) => openapi.slice(openapi.indexOf(`    ${name}:\n`), openapi.indexOf(`    ${next}:\n`))
  for (const [name, next] of [
    ["SkillListResponse", "SkillPoolResponse"],
    ["SkillPoolResponse", "SkillCatalogResponse"],
  ]) {
    const response = schema(name, next)
    assert.match(response, /required: \[skills\]/u)
    assert.match(response, /next_cursor:\n\s+type: \[string, 'null'\]/u)
  }
  const catalog = schema("SkillCatalogResponse", "SkillQuotaResponse")
  assert.match(catalog, /required: \[skills, next_cursor\]/u)
  assert.match(catalog, /next_cursor:\n\s+type: \[string, 'null'\]/u)
  const mcp = schema("McpServerListResponse", "McpServerResponse")
  assert.match(mcp, /required: \[servers\]/u)
  assert.match(mcp, /next_cursor:\n\s+type: string/u)
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
  assert.match(packageJson.scripts["format:check"], /src\/generated\/capability-http/u)
  assert.match(packageJson.scripts["format:check"], /src\/generated\/scheduler/u)
  assert.equal(packageJson.scripts["contract:generate:capability"], "node scripts/generate-capability-http-client.mjs --write")
  assert.equal(packageJson.scripts["contract:check:capability"], "node scripts/generate-capability-http-client.mjs --check")
  assert.equal(packageJson.scripts["contract:generate:scheduler"], "node scripts/generate-scheduler-contracts.mjs --write")
  assert.equal(packageJson.scripts["contract:check:scheduler"], "node scripts/generate-scheduler-contracts.mjs --check")
  assert.equal(
    packageJson.scripts["contract:check"],
    "pnpm contract:check:capability && pnpm contract:check:scheduler && pnpm contract:lint && pnpm contract:semantic && pnpm contract:test",
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
