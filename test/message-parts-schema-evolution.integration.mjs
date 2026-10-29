import assert from "node:assert/strict"
import { createServer, connect } from "node:net"
import { test } from "node:test"
import { Pool } from "pg"
import { loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import { evolveMessagePartsSchema, messagePartsSchemaDefinitions } from "../scripts/evolve-message-parts-schema.mjs"

test("pure: extracts only the approved additive Message delta and rejects canonical table drift", async () => {
  const schema = await loadCanonicalSchema()
  const definitions = messagePartsSchemaDefinitions(schema)
  assert.deepEqual(
    definitions.columns.map(({ name }) => name),
    ["ordered_parts", "parts_format_version", "parts_public_sequence"],
  )
  assert.match(definitions.constraint, /^CONSTRAINT ck_bff_message_ordered_parts CHECK/u)
  assert.ok(!definitions.oldTable.includes("ordered_parts"))
  assert.ok(!definitions.oldTable.includes("parts_format_version"))
  assert.ok(!definitions.oldTable.includes("parts_public_sequence"))
  for (const changed of [
    schema.replace("ordered_parts JSONB,", "ordered_parts JSONB DEFAULT '[]',"),
    schema.replace("parts_format_version = 1", "parts_format_version >= 1"),
    schema.replace("  content TEXT NOT NULL,", "  content TEXT,"),
  ]) {
    assert.throws(() => messagePartsSchemaDefinitions(changed), /invalid_schema/u)
  }
})

test("pure: rejects malformed scope and modes with a sanitized closed result before any connection", async () => {
  for (const input of [
    {},
    {
      mode: "reset",
      databaseUrl: "postgres://127.0.0.1:1/x?schema=kokoro_bff",
    },
    {
      mode: "apply",
      databaseUrl: "postgres://127.0.0.1:1/postgres?schema=kokoro_bff",
    },
    { mode: "check", databaseUrl: "postgres://127.0.0.1:1/x?schema=public" },
    {
      mode: "apply",
      databaseUrl: "postgres://127.0.0.1:1/x?schema=kokoro_bff&options=-c%20search_path%3Dpublic",
    },
    {
      mode: "check",
      databaseUrl: "postgres://127.0.0.1:1/x?schema=kokoro_bff",
      timeoutMs: 20001,
    },
  ]) {
    const result = await evolveMessagePartsSchema(input)
    assert.equal(result.state, "invalid_request")
    assert.equal(result.code, "invalid_request")
    assert.deepEqual(Object.keys(result).sort(), ["cleanup", "code", "duration_ms", "state"])
  }
})

test("pure: an already canceled approved request retires before connecting", async () => {
  const abort = new AbortController()
  abort.abort()
  const result = await evolveMessagePartsSchema({
    mode: "apply",
    databaseUrl: "postgres://127.0.0.1:1/parts_canceled?schema=kokoro_bff",
    signal: abort.signal,
  })
  assert.equal(result.state, "unavailable")
  assert.ok(result.duration_ms < 500)
})

const databaseUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integration = databaseUrl ? test : test.skip

async function fixture() {
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error("fixture URL must be valid")
  }
  const database = decodeURIComponent(url.pathname.slice(1))
  assert.match(database, /^kokoro_bff_parts_[0-9a-f]{32}$/u, "Root must provide a dedicated disposable parts fixture database")
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "fixture and ACK relay are loopback-only")
  assert.deepEqual(url.searchParams.getAll("schema"), ["kokoro_bff"])
  const pool = new Pool({
    connectionString: databaseUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
    max: 3,
  })
  try {
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, database)
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM kokoro_bff.bff_message")).rows[0].count, 0, "fixture must start with no Message rows")
    assert.equal((await pool.query("SELECT to_regnamespace('message_parts_other_fixture') IS NULL AS absent")).rows[0].absent, true)
    const definitions = messagePartsSchemaDefinitions(await loadCanonicalSchema())
    await pool.query("CREATE SCHEMA message_parts_other_fixture; CREATE TABLE message_parts_other_fixture.sentinel (value TEXT NOT NULL)")
    await pool.query("INSERT INTO message_parts_other_fixture.sentinel(value) VALUES ('other schema remains intact')")
    const other = async () => (await pool.query("SELECT to_jsonb(s) AS value,xmin::text AS xmin FROM message_parts_other_fixture.sentinel s")).rows
    const otherBefore = await other()
    const rows = async () =>
      (
        await pool.query(`SELECT to_jsonb(m)-'ordered_parts'-'parts_format_version'-'parts_public_sequence' AS value,xmin::text AS xmin
      FROM kokoro_bff.bff_message m ORDER BY message_id COLLATE "C"`)
      ).rows
    const dropParts = () =>
      pool.query(`ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT IF EXISTS ck_bff_message_ordered_parts,
      DROP COLUMN IF EXISTS ordered_parts,DROP COLUMN IF EXISTS parts_format_version,DROP COLUMN IF EXISTS parts_public_sequence`)
    const evolve = (mode = "apply", extra = {}) => evolveMessagePartsSchema({ databaseUrl, mode, ...extra })
    const close = async () => {
      try {
        await pool.query("DELETE FROM kokoro_bff.bff_message WHERE tenant_id='message_parts_evolution_fixture'")
        await dropParts()
        assert.equal((await evolve()).state, "updated")
        assert.deepEqual(await other(), otherBefore)
        await pool.query("DROP TABLE message_parts_other_fixture.sentinel; DROP SCHEMA message_parts_other_fixture")
      } finally {
        await pool.end()
      }
    }
    return {
      pool,
      definitions,
      rows,
      other,
      otherBefore,
      dropParts,
      evolve,
      close,
    }
  } catch (error) {
    await pool.end()
    throw error
  }
}

