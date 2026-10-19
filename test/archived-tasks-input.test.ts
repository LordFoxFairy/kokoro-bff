import assert from "node:assert/strict"
import test from "node:test"
import type { IncomingMessage } from "node:http"
import {
  parseArchiveInput,
  parseArchiveBody,
  decodeArchivedCursor,
  encodeArchivedCursor,
  archiveStateValid,
  archivedItemsValid,
} from "../src/http/archived-tasks-input.js"
const identity = { tenantId: "tenant", subjectId: "owner", limit: 1 }
const position = { archivedAt: "2026-10-15T00:00:00.000Z", sessionId: "历史😀" }
const request = (url: string, method = "GET", headers: Record<string, string> = {}) =>
  ({ url, method, headers, rawHeaders: Object.entries(headers).flat() }) as IncomingMessage

test("archive canonical historical ID percent encoding preserves Unicode whitespace slash percent and dots exactly", () => {
  for (const id of ["历史😀", " A ", "../x", "a/b", "%2F", "x!~'()*", "\t"]) {
    const result = parseArchiveInput(request(`/v1/sessions/${encodeURIComponent(id)}/archive`))
    assert.equal(result.kind === "state" && result.conversationId, id)
  }
  for (const path of [
    "/v1/sessions/%FF/archive",
    "/v1/sessions/%61/archive",
    "/v1/sessions/x/archive?",
    "/v1/sessions//archive",
    "/v1/sessions/历史/archive",
    "/v1/sessions/x/restore",
  ])
    assert.throws(() => parseArchiveInput(request(path)))
})
test("archive list rejects duplicate unknown invalid UTF8 body and noncanonical limits", () => {
  assert.deepEqual(parseArchiveInput(request("/v1/account/archived-tasks")), { kind: "list", limit: 20, cursor: null })
  for (const query of ["?limit=0", "?limit=01", "?limit=101", "?limit=1&limit=1", "?unknown=x", "?cursor=", "?cursor=%FF", "?limit=1#x"])
    assert.throws(() => parseArchiveInput(request("/v1/account/archived-tasks" + query)))
  assert.throws(() => parseArchiveInput(request("/v1/account/archived-tasks", "GET", { "content-length": "2" })))
})
test("archive commands require exactly one raw idempotency key and strict empty nonBOM JSON", () => {
  const path = "/v1/sessions/a/archive"
  assert.equal(parseArchiveInput(request(path, "POST", { "idempotency-key": "valid.key" })).kind, "archive")
  for (const key of ["", " a", "a b", "a,b", "x".repeat(129)]) assert.throws(() => parseArchiveInput(request(path, "POST", { "idempotency-key": key })))
  assert.throws(() =>
    parseArchiveInput({
      ...request(path, "POST", { "idempotency-key": "x" }),
      rawHeaders: ["Idempotency-Key", "x", "idempotency-key", "x"],
    } as IncomingMessage),
  )
  parseArchiveBody(Buffer.from(" {} \n"))
  for (const body of ["", "null", "[]", '{"a":1}', '{"a":1,"a":2}', "\ufeff{}", '{"a":"\\ud800"}']) assert.throws(() => parseArchiveBody(Buffer.from(body)))
  assert.throws(() => parseArchiveBody(Buffer.from([0x7b, 0xff, 0x7d])))
})
test("archive cursor is closed canonical and bound to identity limit and exact millisecond anchor", () => {
  const cursor = encodeArchivedCursor(position, identity)
  assert.deepEqual(decodeArchivedCursor(cursor, identity), position)
  for (const changed of [
    { ...identity, subjectId: "other" },
    { ...identity, tenantId: "other" },
    { ...identity, limit: 2 },
  ])
    assert.throws(() => decodeArchivedCursor(cursor, changed))
  const value = { kind: "archived_tasks", ...identity, ...position }
  for (const raw of [
    "\ufeff" + JSON.stringify(value),
    JSON.stringify({ ...value, extra: true }),
    JSON.stringify({ ...value, archivedAt: "2026-10-15T00:00:00Z" }),
    JSON.stringify(value).replace('"kind":', '"kind":"archived_tasks","kind":'),
  ])
    assert.throws(() => decodeArchivedCursor(`arc1_${Buffer.from(raw).toString("base64url")}`, identity))
  assert.throws(() => decodeArchivedCursor(cursor + "=", identity))
})
test("archive safe projections preserve titles and C byte order without accepting extra capability fields", () => {
  const item = { session_id: "A", title: "\t", archived_at: position.archivedAt, project_ref: null }
  const ids = ["A", "a", "\ue000", "😀"].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  assert.equal(
    archivedItemsValid(
      ids.map((session_id) => ({ ...item, session_id })),
      100,
    ),
    true,
  )
  assert.equal(archivedItemsValid([{ ...item, share_id: "secret" }] as never, 1), false)
  assert.equal(archivedItemsValid([item, item], 2), false)
  assert.equal(archiveStateValid({ archived_at: null, session_id: "A" }, "A"), true)
  assert.equal(archiveStateValid({ archived_at: null, session_id: "B" }, "A"), false)
})
