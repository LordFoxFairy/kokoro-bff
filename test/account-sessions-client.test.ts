import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { requestIamAccountSessions } from "../src/infrastructure/clients/iam-account-sessions.ts"
import type { AccountSessionInput } from "../src/infrastructure/clients/iam-account-sessions.types.ts"

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
const session = (session_id: string) => ({ session_id, created_at: "2026-10-01T01:02:03.000Z", expires_at: "2026-11-01T01:02:03.000Z" })
const page = () => ({ data: { current_session: session("current"), sessions: [session("other")] }, meta: { next_cursor: null } })
function input(extra: Partial<AccountSessionInput> = {}): AccountSessionInput {
  return {
    baseUrl: "http://iam.test",
    token: "delegated-secret",
    requestId: "account-client",
    signal: new AbortController().signal,
    deadlineAt: performance.now() + 1000,
    maxResponseBytes: 1024 * 1024,
    kind: "list",
    limit: 25,
    cursor: null,
    ...extra,
  } as AccountSessionInput
}
function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "account-client", ...headers },
  })
}
function fetched(value: Response) {
  globalThis.fetch = async () => value
}

test("normal generated list/revoke operations forward only bearer and correlation and require owner ACK", async () => {
  const seen: Request[] = []
  globalThis.fetch = async (request) => {
    const req = request as Request
    seen.push(req)
    return response(req.method === "DELETE" ? { data: { session_id: "other", revoked: true } } : page())
  }
  assert.deepEqual(await requestIamAccountSessions(input()), { ok: true, data: page().data, nextCursor: null })
  assert.deepEqual(await requestIamAccountSessions(input({ kind: "revoke", sessionId: "other" })), { ok: true, data: { session_id: "other", revoked: true } })
  assert.equal(seen[0]!.url, "http://iam.test/internal/v1/account/sessions?limit=25")
  assert.equal(seen[1]!.url, "http://iam.test/internal/v1/account/sessions/other")
  assert.equal(seen[1]!.headers.get("authorization"), "Bearer delegated-secret")
  for (const req of seen) {
    assert.equal(req.headers.get("cookie"), null)
    assert.equal(req.body, null)
    assert.equal(req.headers.get("x-request-id"), "account-client")
  }
})

for (const [name, mutate] of [
  ["root", (v: ReturnType<typeof page>) => Object.assign(v, { secret: "owner-secret" })],
  ["data", (v: ReturnType<typeof page>) => Object.assign(v.data, { token: "owner-secret" })],
  ["current", (v: ReturnType<typeof page>) => Object.assign(v.data.current_session, { user_agent: "not a trusted device" })],
  ["other", (v: ReturnType<typeof page>) => Object.assign(v.data.sessions[0]!, { ip_address: "private" })],
  ["meta", (v: ReturnType<typeof page>) => Object.assign(v.meta, { extra: "private" })],
] as const)
  test(`rejects unknown ${name} before generated strip`, async () => {
    const value = page()
    mutate(value)
    fetched(response(value))
    assert.deepEqual(await requestIamAccountSessions(input()), { ok: false, status: 502, code: "account_session_response_invalid" })
  })

for (const [name, body] of [
  ["current included", { data: { current_session: session("current"), sessions: [session("current")] }, meta: { next_cursor: null } }],
  ["duplicate others", { data: { current_session: session("current"), sessions: [session("other"), session("other")] }, meta: { next_cursor: null } }],
  ["over requested limit", { data: { current_session: session("current"), sessions: [session("one"), session("two")] }, meta: { next_cursor: null } }],
  ["non UTC millis", { data: { current_session: { ...session("current"), created_at: "2026-10-01T01:02:03Z" }, sessions: [] }, meta: { next_cursor: null } }],
] as const)
  test(`rejects ${name} without a partial projection`, async () => {
    fetched(response(body))
    assert.equal((await requestIamAccountSessions(input({ limit: 1 }))).ok, false)
  })

test("separate current plus no other active sessions is a valid owner empty page", async () => {
  const body = { data: { current_session: session("current"), sessions: [] }, meta: { next_cursor: null } }
  fetched(response(body))
  assert.deepEqual(await requestIamAccountSessions(input()), { ok: true, data: body.data, nextCursor: null })
})
test("revoke rejects wrong ID and false ACK", async () => {
  for (const data of [
    { session_id: "foreign", revoked: true },
    { session_id: "other", revoked: false },
    { session_id: "other", revoked: true, token: "private" },
  ]) {
    fetched(response({ data }))
    assert.equal((await requestIamAccountSessions(input({ kind: "revoke", sessionId: "other" }))).ok, false)
  }
})

