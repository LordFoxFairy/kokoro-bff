import assert from "node:assert/strict"
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
  assert.equal(packageJson.scripts["contract:test"], "node --test test/contract-governance.test.mjs")
  assert.equal(packageJson.scripts["contract:check"], "pnpm contract:lint && pnpm contract:test")
  assert.equal(packageJson.scripts["db:apply-schema"], "node scripts/apply-schema.mjs")
  assert.equal(tsconfig.compilerOptions.useUnknownInCatchVariables, true)
  for (const heading of ["Owner", "Visibility", "Version", "Generation", "Breaking policy", "Provenance"]) {
    assert.match(contractReadme, new RegExp(`^## ${heading}$`, "mu"), heading)
  }
})
