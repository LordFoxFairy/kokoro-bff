import assert from "node:assert/strict"
import test from "node:test"
import { parseSharedTasksInput, encodeSharedTasksCursor, decodeSharedTasksCursor, sharedTasksPageValid } from "../dist/http/shared-tasks-input.js"
const request = (query = "", headers = {}) => ({ method: "GET", url: `/v1/account/shared-tasks${query}`, headers }) as never
const position = { sharedAt: "2026-10-01T01:02:03.000Z", sessionId: "conv_一" }
test("shared task query defaults and canonical limits", () => {
  assert.deepEqual(parseSharedTasksInput(request()), { limit: 20, cursor: null })
  assert.equal(parseSharedTasksInput(request("?limit=100")).limit, 100)
})
for (const query of [
  "?limit=0",
  "?limit=01",
  "?limit=101",
  "?limit=1&limit=2",
  "?unknown=1",
  "?cursor=",
  "?cursor=%FF",
  "?%FF=1",
  "?cursor=%",
  "?cursor=%E0%A4",
])
  test(`shared task raw query rejects ${query}`, () => assert.throws(() => parseSharedTasksInput(request(query))))
for (const headers of [{ "content-length": "2" }, { "transfer-encoding": "chunked" }, { "content-encoding": "identity" }, { "idempotency-key": "unused" }])
  test(`shared task GET rejects framing ${Object.keys(headers)[0]}`, () => assert.throws(() => parseSharedTasksInput(request("", headers))))
test("shared cursor roundtrip preserves position and rejects other tenant, subject and limit", () => {
  const cursor = encodeSharedTasksCursor(position, "tenant", "subject", 20)
  assert.deepEqual(decodeSharedTasksCursor(cursor, "tenant", "subject", 20), position)
  for (const args of [
    ["other", "subject", 20],
    ["tenant", "other", 20],
    ["tenant", "subject", 21],
  ] as const)
    assert.throws(() => decodeSharedTasksCursor(cursor, ...args))
  assert.ok(!Buffer.from(cursor.slice(5), "base64url").toString().includes("share_id"))
})
const rawCursor = (json: string | Uint8Array) => `sht1_${Buffer.from(json).toString("base64url")}`
for (const raw of [
  '{"kind":"shared_tasks","kind":"shared_tasks"}',
  '{"kind":"shared_tasks","k\\u0069nd":"shared_tasks"}',
  "\ufeff{}",
  new Uint8Array([255]),
  "{}",
])
  test(`shared cursor strict raw rejects ${String(raw).slice(0, 30)}`, () =>
    assert.throws(() => decodeSharedTasksCursor(rawCursor(raw), "tenant", "subject", 20)))
test("shared cursor rejects wrong dates, extra capability, malformed base64 and oversized identity", () => {
  const base = { kind: "shared_tasks", tenantId: "tenant", subjectId: "subject", limit: 20, ...position }
  for (const raw of [
    { ...base, sharedAt: "2026-02-30T00:00:00.000Z" },
    { ...base, share_id: "secret" },
    { ...base, sessionId: "" },
  ])
    assert.throws(() => decodeSharedTasksCursor(rawCursor(JSON.stringify(raw)), "tenant", "subject", 20))
  assert.throws(() => decodeSharedTasksCursor("sht1_e30=", "tenant", "subject", 20))
  assert.throws(() => encodeSharedTasksCursor(position, "x".repeat(3000), "subject", 20))
})
test("shared page rejects capability, duplicates, wrong order and empty continuation", () => {
  const item = { session_id: "a", title: "标题", shared_at: position.sharedAt, expires_at: null }
  assert.equal(sharedTasksPageValid({ items: [item], next_cursor: null }, 20), true)
  for (const page of [
    { items: [{ ...item, share_id: "secret" }], next_cursor: null },
    { items: [item, item], next_cursor: null },
    { items: [{ ...item, session_id: "z" }, item], next_cursor: null },
    { items: [], next_cursor: "sht1_x" },
  ])
    assert.equal(sharedTasksPageValid(page, 20), false)
})

test("shared page preserves canonical Chat title strings without invented trim or whole-string length limits", () => {
  for (const title of ["\t", ` ${"x".repeat(200)} `])
    assert.equal(sharedTasksPageValid({ items: [{ session_id: "a", title, shared_at: position.sharedAt, expires_at: null }], next_cursor: null }, 20), true)
})
test("shared page ties use PostgreSQL C UTF8 bytes rather than JavaScript UTF16 ordering", () => {
  const ids = ["a", "Z", "\uE000", "𐀀"].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  assert.equal(
    sharedTasksPageValid(
      { items: ids.map((session_id) => ({ session_id, title: "title", shared_at: position.sharedAt, expires_at: null })), next_cursor: null },
      20,
    ),
    true,
  )
})
