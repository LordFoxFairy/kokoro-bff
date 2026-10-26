import assert from "node:assert/strict"
import { test } from "node:test"

import { ChatApplicationService } from "../src/application/chat-service.ts"
import { chatMessage } from "../src/application/chat/mappers.ts"

const watermark = "agui_" + "1".repeat(32)
const rendering = { mode: "ordered", format_version: 1, revision: "3", event_watermark: watermark, parts_cursor: "opaque-bound-parts" } as const
const message = {
  messageId: "message",
  tenantId: "tenant",
  conversationId: "session",
  runId: "run",
  role: "assistant",
  content: null,
  selectedSkillSourceRefs: [],
  status: "streaming",
  failure: null,
  messageSeq: "2",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  rendering,
}

test("private snapshot preserves the ordered read reference and does not turn a non-inlined body into empty text", async () => {
  const service = new ChatApplicationService({
    readSnapshot: async () => ({
      conversation: { conversationId: "session", ownerId: "owner", title: "Task", createdAt: new Date(0), updatedAt: new Date(0) },
      messages: [message],
      deliveries: [],
      deliveriesHasMore: false,
      eventWatermark: watermark,
      executionProcess: null,
    }),
  } as never)
  const snapshot = await service.snapshot("tenant", "owner", "session", undefined)
  assert.equal(snapshot?.messages?.[0]?.content, null)
  assert.deepEqual(snapshot?.messages?.[0]?.rendering, rendering)
})

test("the original public-share Message mapper retains a plain body and omits private parts metadata", () => {
  const result = chatMessage({ ...message, content: "original shared text" } as never)
  assert.equal(result.content, "original shared text")
  assert.equal(Object.hasOwn(result, "rendering"), false)
})

import { EventEmitter } from "node:events"
import { setImmediate as immediate } from "node:timers/promises"
import {
  assertMessagePartsCursorScope,
  decodeMessagePartsCursor,
  encodeMessagePartsCursor,
  messagePartsPageFromSlices,
  messageReadLifetime,
  privateMessageFromRow,
  privateMessagesFromRows,
  readMessageParts,
  recoverLegacyFrames,
  withMessageReadClient,
  type MessagePartsCursor,
  type MessagePartsScope,
} from "../src/infrastructure/postgres/message-parts-read.ts"
import { parseChatMessagePartsInput } from "../src/http/chat-message-parts-input.ts"

const scope: MessagePartsScope = {
  tenantId: "tenant",
  subjectId: "owner",
  conversationId: "session",
  messageId: "message",
  runId: "run",
  projectRef: null,
  requestedProjectRef: null,
  scope: "all",
}
const initial: MessagePartsCursor = { ...scope, format: 1, revision: "12", watermark, source: "message", ordinal: "0", offset: "0" }
const tool = {
  activity: "tool",
  activity_id: "act_" + "a".repeat(64),
  segment_id: "seg_" + "b".repeat(64),
  status: "completed",
  display_code: "tool.execution",
}
const textItem = { kind: "text", part_id: "text:public-text-id", segment_id: "public-text-id", first_sequence: "3", latest_sequence: "9", completed: true }
const activityItem = { kind: "activity", part_id: `activity:${tool.activity_id}`, first_sequence: "10", latest_sequence: "12", activity: tool }
const lifetime = () => ({ signal: new AbortController().signal, deadlineAt: performance.now() + 1000 })
function readFixture(handler: (sql: string, values: unknown[]) => unknown[] = () => []) {
  const calls: Array<{ sql: string; values: unknown[] }> = [],
    releases: unknown[] = []
  const client = Object.assign(new EventEmitter(), {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      return { rows: handler(sql, values) }
    },
    release(value: unknown) {
      releases.push(value)
    },
  })
  return {
    calls,
    releases,
    client,
    pool: {
      async connect() {
        return client
      },
    } as never,
  }
}

