import assert from "node:assert/strict"
import { test } from "node:test"

import { ChatApplicationService } from "../dist/application/chat-service.js"
import { authorizeChatRequest } from "../dist/http/routes/chat-authorization.js"
import { liveChatBusiness } from "../dist/http/routes/chat.js"
import { PostgresChatRepository } from "../dist/infrastructure/postgres/chat-repository.js"
import type { ChatRepository, ConversationCollectionFilter, ConversationPage } from "../src/application/ports/chat-repository.ts"

const collectionContext = { requestId: "request_collection_scope", identity: { namespace: "tenant_a", userId: "owner_a" } }

function collectionRequest(query: string): never {
  return { method: "GET", url: `/v1/sessions${query}` } as never
}

function responseDouble(): never {
  return { writeHead() {}, end() {} } as never
}

async function collectionRepositoryCall(query: string): Promise<{ calls: unknown[][]; projectReads: number }> {
  const calls: unknown[][] = []
  let projectReads = 0
  const page: ConversationPage = { conversations: [], next_cursor: null }
  const repository = {
    listConversations: async (...args: unknown[]) => {
      calls.push(args)
      return page
    },
  }
  const chat = new ChatApplicationService(repository as never)
  const store = {
    services: {
      chat,
      projects: {
        find: async () => {
          projectReads += 1
          return {}
        },
      },
    },
  } as never
  const request = collectionRequest(query)
  const authorization = await authorizeChatRequest(request, collectionContext, ["sessions"], {}, store)
  assert.ok(authorization?.ok)
  assert.equal(await liveChatBusiness(request, responseDouble(), {} as never, collectionContext, ["sessions"], {}, null, new Map(), store, authorization), true)
  return { calls, projectReads }
}

test("passes the trusted subject through the private Chat application port", async () => {
  const calls: Array<[string, string, ConversationCollectionFilter, number, string | null]> = []
  const page: ConversationPage = {
    conversations: [
      {
        conversationId: "session_a",
        tenantId: "tenant_a",
        ownerId: "owner_a",
        title: "A",
        projectRef: null,
        status: "active",
        createdAt: new Date("2026-09-04T11:00:00.000Z"),
        updatedAt: new Date("2026-09-04T12:00:00.000Z"),
        deletedAt: null,
      },
    ],
    next_cursor: null,
  }
  const repository: ChatRepository = {
    listConversations: async (tenantId, subjectId, filter, limit, cursor) => {
      calls.push([tenantId, subjectId, filter, limit, cursor])
      return page
    },
  }

  const result = await new ChatApplicationService(repository).listConversations("tenant_a", "owner_a", { kind: "project", projectRef: "project_a" }, 20, null)

  assert.deepEqual(result, { sessions: [{ session_id: "session_a", title: "A", updated_at: "2026-09-04T12:00:00.000Z" }], next_cursor: null })
  assert.deepEqual(calls, [["tenant_a", "owner_a", { kind: "project", projectRef: "project_a" }, 20, null]])
})

for (const [name, query, expectedFilter, expectedProjectReads] of [
  ["omitted scope", "", { kind: "all" }, 0],
  ["empty scope", "?scope=", { kind: "all" }, 0],
  ["explicit direct scope", "?scope=direct", { kind: "direct" }, 0],
  ["project scope", "?project_ref=project_a", { kind: "project", projectRef: "project_a" }, 1],
] as const) {
  test(`passes ${name} distinctly through authorization and service to the Conversation repository`, async () => {
    const result = await collectionRepositoryCall(query)

    assert.deepEqual(result.calls, [["tenant_a", "owner_a", expectedFilter, 20, null]])
    assert.equal(result.projectReads, expectedProjectReads)
  })
}

test("rejects direct plus project collection filters before Project lookup", async () => {
  let projectReads = 0
  const store = {
    services: {
      projects: {
        find: async () => {
          projectReads += 1
          return {}
        },
      },
    },
  } as never

  const authorization = await authorizeChatRequest(collectionRequest("?scope=direct&project_ref=project_a"), collectionContext, ["sessions"], {}, store)

  assert.deepEqual(
    {
      authorization: authorization === null || authorization.ok ? authorization : { ok: false, status: authorization.status, code: authorization.code },
      projectReads,
    },
    { authorization: { ok: false, status: 400, code: "invalid_scope" }, projectReads: 0 },
  )
})