async function catalog(pool) {
  return {
    columns: (
      await pool.query(`SELECT attname,format_type(atttypid,atttypmod) AS type,attnotnull,attidentity,attgenerated,
      pg_get_expr(d.adbin,d.adrelid,false) AS default_expression FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='kokoro_bff.bff_message'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY attname COLLATE "C"`)
    ).rows,
    constraints: (
      await pool.query(`SELECT conname,contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid,false) AS definition
      FROM pg_constraint WHERE conrelid='kokoro_bff.bff_message'::regclass ORDER BY conname COLLATE "C"`)
    ).rows,
    indexes: (
      await pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='kokoro_bff' AND tablename='bff_message' ORDER BY indexname COLLATE \"C\"")
    ).rows,
  }
}

integration("PG: additive Message parts preserves retained rows/xmin, accepts physical column reordering, and rejects drift without repair", async () => {
  const f = await fixture()
  const { pool } = f
  try {
    await f.dropParts()
    await pool.query(
      `INSERT INTO kokoro_bff.bff_message(message_id,tenant_id,conversation_id,run_id,role,content,status,message_seq)
      VALUES ('parts_user','message_parts_evolution_fixture','parts_conversation','parts_run','user',$1,'completed',1),
             ('parts_assistant','message_parts_evolution_fixture','parts_conversation','parts_run','assistant',$2,'completed',2)`,
      ["原文 🦊\nkept", "公开回答 kept"],
    )
    const before = await f.rows()
    const indexes = (await catalog(pool)).indexes
    assert.equal((await f.evolve("check")).state, "update_required")
    assert.deepEqual(await f.rows(), before)
    assert.equal((await f.evolve()).state, "updated")
    assert.equal((await f.evolve()).state, "current")
    assert.equal((await f.evolve("check")).state, "current")
    assert.deepEqual(await f.rows(), before)
    assert.deepEqual((await catalog(pool)).indexes, indexes)
    assert.deepEqual(
      (await pool.query('SELECT ordered_parts,parts_format_version,parts_public_sequence FROM kokoro_bff.bff_message ORDER BY message_id COLLATE "C"')).rows,
      [
        {
          ordered_parts: null,
          parts_format_version: null,
          parts_public_sequence: null,
        },
        {
          ordered_parts: null,
          parts_format_version: null,
          parts_public_sequence: null,
        },
      ],
    )
    assert.equal(
      (
        await pool.query(`SELECT (SELECT attnum FROM pg_attribute WHERE attrelid='kokoro_bff.bff_message'::regclass AND attname='ordered_parts') >
      (SELECT attnum FROM pg_attribute WHERE attrelid='kokoro_bff.bff_message'::regclass AND attname='updated_at') AS appended`)
      ).rows[0].appended,
      true,
    )
    await assert.rejects(pool.query("UPDATE kokoro_bff.bff_message SET ordered_parts='[]'::jsonb WHERE message_id='parts_assistant'"), { code: "23514" })
    await assert.rejects(
      pool.query("UPDATE kokoro_bff.bff_message SET ordered_parts='[]'::jsonb,parts_format_version=1,parts_public_sequence=0 WHERE message_id='parts_user'"),
      { code: "23514" },
    )
    assert.deepEqual(await f.rows(), before)

    const drift = async (apply, undo) => {
      await pool.query(apply)
      try {
        const prior = await catalog(pool)
        const rowPrior = await f.rows()
        assert.equal((await f.evolve()).state, "invalid_schema")
        assert.deepEqual(await catalog(pool), prior)
        assert.deepEqual(await f.rows(), rowPrior)
        assert.deepEqual(await f.other(), f.otherBefore)
      } finally {
        await pool.query(undo)
      }
    }
    await drift("ALTER TABLE kokoro_bff.bff_message ADD COLUMN unapproved TEXT", "ALTER TABLE kokoro_bff.bff_message DROP COLUMN unapproved")
    await drift(
      "ALTER TABLE kokoro_bff.bff_message ADD CONSTRAINT ck_unapproved CHECK (length(content)>=0)",
      "ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT ck_unapproved",
    )
    await drift("ALTER TABLE kokoro_bff.bff_message ALTER COLUMN content DROP NOT NULL", "ALTER TABLE kokoro_bff.bff_message ALTER COLUMN content SET NOT NULL")
    await drift(
      "ALTER TABLE kokoro_bff.bff_message ALTER COLUMN ordered_parts SET DEFAULT '[]'::jsonb",
      "ALTER TABLE kokoro_bff.bff_message ALTER COLUMN ordered_parts DROP DEFAULT",
    )
    await drift(
      "ALTER TABLE kokoro_bff.bff_message ALTER COLUMN parts_format_version TYPE INTEGER",
      "ALTER TABLE kokoro_bff.bff_message ALTER COLUMN parts_format_version TYPE SMALLINT",
    )
    await drift(
      `ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT ck_bff_message_ordered_parts, ADD ${f.definitions.constraint} NOT VALID`,
      `ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT ck_bff_message_ordered_parts, ADD ${f.definitions.constraint}`,
    )
    await drift(
      `ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT ck_bff_message_ordered_parts, ADD CONSTRAINT ck_bff_message_ordered_parts CHECK (ordered_parts IS NULL OR TRUE)`,
      `ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT ck_bff_message_ordered_parts, ADD ${f.definitions.constraint}`,
    )
    await drift(
      "ALTER TABLE kokoro_bff.bff_message RENAME CONSTRAINT ck_bff_message_ordered_parts TO unexpected_parts_check",
      "ALTER TABLE kokoro_bff.bff_message RENAME CONSTRAINT unexpected_parts_check TO ck_bff_message_ordered_parts",
    )
    await drift("ALTER TABLE kokoro_bff.bff_message ENABLE ROW LEVEL SECURITY", "ALTER TABLE kokoro_bff.bff_message DISABLE ROW LEVEL SECURITY")
    for (const columns of [[f.definitions.columns[0]], f.definitions.columns]) {
      await f.dropParts()
      await pool.query(`ALTER TABLE kokoro_bff.bff_message ${columns.map(({ declaration }) => `ADD COLUMN ${declaration}`).join(", ")}`)
      const partial = await catalog(pool)
      const partialRows = await f.rows()
      assert.equal((await f.evolve()).state, "invalid_schema")
      assert.deepEqual(await catalog(pool), partial)
      assert.deepEqual(await f.rows(), partialRows)
    }
    await f.dropParts()
    const blocker = await pool.connect()
    try {
      await blocker.query("BEGIN; LOCK TABLE kokoro_bff.bff_message IN ACCESS SHARE MODE")
      const unavailable = await f.evolve("apply", { timeoutMs: 500 })
      assert.equal(unavailable.state, "unavailable")
      assert.ok(unavailable.duration_ms < 1500)
    } finally {
      await blocker.query("ROLLBACK")
      blocker.release()
    }
    assert.equal((await f.evolve("check")).state, "update_required")
    const canceled = new AbortController()
    canceled.abort()
    assert.equal((await f.evolve("apply", { signal: canceled.signal })).state, "unavailable")
    assert.equal((await f.evolve("check")).state, "update_required")
    assert.deepEqual(await f.other(), f.otherBefore)
  } finally {
    await f.close()
  }
})