for (const [query, code] of [
  ["?limit=0", "invalid_request"],
  ["?limit=33", "invalid_request"],
  ["?limit=01", "invalid_request"],
  ["?limit=1&limit=2", "invalid_request"],
  ["?offset=1", "invalid_request"],
  ["?cursor=", "invalid_cursor"],
  ["?scope=all", "invalid_scope"],
  ["?scope=direct&project_ref=project", "invalid_scope"],
]) {
  test(`strict parts query rejects ${query}`, () =>
    assert.deepEqual(parseChatMessagePartsInput({ url: `/v1/sessions/session/messages/message/parts${query}` } as never), { ok: false, code }))
}
test("parts query defaults to 16 and preserves cursor rather than converting a watermark", () => {
  assert.deepEqual(parseChatMessagePartsInput({ url: "/v1/sessions/session/messages/message/parts" } as never), {
    ok: true,
    scope: "all",
    cursor: null,
    limit: 16,
  })
  assert.deepEqual(parseChatMessagePartsInput({ url: "/v1/sessions/session/messages/message/parts?scope=direct&limit=32&cursor=opaque" } as never), {
    ok: true,
    scope: "direct",
    cursor: "opaque",
    limit: 32,
  })
})

test("opaque parts cursor retains 64-bit decimal revision and captured nullable public watermark", () => {
  const cursor = { ...initial, revision: "9223372036854775807", watermark: null, ordinal: "9007199254740993" }
  assert.deepEqual(decodeMessagePartsCursor(encodeMessagePartsCursor(cursor)), cursor)
})
for (const patch of [
  { subjectId: "other" },
  { tenantId: "other" },
  { projectRef: "project" },
  { requestedProjectRef: "project" },
  { scope: "direct" },
  { messageId: "other" },
  { runId: "other" },
]) {
  test(`parts cursor binds ${Object.keys(patch)[0]}`, () =>
    assert.throws(() => assertMessagePartsCursorScope(initial, { ...scope, ...patch } as MessagePartsScope), /MESSAGE_PARTS_CURSOR_INVALID/))
}
for (const patch of [
  { revision: "01" },
  { revision: "9223372036854775808" },
  { ordinal: "-1" },
  { offset: "1.0" },
  { watermark: "12" },
  { format: 2 },
  { extra: true },
]) {
  test(`parts cursor rejects noncanonical ${JSON.stringify(patch)}`, () =>
    assert.throws(() => decodeMessagePartsCursor(encodeMessagePartsCursor({ ...initial, ...patch } as MessagePartsCursor)), /MESSAGE_PARTS_CURSOR_INVALID/))
}
test("parts text slices count astral Unicode scalars, continue the same slot, then preserve activity order", () => {
  const text = "😀".repeat(4097)
  const first = messagePartsPageFromSlices(
    initial,
    2,
    [
      { ordinal: "0", item: textItem, text_slice: Array.from(text).slice(0, 4096).join(""), total_scalars: "4097" },
      { ordinal: "1", item: activityItem, text_slice: null, total_scalars: null },
    ],
    16,
  )
  assert.equal(first.items.length, 1)
  assert.deepEqual(first.items[0], { ...textItem, text: "😀".repeat(4096), offset: "0", end: "4096", total_scalars: "4097" })
  const next = decodeMessagePartsCursor(first.next_cursor!)
  assert.deepEqual({ ...next }, { ...initial, offset: "4096" })
  const last = messagePartsPageFromSlices(
    next,
    2,
    [
      { ordinal: "0", item: textItem, text_slice: "😀", total_scalars: "4097" },
      { ordinal: "1", item: activityItem, text_slice: null, total_scalars: null },
    ],
    16,
  )
  assert.deepEqual(last.items[0], { ...textItem, text: "😀", offset: "4096", end: "4097", total_scalars: "4097" })
  assert.deepEqual(last.items[1], activityItem)
  assert.equal(last.event_watermark, watermark)
  assert.equal(last.next_cursor, null)
})
test("empty admitted ordered Message is a confirmed zero-slot read, not a terminal Run", () => {
  const page = messagePartsPageFromSlices({ ...initial, revision: "0" }, 0, [], 16)
  assert.deepEqual(page.items, [])
  assert.equal(page.next_cursor, null)
  assert.equal(Object.hasOwn(page, "status"), false)
})
for (const [label, item, text, total, cursor] of [
  ["oversize slice", textItem, "x".repeat(4097), "4097", initial],
  ["lone surrogate", textItem, "\ud800", "1", initial],
  ["future position", { ...textItem, latest_sequence: "13" }, "x", "1", initial],
  ["raw tool result", { ...activityItem, activity: { ...tool, result: "private" } }, null, null, initial],
  ["unprofiled field", { ...textItem, private_summary: "secret" }, "x", "1", initial],
  ["past terminal offset", textItem, "", "1", { ...initial, offset: "1" }],
] as const) {
  test(`parts refuse ${label} instead of emitting fabricated successful history`, () =>
    assert.throws(() => messagePartsPageFromSlices(cursor, 1, [{ ordinal: "0", item, text_slice: text, total_scalars: total }], 16)))
}

