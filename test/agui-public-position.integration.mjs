import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { Pool } from "pg"
import { PostgresAgUiProjectionRepository } from "../dist/infrastructure/postgres/agui-projection-repository.js"
import { agUiSseFrame } from "../dist/interfaces/http/agui/sse.js"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integrationTest = postgresUrl ? test : test.skip

integrationTest("durable AG-UI replay public positions and final-payload byte budget (owned empty PostgreSQL only)", { timeout: 30000 }, async (suite) => {
  // Root allocates/reclaims this exact temporary database; this fixture never drops or resets a schema.
  const target = new URL(postgresUrl)
  assert.match(target.pathname, /^\/kokoro_bff_parts_[0-9a-f]{32}$/u)
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
  const pool = new Pool({ connectionString: postgresUrl, max: 2, options: "-c search_path=kokoro_bff -c timezone=UTC", statement_timeout: 5000 })
  try {
    assert.equal((await pool.query("SELECT to_regclass('kokoro_bff.bff_agui_event') AS installed")).rows[0].installed, null, "fresh isolated database required")
    await pool.query("CREATE SCHEMA kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    const suffix = randomUUID().replaceAll("-", "")
    const tenant = `position_t_${suffix}`,
      session = `position_s_${suffix}`
    const repository = new PostgresAgUiProjectionRepository({ pool })
    const metadata = { event_id: "agent_source_4", seq: 4, session_id: session, run_id: "run_1", timestamp: "2026-01-01T00:00:04.000Z" }
    const payloads = [
      { type: "TEXT_MESSAGE_START", messageId: "segment_1", role: "assistant", metadata: { kokoro: metadata } },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "segment_1", delta: "真实 text", metadata: { kokoro: metadata } },
      {
        type: "CUSTOM",
        name: "kokoro.run.queued",
        value: { run_id: "run_1" },
        metadata: { kokoro: { ...metadata, event_id: "bff_source_2", seq: "2", source_owner: "kokoro-bff" } },
      },
    ]
    await pool.query("INSERT INTO bff_agui_stream(tenant_id,session_id,source_high_watermark,next_public_sequence) VALUES($1,$2,4,10)", [tenant, session])
    for (const [index, payload] of payloads.entries()) {
      const owner = index < 2 ? "kokoro-agent" : "kokoro-bff"
      await pool.query(
        `INSERT INTO bff_agui_event(tenant_id,session_id,public_sequence,cursor,source_owner,source_event_id,frame_index,event_type,event_payload,source_occurred_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'2026-01-01T00:00:04Z')`,
        [
          tenant,
          session,
          index + 7,
          `agui_${randomUUID().replaceAll("-", "")}`,
          owner,
          payload.metadata.kokoro.event_id,
          index < 2 ? index : 0,
          payload.type,
          JSON.stringify(payload),
        ],
      )
    }
    for (const [owner, id, sequence] of [
      ["kokoro-agent", "agent_source_4", 4],
      ["kokoro-bff", "bff_source_2", 2],
    ]) {
      await pool.query(
        `INSERT INTO bff_agui_source_event(tenant_id,session_id,source_owner,source_event_id,source_sequence,source_digest,source_occurred_at)
         VALUES($1,$2,$3,$4,$5,$6,'2026-01-01T00:00:04Z')`,
        [tenant, session, owner, id, sequence, "a".repeat(64)],
      )
    }
    const ledger = async () => ({
      frames: (
        await pool.query(
          "SELECT public_sequence::text,cursor,event_payload,xmin::text FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 ORDER BY public_sequence",
          [tenant, session],
        )
      ).rows,
      sources: (
        await pool.query(
          "SELECT source_owner,source_event_id,source_digest,xmin::text FROM bff_agui_source_event WHERE tenant_id=$1 AND session_id=$2 ORDER BY source_owner",
          [tenant, session],
        )
      ).rows,
    })
    const before = await ledger()
    await suite.test("actual ledger positions distinguish two frames from one source and preserve BFF source shape through SSE", async () => {
      const page = await repository.replay(tenant, session, null, 10, 1024 * 1024)
      assert.equal(page.kind, "page")
      assert.equal(page.atHead, true)
      assert.deepEqual(
        page.frames.map((frame) => frame.payload.metadata.kokoro.public_sequence),
        ["7", "8", "9"],
      )
      assert.deepEqual(
        page.frames.map((frame) => frame.payload.metadata.kokoro.seq),
        [4, 4, "2"],
      )
      assert.equal(page.frames[2].payload.metadata.kokoro.source_owner, "kokoro-bff")
      for (const frame of page.frames) {
        const encoded = agUiSseFrame(frame.payload, frame.cursor)
        assert.equal(JSON.parse(encoded.split("\ndata: ")[1].trim()).metadata.kokoro.public_sequence, String(frame.publicSequence))
      }
      const resumed = await repository.replay(tenant, session, page.frames[0].cursor, 10, 1024 * 1024)
      assert.deepEqual(
        resumed.frames.map((frame) => frame.payload.metadata.kokoro.public_sequence),
        ["8", "9"],
      )
    })
    await suite.test("SQL sizes projected metadata, keeps the oversized first-frame rule, and does not leak into the next page", async () => {
      const sizes = (
        await pool.query(
          `SELECT sum(octet_length(event_payload::text)+octet_length(cursor)+octet_length(event_type)+64)::integer AS old_bytes,
                sum(octet_length(jsonb_set(event_payload,'{metadata,kokoro,public_sequence}',to_jsonb(public_sequence::text),true)::text)+octet_length(cursor)+octet_length(event_type)+64)::integer AS final_bytes
           FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 AND public_sequence IN (7,8)`,
          [tenant, session],
        )
      ).rows[0]
      assert.ok(sizes.final_bytes > sizes.old_bytes)
      const page = await repository.replay(tenant, session, null, 10, sizes.old_bytes)
      assert.deepEqual(
        page.frames.map((frame) => frame.payload.metadata.kokoro.public_sequence),
        ["7"],
      )
      assert.equal(page.atHead, false)
      const oversized = await repository.replay(tenant, session, null, 10, 1)
      assert.deepEqual(
        oversized.frames.map((frame) => frame.payload.metadata.kokoro.public_sequence),
        ["7"],
      )
    })
    assert.deepEqual(await ledger(), before, "replay must not UPDATE old payloads, source digests, or xmin")
    await suite.test("malformed persisted metadata fails loud without changing the row", async () => {
      const badSession = `${session}_bad`
      await pool.query("INSERT INTO bff_agui_stream(tenant_id,session_id,next_public_sequence) VALUES($1,$2,2)", [tenant, badSession])
      await pool.query(
        `INSERT INTO bff_agui_event(tenant_id,session_id,public_sequence,cursor,source_owner,source_event_id,frame_index,event_type,event_payload,source_occurred_at)
         VALUES($1,$2,1,$3,'kokoro-agent','bad_source',0,'RUN_STARTED',$4::jsonb,'2026-01-01T00:00:04Z')`,
        [tenant, badSession, `agui_${randomUUID().replaceAll("-", "")}`, JSON.stringify({ type: "RUN_STARTED", metadata: { kokoro: { ...metadata, seq: "4" } } })],
      )
      const readBad = () => pool.query("SELECT event_payload,xmin::text FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2", [tenant, badSession])
      const original = (await readBad()).rows
      await assert.rejects(repository.replay(tenant, badSession, null, 10, 4096), /AGUI_REPLAY_METADATA_INVALID/u)
      assert.deepEqual((await readBad()).rows, original)
    })
  } finally {
    await pool.end()
  }
})
