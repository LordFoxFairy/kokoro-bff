import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { create } from "@bufbuild/protobuf"
import { SkillProductFactsSchema } from "../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { ChatTurnApplicationService } from "../dist/application/chat-turn-service.js"
import { liveChatBusiness } from "../dist/http/routes/chat.js"
import { authorizeUserRequest } from "../dist/auth/user-admission.js"
import { handleChatMessageRequest } from "../dist/http/routes/chat-message-native.js"
import { createServer } from "node:http"
import { once } from "node:events"
import { test, afterEach } from "node:test"
import { handleChatBusinessReadRequest } from "../src/http/routes/chat-business-native.ts"
import { handleChatMutationRequest } from "../dist/http/routes/chat-mutation-native.js"
import { handleMoveSessionRequest } from "../dist/http/routes/move-session-native.js"
import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const servers = []
const config = {
  host: "127.0.0.1",
  port: 0,
  mode: "live",
  domain: "dev.kokoro.localhost",
  tenantId: "tenant",
  iamBaseUrl: null,
  iamWebOrigin: "https://web.example.test",
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
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "secret",
      cookie: "kokoro-issuer.session_token=session",
      origin: "https://web.example.test",
    },
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
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "secret",
      cookie: "kokoro-issuer.session_token=session",
      origin: "https://web.example.test",
    },
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
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "secret",
      cookie: "kokoro-issuer.session_token=session",
      origin: "https://web.example.test",
    },
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

const nativeHeaders = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "secret",
  cookie: "kokoro-issuer.session_token=session",
  origin: "https://web.example.test",
  "content-type": "application/json",
}

test("Chat mutation early authorization, body and Session denials retain exact response association without writes", async () => {
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "owner" } })
  let lookups = 0
  let writes = 0
  const chat = {
    findConversation: async () => {
      lookups++
      return null
    },
    renameConversation: async () => {
      writes++
      throw new Error("unexpected mutation")
    },
  }
  const server = createServer((request, response) => {
    void handleChatMutationRequest(request, response, config, admission, chat, {}, new Map(), null).then((handled) => {
      if (!handled) response.writeHead(404).end()
    })
  })
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  for (const [label, raw, denied, status, code, message] of [
    ["missing", '{"title":"Hidden"}', false, 404, "session_not_found", "Session was not found"],
    ["body", "{", false, 400, "invalid_json", "Request body must be a JSON object"],
    ["session", '{"title":"Hidden"}', true, 401, "session_invalid", "BFF user admission failed"],
  ]) {
    if (denied) admission.deny("session", { ok: false, status: 401, code: "session_invalid" })
    const requestId = `chat-denied-${label}`
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/sessions/conv_missing/title`, {
      method: "PATCH",
      headers: { ...nativeHeaders, "x-request-id": requestId },
      body: raw,
    })
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error: { code, message }, meta: { request_id: requestId } })
    assert.equal(response.headers.get("x-request-id"), requestId)
    assert.equal(response.headers.get("cache-control"), "no-store")
  }
  assert.equal(lookups, 1)
  assert.equal(writes, 0)
})

test("Move Session denial and authentication dependency failure retain request-id without touching the owner", async () => {
  const admission = new SessionAdmissionDouble()
  admission.deny("session", { ok: false, status: 401, code: "session_invalid" })
  let unavailable = false
  let moves = 0
  const provider = {
    verify: async (input) => {
      if (unavailable) throw new Error("SECRET_CANARY")
      return admission.verify(input)
    },
  }
  const server = createServer((request, response) => {
    void handleMoveSessionRequest(request, response, config, provider, {
      moveConversation: async () => {
        moves++
        throw new Error("unexpected move")
      },
    }).then((handled) => {
      if (!handled) response.writeHead(404).end()
    })
  })
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  for (const [dependency, status, code, message] of [
    [false, 401, "session_invalid", "BFF user admission failed"],
    [true, 503, "chat_move_unavailable", "Conversation move is unavailable"],
  ]) {
    unavailable = dependency
    const requestId = `move-denied-${status}`
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/sessions/conv_missing/move`, {
      method: "POST",
      headers: { ...nativeHeaders, "x-request-id": requestId },
      body: '{"target_project_id":null}',
    })
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error: { code, message }, meta: { request_id: requestId } })
    assert.equal(response.headers.get("x-request-id"), requestId)
    assert.equal(response.headers.get("cache-control"), "no-store")
  }
  assert.equal(moves, 0)
})

