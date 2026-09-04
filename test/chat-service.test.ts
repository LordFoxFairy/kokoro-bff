import assert from "node:assert/strict"
import { test } from "node:test"

import { ChatApplicationService } from "../dist/application/chat-service.js"
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
