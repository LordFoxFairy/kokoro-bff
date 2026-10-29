import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"
import type { CommitChatTurn } from "../src/application/ports/agent-dispatch-outbox-repository.js"
import { ChatTurnApplicationService } from "../src/application/chat-turn-service.js"
const frozen = {
  schema_version: 3 as const,
  launch: {
    request_id: "old-request",
    run_id: "old-run",
    session_id: "session",
    feature_key: "chat" as const,
    message_id: "original-user",
    content: "original trusted question",
    project_ref: "old-project",
    selected_skill_source_refs: ["skill:pinned"],
    selected_mcp_connection_ids: ["connection:original"],
    selected_custom_api_profiles: [{ profile_id: "api:original", expected_state_version: 3 }],
    requested_model_label: "model:original",
    trace: { source: "kokoro-bff" as const, agent: "deep", thinking: true, mcp_servers: ["diagnostic-only"] },
  },
}
const source = {
  sourceMessageId: "old-answer",
  sourceRunId: "old-run",
  originalUserMessageId: "original-user",
  content: frozen.launch.content,
  payload: frozen,
  sourceFingerprint: "a".repeat(64),
}
test("regeneration copies only frozen execution choices and creates distinct native mirror identities", async () => {
  const commits: CommitChatTurn[] = []
  const repository = {
    readRegenerationSource: async () => source,
    commitChatTurn: async (command: CommitChatTurn) => {
      commits.push(command)
      return { run_id: command.runId, user_message_id: command.userMessageId, assistant_message_id: command.assistantMessageId }
    },
  } as never
  const service = new ChatTurnApplicationService(repository, { generate: (material) => createHash("sha256").update(material).digest("hex") })
  const result = await service.regenerate({
    tenantId: "tenant",
    subjectId: "owner",
    actorId: "owner",
    conversationId: "session",
    sourceMessageId: "old-answer",
    requestId: "fresh-request",
    idempotencyKey: "explicit-new-attempt",
    signal: new AbortController().signal,
    deadlineAt: performance.now() + 5000,
  })
  assert.equal(result?.user_message_id, "original-user")
  assert.equal(result?.regenerated_from_message_id, "old-answer")
  const command = commits[0]!
  assert.notEqual(command.runId, "old-run")
  assert.notEqual(command.userMessageId, "original-user")
  assert.equal(command.payload.launch.message_id, command.userMessageId)
  assert.equal(command.payload.launch.request_id, "fresh-request")
  assert.equal(command.payload.launch.content, "original trusted question")
  assert.deepEqual(command.payload.launch.selected_skill_source_refs, ["skill:pinned"])
  assert.deepEqual(command.payload.launch.selected_mcp_connection_ids, ["connection:original"])
  assert.deepEqual(command.payload.launch.selected_custom_api_profiles, [{ profile_id: "api:original", expected_state_version: 3 }])
  assert.equal(command.payload.launch.requested_model_label, "model:original")
  assert.equal(command.payload.launch.trace.mcp_servers, undefined)
  assert.equal(command.payload.launch.project_ref, null)
  assert.equal(command.regeneration.originalUserMessageId, "original-user")
  assert.notEqual(command.identityAssertionRef, "old-request")
})
