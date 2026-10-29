import assert from "node:assert/strict"
import { test } from "node:test"
import { regenerationSourceInTransaction } from "../src/infrastructure/postgres/message-regeneration.js"
const payload = {
  schema_version: 3,
  launch: {
    request_id: "old-request",
    run_id: "run",
    session_id: "session",
    feature_key: "chat",
    message_id: "user",
    content: "question",
    project_ref: null,
    selected_skill_source_refs: ["skill:pinned"],
    trace: { source: "kokoro-bff" },
  },
}
const row = {
  source_run_id: "run",
  source_status: "completed",
  dispatch_status: "terminal",
  admission_unknown_seen: false,
  user_message_id: "user",
  content: "question",
  input_id: "user",
  input_content: "question",
  selected_skill_source_refs: ["skill:pinned"],
  source_origin: "normal",
  input_origin: "normal",
  source_parent: null,
  input_parent: null,
  source_user: null,
  input_user: null,
  payload,
}
const input = { tenantId: "tenant", subjectId: "owner", conversationId: "session", sourceMessageId: "answer" }
const read = (value: unknown) => regenerationSourceInTransaction({ query: async () => ({ rows: [value] }) } as never, input)
test("regeneration source binds the typed frozen payload to the exact immutable user choices and mirror lineage", async () => {
  assert.equal((await read(row))?.originalUserMessageId, "user")
  const mirror = {
    ...row,
    input_id: "mirror",
    source_origin: "regeneration_answer",
    input_origin: "regeneration_input",
    source_parent: "previous-answer",
    input_parent: "previous-answer",
    source_user: "user",
    input_user: "user",
    payload: { ...payload, launch: { ...payload.launch, message_id: "mirror" } },
  }
  assert.equal((await read(mirror))?.originalUserMessageId, "user")
  for (const wrong of [
    { ...row, selected_skill_source_refs: [] },
    { ...row, input_content: "changed" },
    { ...row, source_origin: "regeneration_answer" },
    { ...mirror, input_parent: "other-answer" },
    { ...mirror, input_user: "other-user" },
    { ...row, payload: { ...payload, launch: { ...payload.launch, session_id: "other" } } },
  ])
    await assert.rejects(read(wrong), /SOURCE_INVALID/)
  for (const wrong of [
    { ...row, source_status: "pending" },
    { ...row, dispatch_status: "retryable" },
    { ...row, dispatch_status: "failed", admission_unknown_seen: true },
  ])
    await assert.rejects(read(wrong), /NOT_READY/)
})
