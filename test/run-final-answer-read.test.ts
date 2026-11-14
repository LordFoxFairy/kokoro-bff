import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import * as finalAnswers from "../src/infrastructure/postgres/run-final-answer-read.js"

const { readRunFinalAnswer } = finalAnswers

const segment = "msg_" + "a".repeat(32)
const part = { kind: "text", part_id: `text:${segment}`, segment_id: segment, first_sequence: "4", latest_sequence: "6", completed: true, text: "" }
const valid = { parts_format_version: 1, revision: "8", final_segment_id: null, candidates: [part] }
function setup(row: unknown) {
  const releases: unknown[] = []
  const client = Object.assign(new EventEmitter(), {
    query: async (sql: string) => ({
      rows: sql.includes("FROM bff_message message")
        ? row
          ? [row]
          : []
        : sql.includes("FROM bff_conversation conversation")
          ? [{ tenant_id: "tenant", owner_id: "owner", conversation_id: "session", project_ref: null }]
          : [],
    }),
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

const selection = { tenantId: "tenant", subjectId: "owner", messageId: "assistant", projectId: null }
const body = "  source e\u0301 🧪\n\n"
const selected = {
  conversation_id: "source-session",
  run_id: "source-run",
  parts_format_version: 1,
  revision: "8",
  final_segment_id: segment,
  candidates: [{ ...part, text: body }],
}
const queryResult = (rows: unknown[]) => ({ query: async () => ({ rows }) }) as never

test("a transaction-scoped selection returns exact final bytes and their durable source identity", async () => {
  assert.deepEqual(await finalAnswers.selectedFinalAnswerInTransaction(queryResult([selected]), selection), {
    conversationId: "source-session",
    messageId: "assistant",
    runId: "source-run",
    finalSegmentId: segment,
    revision: "8",
    content: body,
    sizeBytes: String(Buffer.byteLength(body, "utf8")),
    contentSha256: createHash("sha256").update(body, "utf8").digest("hex"),
  })
})

test("selection requires one exact completed canonical slot with a positive revision and at most 24 KiB of valid UTF-8", async () => {
  for (const row of [
    { ...selected, final_segment_id: null },
    { ...selected, revision: "0" },
    { ...selected, revision: "9223372036854775808" },
    { ...selected, candidates: [{ ...part, text: body, completed: false }] },
    { ...selected, candidates: [{ ...part, text: body }, null] },
    { ...selected, candidates: [{ ...part, text: body, latest_sequence: "9" }] },
    { ...selected, candidates: [{ ...part, text: body, segment_id: "another" }] },
    { ...selected, candidates: [null] },
    ...["", "\uD800", "\u0000", "🧪".repeat(6144) + "x"].map((text) => ({ ...selected, candidates: [{ ...part, text }] })),
  ]) {
    assert.equal(await finalAnswers.selectedFinalAnswerInTransaction(queryResult([row]), selection), null)
  }
  assert.equal(await finalAnswers.selectedFinalAnswerInTransaction(queryResult([]), selection), null)
  assert.equal(await finalAnswers.selectedFinalAnswerInTransaction(queryResult([selected, selected]), selection), null)
  const exactly = { ...selected, candidates: [{ ...part, text: "🧪".repeat(6144) }] }
  assert.equal((await finalAnswers.selectedFinalAnswerInTransaction(queryResult([exactly]), selection))?.sizeBytes, "24576")
})

test("selection propagates transaction NOWAIT and cancellation failures to the owning transaction", async () => {
  for (const failure of [Object.assign(Error("locked"), { code: "55P03" }), new DOMException("caller aborted", "AbortError")]) {
    const client = {
      query: async () => {
        throw failure
      },
    } as never
    await assert.rejects(finalAnswers.selectedFinalAnswerInTransaction(client, selection), (actual) => actual === failure)
  }
})