function legacyRows(
  terminal: Record<string, unknown> = { type: "RUN_FINISHED", threadId: "session", runId: "run", status: "completed", outcome: { type: "success" } },
) {
  function row(position: number, source: number, frameIndex: number, event: Record<string, unknown>) {
    const id = `source-${source}`
    return {
      public_sequence: String(position),
      source_sequence: String(source),
      frame_index: frameIndex,
      source_event_id: id,
      source_digest: "c".repeat(64),
      source_valid: true,
      event_payload: {
        ...event,
        metadata: { kokoro: { event_id: id, seq: source, session_id: "session", run_id: "run", timestamp: new Date(source * 1000).toISOString() } },
      },
    }
  }
  // Public 1 is the BFF admission and is not an Agent source. Source 30 is not public 30.
  return [
    row(2, 30, 0, { type: "CUSTOM", name: "kokoro.activity.updated", value: tool }),
    row(3, 31, 0, { type: "RUN_STARTED", threadId: "session", runId: "run" }),
    row(4, 32, 0, { type: "TEXT_MESSAGE_START", messageId: "public-text-id", role: "assistant" }),
    row(5, 32, 1, { type: "TEXT_MESSAGE_CONTENT", messageId: "public-text-id", delta: "original😀" }),
    row(6, 33, 0, { type: "TEXT_MESSAGE_END", messageId: "public-text-id" }),
    row(7, 34, 0, { type: "CUSTOM", name: "kokoro.todo.updated", value: { todos: [] } }),
    row(8, 35, 0, terminal),
  ]
}
test("legacy proof preserves the unique segment and activity position with BFF admission before Agent sources", () => {
  const recovered = recoverLegacyFrames(scope, "original😀", "completed", "3", legacyRows())
  assert.ok(recovered)
  assert.equal(recovered.publicSequence, "8")
  assert.deepEqual(
    recovered.parts.map((part) => [part.kind, part.first_sequence]),
    [
      ["activity", "2"],
      ["text", "4"],
    ],
  )
  assert.equal(recovered.parts[1]?.kind === "text" && recovered.parts[1].text, "original😀")
})
test("legacy body corrections absent from public delta evidence remain legacy, not an inferred final answer", () =>
  assert.equal(recoverLegacyFrames(scope, "corrected final", "completed", "3", legacyRows()), null))
for (const corrupt of [
  (rows: ReturnType<typeof legacyRows>) => rows.filter((row) => row.public_sequence !== "6"),
  (rows: ReturnType<typeof legacyRows>) => rows.map((row) => ({ ...row, source_valid: false })),
  (rows: ReturnType<typeof legacyRows>) =>
    rows.map((row) => ({
      ...row,
      event_payload: { ...row.event_payload, metadata: { kokoro: { ...row.event_payload.metadata.kokoro, session_id: "foreign" } } },
    })),
  (rows: ReturnType<typeof legacyRows>) => rows.map((row) => (row.public_sequence === "5" ? { ...row, frame_index: 0 } : row)),
])
  test("legacy proof rejects missing/foreign/unproven source frames", () =>
    assert.equal(recoverLegacyFrames(scope, "original😀", "completed", "3", corrupt(legacyRows())), null))
test("a completed legacy body cannot be promoted using a cancelled terminal", () =>
  assert.equal(
    recoverLegacyFrames(
      scope,
      "original😀",
      "completed",
      "3",
      legacyRows({
        type: "RUN_FINISHED",
        threadId: "session",
        runId: "run",
        status: "cancelled",
        outcome: { type: "interrupt", interrupts: [{ id: "cancel", reason: "cancelled" }] },
      }),
    ),
    null,
  ))