async function messageBoundaryFixture(t) {
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "owner" } })
  const submissions = [],
    genericCalls = [],
    receipts = new Map()
  let active = true
  const store = {
    ready: async () => undefined,
    close: async () => undefined,
    getReceipt: async (scope) => receipts.get(scope) ?? null,
    claimReceipt: async (scope, fingerprint) => {
      genericCalls.push("claim")
      const receipt = receipts.get(scope)
      if (receipt) return { claimed: false, receipt }
      receipts.set(scope, { fingerprint, status: 102, body: {} })
      return { claimed: true, receipt: null }
    },
    putReceipt: async (scope, receipt) => {
      genericCalls.push("put")
      receipts.set(scope, receipt)
    },
    releaseReceipt: async (scope) => {
      genericCalls.push("release")
      receipts.delete(scope)
    },
  }
  const chatTurns = {
    submit: async (input) => {
      submissions.push(input)
      if (!active) return null
      if (input.content !== "hello") throw new Error("CHAT_TURN_IDEMPOTENCY_CONFLICT")
      return { run_id: "canonical-run", user_message_id: "canonical-user", assistant_message_id: "canonical-assistant" }
    },
  }
  const server = createBffServer(
    { ...config, agUi: DEFAULT_AGUI_CONFIG, agentEnabled: true, upstreams: { agents: "http://agent.invalid" } },
    {
      businessStore: store,
      sessionAdmission: admission,
      chatTurnService: chatTurns,
      chatService: { findConversation: async () => null },
      projectService: { find: async () => null },
      readiness: async () => undefined,
    },
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(async () => {
    server.closeAllConnections()
    await server.shutdown()
  })
  return {
    admission,
    submissions,
    genericCalls,
    receipts,
    setActive(value) {
      active = value
    },
    async post(raw, id, key = "same-intent") {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/sessions/conv_message/messages`, {
        method: "POST",
        headers: { ...nativeHeaders, "x-request-id": id, ...(key ? { "idempotency-key": key } : {}) },
        body: raw,
      })
      return { status: response.status, headers: response.headers, body: await response.json() }
    },
  }
}

test("native Message replay and current scope are decided only by canonical ChatTurn, never a generic HTTP receipt", async (t) => {
  const f = await messageBoundaryFixture(t)
  const results = []
  const raw = '{"content":"hello","selected_skill_source_refs":[]}'
  results.push(await f.post(raw, "message-first"))
  results.push(await f.post(raw, "message-replay"))
  f.setActive(false)
  results.push(await f.post(raw, "message-inactive"))
  f.setActive(true)
  results.push(await f.post('{"content":"changed","selected_skill_source_refs":[]}', "message-conflict"))
  assert.deepEqual(
    results.map(({ status }) => status),
    [202, 202, 404, 409],
  )
  assert.equal(f.submissions.length, 4)
  assert.equal(f.admission.calls.length, 4)
  assert.deepEqual(f.genericCalls, [])
  assert.equal(f.receipts.size, 0)
  for (const [index, id] of ["message-first", "message-replay", "message-inactive", "message-conflict"].entries()) {
    assert.equal(results[index].headers.get("x-request-id"), id)
    assert.equal(results[index].body.meta.request_id, id)
  }
  f.admission.deny("session", { ok: false, status: 401, code: "session_invalid" })
  const revoked = await f.post(raw, "message-revoked")
  assert.equal(revoked.status, 401)
  assert.equal(revoked.body.error.code, "session_invalid")
  assert.equal(revoked.headers.get("x-request-id"), "message-revoked")
  assert.equal(f.submissions.length, 4)
})

test("Message local JSON and byte errors keep400/413 and never claim or submit owner work", async (t) => {
  const f = await messageBoundaryFixture(t)
  const results = [
    await f.post("{", "bad-json"),
    await f.post('{"content":7}', "bad-message"),
    await f.post(JSON.stringify({ content: "x".repeat(1024 * 1024 + 1) }), "oversized-message"),
  ]
  assert.deepEqual(
    results.map(({ status }) => status),
    [400, 400, 413],
  )
  assert.deepEqual(
    results.slice(0, 2).map(({ body }) => body.error.code),
    ["invalid_json", "invalid_message"],
  )
  assert.equal(f.submissions.length, 0)
  assert.deepEqual(f.genericCalls, [])
  for (const [index, id] of ["bad-json", "bad-message", "oversized-message"].entries()) assert.equal(results[index].headers.get("x-request-id"), id)
})

test("legacy and native Message projections retain the same canonical wire and trusted input without generic receipts", async (t) => {
  const native = await messageBoundaryFixture(t)
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "owner" } })
  const calls = [],
    genericMap = new Map()
  const runtime = { ...config, agentEnabled: true, upstreams: { agents: "http://agent.invalid" } }
  const server = createServer(async (request, response) => {
    const admitted = await authorizeUserRequest(request, runtime, admission, "shared-message", new AbortController().signal, response)
    assert.equal(admitted.ok, true)
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const json = JSON.parse(Buffer.concat(chunks).toString())
    await liveChatBusiness(
      request,
      response,
      runtime,
      admitted.context,
      ["sessions", "conv_message", "messages"],
      json,
      null,
      genericMap,
      {
        chatService: {},
        chatTurnService: {
          submit: async (input) => {
            calls.push(input)
            return { run_id: "canonical-run", user_message_id: "canonical-user", assistant_message_id: "canonical-assistant" }
          },
        },
      },
      { ok: true },
    )
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const raw = '{"content":"hello","selected_skill_source_refs":[]}'
  const first = await native.post(raw, "shared-message")
  const second = await fetch(`http://127.0.0.1:${server.address().port}/v1/sessions/conv_message/messages`, {
    method: "POST",
    headers: { ...nativeHeaders, "idempotency-key": "same-intent" },
    body: raw,
  })
  assert.equal(second.status, first.status)
  assert.deepEqual(await second.json(), first.body)
  assert.deepEqual(calls, native.submissions)
  assert.equal(second.headers.get("x-request-id"), "shared-message")
  assert.equal(genericMap.size, 0)
  assert.deepEqual(native.genericCalls, [])
})

