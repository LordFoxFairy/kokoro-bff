import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { test } from "node:test"
import { handleChatMessageRequest } from "../dist/http/routes/chat-message-native.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const config = {
  host: "127.0.0.1",
  port: 0,
  mode: "live",
  domain: "dev.kokoro.localhost",
  tenantId: "tenant",
  iamBaseUrl: null,
  iamWebOrigin: "https://web.example.test",
  sharedSecret: "test-secret",
  upstreamSecret: null,
  upstreamTimeoutMs: 1000,
  upstreamMaxResponseBytes: 65536,
  schedulerServiceToken: null,
  schedulerTargetUrl: null,
  agentEnabled: true,
  postgresUrl: null,
  redisUrl: null,
  agUi: DEFAULT_AGUI_CONFIG,
  upstreams: { agents: "http://agent.local" },
}

async function listen(server) {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return `http://127.0.0.1:${server.address().port}`
}

test("Chat message POST uses the ChatModule outbox provider and bypasses LegacyRoutes", async (t) => {
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "subject" } })
  const calls = []
  const projects = { find: async () => ({ id: "project-1" }) }
  const chatTurns = {
    submit: async (input) => {
      calls.push(input)
      return { run_id: "run-1", user_message_id: "msg-user", assistant_message_id: "msg-assistant" }
    },
  }
  const server = createServer((request, response) => {
    void handleChatMessageRequest(request, response, config, admission, chatTurns, projects, null).then((handled) => {
      if (!handled && !response.writableEnded) {
        response.writeHead(404)
        response.end()
      }
    })
  })
  const base = await listen(server)
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const response = await fetch(`${base}/v1/sessions/session/messages`, {
    method: "POST",
    headers: {
      cookie: "kokoro-issuer.session_token=session",
      origin: "https://web.example.test",
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      "x-kokoro-request-id": "chat-message-test",
      "idempotency-key": "message-1",
      "content-type": "application/json",
    },
    body: JSON.stringify({ content: "hello", selected_skill_source_refs: [] }),
  })
  assert.equal(response.status, 202)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].content, "hello")
  assert.deepEqual(calls[0].selectedSkillSourceRefs, [])
})
