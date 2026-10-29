import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import { PostgresAgUiProjectionRepository } from "../src/infrastructure/postgres/agui-projection-repository.ts"
import { agUiSseFrame, AgUiSseWriter } from "../src/interfaces/http/agui/sse.ts"

const source = (extra = {}) => ({ event_id: "source_4", seq: 4, session_id: "session_1", run_id: "run_1", timestamp: "2026-01-01T00:00:04.000Z", ...extra })
const event = (kokoro = source()) => ({ type: "RUN_STARTED", threadId: "session_1", runId: "run_1", timestamp: 4000, metadata: { kokoro } })
const row = (publicSequence, payload = event()) => ({
  head_identity_valid: true,
  cursor_valid: true,
  cursor_expired: false,
  after_sequence: "0",
  head_sequence: "8",
  terminal_run_id: null,
  public_sequence: publicSequence,
  cursor: `agui_${publicSequence.padStart(32, "0")}`,
  event_type: payload.type,
  event_payload: payload,
})
const replay = (rows) => new PostgresAgUiProjectionRepository({ pool: { query: async () => ({ rows }) } }).replay("tenant_1", "session_1", null, 10, 4096)

test("replay decorates each durable frame with its own ledger position, preserving source identity and raw JSON", async () => {
  const payload = event()
  Object.freeze(payload.metadata.kokoro)
  Object.freeze(payload.metadata)
  Object.freeze(payload)
  const page = await replay([row("7", payload), row("8", payload)])
  assert.equal(page.kind, "page")
  assert.deepEqual(
    page.frames.map((frame) => frame.payload.metadata.kokoro.public_sequence),
    ["7", "8"],
  )
  assert.deepEqual(
    page.frames.map((frame) => frame.payload.metadata.kokoro.seq),
    [4, 4],
  )
  assert.equal(Object.hasOwn(payload.metadata.kokoro, "public_sequence"), false)
  assert.notEqual(page.frames[0].payload.metadata, payload.metadata)
  assert.equal(page.frames[0].cursor, "agui_00000000000000000000000000000007")
})

test("BFF queued/dispatch string source coordinates remain separate from decimal public positions", async () => {
  const page = await replay([row("8", event(source({ seq: "2", source_owner: "kokoro-bff" })))])
  assert.deepEqual(page.frames[0].payload.metadata.kokoro, { ...source({ seq: "2", source_owner: "kokoro-bff" }), public_sequence: "8" })
})

test("replay rejects malformed owner metadata rather than guessing a source or public coordinate", async () => {
  for (const kokoro of [
    { ...source(), seq: undefined },
    { ...source(), seq: "4" },
    { ...source(), source_owner: "kokoro-bff" },
    { ...source(), seq: "2", source_owner: "agent" },
    { ...source(), private_token: "not-public" },
    { ...source(), public_sequence: "7" },
    { ...source(), failure: { source: "agent", code: "internal_error", retryable: true } },
  ])
    await assert.rejects(replay([row("8", event(kokoro))]), /AGUI_REPLAY_METADATA_INVALID/u)
  for (const payload of [{ type: "RUN_STARTED" }, { ...event(), metadata: { kokoro: source(), private_payload: "not-public" } }])
    await assert.rejects(replay([row("8", payload)]), /AGUI_REPLAY_METADATA_INVALID/u)
  for (const sequence of ["0", "01", "-1", "1\n", "9007199254740993", "9223372036854775808"]) {
    await assert.rejects(replay([row(sequence)]), /AGUI_REPLAY_METADATA_INVALID|public sequence is invalid/u)
  }
})

test("AG-UI EventSchemas and SSE encoder preserve the authoritative field, and writer counts its actual bytes", async () => {
  const page = await replay([row("8")])
  const frame = page.frames[0]
  const encoded = agUiSseFrame(frame.payload, frame.cursor)
  const decoded = JSON.parse(encoded.split("\ndata: ")[1].trim())
  assert.equal(decoded.metadata.kokoro.public_sequence, "8")
  assert.equal(decoded.metadata.kokoro.seq, 4)
  const request = Object.assign(new EventEmitter(), { aborted: false })
  const writes = []
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    write: (chunk) => {
      writes.push(chunk)
      return true
    },
  })
  const writer = new AgUiSseWriter(request, response, { maxFrames: 2, maxBytes: Buffer.byteLength(encoded) - 1, maxDurationMs: 1000 })
  assert.deepEqual(await writer.writeFrames([frame]), { status: "budget_exhausted", lastCursor: null, writtenFrames: 0 })
  assert.deepEqual(writes, [])
})

test("pure replay payload preserves full decimal precision and the existing Agent failure profile", async () => {
  const { agUiReplayPayload } = await import("../src/infrastructure/postgres/agui-replay-payload.ts")
  const payload = event(source({ failure: { source: "agent", code: "model_unavailable", retryable: true } }))
  const projected = agUiReplayPayload(payload, "9223372036854775807", "RUN_STARTED")
  assert.equal(projected.metadata.kokoro.public_sequence, "9223372036854775807")
  assert.deepEqual(projected.metadata.kokoro.failure, payload.metadata.kokoro.failure)
  for (const value of ["0", "01", "-1", "1\n", "9223372036854775808"])
    assert.throws(() => agUiReplayPayload(payload, value, "RUN_STARTED"), /AGUI_REPLAY_METADATA_INVALID/u)
  assert.equal(agUiReplayPayload(event(source({ run_id: null })), "8", "RUN_STARTED").metadata.kokoro.run_id, null)
  assert.deepEqual(agUiReplayPayload(event(source({ public_sequence: "8" })), "8", "RUN_STARTED"), event(source({ public_sequence: "8" })))
  assert.throws(
    () => agUiReplayPayload(event(source({ seq: "2", source_owner: "kokoro-bff", run_id: null })), "8", "RUN_STARTED"),
    /AGUI_REPLAY_METADATA_INVALID/u,
  )
  assert.throws(() => agUiReplayPayload(payload, "8", "CUSTOM"), /AGUI_REPLAY_METADATA_INVALID/u)
})