function relayEndpoints(targetUrl) {
  const target = new URL(targetUrl)
  // Capture immutable primitives before the separate client-facing URL is changed.
  return { upstreamHost: target.hostname, upstreamPort: Number(target.port || 5432), proxyUrl: new URL(targetUrl) }
}

test("pure: a relay URL cannot redirect the captured PostgreSQL upstream", () => {
  const endpoints = relayEndpoints("postgres://localhost:5442/kokoro_bff_parts_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?schema=kokoro_bff")
  endpoints.proxyUrl.hostname = "127.0.0.1"
  endpoints.proxyUrl.port = "25000"
  endpoints.proxyUrl.searchParams.set("sslmode", "disable")
  assert.equal(endpoints.upstreamHost, "localhost")
  assert.equal(endpoints.upstreamPort, 5442)
  assert.equal(endpoints.proxyUrl.port, "25000")
})

async function commitAckRelay(targetUrl) {
  const { upstreamHost, upstreamPort, proxyUrl } = relayEndpoints(targetUrl)
  const sockets = new Set()
  let commitSeen = false
  let blockedBytes = 0
  let connections = 0
  let connectionOverflow = false
  let upstreamConnected = false
  let clientPendingBytes = 0
  let backendPendingBytes = 0
  const clientPackets = []
  const backendPackets = []
  const socketErrors = new Set()
  const remember = (list, type, length) => {
    list.push({ type, length })
    if (list.length > 128) list.shift()
  }
  const server = createServer((front) => {
    connections += 1
    if (connections > 1) {
      connectionOverflow = true
      front.destroy()
      return
    }
    const back = connect({ host: upstreamHost, port: upstreamPort })
    sockets.add(front)
    sockets.add(back)
    let pending = Buffer.alloc(0)
    let backendPending = Buffer.alloc(0)
    let startup = true
    let suppress = false
    back.once("connect", () => {
      upstreamConnected = true
    })
    for (const [side, socket] of [
      ["client", front],
      ["backend", back],
    ]) {
      socket.on("error", (error) => {
        const code = typeof error.code === "string" && /^[A-Z0-9_]+$/u.test(error.code) ? error.code : "unknown"
        socketErrors.add(`${side}:${code}`)
        front.destroy()
        back.destroy()
      })
      socket.on("close", () => {
        sockets.delete(socket)
      })
    }
    front.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk])
      clientPendingBytes = pending.length
      while (pending.length >= (startup ? 4 : 5)) {
        const length = pending.readInt32BE(startup ? 0 : 1) + (startup ? 0 : 1)
        if (length < (startup ? 8 : 5) || length > 1048576) {
          remember(clientPackets, "invalid", length)
          front.destroy()
          back.destroy()
          return
        }
        if (pending.length < length) return
        const packet = pending.subarray(0, length)
        pending = pending.subarray(length)
        clientPendingBytes = pending.length
        remember(clientPackets, startup ? "startup" : String.fromCharCode(packet[0]), length)
        if (!startup && packet[0] === 81 && packet.subarray(5).toString("utf8") === "COMMIT\0") {
          suppress = true
          commitSeen = true
        }
        back.write(packet)
        startup = false
      }
    })
    back.on("data", (chunk) => {
      // Diagnostic metadata only: no packet body, SQL, authentication value or URL is recorded.
      backendPending = Buffer.concat([backendPending, chunk])
      backendPendingBytes = backendPending.length
      while (backendPending.length >= 5) {
        const length = backendPending.readInt32BE(1) + 1
        if (length < 5 || length > 1048576) {
          remember(backendPackets, "invalid", length)
          backendPending = Buffer.alloc(0)
          backendPendingBytes = 0
          break
        }
        if (backendPending.length < length) break
        remember(backendPackets, String.fromCharCode(backendPending[0]), length)
        backendPending = backendPending.subarray(length)
        backendPendingBytes = backendPending.length
      }
      if (suppress) blockedBytes += chunk.length
      else front.write(chunk)
    })
    front.on("end", () => back.end())
    back.on("end", () => front.end())
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  proxyUrl.hostname = "127.0.0.1"
  proxyUrl.port = String(address.port)
  proxyUrl.searchParams.set("sslmode", "disable")
  return {
    url: proxyUrl.toString(),
    observed: () => ({
      commitSeen,
      blockedBytes,
      connections,
      connectionOverflow,
      sockets: sockets.size,
      upstreamConnected,
      clientPendingBytes,
      backendPendingBytes,
      clientPackets: [...clientPackets],
      backendPackets: [...backendPackets],
      socketErrors: [...socketErrors].sort(),
    }),
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

async function waitFor(predicate, timeoutMs = 1800) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error("fixture observation deadline exceeded")
}

