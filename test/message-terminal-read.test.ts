import assert from "node:assert/strict"
import { test } from "node:test"
import type { PoolClient } from "pg"
import { privateMessagesFromRows, type PrivateMessageRow } from "../src/infrastructure/postgres/message-parts-read.js"
import { privateChatMessage, chatMessage } from "../src/application/chat/mappers.js"
const scope = { tenantId: "tenant", subjectId: "owner", conversationId: "session", projectRef: null, requestedProjectRef: null, scope: "all" as const }
const row = (content = ""): PrivateMessageRow => ({
  message_id: "message",
  tenant_id: "tenant",
  conversation_id: "session",
  run_id: "run",
  role: "assistant",
  content,
  selected_skill_source_refs: [],
  status: "failed",
  agent_failure_code: null,
  agent_failure_retryable: null,
  message_seq: "1",
  created_at: "2026-10-28T00:00:00Z",
  updated_at: "2026-10-28T00:00:00Z",
  parts_count: null,
  parts_format_version: null,
  parts_public_sequence: null,
})
const terminal = () => ({
  message_id: "message",
  run_id: "run",
  tenant_id: "tenant",
  session_id: "session",
  subject_id: "owner",
  status: "cancelled",
  source_owner: "kokoro-agent",
  source_event_id: "cancel-event",
  source_sequence: "4",
  source_digest: "a".repeat(64),
  source_occurred_at: "2026-10-28T00:00:01Z",
})
const client = (proof: unknown[], count = { value: 0 }) =>
  ({
    query: async () => {
      count.value++
      return { rows: proof }
    },
  }) as unknown as PoolClient
for (const content of ["", "trusted partial"])
  test(`projects cancelled private Message without changing stored status/body (${content ? "partial" : "empty"})`, async () => {
    const count = { value: 0 },
      data = row(content)
    const [read] = await privateMessagesFromRows(client([terminal()], count), [data], scope, "agui_" + "1".repeat(32), null, null)
    assert.equal((read as unknown as { terminal_status: string }).terminal_status, "cancelled")
    assert.equal(read?.status, "failed")
    assert.equal(read?.content, content)
    assert.equal(count.value, 1)
    assert.equal(privateChatMessage(read!).terminal_status, "cancelled")
    assert.equal(Object.hasOwn(chatMessage(read as never), "terminal_status"), false)
  })
test("unknown/generic failures stay absent, candidates are batched once, and noncandidates do no IO", async () => {
  const count = { value: 0 }
  const [read] = await privateMessagesFromRows(client([], count), [row()], scope, "agui_" + "1".repeat(32), null, null)
  assert.equal(Object.hasOwn(read!, "terminal_status"), false)
  assert.equal(count.value, 1)
  const before = count.value
  await privateMessagesFromRows(client([], count), [{ ...row(), status: "completed" }], scope, "agui_" + "1".repeat(32), null, null)
  assert.equal(count.value, before)
})
for (const key of ["tenant_id", "session_id", "subject_id", "message_id", "run_id"])
  test(`rejects corrupt/foreign terminal proof ${key}`, async () => {
    await assert.rejects(
      privateMessagesFromRows(client([{ ...terminal(), [key]: "foreign" }]), [row()], scope, "agui_" + "1".repeat(32), null, null),
      /MESSAGE_PARTS_UNAVAILABLE/u,
    )
  })
test("rejects multiple or untrusted terminals instead of inventing cancellation", async () => {
  for (const proof of [[terminal(), terminal()], [{ ...terminal(), source_owner: "foreign" }]])
    await assert.rejects(privateMessagesFromRows(client(proof), [row()], scope, "agui_" + "1".repeat(32), null, null), /MESSAGE_PARTS_UNAVAILABLE/u)
})

test("durable cancellation is independent of an absent/GCed AG-UI watermark and later Runs", async () => {
  const [read] = await privateMessagesFromRows(client([terminal()]), [row()], scope, null, "new-run", "new-message")
  assert.equal(read?.terminal_status, "cancelled")
  for (const status of ["completed", "failed"]) {
    const [other] = await privateMessagesFromRows(client([{ ...terminal(), status }]), [row()], scope, null, null, null)
    assert.equal(Object.hasOwn(other!, "terminal_status"), false)
  }
})
for (const mutate of [
  { source_event_id: "" },
  { source_sequence: "0" },
  { source_sequence: "9223372036854775808" },
  { source_digest: "bad" },
  { source_occurred_at: "bad" },
])
  test(`rejects corrupt durable source identity ${Object.keys(mutate)[0]}`, async () => {
    await assert.rejects(privateMessagesFromRows(client([{ ...terminal(), ...mutate }]), [row()], scope, null, null, null), /MESSAGE_PARTS_UNAVAILABLE/u)
  })