test("failed legacy text is retained with the original safe tool even when a Run ends in error", () => {
  const rows = legacyRows({ type: "RUN_ERROR", message: "Agent run failed", code: "model_unavailable" })
  const state = recoverLegacyFrames(scope, "original😀", "failed", "3", rows)
  assert.equal(state?.parts[1]?.kind === "text" && state.parts[1].text, "original😀")
})

test("ordered descriptors validate revision zero against nonempty parts without loading body", () =>
  assert.throws(
    () =>
      privateMessageFromRow(
        {
          message_id: "message",
          tenant_id: "tenant",
          conversation_id: "session",
          role: "assistant",
          run_id: "run",
          selected_skill_source_refs: [],
          content: null,
          status: "pending",
          agent_failure_code: null,
          agent_failure_retryable: null,
          message_seq: "2",
          created_at: new Date(0),
          updated_at: new Date(0),
          parts_format_version: 1,
          parts_public_sequence: "0",
          parts_count: 1,
        } as never,
        scope,
        null,
      ),
    /MESSAGE_PARTS_UNAVAILABLE/,
  ))
test("read lifetime rejects a nonfinite deadline instead of resetting an inherited budget", () =>
  assert.throws(() => messageReadLifetime({ signal: new AbortController().signal, deadlineAt: NaN }), /MESSAGE_PARTS_UNAVAILABLE/))
test("already-aborted private reads never acquire a client", async () => {
  const controller = new AbortController()
  controller.abort()
  let acquired = 0
  await assert.rejects(
    withMessageReadClient(
      {
        connect: async () => {
          acquired += 1
          throw new Error("not called")
        },
      } as never,
      { ...lifetime(), signal: controller.signal },
      async () => null,
    ),
    /MESSAGE_PARTS_UNAVAILABLE/,
  )
  assert.equal(acquired, 0)
})
test("an aborted pending acquisition releases only its eventual own lease", async () => {
  const fixture = readFixture(),
    controller = new AbortController()
  let resolve!: (value: unknown) => void
  const pending = withMessageReadClient(
    {
      connect: () =>
        new Promise((done) => {
          resolve = done
        }),
    } as never,
    { ...lifetime(), signal: controller.signal },
    async () => null,
  )
  controller.abort()
  await assert.rejects(pending, /MESSAGE_PARTS_UNAVAILABLE/)
  resolve(fixture.client)
  await immediate()
  assert.deepEqual(fixture.releases, [undefined])
  assert.deepEqual(fixture.calls, [])
})
test("aborting a late query destroys only its leased connection and never publishes a late result", async () => {
  const fixture = readFixture(),
    controller = new AbortController()
  let finish!: (value: string) => void, entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const pending = withMessageReadClient(fixture.pool, { ...lifetime(), signal: controller.signal }, async () => {
    entered()
    return new Promise<string>((resolve) => {
      finish = resolve
    })
  })
  await started
  controller.abort()
  await assert.rejects(pending, /MESSAGE_PARTS_UNAVAILABLE/)
  finish("late")
  await immediate()
  assert.deepEqual(fixture.releases, [true])
  assert.equal(
    fixture.calls.some((call) => call.sql === "COMMIT"),
    false,
  )
})
test("parts dependency errors use their named read error rather than leaking driver or payload errors", async () => {
  const fixture = readFixture(() => {
    throw new Error("driver private reason")
  })
  await assert.rejects(readMessageParts(fixture.pool, { ...scope, ...lifetime(), projectRef: undefined, cursor: null, limit: 16 }), /MESSAGE_PARTS_UNAVAILABLE/)
  assert.deepEqual(fixture.releases, [true])
})
test("parts rejects direct plus project before acquiring resources", async () => {
  const fixture = readFixture()
  await assert.rejects(
    readMessageParts(fixture.pool, { ...scope, ...lifetime(), projectRef: "project", scope: "direct", cursor: null, limit: 16 }),
    /MESSAGE_PARTS_SCOPE_INVALID/,
  )
  assert.deepEqual(fixture.calls, [])
})

