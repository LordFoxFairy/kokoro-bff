import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { z } from "zod"
import { SKILL_DOWNLOAD_POLICY } from "../src/http/routes/skill-download.policy.js"

test("exact Skill download private policy is the single strict generated contract", async () => {
  const generated = JSON.parse(await readFile(new URL("../contract/skill-download-policy.json", import.meta.url), "utf8"))
  assert.deepEqual(generated, SKILL_DOWNLOAD_POLICY)
  assert.deepEqual(
    SKILL_DOWNLOAD_POLICY.operations.slice(0, 3).map(({ method, path, qualifier, parameter }) => ({ method, path, qualifier, parameter })),
    [
      { method: "POST", path: "/browser/v1/skill-installations/{installation_id}/download", qualifier: "installation", parameter: "installation_id" },
      { method: "POST", path: "/browser/v1/skills/{version_id}/download", qualifier: "managed", parameter: "version_id" },
      { method: "POST", path: "/browser/v1/skill-shares/{share_id}/download", qualifier: "share", parameter: "share_id" },
    ],
  )
  for (const operation of SKILL_DOWNLOAD_POLICY.operations) {
    assert.deepEqual(operation.request, {
      query: "forbidden",
      idempotencyKey: "forbidden",
      payload: "exactly-zero-bytes",
      contentLength: ["absent", "0"],
      transferEncoding: "forbidden",
    })
    assert.deepEqual(operation.responses[200].properties.data.required, ["source_ref", "revision", "download_info"])
    assert.deepEqual(
      operation.responses.errors.map(({ status }) => status),
      [400, 401, 403, 404, 405, 429, 502, 503, 504],
    )
  }
})

test("Project exact private policy adds only its dual selector operation and preserves all old operations", async () => {
  assert.equal(metadataPolicyParent().version, 2)
  assert.equal(SKILL_DOWNLOAD_POLICY.operations.length, 4)
  const operation = SKILL_DOWNLOAD_POLICY.operations[3]!
  assert.equal(operation.path, "/browser/v1/projects/{projectId}/skill-installations/{installation_id}/download")
  assert.equal(operation.qualifier, "project_installation")
  assert.equal(operation.projectParameter, "projectId")
  assert.deepEqual(operation.projectParameterSchema, operation.parameterSchema)
  assert.deepEqual(operation.request, SKILL_DOWNLOAD_POLICY.operations[0]!.request)
  assert.deepEqual(operation.responses, SKILL_DOWNLOAD_POLICY.operations[0]!.responses)
})

test("opaque Skill bytes publish their own operation, not the metadata POST response union", () => {
  assert.equal(Object.hasOwn(SKILL_DOWNLOAD_POLICY, "byte_operation"), true, "GET ZIP/status-code framing is missing from the published private policy")
})

function metadataPolicyParent() {
  const current = JSON.parse(JSON.stringify(SKILL_DOWNLOAD_POLICY))
  assert.equal(current.version, 3)
  assert.ok(Object.hasOwn(current, "byte_operation"))
  delete current.byte_operation
  current.version = 2
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(current, null, 2) + "\n")
      .digest("hex"),
    "454d0980e647ef7a7679bb8e986350c3aa5933092ed96df3661bb48e1de1584f",
  )
  return current
}

function byteErrorAllowed(status: number, value: unknown) {
  const operation = SKILL_DOWNLOAD_POLICY.byte_operation
  const row = operation.responses.errors.find((candidate) => candidate.status === status)
  return row !== undefined && z.fromJSONSchema(JSON.parse(JSON.stringify(row.schema))).safeParse(value).success
}

