import assert from "node:assert/strict"
import test from "node:test"
import { parseRssConditions, matchesRssConditions } from "../src/domain/scheduled-task/rss-conditions.js"
const e = {
  identity: "x",
  title: "Hello world",
  summary: "",
  content: "",
  authors: ["A", "B"],
  categories: [],
  link: null,
  domain: null,
  publishedAt: null,
  updatedAt: null,
  enclosures: [],
} as const
test("OR of AND rules, empty filter and exact Unicode/case semantics", () => {
  assert.equal(matchesRssConditions(e, parseRssConditions([])), true)
  assert.equal(
    matchesRssConditions(
      e,
      parseRssConditions([
        [{ field: "title", operator: "equals", value: "no" }],
        [
          { field: "title", operator: "contains", value: "Hello" },
          { field: "author", operator: "equals", value: "A\nB" },
        ],
      ]),
    ),
    true,
  )
  assert.equal(matchesRssConditions(e, parseRssConditions([[{ field: "title", operator: "contains", value: "hello" }]])), false)
})
for (const [operator, value, expected] of [
  ["contains", "world", true],
  ["not_contains", "world", false],
  ["equals", "Hello world", true],
  ["not_equals", "Hello world", false],
  ["starts_with", "Hello", true],
  ["not_starts_with", "Hello", false],
  ["ends_with", "world", true],
  ["not_ends_with", "world", false],
] as const)
  test(operator, () => assert.equal(matchesRssConditions(e, parseRssConditions([[{ field: "title", operator, value }]])), expected))
test("missing fields are empty and emptiness forbids value", () => {
  assert.equal(matchesRssConditions(e, parseRssConditions([[{ field: "domain", operator: "is_empty" }]])), true)
  assert.equal(matchesRssConditions(e, parseRssConditions([[{ field: "domain", operator: "is_not_empty" }]])), false)
})
for (const bad of [
  null,
  {},
  [[]],
  [[{ field: "title", operator: "regex", value: ".*" }]],
  [[{ field: "bad", operator: "equals", value: "x" }]],
  [[{ field: "title", operator: "is_empty", value: "" }]],
  [[{ field: "title", operator: "equals", value: "" }]],
  [[{ field: "title", operator: "equals", value: "a".repeat(1025) }]],
  [[{ field: "title", operator: "equals", value: "x", extra: 1 }]],
  Array(9).fill([{ field: "title", operator: "is_empty" }]),
  [Array(17).fill({ field: "title", operator: "is_empty" })],
])
  test(`closed conditions reject ${JSON.stringify(bad).slice(0, 70)}`, () => assert.throws(() => parseRssConditions(bad)))
test("bad later rule cannot hide behind matching early OR group", () =>
  assert.throws(() => parseRssConditions([[{ field: "title", operator: "is_not_empty" }], [{ field: "title", operator: "regex", value: "x" }]])))

test("matching revalidates before short circuit, input is copied and frozen", () => {
  const raw = [[{ field: "title", operator: "equals", value: "Hello world" }]]
  const parsed = parseRssConditions(raw)
  raw[0]![0]!.value = "changed"
  assert.equal(matchesRssConditions(e, parsed), true)
  assert.ok(Object.isFrozen(parsed))
  assert.ok(Object.isFrozen(parsed[0]?.[0]))
  assert.throws(() => matchesRssConditions(e, [[{ field: "title", operator: "is_not_empty" }], [{ field: "title", operator: "regex", value: "x" }]] as never))
})
test("exact condition limits and non-normalizing Unicode semantics", () => {
  assert.equal(parseRssConditions(Array(8).fill(Array(16).fill({ field: "title", operator: "equals", value: "x".repeat(1024) }))).length, 8)
  assert.equal(matchesRssConditions({ ...e, title: "é" }, parseRssConditions([[{ field: "title", operator: "equals", value: "e\u0301" }]])), false)
})