test("a retained legacy cursor whose captured ledger watermark was collected is explicitly gone", async () => {
  const fixture = readFixture((sql) => {
    if (sql.startsWith("SELECT message.message_id"))
      return [
        {
          message_id: "message",
          run_id: "run",
          project_ref: null,
          status: "completed",
          parts_format_version: null,
          parts_public_sequence: null,
          parts_count: null,
          legacy_text: "original😀",
          legacy_bytes: "12",
          selected_run_id: "run",
          latest_assistant_id: "message",
        },
      ]
    if (sql.includes("bff_agui_cursor_tombstone")) return [{ retained: false }]
    return []
  })
  await assert.rejects(
    readMessageParts(fixture.pool, {
      ...scope,
      ...lifetime(),
      projectRef: undefined,
      cursor: encodeMessagePartsCursor({ ...initial, source: "ledger" }),
      limit: 16,
    }),
    /MESSAGE_PARTS_GONE/,
  )
})
test("parts reject page-wide metadata overflow before parsing or exposing it", () =>
  assert.throws(
    () => messagePartsPageFromSlices(initial, 1, [{ ordinal: "0", item: null, text_slice: "", total_scalars: "0", metadata_bytes: "1048577" }], 16),
    /MESSAGE_PARTS_BUDGET_EXCEEDED/,
  ))

import { liveChatBusiness } from "../src/http/routes/chat.ts"

async function partsHttp(
  read: (query: unknown) => Promise<unknown>,
  url = "/v1/sessions/session/messages/message/parts",
  authorization: unknown = { ok: true },
) {
  const request = Object.assign(new EventEmitter(), { method: "GET", url, aborted: false })
  let status = 0,
    body: unknown
  const headers = new Map<string, unknown>()
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    destroyed: false,
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value)
    },
    writeHead(code: number, values: Record<string, unknown>) {
      status = code
      Object.entries(values).forEach(([key, value]) => headers.set(key, value))
    },
    end(value: Buffer) {
      body = JSON.parse(value.toString())
      this.writableEnded = true
    },
  })
  const handled = await liveChatBusiness(
    request as never,
    response as never,
    {} as never,
    { requestId: "parts_http", identity: { namespace: "tenant", userId: "owner" } } as never,
    ["sessions", "session", "messages", "message", "parts"],
    {},
    null,
    new Map(),
    { services: { chat: { readMessageParts: read } } } as never,
    authorization as never,
  )
  return { handled, status, body, headers, request, response }
}
test("parts GET forwards trusted identity and original absolute read context, emits a no-store exact envelope", async () => {
  const page = messagePartsPageFromSlices(initial, 1, [{ ordinal: "0", item: textItem, text_slice: "原字", total_scalars: "2" }], 16)
  let query: Record<string, unknown> | undefined
  const result = await partsHttp(async (value) => {
    query = value as Record<string, unknown>
    return page
  })
  assert.equal(result.status, 200)
  assert.equal(result.handled, true)
  assert.equal(result.headers.get("cache-control"), "no-store")
  assert.deepEqual(result.body, { data: page, meta: { request_id: "parts_http" } })
  assert.equal(query?.subjectId, "owner")
  assert.equal(query?.tenantId, "tenant")
  assert.equal(query?.limit, 16)
  assert.equal(query?.scope, "all")
  assert.equal(query?.cursor, null)
  assert.ok(query?.signal instanceof AbortSignal)
  assert.ok(Number(query?.deadlineAt) - performance.now() <= 10000)
  assert.equal(result.request.listenerCount("aborted"), 0)
  assert.equal(result.response.listenerCount("close"), 0)
})
for (const [error, status, code] of [
  ["MESSAGE_PARTS_CURSOR_INVALID", 400, "invalid_cursor"],
  ["MESSAGE_PARTS_CHANGED", 409, "message_parts_changed"],
  ["MESSAGE_PARTS_GONE", 410, "message_parts_gone"],
  ["MESSAGE_PARTS_UNAVAILABLE", 503, "message_parts_unavailable"],
  ["MESSAGE_PARTS_BUDGET_EXCEEDED", 503, "message_parts_budget_exceeded"],
] as const)
  test(`parts HTTP exposes ${code} and makes no implicit second read`, async () => {
    let attempts = 0
    const result = await partsHttp(async () => {
      attempts += 1
      throw new Error(error)
    })
    assert.equal(result.status, status)
    assert.equal((result.body as { error: { code: string } }).error.code, code)
    assert.equal(attempts, 1)
  })
