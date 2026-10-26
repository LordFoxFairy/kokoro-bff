import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import test from "node:test"
import { restorePublic27ToolDisplayContract } from "../scripts/tool-display-public-contract.mjs"
import { MCP_SERVER_ICON_CONTRACT } from "../src/application/mcp-server-icon.contract.js"

const document = JSON.parse(readFileSync(new URL("../contract/openapi/browser/v1/mcp-server-icon.json", import.meta.url), "utf8"))
test("private media contract publishes only the exact independent binary read and existing closed failures", () => {
  const policy = MCP_SERVER_ICON_CONTRACT
  assert.deepEqual(document["x-kokoro-media-policy"], policy)
  assert.deepEqual(Object.keys(document.paths), [policy.path])
  assert.deepEqual(Object.keys(document.paths[policy.path]), ["get"])
  const operation = document.paths[policy.path].get
  assert.equal(operation.operationId, policy.operation_id)
  assert.equal(operation.requestBody, undefined)
  assert.deepEqual(
    operation.parameters.map((value: { in: string; name: string }) => [value.in, value.name]),
    [["path", "server_id"]],
  )
  assert.deepEqual(Object.keys(operation.responses[200].content), ["image/png", "image/jpeg"])
  assert.equal(operation.responses[200].headers["content-length"].required, true)
  for (const status of new Set(policy.errors.map((fault) => fault.status))) {
    const tuples = operation.responses[status].content["application/json"].schema.oneOf.map(
      (schema: { properties: { error: { properties: { code: { const: string }; retryable: { const: boolean } } } } }) => ({
        status,
        code: schema.properties.error.properties.code.const,
        retryable: schema.properties.error.properties.retryable.const,
      }),
    )
    assert.deepEqual(
      tuples,
      policy.errors.filter((fault) => fault.status === status),
    )
  }
})

test("the independent media publication leaves the full existing public, command and publication parents untouched", () => {
  for (const path of [
    "contract/openapi/v1/openapi.yaml",
    "contract/connector-command-errors-v1.json",
    "contract/openapi/browser/v1/mcp-project-publication.json",
    "database/schema.sql",
  ]) {
    const parent = execFileSync("git", ["show", `6f7474ae97edbded5d43a5e9d76eaa3b2f4b3a01:${path}`])
    const bytes = readFileSync(new URL(`../${path}`, import.meta.url))
    const current = path === "contract/openapi/v1/openapi.yaml" ? restorePublic27ToolDisplayContract(bytes.toString("utf8")) : bytes
    assert.equal(createHash("sha256").update(current).digest("hex"), createHash("sha256").update(parent).digest("hex"), path)
  }
})
