import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import {
  compareOperationBaseline,
  inspectOpenApiGovernance,
} from "../scripts/check-contract.mjs"

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

  assert.deepEqual(compareOperationBaseline(governedOperation, baseline), [
    "breaking change: GET /v1/projects (listProjects) was removed",
  ])
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

test("the Capability consumer pins the accepted owner artifact before runtime generation", async () => {
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

  assert.deepEqual(Object.keys(manifest).sort(), [
    "generated",
    "generator",
    "lockfile_sha256",
    "owner",
    "runtime",
    "schema_version",
    "status",
  ])
  assert.deepEqual(manifest, {
    schema_version: 1,
    status: "design-frozen",
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
    generated: [],
  })
  assert.equal(sha256(vendorDocument), ownerDigest)
  assert.equal(openapi.info.version, "2.0.0")
  assert.deepEqual(Object.keys(openapi.paths).sort(), [
    "/v1/mcp/servers",
    "/v1/skills",
    "/v1/skills/catalog",
    "/v1/skills/pool",
  ])
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
})

test("the public AG-UI contract exposes only durable opaque BFF cursors", async () => {
  const openapi = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const eventOperation = openapi.slice(
    openapi.indexOf("  /v1/sessions/{id}/events:"),
    openapi.indexOf("  /v1/sessions/{id}/runs/{runId}/control:"),
  )
  const eventCursor = openapi.slice(
    openapi.indexOf("    EventCursor:"),
    openapi.indexOf("    RequestMeta:"),
  )
  const eventStream = openapi.slice(
    openapi.indexOf("    SessionEventStream:"),
    openapi.indexOf("    RenameSessionRequest:"),
  )

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
  assert.equal(packageJson.scripts["contract:check"], "pnpm contract:lint && pnpm contract:semantic && pnpm contract:test")
  assert.equal(packageJson.scripts["db:apply-schema"], "node scripts/apply-schema.mjs")
  assert.equal(tsconfig.compilerOptions.useUnknownInCatchVariables, true)
  for (const heading of ["Owner", "Visibility", "Version", "Generation", "Breaking policy", "Provenance"]) {
    assert.match(contractReadme, new RegExp(`^## ${heading}$`, "mu"), heading)
  }
})