integration("PG: a real lost COMMIT acknowledgement remains unknown and only a fresh check reconciles", async () => {
  const f = await fixture()
  let relay
  try {
    await f.dropParts()
    relay = await commitAckRelay(databaseUrl)
    let settled = false
    let operation = { state: "pending", code: null }
    const pending = evolveMessagePartsSchema({
      databaseUrl: relay.url,
      mode: "apply",
      timeoutMs: 3000,
    }).then((value) => {
      settled = true
      operation = { state: value.state, code: value.code }
      return value
    })
    try {
      await waitFor(() => {
        const observed = relay.observed()
        assert.equal(observed.connectionOverflow, false, "fixture relay must accept at most one client connection")
        return observed.commitSeen && observed.blockedBytes > 0
      })
    } catch {
      throw new Error(`fixture observation failed; sanitized=${JSON.stringify({ operation, relay: relay.observed() })}`)
    }
    assert.equal(settled, false)
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS count FROM pg_attribute WHERE attrelid='kokoro_bff.bff_message'::regclass AND attname=ANY($1::text[]) AND NOT attisdropped",
          [["ordered_parts", "parts_format_version", "parts_public_sequence"]],
        )
      ).rows[0].count,
      3,
    )
    const unknown = await pending
    assert.equal(unknown.state, "unknown")
    assert.equal(unknown.code, "commit_unknown")
    assert.ok(unknown.duration_ms < 4500)
    assert.equal(relay.observed().connections, 1, "no unknown reapply/reconnect")
    assert.equal((await f.evolve("check")).state, "current")
    assert.deepEqual(await f.other(), f.otherBefore)
  } finally {
    await relay?.close()
    await f.close()
  }
})