test("Message default Skills bind exact installations and a post-read Project loss prevents canonical commit", async (t) => {
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "owner" } })
  const commits = []
  let foreign = false,
    loseProject = false,
    visible = true
  const repository = {
    prepareChatTurnSelection: async () => ({ kind: "new", projectId: "project", installationIds: ["installation"] }),
    commitChatTurn: async (command) => {
      commits.push(command)
      return { run_id: command.runId, user_message_id: command.userMessageId, assistant_message_id: command.assistantMessageId }
    },
  }
  const chatTurns = new ChatTurnApplicationService(repository, { generate: (material) => createHash("sha256").update(material).digest("hex") })
  const stamp = (seconds) => ({ seconds: BigInt(seconds), nanos: 0 })
  const installation = () => ({
    installationId: { value: foreign ? "foreign" : "installation" },
    sourceRef: { value: "skill:version" },
    seriesId: { value: "series" },
    revision: 1n,
    acquisitionKind: 1,
    installed: true,
    enabled: true,
    installedAt: stamp(1),
    updatedAt: stamp(2),
    skillUpdatedAt: stamp(3),
    displayName: "Skill",
    summary: "",
    tags: [],
    sourceStatus: 2,
    examplePrompts: { prompts: [] },
    categoryKeys: { keys: [] },
    product: create(SkillProductFactsSchema, { publicationAudience: "owner", stateVersion: 1n }),
  })
  const projects = {
    find: async (scope, id) => {
      assert.deepEqual(scope, { tenantId: "tenant", subjectId: "owner" })
      assert.equal(id, "project")
      return visible ? { id: "project" } : null
    },
  }
  const installations = {
    get: async (input, signal) => {
      assert.deepEqual(input, { requestId: "skills-message", tenant: "tenant", subject: "owner", projectRef: "project", installationId: "installation" })
      assert.equal(signal.aborted, false)
      if (loseProject) visible = false
      return { installation: installation() }
    },
  }
  const runtime = { ...config, agentEnabled: true, upstreams: { agents: "http://agent.invalid" } }
  const server = createServer((request, response) => {
    void handleChatMessageRequest(request, response, runtime, admission, chatTurns, projects, installations)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const send = () =>
    fetch(`http://127.0.0.1:${server.address().port}/v1/sessions/conv_message/messages`, {
      method: "POST",
      headers: { ...nativeHeaders, "idempotency-key": "skills-key", "x-request-id": "skills-message" },
      body: '{"content":"hello"}',
    })
  const allowed = await send()
  assert.equal(allowed.status, 202)
  await allowed.arrayBuffer()
  assert.equal(commits.length, 1)
  assert.deepEqual(commits[0].payload.launch.selected_skill_source_refs, ["skill:version"])
  assert.deepEqual(commits[0].skillSelection, { projectId: "project", installationIds: ["installation"] })
  foreign = true
  const wrong = await send()
  assert.equal(wrong.status, 400)
  assert.equal((await wrong.json()).error.code, "invalid_skill_selection")
  foreign = false
  loseProject = true
  const withdrawn = await send()
  assert.equal(withdrawn.status, 404)
  assert.equal((await withdrawn.json()).error.code, "project_not_found")
  assert.equal(commits.length, 1)
})
