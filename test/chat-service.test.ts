import "./chat-message-parts-read.test.ts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { EventEmitter } from "node:events"

import { ChatApplicationService } from "../dist/application/chat-service.js"
import { authorizeChatRequest } from "../dist/http/routes/chat-authorization.js"
import { liveChatBusiness } from "../dist/http/routes/chat.js"
import { PostgresChatRepository } from "../dist/infrastructure/postgres/chat-repository.js"
import type { ChatRepository, ConversationCollectionFilter, ConversationPage } from "../src/application/ports/chat-repository.ts"

const collectionContext = { requestId: "request_collection_scope", identity: { namespace: "tenant_a", userId: "owner_a" } }

function collectionRequest(query: string): never {
  return { method: "GET", url: `/v1/sessions${query}` } as never
}

function responseDouble(): { response: never; headers: Map<string, unknown> } {
  const headers = new Map<string, unknown>()
  return {
    response: {
      setHeader(name: string, value: unknown) {
        headers.set(name.toLowerCase(), value)
      },
      writeHead() {},
      end() {},
    } as never,
    headers,
  }
}

async function collectionRepositoryCall(query: string): Promise<{ calls: unknown[][]; projectReads: number; responseHeaders: Map<string, unknown> }> {
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
  const response = responseDouble()
  assert.equal(
    await liveChatBusiness(request, response.response, {} as never, collectionContext, ["sessions"], {}, null, new Map(), store, authorization),
    true,
  )
  return { calls, projectReads, responseHeaders: response.headers }
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
    assert.equal(result.responseHeaders.get("x-request-id"), collectionContext.requestId)
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
  const conversation = {
    conversationId: "session_a",
    tenantId: "tenant_a",
    ownerId: "owner_a",
    title: "A",
    projectRef: null,
    status: "active",
    createdAt: new Date("2026-09-04T11:00:00.000Z"),
    updatedAt: new Date("2026-09-04T12:00:00.000Z"),
    deletedAt: null,
  }
  const repository = {
    readSnapshot: async () => ({
      conversation,
      messages: [],
      deliveries: [
        {
          conversationId: "session_a",
          artifactId: "artifact_a",
          assetId: "asset_a",
          artifactKind: "document",
          title: "Report",
          mime: "text/markdown",
          size: 12,
          runId: "run_a",
          deliveredAt: new Date("2026-09-04T12:00:00.000Z"),
        },
      ],
      deliveriesHasMore: true,
      eventWatermark: "agui_0123456789abcdef0123456789abcdef",
    }),
  }
  const result = await new ChatApplicationService(repository as never).snapshot("tenant_a", "owner_a", "session_a", undefined)
  assert.deepEqual(result?.deliveries, [
    {
      conversation_id: "session_a",
      artifact_id: "artifact_a",
      asset_id: "asset_a",
      artifact_kind: "document",
      title: "Report",
      mime: "text/markdown",
      size: 12,
      run_id: "run_a",
      created_at: "2026-09-04T12:00:00.000Z",
    },
  ])
  assert.equal(result?.deliveries_has_more, true)
  assert.equal(result?.event_watermark, "agui_0123456789abcdef0123456789abcdef")
})

test("Chat snapshot maps only a repository-proven active running Run", async () => {
  const conversation = {
    conversationId: "session_running",
    tenantId: "tenant_a",
    ownerId: "owner_a",
    title: "Running",
    projectRef: null,
    status: "active",
    createdAt: new Date("2026-09-04T11:00:00.000Z"),
    updatedAt: new Date("2026-09-04T12:00:00.000Z"),
    deletedAt: null,
  }
  const repository = {
    readSnapshot: async () => ({
      conversation,
      messages: [],
      deliveries: [],
      deliveriesHasMore: false,
      eventWatermark: null,
      executionHead: { runId: "run_current", state: "active", pendingPauses: [] },
    }),
  }
  const result = await new ChatApplicationService(repository as never).snapshot("tenant_a", "owner_a", "session_running", undefined)
  assert.deepEqual(result?.execution_head, { run_id: "run_current", state: "active", pending_pauses: [] })
})

