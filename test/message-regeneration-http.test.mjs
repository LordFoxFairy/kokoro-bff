import assert from "node:assert/strict"
import { test } from "node:test"
import { createBffServer } from "../src/bootstrap/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
async function fixture(t) {
  const calls = []
  const chatTurns = {
    regenerate: async (input) => {
      calls.push(input)
      return { run_id: "new-run", assistant_message_id: "new-answer", user_message_id: "original-question", regenerated_from_message_id: input.sourceMessageId }
    },
  }
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "qa.test",
    tenantId: "tenant",
    iamBaseUrl: null,
    sharedSecret: "secret",
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
  const server = createBffServer(config, {
    businessStore: { services: { chatTurns, chat: { findConversation: async () => ({ conversationId: "session" }) } } },
    readiness: async () => undefined,
    sessionAdmission: new SessionAdmissionDouble({ qa: { namespace: "tenant", userId: "owner" } }),
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  })
  const request = async (body = "{}", headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/sessions/session/messages/old-answer/regenerate`, {
      method: "POST",
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "secret",
        authorization: "Bearer qa",
        "content-type": "application/json",
        "idempotency-key": "new-explicit-regen",
        ...headers,
      },
      body,
    })
    return { status: response.status, body: await response.json() }
  }
  return { calls, request }
}
test("explicit regeneration accepts only a source identity and preserves original user linkage", async (t) => {
  const f = await fixture(t),
    result = await f.request()
  assert.equal(result.status, 202)
  assert.deepEqual(result.body, {
    data: { run_id: "new-run", assistant_message_id: "new-answer", user_message_id: "original-question", regenerated_from_message_id: "old-answer" },
  })
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].subjectId, "owner")
  assert.equal(f.calls[0].sourceMessageId, "old-answer")
  assert.equal(f.calls[0].idempotencyKey, "new-explicit-regen")
  assert.equal(Object.hasOwn(f.calls[0], "content"), false)
})
test("regeneration cannot accept copied prompt, execution choices or actor from the UI", async (t) => {
  const f = await fixture(t)
  for (const body of ['{"content":"copy"}', '{"model":"old"}', '{"subject_id":"other"}', "[]", '{"x":1,"x":2}'])
    assert.equal((await f.request(body)).status, 400)
  assert.equal(f.calls.length, 0)
})
