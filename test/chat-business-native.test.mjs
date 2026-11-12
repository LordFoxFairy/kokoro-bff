import "reflect-metadata"
import { Test } from "@nestjs/testing"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { create } from "@bufbuild/protobuf"
import { SkillProductFactsSchema } from "../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { ChatTurnApplicationService } from "../dist/application/chat-turn-service.js"
import { handleChatMessageRequest } from "../dist/http/routes/chat-message-native.js"
import { createServer } from "node:http"
import { once } from "node:events"
import { test, afterEach } from "node:test"
import { handleChatBusinessReadRequest } from "../src/http/routes/chat-business-native.ts"
import { handleChatMutationRequest } from "../dist/http/routes/chat-mutation-native.js"
import { requestBodyJson } from "../dist/http/request.js"
import { handleMoveSessionRequest } from "../dist/http/routes/move-session-native.js"
import {
  AGENT_CANCELLATION_DISPATCHER,
  AGENT_DISPATCH_DISPATCHER,
  AGUI_PROJECTOR,
  BFF_CONFIG,
  BFF_DATABASE,
  CHAT_IDEMPOTENCY,
  CHAT_CONVERSATION_LOOKUP,
  CHAT_TURN_SERVICE,
  CHAT_SESSION_MUTATIONS,
  PROJECT_LOOKUP,
  SESSION_ADMISSION,
} from "../dist/common/tokens.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../dist/main.js"
import { ChatModule } from "../dist/modules/chat/chat.module.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const unexpectedConversation = () => assert.fail("Collection or rejected requests must not read a Conversation")
const unexpectedProcess = () => assert.fail("Non-process Chat reads must not use the AG-UI process reader")
const unexpectedProjects = { find: () => assert.fail("Unscoped Chat reads must not access the Project owner") }
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
    void handleChatBusinessReadRequest(request, response, config, admission, chat, unexpectedConversation, unexpectedProjects, unexpectedProcess).then(
      (handled) => {
        if (!handled) {
          response.writeHead(404)
          response.end()
        }
      },
    )
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
    void handleChatBusinessReadRequest(request, response, config, admission, chat, unexpectedConversation, projects, unexpectedProcess).then((handled) => {
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
    void handleChatBusinessReadRequest(request, response, config, admission, chat, chat.findConversation, unexpectedProjects, unexpectedProcess).then(
      (handled) => {
        if (!handled) {
          response.writeHead(404)
          response.end()
        }
      },
    )
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
    void handleChatMutationRequest(request, response, config, admission, chat, chat.findConversation, {}, new Map(), null).then((handled) => {
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
    void handleMoveSessionRequest(request, response, config, provider, async () => {
      moves++
      throw new Error("unexpected move")
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

async function messageBoundaryFixture(t, overrides = {}) {
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "owner" } })
  const submissions = [],
    genericCalls = [],
    receipts = new Map()
  let active = true
  const chatIdempotency = {
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
  const builder = Test.createTestingModule({ imports: [ChatModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue({ ...config, agUi: DEFAULT_AGUI_CONFIG, agentEnabled: true, upstreams: { agents: "http://agent.invalid" } })
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: Object.freeze({}), redis: Object.freeze({}) })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(admission)
    .overrideProvider(CHAT_CONVERSATION_LOOKUP)
    .useValue(overrides.findConversation ?? (() => assert.fail("Canonical Message admission must not query an unlocked Conversation")))
    .overrideProvider(PROJECT_LOOKUP)
    .useValue({ find: async () => null })
    .overrideProvider(CHAT_TURN_SERVICE)
    .useValue(chatTurns)
    .overrideProvider(CHAT_IDEMPOTENCY)
    .useValue(chatIdempotency)
  if (overrides.mutations !== undefined) builder.overrideProvider(CHAT_SESSION_MUTATIONS).useValue(overrides.mutations)
  for (const token of [AGENT_DISPATCH_DISPATCHER, AGENT_CANCELLATION_DISPATCHER, AGUI_PROJECTOR]) {
    builder.overrideProvider(token).useValue(null)
  }
  const module = await builder.compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, logger: false })
  t.after(() => app.close())
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()
  return {
    base,
    admission,
    submissions,
    genericCalls,
    receipts,
    setActive(value) {
      active = value
    },
    async post(raw, id, key = "same-intent") {
      const response = await fetch(`${base}/v1/sessions/conv_message/messages`, {
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

test("native Message submission returns canonical wire and passes the trusted input without generic receipts", async (t) => {
  const f = await messageBoundaryFixture(t)
  const requestId = "shared-message"
  const result = await f.post('{"content":"hello","selected_skill_source_refs":[]}', requestId)
  assert.equal(result.status, 202)
  assert.deepEqual(result.body, {
    data: { run_id: "canonical-run", user_message_id: "canonical-user", assistant_message_id: "canonical-assistant" },
    meta: { request_id: requestId },
  })
  assert.deepEqual(f.submissions, [
    {
      tenantId: "tenant",
      conversationId: "conv_message",
      content: "hello",
      selectedSkillSourceRefs: [],
      subjectId: "owner",
      actorId: "owner",
      requestId,
      idempotencyKey: "same-intent",
    },
  ])
  assert.equal(result.headers.get("x-request-id"), requestId)
  assert.deepEqual(f.genericCalls, [])
  assert.equal(f.receipts.size, 0)
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

test("native title writes reject damaged UTF-8 before receipts while preserving literal replacement characters", async (t) => {
  const titles = []
  const f = await messageBoundaryFixture(t, {
    findConversation: async () => ({ conversationId: "conv_utf8", ownerId: "owner", tenantId: "tenant", projectRef: null }),
    mutations: {
      renameConversation: async (_tenant, _subject, _id, title) => {
        titles.push(title)
        return { conversationId: "conv_utf8" }
      },
    },
  })
  const patch = async (bytes, key) => {
    const response = await fetch(`${f.base}/v1/sessions/conv_utf8/title`, {
      method: "PATCH",
      headers: { ...nativeHeaders, "idempotency-key": key, "x-request-id": key },
      body: bytes,
    })
    return { status: response.status, headers: response.headers, body: await response.json() }
  }
  const valid = await patch(Buffer.from('{"title":"A�"}', "utf8"), "utf8-literal")
  assert.equal(valid.status, 200)
  assert.deepEqual(titles, ["A�"])
  const receiptBefore = JSON.stringify([...f.receipts])
  const callsBefore = [...f.genericCalls]
  for (const [label, bytes] of [
    ["invalid-byte", Buffer.concat([Buffer.from('{"title":"A'), Buffer.from([0xff]), Buffer.from('"}')])],
    ["truncated", Buffer.concat([Buffer.from('{"title":"A'), Buffer.from([0xe2, 0x82]), Buffer.from('"}')])],
    ["bom", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"title":"B"}')])],
  ]) {
    const result = await patch(bytes, `utf8-${label}`)
    assert.equal(result.status, 400, label)
    assert.equal(result.body.error.code, "invalid_json", label)
    assert.equal(result.headers.get("x-request-id"), `utf8-${label}`)
    assert.deepEqual(titles, ["A�"], "rejected wire bytes cannot change the title")
    assert.deepEqual(f.genericCalls, callsBefore, "rejected wire bytes cannot claim or complete receipts")
    assert.equal(JSON.stringify([...f.receipts]), receiptBefore)
  }
})

test("shared JSON decoding retains empty, multipart, object and duplicate-key policies", () => {
  const request = { method: "POST", url: "/v1/sessions", headers: { "content-type": "application/json" } }
  assert.deepEqual(requestBodyJson(request, Buffer.alloc(0)), {})
  assert.deepEqual(requestBodyJson({ ...request, headers: { "content-type": "multipart/form-data; boundary=x" } }, Buffer.from([0xff])), {})
  assert.equal(requestBodyJson(request, Buffer.from("[]")), null)
  assert.deepEqual(requestBodyJson(request, Buffer.from('{"title":"first","title":"last"}')), { title: "last" })
})

test("Session Share metadata GET uses native admission and returns read-only current metadata", async () => {
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "owner" } })
  const calls = []
  const chat = {
    readShareMetadata: async (query) => {
      calls.push(query)
      return { share: { share_id: "shr_current", created_at: "2026-11-12T00:00:00.000Z", expires_at: null } }
    },
  }
  const server = createServer((request, response) => {
    void handleChatBusinessReadRequest(request, response, config, admission, chat, unexpectedConversation, unexpectedProjects, unexpectedProcess).then(
      (handled) => {
        if (!handled) response.writeHead(404).end()
      },
    )
  })
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/sessions/session-1/share`, {
    headers: { ...nativeHeaders, "x-request-id": "share-read" },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    data: { share: { share_id: "shr_current", created_at: "2026-11-12T00:00:00.000Z", expires_at: null } },
    meta: { request_id: "share-read" },
  })
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("x-request-id"), "share-read")
  assert.equal(calls.length, 1)
  assert.equal(calls[0].tenantId, "tenant")
  assert.equal(calls[0].subjectId, "owner")
  assert.equal(calls[0].conversationId, "session-1")
  assert.equal(calls[0].scope, "all")
  assert.ok(calls[0].signal instanceof AbortSignal)
  assert.ok(calls[0].deadlineAt > performance.now())
})

test("Session Share metadata retains null vs inaccessible and rejects Session or contradictory scope before owner reads", async () => {
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "owner" } })
  let result = { share: null },
    reads = 0
  const chat = {
    readShareMetadata: async () => {
      reads++
      return result
    },
  }
  const server = createServer((request, response) => {
    void handleChatBusinessReadRequest(request, response, config, admission, chat, unexpectedConversation, unexpectedProjects, unexpectedProcess).then(
      (handled) => {
        if (!handled) response.writeHead(404).end()
      },
    )
  })
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const url = `http://127.0.0.1:${server.address().port}/v1/sessions/session-1/share`
  const unshared = await fetch(url, { headers: nativeHeaders })
  assert.equal(unshared.status, 200)
  assert.deepEqual((await unshared.json()).data, { share: null })
  result = null
  const unavailable = await fetch(url + "?project_ref=unowned", { headers: nativeHeaders })
  assert.equal(unavailable.status, 404)
  assert.equal((await unavailable.json()).error.code, "session_not_found")
  const invalid = await fetch(url + "?scope=direct&project_ref=project-1", { headers: nativeHeaders })
  assert.equal(invalid.status, 400)
  const denied = await fetch(url, { headers: { ...nativeHeaders, cookie: "kokoro-issuer.session_token=retired", authorization: "Bearer unrelated" } })
  assert.equal(denied.status, 401)
  assert.equal(reads, 2)
})

test("Session Share metadata carries one admission lifetime into the bounded read and retires it on timeout", async () => {
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "owner" } })
  let readSignal, remaining
  const chat = {
    readShareMetadata: (query) =>
      new Promise((resolve, reject) => {
        readSignal = query.signal
        remaining = query.deadlineAt - performance.now()
        const stop = () => reject(new Error("owned read retired"))
        if (query.signal.aborted) stop()
        else query.signal.addEventListener("abort", stop, { once: true })
      }),
  }
  const server = createServer((request, response) => {
    void handleChatBusinessReadRequest(
      request,
      response,
      { ...config, upstreamTimeoutMs: 60 },
      admission,
      chat,
      unexpectedConversation,
      unexpectedProjects,
      unexpectedProcess,
    )
  })
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/sessions/session-1/share`, { headers: nativeHeaders })
  assert.equal(response.status, 503)
  assert.equal(readSignal, admission.calls[0].signal)
  assert.equal(readSignal.aborted, true)
  assert.ok(remaining > 0 && remaining <= 60)
  assert.equal(admission.calls.length, 1)
})
