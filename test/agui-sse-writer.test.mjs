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
    const writer = new sse.AgUiSseWriter(request, response, {
      maxFrames: 10,
      maxBytes: 64 * 1024,
      maxDurationMs: 50,
    }, () => now)
    now = 151

    assert.deepEqual(await writer.writeFrames([frame(1)]), {
      status: "budget_exhausted",
      lastCursor: null,
      writtenFrames: 0,
    })
    assert.equal(response.writes.length, 0)
  })
})
