import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const target = new URL("../contract/openapi/browser/v1/auth-session.json", import.meta.url)
test("browser auth publishes one closed safe status read without public API or secret fields", async () => {
  const document = JSON.parse(await readFile(target, "utf8").catch(() => "null"))
  assert.ok(document, "the browser-private auth status artifact must be published")
  assert.equal(document.info.version, "1.0.0")
  assert.deepEqual(Object.keys(document.paths), ["/browser/v1/auth/session"])
  const operation = document.paths["/browser/v1/auth/session"].get
  assert.equal(operation.operationId, "getBrowserAuthSession")
  assert.deepEqual(
    operation.parameters.map(({ in: location, name }) => [location, name]),
    [["query", "refresh"]],
  )
  const { browserAuthSessionPublicQuery } = await import("../src/auth/auth-session.contract.ts")
  const { z } = await import("zod")
  assert.deepEqual(operation.parameters[0].schema, z.toJSONSchema(browserAuthSessionPublicQuery).properties.refresh)
  assert.equal(operation.requestBody, undefined)
  const success = operation.responses[200].content["application/json"].schema
  assert.equal(success.additionalProperties, false)
  assert.deepEqual(success.required, ["data"])
  const branches = success.properties.data.oneOf
  assert.equal(branches.length, 2)
  const anonymous = branches.find((branch) => branch.properties.authenticated.const === false)
  const authenticated = branches.find((branch) => branch.properties.authenticated.const === true)
  assert.ok(anonymous)
  assert.ok(authenticated)
  for (const [branch, keys] of [
    [anonymous, ["authenticated"]],
    [authenticated, ["authenticated", "subject", "tenant_id", "expires_at"]],
  ]) {
    assert.deepEqual(new Set(Object.keys(branch.properties)), new Set(keys))
    assert.deepEqual(new Set(branch.required), new Set(keys))
    assert.equal(branch.additionalProperties, false)
  }
  assert.equal(authenticated.properties.expires_at.type, "string")
  assert.equal(authenticated.properties.expires_at.format, "date-time")
  const timestamp = new RegExp(authenticated.properties.expires_at.pattern)
  assert.equal(timestamp.test("2030-01-01T00:00:00.000Z"), true)
  assert.equal(timestamp.test("2030-01-01T00:00:00.000+00:00"), false, "published timestamp is UTC-only")
  assert.deepEqual(Object.keys(operation.responses), ["200", "400", "403", "429", "503"])
  assert.equal(operation.responses[200].headers["cache-control"].schema.const, "no-store")
  assert.equal(operation.responses[200].headers["x-request-id"].required, true)
  for (const status of [400, 403, 429, 503]) {
    const schema = operation.responses[status].content["application/json"].schema
    for (const branch of schema.anyOf ?? [schema]) {
      assert.deepEqual(new Set(branch.properties.error.required), new Set(["code", "message", "retryable"]))
      assert.equal(branch.properties.error.additionalProperties, false)
    }
  }
})

test("relay policy rejects raw get-session including queries", async () => {
  const { iamRelayRoute } = await import("../src/http/routes/iam-protocol-relay.policy.ts")
  assert.equal(iamRelayRoute("/iam/get-session", "GET"), null)
  assert.equal(iamRelayRoute("/iam/get-session?disableCookieCache=true", "GET"), null)
})

test("safe status and strict refresh schemas reject secrets and ambiguous input", async () => {
  const { browserAuthSessionResponse, browserAuthSessionQuery } = await import("../src/auth/auth-session.contract.ts")
  assert.equal(browserAuthSessionResponse.safeParse({ data: { authenticated: false } }).success, true)
  assert.equal(browserAuthSessionResponse.safeParse({ data: { authenticated: false, token: "secret" } }).success, false)
  assert.equal(
    browserAuthSessionResponse.safeParse({ data: { authenticated: true, subject: "user", tenant_id: "tenant", expires_at: "2030-01-01T00:00:00.000Z" } })
      .success,
    true,
  )
  assert.equal(
    browserAuthSessionResponse.safeParse({
      data: { authenticated: true, subject: "user", tenant_id: "tenant", expires_at: "2030-01-01T00:00:00.000Z" },
      meta: { request_id: "id" },
    }).success,
    false,
  )
  assert.deepEqual(browserAuthSessionQuery.parse({}), { refresh: true })
  assert.deepEqual(browserAuthSessionQuery.parse({ refresh: "false" }), { refresh: false })
  for (const value of [{ refresh: "0" }, { refresh: false }, { refresh: ["true", "false"] }, { other: "true" }])
    assert.equal(browserAuthSessionQuery.safeParse(value).success, false)
})
