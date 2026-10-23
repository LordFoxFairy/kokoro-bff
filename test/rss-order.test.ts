import assert from "node:assert/strict"
import test from "node:test"
import { rssOrderBatch } from "../src/domain/scheduled-task/rss-order.js"
for (const [instant, next] of [
  ["2026-12-31T23:59:59.999999999Z", "2027-01-01T00:00:00.000000000Z"],
  ["2026-01-01T00:00:00.999999999Z", "2026-01-01T00:00:01.000000000Z"],
])
  test(`BigInt carries ${instant}`, () => {
    const page = rssOrderBatch({ observedNanoseconds: "0", highWatermark: instant!, identities: ["a", "b"] })
    assert.equal(page.keys[0], next)
    assert.equal(page.highWatermark, page.keys[1])
  })
test("same observed instant two 200-item batches remain globally monotonic across restart", () => {
  const ids = Array.from({ length: 200 }, (_, i) => String(i).padStart(3, "0"))
  const first = rssOrderBatch({ observedNanoseconds: "1790000000000000000", highWatermark: null, identities: ids })
  const second = rssOrderBatch({
    observedNanoseconds: "1790000000000000000",
    highWatermark: JSON.parse(JSON.stringify(first.highWatermark)),
    identities: ids.map((x) => "z" + x),
  })
  assert.ok(second.keys[0]! > first.highWatermark!)
  assert.equal(new Set([...first.keys, ...second.keys]).size, 400)
})
test("empty batch preserves high watermark; unsorted duplicate overflow and Number-like epoch are refused", () => {
  assert.deepEqual(rssOrderBatch({ observedNanoseconds: "1", highWatermark: null, identities: [] }), { keys: [], highWatermark: null })
  for (const input of [
    { observedNanoseconds: "1e9", highWatermark: null, identities: ["a"] },
    { observedNanoseconds: "1", highWatermark: null, identities: ["b", "a"] },
    { observedNanoseconds: "1", highWatermark: null, identities: ["a", "a"] },
    { observedNanoseconds: "253402300800000000000", highWatermark: null, identities: ["a"] },
  ])
    assert.throws(() => rssOrderBatch(input))
})
