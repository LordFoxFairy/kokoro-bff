import assert from "node:assert/strict"
import { test } from "node:test"

import { ChatApplicationService } from "../dist/application/chat-service.js"
import { PostgresChatRepository } from "../dist/infrastructure/postgres/chat-repository.js"
import type { ChatRepository, ConversationPage } from "../src/application/ports/chat-repository.ts"

test("passes the trusted subject through the private Chat application port", async () => {
  const calls: Array<[string, string, string | undefined, number, string | null]> = []
  const page: ConversationPage = {
    conversations: [{ conversationId: "session_a", tenantId: "tenant_a", ownerId: "owner_a", title: "A", projectRef: null, status: "active", createdAt: new Date("2026-09-04T11:00:00.000Z"), updatedAt: new Date("2026-09-04T12:00:00.000Z"), deletedAt: null }],
    next_cursor: null,
  }
  const repository: ChatRepository = {
    listConversations: async (tenantId, subjectId, projectRef, limit, cursor) => {
      calls.push([tenantId, subjectId, projectRef, limit, cursor])
      return page
    },
  }

  const result = await new ChatApplicationService(repository).listConversations("tenant_a", "owner_a", "project_a", 20, null)

  assert.deepEqual(result, { sessions: [{ session_id: "session_a", title: "A", updated_at: "2026-09-04T12:00:00.000Z" }], next_cursor: null })
  assert.deepEqual(calls, [["tenant_a", "owner_a", "project_a", 20, null]])
})

test("Conversation deletion removes Artifact links using only bound tenant and conversation parameters", async () => {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = []
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values })
      if (sql.includes("UPDATE bff_conversation SET status = 'deleted'")) return { rows: [{ conversation_id: "conversation_1" }] }
      return { rows: [], rowCount: 0 }
    },
    release() {},
  }
  const repository = new PostgresChatRepository({ pool: { connect: async () => client } } as never)
  assert.equal(await repository.deleteConversation("tenant_1", "owner_1", "conversation_1", "request_1"), true)
  const linkDelete = calls.find(({ sql }) => sql.includes("DELETE FROM bff_conversation_artifact"))
  assert.ok(linkDelete)
  assert.match(linkDelete.sql, /tenant_id = \$1 AND conversation_id = \$2/u)
  assert.deepEqual(linkDelete.values, ["tenant_1", "conversation_1"])
  assert.equal(calls.at(-1)?.sql, "COMMIT")
})

test("Chat snapshot exposes durable Artifact identity and bounded-history signal", async () => {
  const conversation = { conversationId: "session_a", tenantId: "tenant_a", ownerId: "owner_a", title: "A", projectRef: null, status: "active", createdAt: new Date("2026-09-04T11:00:00.000Z"), updatedAt: new Date("2026-09-04T12:00:00.000Z"), deletedAt: null }
  const repository = { readSnapshot: async () => ({
    conversation,
    messages: [],
    deliveries: [{ conversationId: "session_a", artifactId: "artifact_a", assetId: "asset_a", artifactKind: "document", title: "Report", mime: "text/markdown", size: 12, runId: "run_a", deliveredAt: new Date("2026-09-04T12:00:00.000Z") }],
    deliveriesHasMore: true,
    eventWatermark: "agui_0123456789abcdef0123456789abcdef",
  }) }
  const result = await new ChatApplicationService(repository as never).snapshot("tenant_a", "owner_a", "session_a", undefined)
  assert.deepEqual(result?.deliveries, [{ conversation_id: "session_a", artifact_id: "artifact_a", asset_id: "asset_a", artifact_kind: "document", title: "Report", mime: "text/markdown", size: 12, run_id: "run_a", created_at: "2026-09-04T12:00:00.000Z" }])
  assert.equal(result?.deliveries_has_more, true)
  assert.equal(result?.event_watermark, "agui_0123456789abcdef0123456789abcdef")
})

test("Chat snapshot maps only a repository-proven active running Run", async () => {
  const conversation = { conversationId: "session_running", tenantId: "tenant_a", ownerId: "owner_a", title: "Running", projectRef: null, status: "active", createdAt: new Date("2026-09-04T11:00:00.000Z"), updatedAt: new Date("2026-09-04T12:00:00.000Z"), deletedAt: null }
  const repository = { readSnapshot: async () => ({ conversation, messages: [], deliveries: [], deliveriesHasMore: false, eventWatermark: null, activeRun: { runId: "run_current", status: "running" } }) }
  const result = await new ChatApplicationService(repository as never).snapshot("tenant_a", "owner_a", "session_running", undefined)
  assert.deepEqual(result?.active_run, { run_id: "run_current", status: "running" })
})

for (const [name, marker] of [
  ["expected blank", { expected_run_id: " ", latest_run_id: null, terminal_run_id: null }],
  ["latest blank", { expected_run_id: "run_expected", latest_run_id: " ", terminal_run_id: null }],
  ["terminal blank", { expected_run_id: "run_expected", latest_run_id: "run_expected", terminal_run_id: " " }],
  ["expected non-string", { expected_run_id: 7, latest_run_id: null, terminal_run_id: null }],
  ["latest non-string", { expected_run_id: "run_expected", latest_run_id: 7, terminal_run_id: null }],
  ["terminal non-string", { expected_run_id: "run_expected", latest_run_id: "run_expected", terminal_run_id: 7 }],
] as const) {
  test(`Chat snapshot rejects ${name} and rolls back and releases its connection`, async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = []
    let released = false
    const client = {
      query: async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values })
        if (sql.includes("FROM bff_conversation") && sql.includes("LIMIT 1")) return { rows: [{ conversation_id: "session_invalid", tenant_id: "tenant_a", owner_id: "owner_a", title: "Invalid", project_ref: null, status: "active", created_at: new Date("2026-09-30T00:00:00Z"), updated_at: new Date("2026-09-30T00:00:00Z"), deleted_at: null }] }
        if (sql.includes("FROM bff_agui_stream")) return { rows: [marker] }
        return { rows: [] }
      },
      release: () => { released = true },
    }
    const repository = new PostgresChatRepository({ pool: { connect: async () => client } } as never)

    await assert.rejects(repository.readSnapshot("tenant_a", "owner_a", "session_invalid", undefined), /CHAT_ACTIVE_RUN_STATE_INVALID/u)
    const streamRead = calls.find(({ sql }) => sql.includes("FROM bff_agui_stream"))
    assert.deepEqual(streamRead?.values, ["tenant_a", "session_invalid"])
    assert.equal(calls.at(-1)?.sql, "ROLLBACK")
    assert.equal(released, true)
  })
}

test("Chat snapshot performs no stream read when the Conversation ACL rejects access", async () => {
  const calls: string[] = []
  let released = false
  const client = { query: async (sql: string) => { calls.push(sql); return { rows: [] } }, release: () => { released = true } }
  const repository = new PostgresChatRepository({ pool: { connect: async () => client } } as never)
  assert.equal(await repository.readSnapshot("tenant_a", "other_subject", "session_hidden", undefined), null)
  assert.equal(calls.some((sql) => sql.includes("FROM bff_agui_stream")), false)
  assert.equal(calls.at(-1), "COMMIT")
  assert.equal(released, true)
})