for (const [status, code, expectedStatus, expectedCode] of [
  [400, "INVALID_ARGUMENT", 400, "account_session_input_invalid"],
  [401, "UNAUTHENTICATED", 401, "session_invalid"],
  [403, "PERMISSION_DENIED", 403, "account_session_forbidden"],
  [404, "NOT_FOUND", 404, "account_session_not_found"],
  [409, "CONFLICT", 409, "account_session_conflict"],
  [409, "TENANT_DISABLED", 403, "session_forbidden"],
  [413, "PAYLOAD_TOO_LARGE", 413, "account_session_request_too_large"],
  [500, "INTERNAL", 503, "account_sessions_unavailable"],
  [503, "DEPENDENCY_UNAVAILABLE", 503, "account_sessions_unavailable"],
] as const)
  test(`maps only ${status}/${code} and never exposes the owner's error message`, async () => {
    fetched(response({ error: { code, message: "owner-private-secret", retryable: false, details: [] } }, status))
    assert.deepEqual(await requestIamAccountSessions(input()), { ok: false, status: expectedStatus, code: expectedCode })
  })
test("unknown status/code tuples, malformed metadata and redirects fail closed", async () => {
  for (const value of [
    response(page(), 200, { "x-request-id": "wrong" }),
    response(page(), 200, { "cache-control": "public" }),
    response(page(), 200, { "content-type": "text/plain" }),
    response(page(), 200, { location: "https://evil.invalid" }),
    response({ error: { code: "CONFLICT", message: "x", retryable: false, details: [] } }, 400),
    response(page(), 201),
  ]) {
    fetched(value)
    assert.equal((await requestIamAccountSessions(input())).ok, false)
  }
})
test("rate limits expose only validated delta seconds", async () => {
  for (const retry of ["1", "86400", "0", "86401", "Thu, 01 Jan 2030 00:00:00 GMT"]) {
    fetched(response({ error: { code: "RATE_LIMITED", message: "x", retryable: true, details: [] } }, 429, { "retry-after": retry }))
    const result = await requestIamAccountSessions(input())
    if (retry === "1" || retry === "86400") assert.deepEqual(result, { ok: false, status: 429, code: "account_session_rate_limited", retryAfter: retry })
    else assert.deepEqual(result, { ok: false, status: 502, code: "account_session_response_invalid" })
  }
})
test("headers and body share the configured byte cap bounded by one MiB", async () => {
  fetched(response(page(), 200, { "x-padding": "a".repeat(1000) }))
  assert.equal((await requestIamAccountSessions(input({ maxResponseBytes: 500 }))).ok, false)
  const value = page()
  Object.assign(value, { padding: "a".repeat(1024 * 1024) })
  fetched(response(value))
  assert.equal((await requestIamAccountSessions(input({ maxResponseBytes: 8 * 1024 * 1024 }))).ok, false)
})
test("deadline returns for uncooperative fetch and cancels a late body's owner resource", async () => {
  let resolve!: (value: Response) => void
  let signal!: AbortSignal
  let canceled = false
  globalThis.fetch = async (_request, init) => {
    signal = init!.signal!
    return new Promise((done) => {
      resolve = done
    })
  }
  const start = performance.now()
  const result = await requestIamAccountSessions(input({ deadlineAt: performance.now() + 25 }))
  assert.deepEqual(result, { ok: false, status: 503, code: "account_sessions_unavailable" })
  assert.ok(performance.now() - start < 500)
  assert.equal(signal.aborted, true)
  resolve(
    new Response(
      new ReadableStream({
        cancel() {
          canceled = true
        },
      }),
    ),
  )
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(canceled, true)
})
test("the same deadline cancels and releases a body reader even if cancel itself never settles", async () => {
  let canceled = false
  const body = new ReadableStream({
    pull() {
      return new Promise(() => {})
    },
    cancel() {
      canceled = true
      return new Promise(() => {})
    },
  })
  globalThis.fetch = async () =>
    new Response(body, { headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "account-client" } })
  assert.deepEqual(await requestIamAccountSessions(input({ deadlineAt: performance.now() + 25 })), {
    ok: false,
    status: 503,
    code: "account_sessions_unavailable",
  })
  assert.equal(canceled, true)
  assert.equal(body.locked, false)
})
test("abort closes an in-flight revoke without automatically retrying or claiming ACK", async () => {
  const controller = new AbortController()
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return new Promise(() => {})
  }
  const pending = requestIamAccountSessions(input({ kind: "revoke", sessionId: "other", signal: controller.signal }))
  controller.abort()
  assert.deepEqual(await pending, { ok: false, status: 503, code: "account_sessions_unavailable" })
  assert.equal(calls, 1)
})
test("network failure is unavailable rather than a malformed response or success", async () => {
  globalThis.fetch = async () => {
    throw new Error("transport-secret")
  }
  assert.deepEqual(await requestIamAccountSessions(input()), { ok: false, status: 503, code: "account_sessions_unavailable" })
})
