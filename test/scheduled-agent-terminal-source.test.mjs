import assert from "node:assert/strict"
import test from "node:test"
import { scheduledSourceEventDigest } from "../dist/application/scheduled-source-event-digest.js"
import { classifyScheduledDeliveryStatus } from "../dist/infrastructure/clients/agent/scheduled-dispatch-delivery.js"

test("scheduled source digest binds the unfiltered session event including its run", () => {
  assert.equal(scheduledSourceEventDigest({}), "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a")
  const base = {
    chat_event_id: "e",
    session_id: "scheduled:task",
    run_id: "run_a",
    seq: 1,
    event_type: "activity",
    payload_json: "{}",
    source_index: 0,
    created_at: 1,
  }
  assert.equal(
    scheduledSourceEventDigest({
      payload_json: "{}",
      event_type: "activity",
      seq: 1,
      run_id: "run_a",
      session_id: "scheduled:task",
      chat_event_id: "e",
      created_at: 1,
      source_index: 0,
    }),
    scheduledSourceEventDigest(base),
  )
  assert.equal(scheduledSourceEventDigest({ z: ["狐", { b: 2, a: 1 }], a: true }), scheduledSourceEventDigest({ a: true, z: ["狐", { a: 1, b: 2 }] }))
  assert.throws(() => scheduledSourceEventDigest({ invalid: Number.NaN }), /DIGEST_VALUE_INVALID/)
  assert.throws(() => scheduledSourceEventDigest({ invalid: undefined }), /DIGEST_VALUE_INVALID/)
  assert.notEqual(scheduledSourceEventDigest(base), scheduledSourceEventDigest({ ...base, run_id: "run_b" }))
})

test("scheduled delivery releases the head only for explicit owner 4xx rejection", () => {
  for (const status of [300, 301, 302, 307, 308, 399, 408, 425, 429, 500, 503]) assert.equal(classifyScheduledDeliveryStatus(status), "unknown")
  for (const status of [400, 401, 403, 404, 409, 422]) assert.equal(classifyScheduledDeliveryStatus(status), "not_admitted")
})
