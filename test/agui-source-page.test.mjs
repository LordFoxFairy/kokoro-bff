import assert from "node:assert/strict"
import { describe, it } from "node:test"

import * as agentProjection from "../dist/infrastructure/clients/agent/projection.js"
import { AgUiProjectionService } from "../dist/application/agui/project-session-events.js"

const event = (sequence, overrides = {}) => ({
  chat_event_id: `source_${sequence}`,
  session_id: "session_1",
  run_id: "run_1",
  event_type: sequence === 1 ? "run.started" : "assistant.delta",
  payload_json: sequence === 1 ? '{"status":"running"}' : '{"delta":"hello"}',
  seq: sequence,
  created_at: sequence * 1000,
  ...overrides,
})

describe("Agent event page boundary", () => {
  it("accepts a contiguous partial page and preserves its source snapshot fence", () => {
    assert.equal(typeof agentProjection.agentEventPage, "function")
    assert.deepEqual(
      agentProjection.agentEventPage({
        events: [event(1), event(2)],
        next_seq: 2,
        watermark: 4,
      }, "session_1", 0, 1000),
      {
        events: [event(1), event(2)],
        nextSequence: 2,
        watermark: 4,
        exhausted: false,
      },
    )
  })

  it("accepts an empty page only when the requested source snapshot is exhausted", () => {
    assert.equal(typeof agentProjection.agentEventPage, "function")
    assert.deepEqual(
      agentProjection.agentEventPage({ events: [], next_seq: 4, watermark: 4 }, "session_1", 4, 1000),
      { events: [], nextSequence: 4, watermark: 4, exhausted: true },
    )
    assert.equal(
      agentProjection.agentEventPage({ events: [], next_seq: 4, watermark: 5 }, "session_1", 4, 1000),
      null,
    )
  })

  it("rejects source gaps, backward pages, and pagination fence drift", () => {
    assert.equal(typeof agentProjection.agentEventPage, "function")
    const invalidPages = [
      { events: [event(2)], next_seq: 2, watermark: 2 },
      { events: [event(1), event(2), event(1, { chat_event_id: "source_backwards" })], next_seq: 1, watermark: 2 },
      { events: [event(1)], next_seq: 0, watermark: 1 },
      { events: [event(1)], next_seq: 1, watermark: 0 },
      { events: [event(1)], next_seq: 1 },
      { events: [event(1)], watermark: 1 },
    ]
    for (const page of invalidPages) {
      assert.equal(agentProjection.agentEventPage(page, "session_1", 0, 1000), null)
    }
  })

  it("rejects source identity drift and page overflow", () => {
    assert.equal(typeof agentProjection.agentEventPage, "function")
    assert.equal(
      agentProjection.agentEventPage({
        events: [event(1, { session_id: "session_other" })],
        next_seq: 1,
        watermark: 1,
      }, "session_1", 0, 1000),
      null,
    )
    assert.equal(
      agentProjection.agentEventPage({ events: [event(1), event(2)], next_seq: 2, watermark: 2 }, "session_1", 0, 1),
      null,
    )
  })
})

describe("AG-UI source continuity defense", () => {
  const source = (sequence) => ({
    sourceEventId: `source_${sequence}`,
    sourceSequence: sequence,
    sourceOccurredAt: new Date(sequence * 1000).toISOString(),
    sourcePayload: { seq: sequence },
    event: null,
  })

  it("rejects a source sequence that skips the committed high watermark", async () => {
    const repository = {
      readStream: async () => ({
        version: 0,
        sourceHighWatermark: 0,
        projectionState: { textMessageIds: [], toolCallIds: [] },
      }),
      assertPersistedSources: async () => undefined,
      commitProjection: async () => "committed",
      replay: async () => ({ kind: "page", frames: [], atHead: true, terminalRunId: null }),
      status: async () => ({ sourceHighWatermark: 0, currentCursor: null }),
    }
    const service = new AgUiProjectionService(repository)

    await assert.rejects(
      service.ingest("tenant_1", "session_1", [source(2)]),
      /source sequence is not contiguous/u,
    )
  })

  it("rejects a backward source batch instead of sorting it into validity", async () => {
    const repository = {
      readStream: async () => ({
        version: 0,
        sourceHighWatermark: 0,
        projectionState: { textMessageIds: [], toolCallIds: [] },
      }),
      assertPersistedSources: async () => undefined,
      commitProjection: async () => "committed",
      replay: async () => ({ kind: "page", frames: [], atHead: true, terminalRunId: null }),
      status: async () => ({ sourceHighWatermark: 0, currentCursor: null }),
    }
    const service = new AgUiProjectionService(repository)

    await assert.rejects(
      service.ingest("tenant_1", "session_1", [source(2), source(1)]),
      /source sequence is not contiguous/u,
    )
  })
})