for (const dispatchStatus of ["pending", "leased", "retryable", "admitted"] as const) {
  test(`Chat snapshot maps the ${dispatchStatus} durable FIFO head to queued`, async () => {
    const conversation = {
      conversationId: `session_${dispatchStatus}`,
      tenantId: "tenant_a",
      ownerId: "owner_a",
      title: dispatchStatus,
      projectRef: null,
      status: "active",
      createdAt: new Date("2026-09-04T11:00:00.000Z"),
      updatedAt: new Date("2026-09-04T12:00:00.000Z"),
      deletedAt: null,
    }
    const repository = {
      readSnapshot: async () => ({
        conversation,
        messages: [],
        deliveries: [],
        deliveriesHasMore: false,
        eventWatermark: "agui_0123456789abcdef0123456789abcdef",
        executionHead: { runId: "run_current", state: "queued", pendingPauses: [] },
      }),
    }

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
    const client = Object.assign(new EventEmitter(), {
      query: async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values })
        if (sql.includes("FROM bff_conversation") && sql.includes("LIMIT 1"))
          return {
            rows: [
              {
                conversation_id: "session_invalid",
                tenant_id: "tenant_a",
                owner_id: "owner_a",
                title: "Invalid",
                project_ref: null,
                status: "active",
                created_at: new Date("2026-09-30T00:00:00Z"),
                updated_at: new Date("2026-09-30T00:00:00Z"),
                deleted_at: null,
              },
            ],
          }
        if (sql.includes("FROM bff_agui_stream")) return { rows: [marker] }
        return { rows: [] }
      },
      release: () => {
        released = true
      },
    })
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
  const client = Object.assign(new EventEmitter(), {
    query: async (sql: string) => {
      calls.push(sql)
      return { rows: [] }
    },
    release: () => {
      released = true
    },
  })
  const repository = new PostgresChatRepository({ pool: { connect: async () => client } } as never)
  assert.equal(await repository.readSnapshot("tenant_a", "other_subject", "session_hidden", undefined), null)
  assert.equal(
    calls.some((sql) => sql.includes("FROM bff_agui_stream")),
    false,
  )
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

