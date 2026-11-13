import assert from "node:assert/strict"
import { test } from "node:test"
import { sharedConversationSuffix, type SharedContextRow } from "../src/infrastructure/postgres/chat-shared-context.ts"
const row = (sequence: string, content: string): SharedContextRow => ({
  message_id: `message-${sequence}`,
  sequence,
  role: "user",
  content,
  content_bytes: String(Buffer.byteLength(content)),
  final_valid: true,
})
test("shared context is an ordered whole-message suffix, retaining literal content and explicitly marking any older omitted message", () => {
  const newest = [row("3", " literal 😀 "), { ...row("2", "x"), content: null, content_bytes: "262145" }, row("1", "older")]
  assert.deepEqual(sharedConversationSuffix("project", "conversation", newest), {
    project_ref: "project",
    conversation_id: "conversation",
    messages: [{ message_id: "message-3", sequence: "3", role: "user", content: " literal 😀 " }],
    has_earlier_messages: true,
  })
  assert.equal(sharedConversationSuffix("project", "conversation", [row("1", "single")]).has_earlier_messages, false)
  assert.throws(
    () => sharedConversationSuffix("project", "conversation", [{ ...row("1", "unverified"), role: "assistant", final_valid: false }]),
    /SHARED_CONTEXT/u,
  )
})
