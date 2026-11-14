import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { describe, it } from "node:test"

import * as sse from "../dist/interfaces/http/agui/sse.js"

class RequestFixture extends EventEmitter {
  aborted = false
}

class ResponseFixture extends EventEmitter {
  destroyed = false
  writableEnded = false
  writes = []
  writeResults = []

  write(chunk) {
    this.writes.push(String(chunk))
    return this.writeResults.shift() ?? true
  }
}

const frame = (sequence) => ({
  cursor: `agui_${String(sequence).padStart(32, "0")}`,
  payload: {
    type: "RUN_STARTED",
    threadId: "session_1",
    runId: `run_${sequence}`,
    timestamp: sequence,
  },
})

describe("AG-UI SSE writer", () => {
  it("waits for drain before writing the next frame to a slow reader", async () => {
    assert.equal(typeof sse.AgUiSseWriter, "function")
    const request = new RequestFixture()
    const response = new ResponseFixture()
    response.writeResults.push(false, true)
    const writer = new sse.AgUiSseWriter(request, response, {
      maxFrames: 10,
      maxBytes: 64 * 1024,
      maxDurationMs: 1000,
    })

    let settled = false
    const writing = writer.writeFrames([frame(1), frame(2)]).then((result) => {
      settled = true
      return result
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(response.writes.length, 1)
    assert.equal(settled, false)

    response.emit("drain")
    const result = await writing
    assert.deepEqual(result, {
      status: "written",
      lastCursor: frame(2).cursor,
      writtenFrames: 2,
    })
    assert.equal(response.writes.length, 2)
  })

  it("stops a blocked write when the request is aborted", async () => {
    assert.equal(typeof sse.AgUiSseWriter, "function")
    const request = new RequestFixture()
    const response = new ResponseFixture()
    response.writeResults.push(false, true)
    const writer = new sse.AgUiSseWriter(request, response, {
      maxFrames: 10,
      maxBytes: 64 * 1024,
      maxDurationMs: 1000,
    })

    const writing = writer.writeFrames([frame(1), frame(2)])
    await new Promise((resolve) => setImmediate(resolve))
    request.aborted = true
    request.emit("aborted")

    assert.deepEqual(await writing, {
      status: "aborted",
      lastCursor: frame(1).cursor,
      writtenFrames: 1,
    })
    assert.equal(response.writes.length, 1)
  })

  it("retires a backpressured transport on its signal without leaking listeners or writing the next frame", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 })
    const request = new RequestFixture()
    const response = new ResponseFixture()
    const transport = new AbortController()
    response.writeResults.push(false, true)
    const writer = new sse.AgUiSseWriter(
      request,
      response,
      {
        maxFrames: 10,
        maxBytes: 64 * 1024,
        maxDurationMs: 1000,
      },
      Date.now,
      transport.signal,
    )

    let settled = false
    const writing = writer.writeFrames([frame(1), frame(2)]).then((result) => {
      settled = true
      return result
    })
    try {
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(response.listenerCount("drain"), 1, "the write really reached backpressure")
      transport.abort()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(Date.now(), 1000, "the stream duration and its timer have not advanced")
      assert.equal(settled, true, "transport retirement must wake the write before the duration timer fires")
      assert.deepEqual(await writing, {
        status: "aborted",
        lastCursor: frame(1).cursor,
        writtenFrames: 1,
      })
      assert.equal(response.writes.length, 1)
      assert.equal(request.listenerCount("aborted"), 0)
      for (const event of ["close", "error", "drain"]) assert.equal(response.listenerCount(event), 0)
      assert.deepEqual(await writer.writeFrames([frame(2)]), { status: "aborted", lastCursor: null, writtenFrames: 0 })
      assert.equal(response.writes.length, 1, "a retired transport never accepts a later frame")
    } finally {
      request.aborted = true
      request.emit("aborted")
      await Promise.allSettled([writing])
    }
  })

  it("bounds one connection by frame count and serialized bytes", async () => {
    assert.equal(typeof sse.AgUiSseWriter, "function")
    const request = new RequestFixture()
    const response = new ResponseFixture()
    const firstFrameBytes = Buffer.byteLength(sse.agUiSseFrame(frame(1).payload, frame(1).cursor))
    const writer = new sse.AgUiSseWriter(request, response, {
      maxFrames: 1,
      maxBytes: firstFrameBytes,
      maxDurationMs: 1000,
    })

    assert.deepEqual(await writer.writeFrames([frame(1), frame(2)]), {
      status: "budget_exhausted",
      lastCursor: frame(1).cursor,
      writtenFrames: 1,
    })
    assert.equal(response.writes.length, 1)
    assert.deepEqual(await writer.writeFrames([frame(2)]), {
      status: "budget_exhausted",
      lastCursor: null,
      writtenFrames: 0,
    })
    assert.equal(response.writes.length, 1)
  })

  it("ends writes when the stream duration budget expires", async () => {
    assert.equal(typeof sse.AgUiSseWriter, "function")
    let now = 100
    const request = new RequestFixture()
    const response = new ResponseFixture()
    const writer = new sse.AgUiSseWriter(
      request,
      response,
      {
        maxFrames: 10,
        maxBytes: 64 * 1024,
        maxDurationMs: 50,
      },
      () => now,
    )
    now = 151

    assert.deepEqual(await writer.writeFrames([frame(1)]), {
      status: "budget_exhausted",
      lastCursor: null,
      writtenFrames: 0,
    })
    assert.equal(response.writes.length, 0)
  })
})