test("parts HTTP rejects direct plus Project without dispatching an owner read", async () => {
  let attempts = 0
  const result = await partsHttp(
    async () => {
      attempts += 1
      return null
    },
    "/v1/sessions/session/messages/message/parts?scope=direct&project_ref=project",
    { ok: true, projectRef: "project" },
  )
  assert.equal(result.status, 400)
  assert.equal((result.body as { error: { code: string } }).error.code, "invalid_scope")
  assert.equal(attempts, 0)
})
test("parts HTTP final envelope counts all metadata, not just text bytes", async () => {
  const result = await partsHttp(async () => ({ metadata: "x".repeat(1048576) }))
  assert.equal(result.status, 503)
  assert.equal((result.body as { error: { code: string } }).error.code, "message_parts_budget_exceeded")
})
test("missing owned Message is 404 rather than an invented empty page", async () => {
  const result = await partsHttp(async () => null)
  assert.equal(result.status, 404)
  assert.equal(Object.hasOwn(result.body as object, "data"), false)
})

test("legacy recovery spends one shared request budget on at most the selected global-latest assistant", async () => {
  const fixture = readFixture()
  const rows = Array.from({ length: 100 }, (_, index) => ({
    message_id: `message_${index}`,
    tenant_id: "tenant",
    conversation_id: "session",
    role: "assistant",
    run_id: `run_${index}`,
    selected_skill_source_refs: [],
    content: `original_${index}`,
    status: "completed",
    agent_failure_code: null,
    agent_failure_retryable: null,
    message_seq: String(index + 1),
    created_at: new Date(0),
    updated_at: new Date(0),
    parts_format_version: null,
    parts_public_sequence: null,
    parts_count: null,
  }))
  const result = await privateMessagesFromRows(fixture.client as never, rows as never, scope, watermark, "run_99", "message_99")
  assert.equal(result.length, 100)
  assert.equal(fixture.calls.length, 1)
  assert.deepEqual(fixture.calls[0]?.values, ["tenant", "session", "owner", "run_99", "message_99"])
  assert.equal(result[99]?.content, "original_99")
  fixture.calls.splice(0)
  await privateMessagesFromRows(fixture.client as never, rows.slice(0, 99) as never, scope, watermark, "run_99", "message_99")
  assert.deepEqual(fixture.calls, [])
})
test("legacy recovery refuses more than 512 frames or 4 MiB instead of expanding its read window", () => {
  assert.equal(
    recoverLegacyFrames(
      scope,
      "original😀",
      "completed",
      "3",
      Array.from({ length: 513 }, () => legacyRows()[0]!),
    ),
    null,
  )
  assert.equal(recoverLegacyFrames(scope, "x".repeat(4194305), "completed", "3", legacyRows()), null)
})

import { createHash } from "node:crypto"

