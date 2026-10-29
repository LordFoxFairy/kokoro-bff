import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import { readRunFinalAnswer } from "../src/infrastructure/postgres/run-final-answer-read.js"

const segment = "msg_" + "a".repeat(32)
const part = { kind: "text", part_id: `text:${segment}`, segment_id: segment, first_sequence: "4", latest_sequence: "6", completed: true, text: "" }
const valid = { parts_format_version: 1, revision: "8", final_segment_id: null, candidates: [part] }
function setup(row: unknown) {
  const releases: unknown[] = []
  const client = Object.assign(new EventEmitter(), {
    query: async (sql: string) => ({ rows: sql.includes("FROM bff_message message") ? (row ? [row] : []) : [] }),
    release: (broken?: unknown) => releases.push(broken),
  })
  const pool = { connect: async () => client }
  return { pool: pool as never, releases }
}
const input = () => ({
  tenantId: "tenant",
  subjectId: "owner",
  conversationId: "session",
  runId: "run",
  finalMessageId: segment,
  signal: new AbortController().signal,
  deadlineAt: performance.now() + 1000,
})
test("read-only final binds exact completed slot and owning parts revision", async () => {
  const { pool, releases } = setup(valid)
  assert.deepEqual(await readRunFinalAnswer(pool, input()), { segment_id: segment, revision: "8" })
  assert.equal(releases.length, 1)
})
test("unknown, duplicate, incomplete, conflicting or out-of-revision slots never bind", async () => {
  for (const row of [
    null,
    { ...valid, parts_format_version: null },
    { ...valid, revision: "05" },
    { ...valid, final_segment_id: "other" },
    { ...valid, candidates: [] },
    { ...valid, candidates: [part, part] },
    { ...valid, candidates: [null] },
    { ...valid, candidates: [{ ...part, completed: false }] },
    { ...valid, candidates: [{ ...part, latest_sequence: "9" }] },
    { ...valid, candidates: [{ ...part, segment_id: "other" }] },
  ]) {
    const { pool } = setup(row)
    assert.equal(await readRunFinalAnswer(pool, input()), null)
  }
})
