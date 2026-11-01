import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { test } from "node:test"
import { handleChatMutationRequest } from "../dist/http/routes/chat-mutation-native.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

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

async function listen(server) {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return `http://127.0.0.1:${server.address().port}`
}

test("Chat direct title/share/delete mutations use feature-owned idempotency", async (t) => {
  const calls = []
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "subject" } })
  const chat = {
    findConversation: async () => ({ conversationId: "session" }),
    renameConversation: async (...args) => {
      calls.push(["rename", args])
      return { conversationId: "session" }
    },
    createShare: async (...args) => {
      calls.push(["share", args])
      return { shareId: "share-1" }
    },
    revokeShare: async (...args) => {
      calls.push(["revoke", args])
      return { shareId: "share-1" }
    },
    deleteConversation: async (...args) => {
      calls.push(["delete", args])
      return true
    },
  }
  const entries = new Map()
  const server = createServer((request, response) => {
    void handleChatMutationRequest(request, response, config, admission, chat, entries, null).then((handled) => {
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
  const request = async (path, method, body, key) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: "Bearer session",
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "test-secret",
        "x-kokoro-request-id": "chat-mutation-test",
        "idempotency-key": key,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    return { status: response.status, body: text === "" ? null : JSON.parse(text) }
  }

  assert.equal((await request("/v1/sessions/session/title", "PATCH", { title: "Renamed" }, "title-1")).status, 200)
  assert.equal((await request("/v1/sessions/session/title", "PATCH", { title: "Renamed" }, "title-1")).status, 200)
  assert.equal(calls.filter(([kind]) => kind === "rename").length, 1)
  assert.equal((await request("/v1/sessions/session/share", "POST", undefined, "share-1")).status, 200)
  assert.equal((await request("/v1/sessions/session/share", "DELETE", undefined, "revoke-1")).status, 200)
  assert.equal((await request("/v1/sessions/session", "DELETE", undefined, "delete-1")).status, 200)
  assert.equal((await request("/v1/sessions/session/title?project_ref=project-1", "PATCH", { title: "Scoped" }, "scoped-1")).status, 404)
})