test("keeps direct plus project resource authorization on the existing project-bound path", async () => {
  let projectReads = 0
  let conversationReads = 0
  const store = {
    services: {
      projects: {
        find: async () => {
          projectReads += 1
          return {}
        },
      },
      chat: {
        findConversation: async () => {
          conversationReads += 1
          return {}
        },
      },
    },
  } as never

  const authorization = await authorizeChatRequest(
    collectionRequest("?scope=direct&project_ref=project_a"),
    collectionContext,
    ["sessions", "conversation_a"],
    {},
    store,
  )

  assert.deepEqual(
    { authorization, projectReads, conversationReads },
    {
      authorization: { ok: true, projectRef: "project_a" },
      projectReads: 1,
      conversationReads: 1,
    },
  )
})

test("Conversation keyset advances ascending IDs when updated_at ties", async () => {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = []
  const repository = new PostgresChatRepository({
    pool: {
      query: async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values })
        return { rows: [] }
      },
    },
  } as never)

  await repository.listConversations(
    "tenant_1",
    "owner_1",
    { kind: "project", projectRef: "project_1" },
    2,
    `conv_${Buffer.from(JSON.stringify({ timestamp: "2026-10-01T12:00:00.000Z", id: "conversation_a" })).toString("base64url")}`,
  )

  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /updated_at\s*<\s*\$4/u)
  assert.match(calls[0].sql, /updated_at\s*=\s*\$4\s+AND\s+conversation_id\s*>\s*\$5/u)
  assert.doesNotMatch(calls[0].sql, /\(updated_at,\s*conversation_id\)\s*<\s*\(\$4,\s*\$5\)/u)
  assert.deepEqual(calls[0].values, ["tenant_1", "owner_1", "project_1", "2026-10-01T12:00:00.000Z", "conversation_a", 3])
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
  const repository = { readSnapshot: async () => ({ conversation, messages: [], deliveries: [], deliveriesHasMore: false, eventWatermark: null, executionHead: { runId: "run_current", state: "active", pendingPauses: [] } }) }
  const result = await new ChatApplicationService(repository as never).snapshot("tenant_a", "owner_a", "session_running", undefined)
  assert.deepEqual(result?.execution_head, { run_id: "run_current", state: "active", pending_pauses: [] })
})

for (const dispatchStatus of ["pending", "leased", "retryable", "admitted"] as const) {
  test(`Chat snapshot maps the ${dispatchStatus} durable FIFO head to queued`, async () => {
    const conversation = { conversationId: `session_${dispatchStatus}`, tenantId: "tenant_a", ownerId: "owner_a", title: dispatchStatus, projectRef: null, status: "active", createdAt: new Date("2026-09-04T11:00:00.000Z"), updatedAt: new Date("2026-09-04T12:00:00.000Z"), deletedAt: null }
    const repository = { readSnapshot: async () => ({
      conversation,
      messages: [],
      deliveries: [],
      deliveriesHasMore: false,
      eventWatermark: "agui_0123456789abcdef0123456789abcdef",
      executionHead: { runId: "run_current", state: "queued", pendingPauses: [] },
    }) }

    const result = await new ChatApplicationService(repository as never).snapshot("tenant_a", "owner_a", conversation.conversationId, undefined)

    const publicSnapshot = result as unknown as Record<string, unknown> | null
    assert.deepEqual(publicSnapshot?.execution_head, {
      run_id: "run_current",
      state: "queued",
      pending_pauses: [],
    })
    assert.equal(publicSnapshot?.active_run, undefined)
  })
}

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


// R57: public4 exposes one complete execution head and deletes both legacy snapshot fields.

