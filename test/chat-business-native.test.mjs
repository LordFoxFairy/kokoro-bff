import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { test, afterEach } from "node:test"
import { handleChatBusinessReadRequest } from "../src/http/routes/chat-business-native.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const servers = []
const config = {
  host: "127.0.0.1",
  port: 0,
  mode: "live",
  domain: "dev.kokoro.localhost",
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
  agUi: { ledger: {}, projector: {} },
  upstreams: {},
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

test("Chat business read middleware owns direct collection reads without Project or global store", async () => {
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "owner" } })
  const calls = []
  const chat = {
    listConversations: async (...args) => {
      calls.push(args)
      return { items: [], next_cursor: null }
    },
  }
  const server = createServer((request, response) => {
    void handleChatBusinessReadRequest(request, response, config, admission, chat).then((handled) => {
      if (!handled) {
        response.writeHead(404)
        response.end()
      }
    })
  })
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
    headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "secret", authorization: "Bearer session" },
  })
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).data, { items: [], next_cursor: null })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], "tenant")
  assert.equal(calls[0][1], "owner")
})

test("Chat business read middleware owns project-scoped collection reads with the Project owner", async () => {
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "owner" } })
  const calls = []
  const chat = {
    listConversations: async (...args) => {
      calls.push(["chat", ...args])
      return { items: [], next_cursor: null }
    },
  }
  const projects = {
    find: async (...args) => {
      calls.push(["project", ...args])
      return { id: "project-1" }
    },
  }
  const server = createServer((request, response) => {
    void handleChatBusinessReadRequest(request, response, config, admission, chat, projects).then((handled) => {
      if (!handled) {
        response.writeHead(404)
        response.end()
      }
    })
  })
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/v1/sessions?project_ref=project-1`, {
    headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "secret", authorization: "Bearer session" },
  })
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).data, { items: [], next_cursor: null })
  assert.equal(calls[0][0], "project")
  assert.equal(calls[0][1].tenantId, "tenant")
  assert.equal(calls[0][1].subjectId, "owner")
  assert.equal(calls[0][2], "project-1")
  assert.equal(calls[1][0], "chat")
})

test("Chat business read middleware rechecks the session owner before serving a snapshot", async () => {
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "owner" } })
  const calls = []
  const chat = {
    findConversation: async (...args) => {
      calls.push(["find", ...args])
      return { session_id: "session-1", title: "A", owner_id: "owner", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }
    },
    snapshot: async (...args) => {
      calls.push(["snapshot", ...args])
      return { session: { session_id: "session-1" }, messages: [], files: [], deliveries: [], deliveries_has_more: false, event_watermark: "0" }
    },
  }
  const server = createServer((request, response) => {
    void handleChatBusinessReadRequest(request, response, config, admission, chat).then((handled) => {
      if (!handled) {
        response.writeHead(404)
        response.end()
      }
    })
  })
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/v1/sessions/session-1`, {
    headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "secret", authorization: "Bearer session" },
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.session.session_id, "session-1")
  assert.equal(calls[0][0], "find")
  assert.equal(calls[0][1], "tenant")
  assert.equal(calls[0][2], "owner")
  assert.equal(calls[1][0], "snapshot")
  assert.equal(calls[1][1], "tenant")
  assert.equal(calls[1][2], "owner")
})