test("R124 Chat snapshot always exposes nullable anchored process without charging long Message bytes to its page budget", async () => {
  const conversation = {
    conversationId: "session_process",
    tenantId: "tenant_a",
    ownerId: "owner_a",
    title: "Process",
    projectRef: null,
    status: "active",
    createdAt: new Date("2026-09-04T11:00:00.000Z"),
    updatedAt: new Date("2026-09-04T12:00:00.000Z"),
    deletedAt: null,
  }
  const longMessage = "m".repeat(1024 * 1024 + 1)
  const repository = {
    readSnapshot: async () => ({
      conversation,
      messages: [
        {
          messageId: "message_long",
          conversationId: conversation.conversationId,
          runId: null,
          role: "user",
          content: longMessage,
          status: "completed",
          messageSeq: 1,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
      ],
      deliveries: [],
      deliveriesHasMore: false,
      eventWatermark: null,
      executionProcess: null,
    }),
  }
  const result = await new ChatApplicationService(repository as never).snapshot("tenant_a", "owner_a", conversation.conversationId, undefined)
  assert.equal(Object.hasOwn(result ?? {}, "execution_process"), true)
  assert.equal(result?.execution_process, null)
  assert.equal(result?.messages[0]?.content.length, longMessage.length)
})

test("shared tasks service forwards trusted owner, anchor and the original absolute lifetime", async () => {
  const calls: unknown[][] = []
  const result = { items: [], nextPosition: null }
  const service = new ChatApplicationService({
    async listOwnedSharedTasks(...args: unknown[]) {
      calls.push(args)
      return result
    },
  } as never)
  const signal = new AbortController().signal
  assert.equal(await service.listOwnedSharedTasks("tenant", "owner", 20, null, signal, 12345), result)
  assert.deepEqual(calls, [["tenant", "owner", 20, null, signal, 12345]])
})

// The exact owner read distinguishes an inaccessible conversation from an unshared one.
function shareReadFixture(rows: unknown[], pending = false) {
  const calls: Array<{ sql: string; values?: unknown[] }> = []
  const releases: unknown[] = []
  const client = {
    on() {},
    removeListener() {},
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values })
      if (sql.includes("LEFT JOIN bff_share")) {
        if (pending) return new Promise(() => {})
        return { rows }
      }
      return { rows: [] }
    },
    release(value?: unknown) {
      releases.push(value)
    },
  }
  return {
    calls,
    releases,
    repository: new PostgresChatRepository({
      pool: { connect: async () => client },
    } as never),
  }
}
const shareQuery = () => ({
  tenantId: "tenant_a",
  subjectId: "owner_a",
  conversationId: "session_a",
  projectRef: undefined,
  scope: "all" as const,
  signal: new AbortController().signal,
  deadlineAt: performance.now() + 1000,
})
test("share metadata reads exact active owner state and never executes mutation SQL", async () => {
  const f = shareReadFixture([
    {
      share_id: "shr_exact",
      created_at: new Date("2026-11-01T01:02:03.000Z"),
      expires_at: null,
    },
  ])
  const query = shareQuery()
  assert.deepEqual(await f.repository.readShareMetadata(query), {
    share: {
      share_id: "shr_exact",
      created_at: "2026-11-01T01:02:03.000Z",
      expires_at: null,
    },
  })
  const read = f.calls.find(({ sql }) => sql.includes("LEFT JOIN bff_share"))!
  assert.deepEqual(read.values, ["tenant_a", "owner_a", "session_a", null, "all"])
  for (const guard of [
    "c.owner_id=$2",
    "c.tenant_id=$1",
    "c.status='active'",
    "s.revoked_at IS NULL",
    "s.expires_at > statement_timestamp()",
    "p.deleted_at IS NULL",
    "p.owner_id=c.owner_id",
    "s.resource_kind='conversation'",
    "c.project_ref IS NULL",
  ])
    assert.ok(read.sql.includes(guard), guard)
  assert.equal(f.calls.filter(({ sql }) => sql.includes("LEFT JOIN bff_share")).length, 1)
  assert.ok(f.calls.every(({ sql }) => !/\b(INSERT|UPDATE|DELETE)\b/u.test(sql)))
  assert.equal(f.calls[0]!.sql, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
  assert.equal(f.calls.at(-1)!.sql, "COMMIT")
  assert.deepEqual(f.releases, [false])
})
test("share metadata preserves accessible unshared versus inaccessible conversation distinction", async () => {
  assert.deepEqual(await shareReadFixture([{ share_id: null, created_at: null, expires_at: null }]).repository.readShareMetadata(shareQuery()), { share: null })
  assert.equal(await shareReadFixture([]).repository.readShareMetadata(shareQuery()), null)
})
test("share metadata rejects contaminated rows rather than reporting unshared", async () => {
  const f = shareReadFixture([{ share_id: "shr_bad", created_at: new Date(NaN), expires_at: null }])
  await assert.rejects(f.repository.readShareMetadata(shareQuery()))
  assert.deepEqual(f.releases, [true])
})
test("share metadata pending SQL obeys abort and destroys only its lease", async () => {
  const controller = new AbortController()
  const f = shareReadFixture([], true)
  const result = f.repository.readShareMetadata({
    ...shareQuery(),
    signal: controller.signal,
  })
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  await assert.rejects(result)
  assert.deepEqual(f.releases, [true])
  assert.ok(!f.calls.some(({ sql }) => sql === "COMMIT"))
})
test("share metadata deadline expires while waiting without manufacturing null", async () => {
  const f = shareReadFixture([], true)
  await assert.rejects(
    f.repository.readShareMetadata({
      ...shareQuery(),
      deadlineAt: performance.now() + 20,
    }),
  )
  assert.deepEqual(f.releases, [true])
})

async function shareMetadataRoute(read: (query: unknown) => Promise<unknown>) {
  let status = 0,
    body: unknown
  const headers = new Map<string, unknown>()
  const request = Object.assign(new EventEmitter(), {
    method: "GET",
    url: "/v1/sessions/session_a/share",
  })
  const response = Object.assign(new EventEmitter(), {
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value)
    },
    writeHead(code: number, values: Record<string, unknown>) {
      status = code
      for (const [key, value] of Object.entries(values)) headers.set(key, value)
    },
    end(value: Buffer) {
      body = JSON.parse(value.toString())
    },
  })
  const receipts = new Map()
  const store = { services: { chat: { readShareMetadata: read } } }
  const handled = await liveChatBusiness(
    request as never,
    response as never,
    {} as never,
    collectionContext,
    ["sessions", "session_a", "share"],
    {},
    null,
    receipts,
    store as never,
    { ok: true, projectRef: undefined },
  )
  return { status, body, headers, handled, receipts }
}
test("share metadata GET returns authoritative safe state and does not create a receipt", async () => {
  let received: unknown
  const metadata = {
    share: {
      share_id: "shr_live",
      created_at: "2026-11-01T00:00:00.000Z",
      expires_at: null,
    },
  }
  const result = await shareMetadataRoute(async (query) => {
    received = query
    return metadata
  })
  assert.equal(result.handled, true)
  assert.equal(result.status, 200)
  assert.deepEqual((result.body as { data: unknown }).data, metadata)
  assert.equal(result.receipts.size, 0)
  assert.equal(result.headers.get("cache-control"), "no-store")
  assert.deepEqual(Object.fromEntries(Object.entries(received as object).filter(([key]) => !["signal", "deadlineAt"].includes(key))), {
    tenantId: "tenant_a",
    subjectId: "owner_a",
    conversationId: "session_a",
    projectRef: undefined,
    scope: "all",
  })
  assert.ok((received as { signal: AbortSignal }).signal instanceof AbortSignal)
})
test("share metadata GET keeps unshared, inaccessible and dependency failures distinct", async () => {
  const unshared = await shareMetadataRoute(async () => ({ share: null }))
  assert.equal(unshared.status, 200)
  assert.deepEqual((unshared.body as { data: unknown }).data, { share: null })
  const hidden = await shareMetadataRoute(async () => null)
  assert.equal(hidden.status, 404)
  assert.equal((hidden.body as { error: { code: string } }).error.code, "session_not_found")
  const unavailable = await shareMetadataRoute(async () => {
    throw new Error("private SQL connection secret")
  })
  assert.equal(unavailable.status, 503)
  assert.ok(!JSON.stringify(unavailable.body).includes("private SQL"))
  assert.equal(unavailable.receipts.size, 0)
})