// Flat pinned Agent ChatEvent wire: this test's independent oracle hashes its
// exact canonical field order, not a presumed meaning of the public END frame.
function rawWireDigest(wire: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(Object.fromEntries(Object.entries(wire).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))))
    .digest("hex")
}
function emptyWitnessFixture() {
  const rows: ReturnType<typeof legacyRows> = []
  const wires = new Map<number, Record<string, unknown>>()
  function add(
    position: number,
    sequence: number,
    eventType: string,
    payload: unknown,
    event: Record<string, unknown>,
    messageId: string | null = null,
    frameIndex = 0,
  ) {
    const id = `witness-source-${sequence}`,
      createdAt = sequence * 1000
    const wire = {
      chat_event_id: id,
      session_id: "session",
      run_id: "run",
      source_index: sequence - 30,
      event_type: eventType,
      payload_json: JSON.stringify(payload),
      seq: sequence,
      created_at: createdAt,
      chat_message_id: messageId,
    }
    wires.set(sequence, wire)
    rows.push({
      public_sequence: String(position),
      source_sequence: String(sequence),
      frame_index: frameIndex,
      source_event_id: id,
      source_digest: rawWireDigest(wire),
      source_valid: true,
      event_payload: {
        ...event,
        timestamp: createdAt,
        metadata: { kokoro: { event_id: id, seq: sequence, session_id: "session", run_id: "run", timestamp: new Date(createdAt).toISOString() } },
      },
    })
  }
  const skill = {
    activity: "skill",
    activity_id: "act_" + "c".repeat(64),
    preflight_id: "spf_" + "d".repeat(64),
    source_refs: ["skill:fixture"],
    phase: "ready",
  }
  // BFF queue is public 1. The first retained Agent source is 30, not public 2.
  add(2, 30, "activity", skill, { type: "CUSTOM", name: "kokoro.activity.updated", value: skill })
  add(3, 31, "run.started", { status: "running" }, { type: "RUN_STARTED", threadId: "session", runId: "run" })
  for (let index = 0; index < 12; index += 1)
    add(4 + index, 32 + index, "assistant.completed", { content: "" }, { type: "TEXT_MESSAGE_END", messageId: `empty-${index}` }, `empty-${index}`)
  const nextTool = { ...tool, activity_id: "act_" + "b".repeat(64) }
  add(16, 44, "activity", nextTool, { type: "CUSTOM", name: "kokoro.activity.updated", value: nextTool })
  add(17, 45, "assistant.delta", { delta: "visible😀" }, { type: "TEXT_MESSAGE_START", role: "assistant", messageId: "visible-stream" }, "visible-stream")
  add(18, 45, "assistant.delta", { delta: "visible😀" }, { type: "TEXT_MESSAGE_CONTENT", delta: "visible😀", messageId: "visible-stream" }, "visible-stream", 1)
  const delivery = {
    tool_call_id: "tool",
    artifact_id: "artifact",
    asset_id: "asset",
    artifact_kind: "document",
    path: "/report.md",
    title: "Report",
    mime: "text/markdown",
    size: 1,
    content_hash: "d".repeat(64),
  }
  add(19, 46, "delivery", delivery, { type: "CUSTOM", name: "kokoro.delivery.created", value: delivery })
  add(20, 47, "assistant.completed", { content: "visible😀" }, { type: "TEXT_MESSAGE_END", messageId: "visible-stream" }, "visible-stream")
  add(
    21,
    48,
    "run.completed",
    { status: "completed", token_usage: null },
    { type: "RUN_FINISHED", threadId: "session", runId: "run", status: "completed", outcome: { type: "success" } },
  )
  return { rows, wires }
}
test("retained END-only slots require full empty-wire digest proof, preserve public positions and accept a non-parts delivery", () => {
  const { rows } = emptyWitnessFixture()
  const recovered = recoverLegacyFrames(scope, "visible😀", "completed", "3", rows)
  assert.ok(recovered)
  assert.equal(recovered.publicSequence, "21")
  assert.equal(recovered.parts.length, 15)
  assert.deepEqual(
    recovered.parts
      .filter((part) => part.kind === "text" && part.segment_id.startsWith("empty-"))
      .map((part) => [part.segment_id, part.text, part.completed, part.first_sequence, part.latest_sequence]),
    Array.from({ length: 12 }, (_, index) => [`empty-${index}`, "", true, String(4 + index), String(4 + index)]),
  )
  assert.deepEqual(
    recovered.parts
      .filter((part) => part.kind === "text")
      .map((part) => part.text)
      .join(""),
    "visible😀",
  )
  assert.equal(
    recovered.parts.some((part) => part.part_id.includes("artifact")),
    false,
  )
})
for (const [name, patch] of [
  ["nonempty completion", { payload_json: '{"content":"nonempty private completion"}' }],
  ["wire event identity", { chat_event_id: "other-source" }],
  ["wire session identity", { session_id: "other-session" }],
  ["wire Run identity", { run_id: "other-run" }],
  ["raw execution index", { source_index: 9 }],
  ["source timestamp", { created_at: 32001 }],
  ["serialization", { payload_json: '{ "content": "" }' }],
  ["extra field", { extra: true }],
  ["event profile", { event_type: "assistant.delta" }],
] as const)
  test(`legacy empty witness refuses ${name} drift without weakening original-body protection`, () => {
    const { rows, wires } = emptyWitnessFixture()
    rows.find((row) => row.source_sequence === "32")!.source_digest = rawWireDigest({ ...wires.get(32), ...patch })
    assert.equal(recoverLegacyFrames(scope, "visible😀", "completed", "3", rows), null)
  })
