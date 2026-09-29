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