test("share metadata authorizes in its single bounded owner query without preliminary reads", async () => {
  let reads = 0
  const store = {
    services: {
      projects: {
        find: async () => {
          reads += 1
          return {}
        },
      },
      chat: {
        findConversation: async () => {
          reads += 1
          return {}
        },
      },
    },
  }
  const request = { method: "GET", url: "/v1/sessions/session_a/share?project_ref=project_a" }
  assert.deepEqual(await authorizeChatRequest(request as never, collectionContext, ["sessions", "session_a", "share"], {}, store as never), {
    ok: true,
    projectRef: "project_a",
  })
  assert.equal(reads, 0)
  const invalid = { method: "GET", url: "/v1/sessions/session_a/share?scope=direct&project_ref=project_a" }
  const denied = await authorizeChatRequest(invalid as never, collectionContext, ["sessions", "session_a", "share"], {}, store as never)
  assert.equal(denied?.ok, false)
  if (denied && !denied.ok) assert.equal(denied.code, "invalid_scope")
  assert.equal(reads, 0)
  await authorizeChatRequest(
    { method: "POST", url: "/v1/sessions/session_a/share?project_ref=project_a" } as never,
    collectionContext,
    ["sessions", "session_a", "share"],
    {},
    store as never,
  )
  assert.equal(reads, 2, "existing mutation authorization keeps its original owner/project reads")
})
