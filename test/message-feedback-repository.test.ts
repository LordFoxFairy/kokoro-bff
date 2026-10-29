import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import { readMessageFeedback, setMessageFeedback } from "../src/infrastructure/postgres/message-feedback.js"
const q = () => ({
  tenantId: "tenant",
  subjectId: "owner",
  conversationId: "session",
  messageId: "message",
  signal: new AbortController().signal,
  deadlineAt: performance.now() + 1000,
})
function fixture({ found = true, commitFailure = false } = {}) {
  let value: string | null = null
  const calls: string[] = [],
    releases: unknown[] = []
  const client = Object.assign(new EventEmitter(), {
    async query(sql: string, values?: unknown[]) {
      calls.push(sql)
      if (sql.startsWith("SELECT conversation.conversation_id") || sql.startsWith("SELECT message_id")) return { rows: found ? [{}] : [] }
      if (sql.startsWith("INSERT INTO bff_message_feedback")) value = String(values?.[4])
      if (sql.startsWith("DELETE FROM bff_message_feedback")) value = null
      if (sql.startsWith("SELECT preference.feedback")) return { rows: found ? [{ feedback: value }] : [] }
      if (sql.startsWith("SELECT feedback")) return { rows: value === null ? [] : [{ feedback: value }] }
      if (sql === "COMMIT" && commitFailure) throw Error("ACK lost")
      return { rows: [] }
    },
    release(broken?: unknown) {
      releases.push(broken)
    },
  })
  return { database: { pool: { connect: async () => client } } as never, calls, releases }
}
test("feedback repository reads, sets, clears and scopes the exact assistant without touching Messages", async () => {
  const f = fixture()
  assert.equal((await readMessageFeedback(f.database, q()))?.feedback, null)
  for (const feedback of ["up", "down", null] as const) assert.equal((await setMessageFeedback(f.database, { ...q(), feedback }))?.feedback, feedback)
  assert.ok(f.calls.every((sql) => !sql.startsWith("UPDATE bff_message ") && !sql.includes("receipt") && !sql.includes("dispatch")))
})
test("invisible exact parent cannot mutate; unknown commit retires its own connection", async () => {
  const no = fixture({ found: false })
  assert.equal(await setMessageFeedback(no.database, { ...q(), feedback: "up" }), null)
  assert.ok(no.calls.every((sql) => !sql.startsWith("INSERT") && !sql.startsWith("DELETE")))
  const unknown = fixture({ commitFailure: true })
  await assert.rejects(setMessageFeedback(unknown.database, { ...q(), feedback: "up" }), /COMMIT_UNKNOWN/)
  assert.deepEqual(unknown.releases, [true])
})
test("aborted feedback cannot start SQL or dispatch a delayed preference", async () => {
  const f = fixture(),
    controller = new AbortController()
  controller.abort()
  await assert.rejects(setMessageFeedback(f.database, { ...q(), signal: controller.signal, feedback: "up" }))
  assert.deepEqual(f.calls, [])
})