it("one cached Project ledger changes from sender-private to reader-safe and rejects a revoked reader before sending", async () => {
  const { liveAgentSessionEvents } = await import("../src/http/routes/agent.ts")
  const { AgUiReplayCoordinator } = await import("../src/application/agui/session-runtime.ts")
  let loads = 0
  const metadata = {
    kokoro: { event_id: "event", seq: 1, session_id: "session_1", run_id: "run_1", timestamp: "2026-11-13T00:00:00.000Z", public_sequence: "1" },
  }
  const page = {
    kind: "page",
    atHead: true,
    terminalRunId: "run_1",
    frames: [
      {
        publicSequence: 1,
        cursor: "agui_" + "1".repeat(32),
        eventType: "TEXT_MESSAGE_CONTENT",
        sourceSubjectId: "sender",
        payload: { type: "TEXT_MESSAGE_CONTENT", messageId: "private", delta: "peer-private-trace", metadata },
      },
      {
        publicSequence: 2,
        cursor: "agui_" + "2".repeat(32),
        eventType: "RUN_FINISHED",
        sourceSubjectId: "sender",
        payload: {
          type: "RUN_FINISHED",
          threadId: "session_1",
          runId: "run_1",
          status: "completed",
          outcome: { type: "success" },
          usage: [{ private_funds: "private-funds" }],
          metadata: { kokoro: { ...metadata.kokoro, public_sequence: "2" } },
        },
      },
    ],
  }
  const runtime = {
    connections: { acquire: () => ({ release() {} }), sessionCount: () => 0 },
    replays: new AgUiReplayCoordinator({ cacheTtlMs: 60000 }),
    ledgerWaits: { clear() {} },
  }
  const projection = {
    replay: async () => {
      loads++
      return page
    },
  }
  const invoke = async (subject, allowed) => {
    const request = Object.assign(new EventEmitter(), { headers: {}, aborted: false })
    const response = Object.assign(new EventEmitter(), {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writes: [],
      statusCode: 200,
      setHeader() {},
      writeHead(status) {
        this.statusCode = status
        this.headersSent = true
      },
      write(chunk) {
        this.writes.push(String(chunk))
        return true
      },
      end(chunk) {
        if (chunk) this.writes.push(String(chunk))
        this.writableEnded = true
      },
    })
    await liveAgentSessionEvents(
      request,
      response,
      { agUi: { streamMaxFrames: 10, streamMaxBytes: 65536, streamMaxDurationMs: 1000, replayPageFrames: 10, replayPageBytes: 65536 } },
      { requestId: "request", identity: { namespace: "tenant", userId: subject } },
      "session_1",
      projection,
      true,
      runtime,
      new AbortController().signal,
      { sharedProject: true, authorize: async () => (allowed ? { ok: true, canEdit: true } : false) },
    )
    return { status: response.statusCode, body: response.writes.join("") }
  }
  assert.match((await invoke("sender", true)).body, /peer-private-trace/u)
  const reader = await invoke("reader", true)
  assert.equal(reader.status, 200)
  assert.doesNotMatch(reader.body, /peer-private-trace|private-funds|TEXT_MESSAGE_CONTENT/u)
  assert.match(reader.body, /RUN_FINISHED/u)
  const revoked = await invoke("reader", false)
  assert.equal(revoked.status, 404)
  assert.doesNotMatch(revoked.body, /RUN_FINISHED|peer-private-trace/u)
  assert.equal(page.frames[0].payload.metadata.kokoro.can_control, undefined, "per-reader projection never mutates cached source bytes")
  assert.equal(loads, 1, "cached bytes are never cached authorization or reader-specific projection")
})

it("safe peer ERROR retains the verified owner failure profile and current read-only fact without the private diagnostic", async () => {
  const { projectReaderAgUiFrames } = await import("../src/application/agui/project-session-events.ts")
  const { projectChatEvent, createAgUiProjectionState } = await import("../src/application/agui/project-chat-event.ts")
  const [payload] = projectChatEvent(
    {
      event_id: "error",
      seq: 1,
      session_id: "session",
      run_id: "run",
      timestamp: "2026-11-13T00:00:00.000Z",
      kind: "run.failed",
      payload: { failure: { source: "agent", code: "model_unavailable", retryable: true }, message: "private diagnostic" },
    },
    createAgUiProjectionState(),
  )
  const input = {
    publicSequence: 1,
    cursor: "agui_" + "1".repeat(32),
    eventType: "RUN_ERROR",
    sourceSubjectId: "sender",
    payload: { ...payload, metadata: { kokoro: { ...payload.metadata.kokoro, public_sequence: "1" } } },
  }
  const [result] = projectReaderAgUiFrames([input], "reader", true)
  assert.deepEqual(result.payload.metadata.kokoro.failure, { source: "agent", code: "model_unavailable", retryable: true })
  assert.equal(result.payload.metadata.kokoro.can_control, false)
  assert.equal(result.payload.code, "model_unavailable")
  assert.equal(result.payload.message, "Agent run failed")
  assert.equal(result.payload.threadId, "session")
  assert.equal(result.payload.runId, "run")
  const downgrade = projectReaderAgUiFrames([input], "sender", false)
  assert.equal(downgrade[0].payload.metadata.kokoro.can_control, false)
  assert.throws(() => projectReaderAgUiFrames([{ ...input, payload: { ...input.payload, code: "unverified" } }], "reader", true), {
    name: "AgUiSourceContractError",
  })
})
