import assert from "node:assert/strict"
import { test } from "node:test"
import { createBffServer } from "../src/bootstrap/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

async function fixture(t) {
  const calls = []
  let feedback = null
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant",
    iamBaseUrl: null,
    sharedSecret: "test-secret",
    upstreamSecret: null,
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 65536,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {},
  }
  const admission = new SessionAdmissionDouble({ "feedback-session": { namespace: "tenant", userId: "subject" } })
  const chat = {
    findConversation: async () => ({ conversationId: "session" }),
    readMessageFeedback: async (q) => {
      calls.push(["GET", q])
      return q.messageId === "foreign" ? null : { session_id: q.conversationId, message_id: q.messageId, feedback }
    },
    setMessageFeedback: async (q) => {
      calls.push(["PUT", q])
      if (q.messageId === "foreign") return null
      feedback = q.feedback
      return { session_id: q.conversationId, message_id: q.messageId, feedback }
    },
  }
  const server = createBffServer(config, { businessStore: { services: { chat } }, readiness: async () => undefined, sessionAdmission: admission })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  })
  const request = async (body, path = "/v1/sessions/session/messages/message/feedback", method = body === undefined ? "GET" : "PUT", extra = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "test-secret",
        authorization: "Bearer feedback-session",
        "x-kokoro-request-id": "feedback-test",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  return { request, calls, admission }
}

test("exact assistant feedback GET/PUT is a naturally idempotent preference without command receipts", async (t) => {
  const f = await fixture(t)
  assert.deepEqual((await f.request()).body, { data: { session_id: "session", message_id: "message", feedback: null } })
  for (const feedback of ["up", "up", "down", null, null]) {
    const result = await f.request({ feedback })
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, { data: { session_id: "session", message_id: "message", feedback } })
    assert.equal(result.headers.get("x-request-id"), "feedback-test")
    assert.match(result.headers.get("cache-control"), /no-store/)
  }
  assert.ok(f.calls.every(([, q]) => q.tenantId === "tenant" && q.subjectId === "subject" && q.conversationId === "session" && q.messageId === "message"))
  assert.equal((await f.request(undefined, "/v1/sessions/session/messages/foreign/feedback")).status, 404)
})

test("feedback rejects extra identity, bad rating, duplicate JSON and command headers before persistence", async (t) => {
  const f = await fixture(t)
  for (const body of [{ feedback: "sideways" }, { feedback: "up", subject_id: "foreign" }, {}, { feedback: 1 }, '{"feedback":"up","feedback":"down"}'])
    assert.equal((await f.request(body)).status, 400)
  assert.equal((await f.request({ feedback: "up" }, undefined, "PUT", { "idempotency-key": "not-a-command" })).status, 400)
  assert.equal((await f.request(undefined, "/v1/sessions/session/messages/message/feedback?actor=foreign")).status, 400)
  assert.equal(f.calls.length, 0)
})

test("feedback rechecks current Session after a committed preference and does not fabricate ACK on revocation", async (t) => {
  const f = await fixture(t)
  const verify = f.admission.verify.bind(f.admission)
  f.admission.verify = async (input) => {
    if (f.calls.some(([kind]) => kind === "PUT")) return { ok: false, status: 403, code: "session_forbidden" }
    return verify(input)
  }
  const result = await f.request({ feedback: "up" })
  assert.equal(result.status, 403)
  assert.equal(result.body.data, undefined)
  assert.equal(f.calls.filter(([kind]) => kind === "PUT").length, 1)
})
