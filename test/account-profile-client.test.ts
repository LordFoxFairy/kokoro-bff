import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { requestIamAccountProfile } from "../src/infrastructure/clients/iam-account-profile.ts"
import type { AccountProfileInput } from "../src/infrastructure/clients/iam-account-profile.types.ts"
const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})
const input = (extra: Partial<AccountProfileInput> = {}): AccountProfileInput => ({
  baseUrl: "http://iam.test",
  token: "delegated",
  requestId: "profile-client",
  expectedSubject: "subject",
  name: "新 名",
  expected_name: " Old ",
  deadlineAt: performance.now() + 500,
  signal: new AbortController().signal,
  maxResponseBytes: 1048576,
  ...extra,
})
const ack = () => ({ data: { subject: "subject", name: "新 名" } })
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "profile-client", ...headers } })
test("normal generated PATCH forwards exact CAS and admitted bearer once", async () => {
  let calls = 0
  globalThis.fetch = async (req) => {
    calls++
    const r = req as Request
    assert.equal(r.url, "http://iam.test/internal/v1/account/profile")
    assert.equal(r.method, "PATCH")
    assert.equal(r.headers.get("authorization"), "Bearer delegated")
    assert.equal(r.headers.get("cookie"), null)
    assert.deepEqual(await r.json(), { name: "新 名", expected_name: " Old " })
    return response(ack())
  }
  assert.deepEqual(await requestIamAccountProfile(input()), { ok: true, data: ack().data })
  assert.equal(calls, 1)
})
for (const [label, body] of [
  ["foreign subject", { data: { subject: "foreign", name: "新 名" } }],
  ["different name", { data: { subject: "subject", name: "normalized" } }],
  ["unknown nested", { data: { subject: "subject", name: "新 名", token: "secret" } }],
  ["unknown root", { ...ack(), meta: { request_id: "profile-client" } }],
])
  test(`rejects ${label} before strip or success`, async () => {
    globalThis.fetch = async () => response(body)
    assert.deepEqual(await requestIamAccountProfile(input()), { ok: false, status: 502, code: "account_profile_response_invalid" })
  })
for (const headers of [
  { "x-request-id": "wrong" },
  { "cache-control": "public" },
  { location: "https://foreign.test" },
  { "set-cookie": "secret" },
  { "content-type": "text/plain" },
])
  test(`rejects unsafe owner headers ${Object.keys(headers)[0]}`, async () => {
    globalThis.fetch = async () => response(ack(), 200, headers)
    assert.equal((await requestIamAccountProfile(input())).ok, false)
  })
for (const [status, code, expectedStatus, expectedCode] of [
  [400, "INVALID_ARGUMENT", 400, "account_profile_input_invalid"],
  [401, "UNAUTHENTICATED", 401, "session_invalid"],
  [403, "PERMISSION_DENIED", 403, "account_profile_forbidden"],
  [404, "TENANT_NOT_FOUND", 403, "session_forbidden"],
  [409, "TENANT_DISABLED", 403, "session_forbidden"],
  [409, "CONFLICT", 409, "account_profile_conflict"],
  [413, "PAYLOAD_TOO_LARGE", 413, "account_profile_request_too_large"],
  [429, "RATE_LIMITED", 429, "account_profile_rate_limited"],
  [500, "INTERNAL", 503, "account_profile_unavailable"],
  [503, "DEPENDENCY_UNAVAILABLE", 503, "account_profile_unavailable"],
] as const)
  test(`closed owner ${status}/${code} maps safely`, async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return response({ error: { code, message: "private name and credential", retryable: status === 429 || status === 503, details: [] } }, status, {
        "retry-after": "2",
      })
    }
    const result = await requestIamAccountProfile(input())
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, expectedStatus)
      assert.equal(result.code, expectedCode)
    }
    assert.equal(calls, 1)
    assert.ok(!JSON.stringify(result).includes("private"))
  })
test("wrong status/code and duplicate raw JSON and invalid UTF8 cannot pass owner parsing", async () => {
  for (const value of [
    response({ error: { code: "CONFLICT", message: "x", retryable: false, details: [] } }, 403),
    new Response('{"data":{"subject":"subject","name":"新 名","name":"新 名"}}', {
      headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "profile-client" },
    }),
    new Response(new Uint8Array([255]), { headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "profile-client" } }),
  ]) {
    globalThis.fetch = async () => value
    assert.equal((await requestIamAccountProfile(input())).ok, false)
  }
})
test("noncooperative fetch obeys absolute budget and cancels late body without retry", async () => {
  let resolve!: (value: Response) => void
  let cancelled = false
  let calls = 0
  globalThis.fetch = () => {
    calls++
    return new Promise((r) => {
      resolve = r
    })
  }
  const result = await requestIamAccountProfile(input({ deadlineAt: performance.now() + 25 }))
  assert.deepEqual(result, { ok: false, status: 503, code: "account_profile_unavailable" })
  assert.equal(calls, 1)
  resolve(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true
        },
      }),
    ),
  )
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(cancelled, true)
})
test("hanging body reader is actively cancelled within the same budget", async () => {
  let cancelled = false
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true
        },
      }),
      { headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "profile-client" } },
    )
  assert.equal((await requestIamAccountProfile(input({ deadlineAt: performance.now() + 25 }))).ok, false)
  assert.equal(cancelled, true)
})
test("preaborted caller and depleted budget perform zero PATCH", async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return response(ack())
  }
  const abort = new AbortController()
  abort.abort()
  await requestIamAccountProfile(input({ signal: abort.signal }))
  await requestIamAccountProfile(input({ deadlineAt: performance.now() - 1 }))
  assert.equal(calls, 0)
})

test("caller cancellation actively releases owner body and does not retry", async () => {
  let cancelled = false
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled = true
        },
      }),
      { headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "profile-client" } },
    )
  }
  const abort = new AbortController()
  const pending = requestIamAccountProfile(input({ signal: abort.signal }))
  await new Promise((resolve) => setTimeout(resolve, 5))
  abort.abort()
  assert.deepEqual(await pending, { ok: false, status: 503, code: "account_profile_unavailable" })
  assert.equal(cancelled, true)
  assert.equal(calls, 1)
})
test("response headers and body share the minimum byte cap", async () => {
  globalThis.fetch = async () => response(ack(), 200, { "x-extra": "x".repeat(300) })
  assert.deepEqual(await requestIamAccountProfile(input({ maxResponseBytes: 200 })), { ok: false, status: 502, code: "account_profile_response_invalid" })
})
test("RATE_LIMITED Retry-After is closed and sanitized errors reject unknown raw keys", async () => {
  for (const retry of ["0", "86401", "tomorrow", "1, 2"]) {
    globalThis.fetch = async () =>
      response({ error: { code: "RATE_LIMITED", message: "private", retryable: true, details: [] } }, 429, { "retry-after": retry })
    assert.deepEqual(await requestIamAccountProfile(input()), { ok: false, status: 502, code: "account_profile_response_invalid" })
  }
  globalThis.fetch = async () => response({ error: { code: "CONFLICT", message: "private", retryable: false, details: [], secret: "token" } }, 409)
  assert.equal((await requestIamAccountProfile(input())).ok, false)
})
