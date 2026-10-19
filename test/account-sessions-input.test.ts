import assert from "node:assert/strict"
import type { IncomingMessage } from "node:http"
import test from "node:test"
import { parseAccountSessionInput } from "../src/http/account-session-input.ts"

function request(method: string, url: string, headers: IncomingMessage["headers"] = {}): IncomingMessage {
  return { method, url, headers } as IncomingMessage
}
test("list raw query retains defaults and opaque cursor without accepting duplicate or unknown axes", () => {
  assert.deepEqual(parseAccountSessionInput(request("GET", "/v1/account/sessions"), ["account", "sessions"]), { kind: "list", limit: 25, cursor: null })
  assert.deepEqual(parseAccountSessionInput(request("GET", "/v1/account/sessions?limit=100&cursor=a%2Bb"), ["account", "sessions"]), {
    kind: "list",
    limit: 100,
    cursor: "a+b",
  })
  for (const query of [
    "limit=0",
    "limit=101",
    "limit=01",
    "limit=1.0",
    "limit=1&limit=2",
    "cursor=",
    "cursor=a&cursor=b",
    "subject_id=foreign",
    `cursor=${"a".repeat(2049)}`,
  ])
    assert.equal(parseAccountSessionInput(request("GET", `/v1/account/sessions?${query}`), ["account", "sessions"]), null, query)
})
test("revoke accepts only an owner session id and no query, body, or receipt key", () => {
  assert.deepEqual(parseAccountSessionInput(request("DELETE", "/v1/account/sessions/other"), ["account", "sessions", "other"]), {
    kind: "revoke",
    sessionId: "other",
  })
  for (const headers of [{ "content-length": "1" }, { "transfer-encoding": "chunked" }, { "idempotency-key": "key" }])
    assert.equal(parseAccountSessionInput(request("DELETE", "/v1/account/sessions/other", headers), ["account", "sessions", "other"]), null)
  for (const id of ["", "a".repeat(256)])
    assert.equal(parseAccountSessionInput(request("DELETE", "/v1/account/sessions/other"), ["account", "sessions", id]), null)
  assert.equal(parseAccountSessionInput(request("DELETE", "/v1/account/sessions/other?"), ["account", "sessions", "other"]), null)
  assert.equal(parseAccountSessionInput(request("DELETE", "/v1/account/sessions/other?limit=1"), ["account", "sessions", "other"]), null)
  assert.equal(parseAccountSessionInput(request("POST", "/v1/account/sessions"), ["account", "sessions"]), null)
})
