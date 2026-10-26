import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { Pool } from "pg"
import { PostgresBffRepositories } from "../dist/infrastructure/postgres/repositories.js"
import { PostgresChatRepository } from "../dist/infrastructure/postgres/chat-repository.js"
import { decodeMessagePartsCursor } from "../dist/infrastructure/postgres/message-parts-read.js"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const redisUrl = process.env.KOKORO_TEST_REDIS_URL
const integrationTest = postgresUrl && redisUrl ? test : test.skip
const tool = {
  activity: "tool",
  activity_id: "act_" + "a".repeat(64),
  segment_id: "seg_" + "b".repeat(64),
  status: "completed",
  display_code: "tool.execution",
}
const skill = { activity: "skill", activity_id: "act_" + "c".repeat(64), preflight_id: "spf_" + "d".repeat(64), source_refs: ["skill:fixture"], phase: "ready" }
const lifetime = (scope = "all") => ({ scope, signal: new AbortController().signal, deadlineAt: performance.now() + 10000 })

integrationTest("private Message parts PostgreSQL vertical slice (owned empty database only)", { timeout: 120000 }, async (suite) => {
  // Root supplies and reclaims this exact temporary database. Never reset a preview or normal owner schema.
  assert.match(new URL(postgresUrl).pathname, /^\/kokoro_bff_parts_[0-9a-f]{32}$/u)
  const pool = new Pool({ connectionString: postgresUrl, max: 5, options: "-c search_path=kokoro_bff -c timezone=UTC", statement_timeout: 10000 })
  let store
  try {
    assert.equal((await pool.query("SELECT to_regclass('kokoro_bff.bff_message') AS installed")).rows[0].installed, null, "requires a fresh owned database")
    await pool.query("CREATE SCHEMA kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const reader = new PostgresChatRepository({ pool })
    async function create({ legacy = false, long = "A", twoSegments = false, prelude = false } = {}) {
      const suffix = randomUUID().replaceAll("-", ""),
        tenantId = `parts_t_${suffix}`,
        conversationId = `parts_s_${suffix}`,
        subjectId = `parts_o_${suffix}`
      await pool.query("INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,title) VALUES($1,$2,$3,'Parts fixture')", [
        conversationId,
        tenantId,
        subjectId,
      ])
      const receipt = await store.services.chatTurns.submit({
        tenantId,
        conversationId,
        subjectId,
        actorId: subjectId,
        requestId: `request_${suffix}`,
        idempotencyKey: `key_${suffix}`,
        content: "original user",
      })
      assert.ok(receipt)
      const claim = (
        await store.agentDispatchOutbox.claimAgentDispatchOutbox({ workerId: `worker_${suffix}`, limit: 1, leaseDurationMs: 5000, maxAttempts: 8 })
      )[0]
      assert.equal(claim.runId, receipt.run_id)
      assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(claim), true)
      const messageId = receipt.assistant_message_id,
        runId = receipt.run_id
      if (legacy)
        await pool.query("UPDATE bff_message SET ordered_parts=NULL,parts_format_version=NULL,parts_public_sequence=NULL WHERE message_id=$1", [messageId])
      let sequence = 0
      function source(kind, payload) {
        sequence += 1
        const id = `source_${suffix}_${sequence}`,
          occurredAt = new Date(sequence * 1000).toISOString()
        return {
          sourceRunId: runId,
          sourceEventId: id,
          sourceSequence: sequence,
          sourceOccurredAt: occurredAt,
          sourcePayload: { chat_event_id: id, session_id: conversationId, run_id: runId, seq: sequence, created_at: sequence * 1000, payload },
          event: { event_id: id, seq: sequence, session_id: conversationId, run_id: runId, kind, timestamp: occurredAt, payload },
        }
      }
      const events = [
        ...(prelude ? [source("activity.updated", skill)] : []),
        source("run.created", { run_id: runId }),
        source("message.delta", { segment_id: "public-a", delta: long }),
        source("message.completed", { segment_id: "public-a", content: long }),
        ...(twoSegments
          ? [
              source("activity.updated", { ...tool, status: "running" }),
              source("activity.updated", tool),
              source("message.delta", { segment_id: "public-b", delta: "B" }),
              source("message.completed", { segment_id: "public-b", content: "B" }),
            ]
          : []),
        source("run.completed", { status: "completed" }),
      ]
      await store.agUi.ingest(tenantId, conversationId, events)
      const query = (cursor = null, extra = {}) => ({
        ...lifetime(),
        tenantId,
        subjectId,
        conversationId,
        messageId,
        projectRef: undefined,
        cursor,
        limit: 16,
        ...extra,
      })
      const snapshot = (context = lifetime(), projectRef) => reader.readSnapshot(tenantId, subjectId, conversationId, projectRef, context)
      return { tenantId, subjectId, conversationId, messageId, runId, receipt, query, snapshot }
    }
    const assistant = (snapshot) => snapshot.messages.find((message) => message.role === "assistant")
    const raw = async (c) =>
      (
        await pool.query("SELECT content,ordered_parts,parts_format_version,parts_public_sequence,xmin::text AS xmin FROM bff_message WHERE message_id=$1", [
          c.messageId,
        ])
      ).rows[0]

    await suite.test("private snapshot/list reference exact text-tool-text parts; command receipt and public Share keep original shape", async () => {
      const c = await create({ twoSegments: true })
      assert.deepEqual(Object.keys(c.receipt).sort(), ["assistant_message_id", "run_id", "user_message_id"])
      const snapshot = await c.snapshot(),
        selected = assistant(snapshot)
      assert.equal(selected.content, null)
      assert.equal(selected.rendering.mode, "ordered")
      assert.equal(snapshot.messages.find((message) => message.role === "user").content, "original user")
      const page = await reader.readMessageParts(c.query(selected.rendering.parts_cursor))
      assert.deepEqual(
        page.items.map((item) => [item.kind, item.first_sequence, item.latest_sequence]),
        [
          ["text", "3", "5"],
          ["activity", "6", "7"],
          ["text", "8", "10"],
        ],
      )
      assert.deepEqual(
        page.items.filter((item) => item.kind === "text").map((item) => [item.segment_id, item.text]),
        [
          ["public-a", "A"],
          ["public-b", "B"],
        ],
      )
      assert.deepEqual(page.items[1].activity, tool)
      assert.equal(page.event_watermark, snapshot.eventWatermark)
      assert.equal(page.next_cursor, null)
      const listed = await reader.listMessages(c.tenantId, c.subjectId, c.conversationId, 100, null)
      assert.deepEqual(assistant(listed).rendering, selected.rendering)
      const share = await reader.createShare(c.tenantId, c.subjectId, c.conversationId)
      const shared = await store.services.publicShares.listMessages(share.shareId, c.tenantId, c.conversationId, 100)
      assert.equal(shared.messages.find((message) => message.role === "assistant").content, "AB")
      assert.equal(
        Object.hasOwn(
          shared.messages.find((message) => message.role === "assistant"),
          "rendering",
        ),
        false,
      )
    })
    await suite.test("a >1 MiB astral body never enters snapshot/list and is read in exact 4096-scalar slices", async () => {
      const text = "😀".repeat(270000),
        c = await create({ long: text })
      const snapshot = await c.snapshot(),
        selected = assistant(snapshot)
      assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 16384)
      assert.equal(selected.content, null)
      assert.equal(
        (await reader.listMessages(c.tenantId, c.subjectId, c.conversationId, 100, null)).messages.find((message) => message.role === "assistant").content,
        null,
      )
      let cursor = selected.rendering.parts_cursor,
        reconstructed = "",
        expectedOffset = 0,
        count = 0
      while (cursor !== null) {
        const page = await reader.readMessageParts(c.query(cursor))
        assert.ok(Buffer.byteLength(JSON.stringify({ data: page, meta: { request_id: "request" } })) <= 1048576)
        assert.equal(page.items.length, 1)
        const item = page.items[0]
        assert.equal(item.segment_id, "public-a")
        assert.equal(item.offset, String(expectedOffset))
        assert.ok(Array.from(item.text).length <= 4096)
        expectedOffset += Array.from(item.text).length
        assert.equal(item.end, String(expectedOffset))
        assert.equal(item.total_scalars, "270000")
        reconstructed += item.text
        cursor = page.next_cursor
        count += 1
        assert.ok(count < 100)
      }
      assert.equal(reconstructed, text)
      assert.equal(count, 66)
    })
    await suite.test("same stable revision preserves the original null watermark even after a new public frame", async () => {
      const suffix = randomUUID().replaceAll("-", ""),
        c = { tenantId: `bare_t_${suffix}`, subjectId: "bare_owner", conversationId: `bare_s_${suffix}`, messageId: `bare_m_${suffix}` }
      await pool.query("INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,title) VALUES($1,$2,$3,'Bare fixture')", [
        c.conversationId,
        c.tenantId,
        c.subjectId,
      ])
      await pool.query(
        "INSERT INTO bff_message(message_id,tenant_id,conversation_id,run_id,role,content,status,message_seq,ordered_parts,parts_format_version,parts_public_sequence) VALUES($1,$2,$3,'bare_run','assistant',$4,'streaming',1,$5,1,3)",
        [
          c.messageId,
          c.tenantId,
          c.conversationId,
          "x".repeat(4097),
          JSON.stringify([
            { kind: "text", part_id: "text:bare", segment_id: "bare", text: "x".repeat(4097), completed: false, first_sequence: "1", latest_sequence: "3" },
          ]),
        ],
      )
      const query = { ...lifetime(), ...c, projectRef: undefined, cursor: null, limit: 16 }
      const first = await reader.readMessageParts(query)
      assert.equal(first.event_watermark, null)
      await pool.query(
        "INSERT INTO bff_agui_event(tenant_id,session_id,public_sequence,cursor,source_owner,source_event_id,frame_index,event_type,event_payload,source_occurred_at) VALUES($1,$2,1,$3,'kokoro-bff','queue',0,'CUSTOM','{}',CURRENT_TIMESTAMP(3))",
        [c.tenantId, c.conversationId, "agui_" + randomUUID().replaceAll("-", "")],
      )
      assert.equal((await reader.readMessageParts({ ...query, ...lifetime(), cursor: first.next_cursor })).event_watermark, null)
    })
    await suite.test("revision drift is 409 without an automatic fresh read or source mutation", async () => {
      const c = await create({ long: "x".repeat(4097) }),
        selected = assistant(await c.snapshot())
      const first = await reader.readMessageParts(c.query(selected.rendering.parts_cursor))
      await pool.query("UPDATE bff_message SET parts_public_sequence=parts_public_sequence+1 WHERE message_id=$1", [c.messageId])
      const before = await raw(c)
      await assert.rejects(reader.readMessageParts(c.query(first.next_cursor)), /MESSAGE_PARTS_CHANGED/u)
      assert.deepEqual(await raw(c), before)
      assert.equal((await reader.readMessageParts(c.query())).revision, String(BigInt(first.revision) + 1n))
    })
    await suite.test("every page rechecks tenant, owner, exact current Project and original requested scope", async () => {
      const c = await create(),
        selected = assistant(await c.snapshot()),
        cursor = selected.rendering.parts_cursor
      assert.equal(await reader.readMessageParts(c.query(cursor, { tenantId: "foreign" })), null)
      assert.equal(await reader.readMessageParts(c.query(cursor, { subjectId: "foreign" })), null)
      assert.equal(await reader.readMessageParts(c.query(cursor, { projectRef: "missing" })), null)
      await assert.rejects(reader.readMessageParts(c.query(cursor, { scope: "direct" })), /MESSAGE_PARTS_CURSOR_INVALID/u)
      const project = `project_${randomUUID()}`
      await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,$3,'Project fixture',$1)", [
        project,
        c.tenantId,
        c.subjectId,
      ])
      await pool.query("UPDATE bff_conversation SET project_ref=$2 WHERE conversation_id=$1", [c.conversationId, project])
      assert.equal(await c.snapshot(lifetime("direct")), null)
      assert.equal(await reader.listMessages(c.tenantId, c.subjectId, c.conversationId, 100, null, undefined, lifetime("direct")), null)
      assert.equal(await reader.readMessageParts(c.query(null, { scope: "direct" })), null)
      await assert.rejects(reader.readMessageParts(c.query(cursor)), /MESSAGE_PARTS_CURSOR_INVALID/u)
      await assert.rejects(reader.readMessageParts(c.query(null, { scope: "direct", projectRef: project })), /MESSAGE_PARTS_SCOPE_INVALID/u)
      const current = await c.snapshot(lifetime(), project)
      assert.ok(current)
      assert.ok(await reader.readMessageParts(c.query(assistant(current).rendering.parts_cursor, { projectRef: project })))
      await pool.query("UPDATE bff_project SET deleted_at=CURRENT_TIMESTAMP(3) WHERE project_id=$1", [project])
      assert.equal(await reader.readMessageParts(c.query(null, { projectRef: project })), null)
    })
    await suite.test("retained unique legacy source evidence is read-time only; an older Message on another page remains legacy", async () => {
      const c = await create({ legacy: true, long: "old😀".repeat(1100), prelude: true }),
        before = await raw(c)
      assert.equal(before.ordered_parts, null)
      const selected = assistant(await c.snapshot())
      assert.equal(selected.content, null)
      assert.equal(decodeMessagePartsCursor(selected.rendering.parts_cursor).source, "ledger")
      const page = await reader.readMessageParts(c.query(selected.rendering.parts_cursor, { limit: 1 }))
      assert.deepEqual(page.items[0].activity, skill)
      assert.equal(page.items[0].first_sequence, "2")
      const textPage = await reader.readMessageParts(c.query(page.next_cursor))
      assert.equal(textPage.items[0].segment_id, "public-a")
      assert.equal(textPage.items[0].text, Array.from(before.content).slice(0, 4096).join(""))
      assert.deepEqual(await raw(c), before)
      await pool.query(
        "INSERT INTO bff_message(message_id,tenant_id,conversation_id,run_id,role,content,status,message_seq) VALUES($1,$2,$3,'unselected','assistant','untouched latest legacy','completed',3)",
        [`later_${randomUUID()}`, c.tenantId, c.conversationId],
      )
      const listed = await reader.listMessages(c.tenantId, c.subjectId, c.conversationId, 2, null)
      assert.equal(listed.messages[1].content, before.content)
      assert.equal(Object.hasOwn(listed.messages[1], "rendering"), false)
      // A previously issued proved cursor still continues without rewriting old content.
      assert.ok(await reader.readMessageParts(c.query(textPage.next_cursor)))
      assert.deepEqual(await raw(c), before)
    })
    await suite.test("legacy public delta/body disagreement preserves original body rather than fabricating ordered success", async () => {
      const c = await create({ legacy: true })
      await pool.query("UPDATE bff_message SET content='authoritative correction not in public deltas' WHERE message_id=$1", [c.messageId])
      const before = await raw(c),
        selected = assistant(await c.snapshot())
      assert.equal(selected.content, before.content)
      assert.equal(Object.hasOwn(selected, "rendering"), false)
      await assert.rejects(reader.readMessageParts(c.query()), /MESSAGE_PARTS_UNAVAILABLE/u)
      assert.deepEqual(await raw(c), before)
    })
    await suite.test("collected legacy watermark is 410, not an empty or speculative rebuilt history", async () => {
      const c = await create({ legacy: true }),
        selected = assistant(await c.snapshot()),
        before = await raw(c)
      assert.equal(selected.content, null)
      const anchor = (
        await pool.query("SELECT public_sequence,cursor FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 ORDER BY public_sequence DESC LIMIT 1", [
          c.tenantId,
          c.conversationId,
        ])
      ).rows[0]
      await pool.query("INSERT INTO bff_agui_cursor_tombstone(tenant_id,session_id,cursor,public_sequence) VALUES($1,$2,$3,$4)", [
        c.tenantId,
        c.conversationId,
        anchor.cursor,
        anchor.public_sequence,
      ])
      await pool.query("UPDATE bff_agui_stream SET retention_floor_sequence=$3 WHERE tenant_id=$1 AND session_id=$2", [
        c.tenantId,
        c.conversationId,
        anchor.public_sequence,
      ])
      await pool.query("DELETE FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2", [c.tenantId, c.conversationId])
      await assert.rejects(reader.readMessageParts(c.query(selected.rendering.parts_cursor)), /MESSAGE_PARTS_GONE/u)
      assert.deepEqual(await raw(c), before)
    })
    await suite.test("large fixed metadata is bounded inside PostgreSQL and yields the explicit page budget error", async () => {
      const c = await create(),
        segment = "z".repeat(1048576)
      await pool.query("UPDATE bff_message SET ordered_parts=$2 WHERE message_id=$1", [
        c.messageId,
        JSON.stringify([
          { kind: "text", part_id: `text:${segment}`, segment_id: segment, first_sequence: "3", latest_sequence: "5", completed: true, text: "A" },
        ]),
      ])
      await assert.rejects(reader.readMessageParts(c.query()), /MESSAGE_PARTS_BUDGET_EXCEEDED/u)
    })
  } finally {
    try {
      if (store) await store.close()
    } finally {
      await pool.end()
    }
  }
})
