import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseAgentErrorCode, parseLaunchReceipt, parseReplayPage } from "../dist/infrastructure/clients/agent/http-wire.js"

const receipt = { data: { run_id: "run_1", session_id: "session_1", replayed: false }, meta: { request_id: "request_1" } }
const event = {
  chat_event_id: "event_1",
  session_id: "session_1",
  run_id: "run_1",
  source_index: 0,
  event_type: "assistant.completed",
  payload_json: '{"content":""}',
  seq: 1,
  created_at: 0,
}
const page = { data: { events: [event], next_seq: 1, watermark: 1 }, meta: { request_id: "request_1" } }

describe("Agent owner HTTP success envelopes", () => {
  it("accepts only exact 202 launch receipt, including replay marker and meta", () => {
    assert.deepEqual(parseLaunchReceipt(202, receipt), receipt)
    for (const candidate of [
      { ...receipt, meta: undefined },
      { ...receipt, meta: { request_id: "" } },
      { ...receipt, meta: { request_id: "request_1", extra: true } },
      { ...receipt, extra: true },
      { ...receipt, data: { ...receipt.data, replayed: undefined } },
      { ...receipt, data: { ...receipt.data, extra: true } },
      receipt.data,
    ])
      assert.equal(parseLaunchReceipt(202, candidate), null)
    for (const status of [200, 201, 204]) assert.equal(parseLaunchReceipt(status, receipt), null)
  })

  it("trusts only exact owner error envelopes with safe code syntax", () => {
    assert.equal(parseAgentErrorCode({ error: { code: "agent_unavailable", message: "retry" }, meta: { request_id: "request_1" } }), "agent_unavailable")
    for (const body of [
      { error: { code: "agent_unavailable", message: "retry" } },
      { error: { code: "evil\nheader", message: "retry" }, meta: { request_id: "request_1" } },
      { error: { code: "agent_unavailable", message: "retry", extra: true }, meta: { request_id: "request_1" } },
      { error: { code: "agent_unavailable", message: "retry" }, meta: { request_id: "request_1" }, extra: true },
    ])
      assert.equal(parseAgentErrorCode(body), null)
  })

  it("accepts only exact 200 replay page with owner source identity, enum and epoch time", () => {
    assert.deepEqual(parseReplayPage(200, page), page)
    for (const candidate of [
      { ...page, meta: undefined },
      { ...page, meta: { request_id: "request_1", extra: true } },
      { ...page, extra: true },
      { ...page, data: { ...page.data, extra: true } },
      ...[
        { source_index: undefined },
        { source_index: -1 },
        { source_index: "0" },
        { event_type: "unknown" },
        { created_at: "1970-01-01T00:00:00Z" },
        { created_at: -1 },
        { created_at: 1.5 },
        { seq: 0 },
        { extra: true },
      ].map((change) => ({ ...page, data: { ...page.data, events: [{ ...event, ...change }] } })),
      page.data,
    ])
      assert.equal(parseReplayPage(200, candidate), null)
    for (const status of [202, 204]) assert.equal(parseReplayPage(status, page), null)
  })
})