test("legacy empty witness does not normalize absent or null chat_message_id", () => {
  for (const absent of [true, false]) {
    const { rows, wires } = emptyWitnessFixture(),
      wire = { ...wires.get(32) }
    if (absent) delete wire.chat_message_id
    else wire.chat_message_id = null
    rows.find((row) => row.source_sequence === "32")!.source_digest = rawWireDigest(wire)
    assert.equal(recoverLegacyFrames(scope, "visible😀", "completed", "3", rows), null)
  }
})
test("a digest-proven empty segment cannot subsequently reopen as the visible stream", () => {
  const { rows } = emptyWitnessFixture()
  for (const row of rows) if (["17", "18", "20"].includes(row.public_sequence)) row.event_payload = { ...row.event_payload, messageId: "empty-0" }
  assert.equal(recoverLegacyFrames(scope, "visible😀", "completed", "3", rows), null)
})
test("two independently hashed completions cannot duplicate the same empty segment identity", () => {
  const { rows, wires } = emptyWitnessFixture(),
    row = rows.find((item) => item.source_sequence === "33")!
  row.event_payload = { ...row.event_payload, messageId: "empty-0" }
  row.source_digest = rawWireDigest({ ...wires.get(33), chat_message_id: "empty-0" })
  assert.equal(recoverLegacyFrames(scope, "visible😀", "completed", "3", rows), null)
})
test("the extra delivery allowance is not an open-ended CUSTOM escape hatch", () => {
  const { rows } = emptyWitnessFixture(),
    row = rows.find((item) => item.public_sequence === "19")!
  row.event_payload = { ...row.event_payload, name: "kokoro.unknown" }
  assert.equal(recoverLegacyFrames(scope, "visible😀", "completed", "3", rows), null)
})

test("an exact empty completion witness cannot excuse a second public frame from that source", () => {
  const { rows } = emptyWitnessFixture(),
    original = rows.find((row) => row.public_sequence === "4")!
  for (const row of rows) if (BigInt(row.public_sequence) > 4n) row.public_sequence = String(BigInt(row.public_sequence) + 1n)
  rows.splice(3, 0, {
    ...original,
    public_sequence: "5",
    frame_index: 1,
    event_payload: { ...original.event_payload, type: "CUSTOM", name: "kokoro.todo.updated", value: {} },
  })
  assert.equal(recoverLegacyFrames(scope, "visible😀", "completed", "3", rows), null)
})

import { agentEventPage, mapAgentEvent } from "../src/infrastructure/clients/agent/projection.ts"
import { createAgUiProjectionState, projectChatEvent } from "../src/application/agui/project-chat-event.ts"
import { agUiSourcePayloadDigest, validateAgUiFrames } from "../src/application/agui/project-session-events.ts"

test("the pinned raw Agent decoder and original digest producer supply the same empty-witness proof", () => {
  const { wires } = emptyWitnessFixture()
  const page = agentEventPage({ events: [...wires.values()], next_seq: 48, watermark: 48 }, "session", 29, 1000)
  assert.ok(page)
  const projection = createAgUiProjectionState(),
    rows: ReturnType<typeof legacyRows> = []
  let position = 1
  for (const wire of page.events) {
    const sourceDigest = agUiSourcePayloadDigest(wire)
    assert.equal(sourceDigest, rawWireDigest(wire))
    const frames = validateAgUiFrames(projectChatEvent(mapAgentEvent(wire), projection))
    for (const [index, frame] of frames.entries())
      rows.push({
        public_sequence: String(++position),
        source_sequence: String(wire.seq),
        frame_index: index,
        source_event_id: wire.chat_event_id,
        source_digest: sourceDigest,
        source_valid: true,
        event_payload: frame as never,
      })
  }
  const recovered = recoverLegacyFrames(scope, "visible😀", "completed", "3", rows)
  assert.ok(recovered)
  assert.equal(recovered.publicSequence, "21")
  assert.equal(recovered.parts.filter((part) => part.kind === "text" && part.text === "").length, 12)
  assert.equal(
    recovered.parts
      .filter((part) => part.kind === "text")
      .map((part) => part.text)
      .join(""),
    "visible😀",
  )
})
