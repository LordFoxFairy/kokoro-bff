import assert from "node:assert/strict"
import test from "node:test"
import { parseAccountProfileBody, accountProfileMetadataValid } from "../src/http/account-profile-input.ts"
import type { IncomingMessage } from "node:http"
const parse = (value: unknown) => parseAccountProfileBody(Buffer.from(JSON.stringify(value)))
test("exact Unicode name and historical expected name are never trimmed or normalized", () => {
  assert.deepEqual(parse({ name: "新🙂é", expected_name: " Old " }), { name: "新🙂é", expected_name: " Old " })
  assert.ok(parse({ name: "a".repeat(100), expected_name: "" }))
  for (const name of ["", " a", "a ", "a\u0085", "a\u0000", "\ud800", "🙂".repeat(51)]) assert.equal(parse({ name, expected_name: "Old" }), null)
  assert.equal(parse({ name: "New", expected_name: "a".repeat(16385) }), null)
  for (const value of [{ name: "New" }, { name: "New", expected_name: "Old", subject: "foreign" }, [], null]) assert.equal(parse(value), null)
})
test("raw duplicate keys and invalid UTF8 are rejected before generated stripping", () => {
  assert.equal(parseAccountProfileBody(Buffer.from('{"name":"A","name":"B","expected_name":"Old"}')), null)
  assert.equal(parseAccountProfileBody(Buffer.from([0xff])), null)
})
test("metadata accepts JSON chunked and single identity encoding, rejects query and duplicate headers", () => {
  const request = (headers: Record<string, string>, rawHeaders: string[], url = "/v1/account/profile") =>
    ({ method: "PATCH", url, headers, rawHeaders }) as IncomingMessage
  const valid = request({ "content-type": "application/json", "transfer-encoding": "chunked" }, [
    "Content-Type",
    "application/json",
    "Transfer-Encoding",
    "chunked",
  ])
  assert.equal(accountProfileMetadataValid(valid), true)
  assert.equal(accountProfileMetadataValid({ ...valid, url: "/v1/account/profile?" } as IncomingMessage), false)
  assert.equal(accountProfileMetadataValid({ ...valid, headers: { ...valid.headers, "idempotency-key": "key" } } as IncomingMessage), false)
  assert.equal(accountProfileMetadataValid({ ...valid, rawHeaders: [...valid.rawHeaders, "Content-Type", "application/json"] } as IncomingMessage), false)
  for (const encoding of ["gzip", "identity, identity"])
    assert.equal(
      accountProfileMetadataValid({
        ...valid,
        headers: { ...valid.headers, "content-encoding": encoding },
        rawHeaders: [...valid.rawHeaders, "Content-Encoding", encoding],
      } as IncomingMessage),
      false,
    )
})
test("historical expected_name preserves escaped lone UTF16 while new name still rejects it", () => {
  for (const expected_name of ["\ud800", "\udfff", " \u0000\u0085\ud800 ", "\ud800".repeat(16384)])
    assert.deepEqual(parse({ name: "New", expected_name }), { name: "New", expected_name })
  assert.equal(parse({ name: "\ud800", expected_name: "\ud800" }), null)
})

test("local two-string token proof rejects escaped duplicate keys and accepts escaped delimiters/reordered keys", () => {
  for (const raw of [
    '{"name":"A","n\\u0061me":"B","expected_name":"Old"}',
    '{"name":"A","expected_name":"Old","expected_name":"Old"}',
    '{"name":"A","expected_name":{"name":"Old"}}',
  ])
    assert.equal(parseAccountProfileBody(Buffer.from(raw)), null)
  const value = { name: 'A"\\B', expected_name: '\ud800 "name": "Old" \\ ' }
  assert.deepEqual(parseAccountProfileBody(Buffer.from(JSON.stringify({ expected_name: value.expected_name, name: value.name }))), value)
})