test("byte policy3 restores complete policy2 bytes and keeps ZIP headers distinct from metadata", () => {
  metadataPolicyParent()
  const byte = SKILL_DOWNLOAD_POLICY.byte_operation
  assert.equal(byte.method, "GET")
  assert.equal(byte.path, "/skill-downloads/{handle}")
  assert.equal(byte.parameterSchema.pattern, "^[A-Za-z0-9_-]{43}$")
  assert.deepEqual(byte.request.contentLength, ["absent"])
  assert.deepEqual(SKILL_DOWNLOAD_POLICY.operations[0]!.request.contentLength, ["absent", "0"])
  assert.equal(byte.responses[200].body.kind, "binary")
  assert.equal(byte.responses[200].body.maxBytes, 33_554_432)
  const headers = z.fromJSONSchema(JSON.parse(JSON.stringify(byte.responses[200].headers)))
  const valid = {
    "content-type": "application/zip",
    "content-length": "123",
    "content-disposition": "attachment; filename=\"skill.zip\"; filename*=UTF-8''exact%20Skill.zip",
    "cache-control": "no-store",
    "x-request-id": "correlation",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  }
  assert.equal(headers.safeParse(valid).success, true)
  assert.equal(headers.safeParse({ ...valid, "content-type": "application/json" }).success, false)
  assert.equal(headers.safeParse({ ...valid, "content-length": "0" }).success, false)
  assert.equal(headers.safeParse({ ...valid, "content-disposition": 'attachment; filename="unsafe.zip"' }).success, false)
  assert.equal(headers.safeParse({ data: { download_info: {} } }).success, false)
})

test("byte failures are exact status/code/shape tuples rather than POST metadata or future errors", () => {
  assert.deepEqual(
    SKILL_DOWNLOAD_POLICY.byte_operation.responses.errors.map((row) => row.status),
    [400, 401, 403, 404, 405, 410, 429, 502, 503, 504],
  )
  const valid = [
    [400, "invalid_skill_request", false],
    [401, "Unauthenticated", undefined],
    [401, "session_authentication_required", undefined],
    [401, "session_invalid", false],
    [403, "PermissionDenied", undefined],
    [403, "service_auth_failed", undefined],
    [403, "session_forbidden", false],
    [403, "product_tenant_forbidden", undefined],
    [403, "skill_download_forbidden", false],
    [404, "NotFound", undefined],
    [404, "skill_not_found", false],
    [405, "MethodNotAllowed", undefined],
    [410, "Gone", undefined],
    [429, "session_rate_limited", undefined],
    [429, "session_rate_limited", true],
    [429, "skill_rate_limited", true],
    [502, "skill_response_invalid", false],
    [503, "product_tenant_not_configured", undefined],
    [503, "iam_admission_unavailable", true],
    [503, "skill_dependency_unavailable", true],
    [504, "skill_deadline_exceeded", true],
  ] as const
  for (const [status, code, retryable] of valid) {
    const value = { error: { code, message: "Current read did not complete", ...(retryable === undefined ? {} : { retryable }) } }
    assert.equal(byteErrorAllowed(status, value), true, `${status}/${code}`)
    assert.equal(byteErrorAllowed(status, { ...value, extra: true }), false)
    assert.equal(byteErrorAllowed(status, { error: { ...value.error, extra: true } }), false)
    assert.equal(byteErrorAllowed(status, { error: { ...value.error, code: "future_unknown" } }), false)
    assert.equal(byteErrorAllowed(status, { data: { source_ref: "skill:x", revision: "1", download_info: {} } }), false)
    for (const other of [400, 401, 403, 404, 405, 410, 412, 429, 502, 503, 504, 599])
      if (other !== status) assert.equal(byteErrorAllowed(other, value), false, `${code} must not cross into ${other}`)
  }
  assert.equal(byteErrorAllowed(410, { error: { code: "Gone", message: "Expired", retryable: false } }), false)
  assert.equal(byteErrorAllowed(401, { error: { code: "session_invalid", message: "Invalid", retryable: true } }), false)
  assert.equal(byteErrorAllowed(503, { error: { code: "skill_dependency_unavailable", message: "Unavailable" } }), false)
  assert.equal(byteErrorAllowed(412, { error: { code: "skill_precondition_failed", message: "Rejected", retryable: false } }), false)
  const metadata = SKILL_DOWNLOAD_POLICY.operations[0]!.responses.errors.find((row) => row.status === 403)!
  assert.equal(
    z.fromJSONSchema(JSON.parse(JSON.stringify(metadata.schema))).safeParse({ error: { code: "PermissionDenied", message: "Denied" } }).success,
    false,
  )
  assert.equal(byteErrorAllowed(403, { error: { code: "PermissionDenied", message: "Denied" } }), true)
})