function r57Waiting() {
  return {
    interaction_revision: 7,
    pause_revision: 7,
    pause_ref: "pause:run_hitl_1:7",
    phase: "waiting",
    groups: [
      {
        group_id: "group_tools",
        items: [
          {
            item_id: "item_approve",
            request_id: "request_tool_1",
            kind: "tool_approval",
            allowed_decisions: ["approve", "edit", "reject"],
            display: {
              name: "search",
              description: "Search approved index",
              editable: true,
              input_schema: { type: "object", properties: { query: { type: "string" } } },
              result_preview: null,
              truncated: null,
              source: null,
            },
          },
          {
            item_id: "item_edit",
            request_id: "request_tool_2",
            kind: "tool_approval",
            allowed_decisions: ["edit", "reject"],
            display: { name: "edit", description: "Edit parameters", editable: true, input_schema: { type: "object" } },
          },
          {
            item_id: "item_reject",
            request_id: "request_review_1",
            kind: "result_review",
            allowed_decisions: ["approve", "reject"],
            display: {
              name: "review",
              description: "Review result",
              editable: false,
              input_schema: { type: "object" },
              result_preview: "bounded result",
              truncated: false,
              source: "tool",
            },
          },
        ],
      },
      {
        group_id: "group_inputs",
        items: [
          {
            item_id: "item_respond",
            request_id: "request_question_1",
            kind: "ask_user_question",
            allowed_decisions: ["respond", "reject"],
            display: { name: "question", description: "Choose a region", editable: false, input_schema: { type: "object" } },
            validation: { code: "json_schema_invalid", instance_path: ["region", 0] },
          },
          {
            item_id: "item_submit",
            request_id: "request_input_1",
            kind: "input",
            allowed_decisions: ["submit"],
            display: { name: "form", description: "Confirm values", editable: true, input_schema: { type: "object" } },
          },
        ],
      },
    ],
    action_result: null,
  }
}
function r57Control() {
  return {
    kind: "run.resume",
    expected_pause_revision: 7,
    pause_ref: "pause:run_hitl_1:7",
    decisions: [
      { type: "approve", item_id: "item_approve" },
      { type: "edit", item_id: "item_edit", args: { count: 2, note: null } },
      { type: "reject", item_id: "item_reject" },
      { type: "respond", item_id: "item_respond", response: "continue" },
      { type: "submit", item_id: "item_submit", value: { confirmed: true, comment: null } },
    ],
  }
}

for (const state of ["queued", "active", "waiting", "resuming"] as const) {
  test(`R57 Chat snapshot maps the full ${state} execution head from one repository read`, async () => {
    const pause = {
      ...r57Waiting(),
      phase: state === "resuming" ? "resuming" : "waiting",
      interaction_revision: state === "resuming" ? 8 : 7,
      action_result: state === "resuming" ? { command_id: "command_resume_1", pause_revision: 7, kind: "accepted" } : null,
    }
    const pendingPauses = state === "waiting" || state === "resuming" ? [pause] : []
    const conversation = {
      conversationId: "session_r57",
      tenantId: "tenant_r57",
      ownerId: "owner_r57",
      title: "R57",
      projectRef: null,
      status: "active",
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      updatedAt: new Date("2026-10-01T00:00:01.000Z"),
      deletedAt: null,
    }
    let reads = 0
    const calls: unknown[][] = []
    const repository = {
      readSnapshot: async (...args: unknown[]) => {
        reads++
        calls.push(args)
        return {
          conversation,
          messages: [],
          deliveries: [],
          deliveriesHasMore: false,
          eventWatermark: "agui_0123456789abcdef0123456789abcdef",
          executionHead: { runId: "run_hitl_1", state, pendingPauses },
        }
      },
    }
    const actual = (await new ChatApplicationService(repository as never).snapshot("tenant_r57", "owner_r57", "session_r57", undefined)) as unknown as Record<
      string,
      unknown
    >
    assert.deepEqual(actual.execution_head, { run_id: "run_hitl_1", state, pending_pauses: pendingPauses })
    assert.equal(Object.hasOwn(actual, "active_run"), false)
    assert.equal(Object.hasOwn(actual, "pending_pauses"), false)
    assert.equal(actual.event_watermark, "agui_0123456789abcdef0123456789abcdef")
    assert.equal(reads, 1)
    assert.deepEqual(calls, [["tenant_r57", "owner_r57", "session_r57", undefined]])
  })
}
test("R57 no-head snapshot omits execution head rather than fabricating a pause or exposing a historical active Run", async () => {
  const conversation = {
    conversationId: "session_r57",
    tenantId: "tenant_r57",
    ownerId: "owner_r57",
    title: "R57",
    projectRef: null,
    status: "active",
    createdAt: new Date(0),
    updatedAt: new Date(1000),
    deletedAt: null,
  }
  const repository = { readSnapshot: async () => ({ conversation, messages: [], deliveries: [], deliveriesHasMore: false, eventWatermark: null }) }
  const actual = (await new ChatApplicationService(repository as never).snapshot("tenant_r57", "owner_r57", "session_r57", undefined)) as unknown as Record<
    string,
    unknown
  >
  assert.equal(Object.hasOwn(actual, "execution_head"), false)
  assert.equal(Object.hasOwn(actual, "active_run"), false)
  assert.equal(Object.hasOwn(actual, "pending_pauses"), false)
})
