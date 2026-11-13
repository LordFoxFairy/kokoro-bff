import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import { test } from "node:test"
import "reflect-metadata"
import { Test } from "@nestjs/testing"
import {
  AGENT_CANCELLATION_DISPATCHER,
  AGENT_DISPATCH_DISPATCHER,
  AGENT_RUNS_READER,
  AGUI_PROJECTOR,
  BFF_CONFIG,
  BFF_DATABASE,
  CHAT_CONVERSATION_LOOKUP,
  CHAT_READABLE_CONVERSATION_LOOKUP,
  RUN_FINAL_ANSWER_LOOKUP,
  SESSION_ADMISSION,
} from "../dist/common/tokens.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../dist/main.js"
import { AgentRunsModule } from "../dist/modules/agent-runs/agent-runs.module.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { ScanState, StorageService } from "../dist/generated/storage-connect/kokoro/storage/v3/storage_pb.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
const activityId = `act_${"a".repeat(64)}`
const display = {
  run_id: "run",
  display_skills: [{ source_ref: "skill:pinned", name: "Original package name", virtual_path: "/.skills/cGlubmVk/SKILL.md", revision: "9007199254740993" }],
  tool_paths: [{ activity_id: activityId, virtual_path: "/workspace/results/report.md" }],
  tool_facts: [],
  activity_details: [],
}
async function fixture(t, storage) {
  const calls = [],
    finalReads = []
  let finalProof = null
  let ownerBody = { data: display, meta: { request_id: "agent-request" } },
    visible = true,
    submitted = true
  const owner = createServer((req, res) => {
    calls.push({ url: req.url, headers: req.headers })
    if (typeof ownerBody === "function") return ownerBody(req, res)
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify(ownerBody))
  })
  t.after(async () => {
    owner.closeAllConnections()
    await new Promise((r) => owner.close(r))
  })
  await new Promise((r) => owner.listen(0, "127.0.0.1", r))
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant",
    iamBaseUrl: null,
    iamWebOrigin: "https://web.example.test",
    sharedSecret: "test-secret",
    upstreamSecret: "owner-service",
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 1048576,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: true,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { agents: `http://127.0.0.1:${owner.address().port}` },
    ...(storage === undefined ? {} : { storage }),
  }
  const admission = new SessionAdmissionDouble({ "display-session": { namespace: "tenant", userId: "subject" } })
  const reader = {
    readSubmittedAgentRun: async (q) =>
      typeof submitted === "function"
        ? submitted(q)
        : submitted
          ? typeof submitted === "object"
            ? submitted
            : { tenantId: q.tenantId, userId: "subject", runId: q.runId, conversationId: "session" }
          : null,
  }
  let conversation = { conversationId: "session", ownerId: "subject", projectRef: null }
  const findConversation = async () => (visible ? conversation : null)
  const readRunFinalAnswer = async (q) => {
    finalReads.push(q)
    return typeof finalProof === "function" ? finalProof(q) : finalProof
  }
  const unexpected = () => assert.fail("Run display fixture must not reach PostgreSQL")
  const builder = Test.createTestingModule({ imports: [AgentRunsModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpected, connect: unexpected }, ready: unexpected })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(admission)
    .overrideProvider(AGENT_RUNS_READER)
    .useValue(reader)
    .overrideProvider(CHAT_CONVERSATION_LOOKUP)
    .useValue(async () => (visible && conversation.ownerId === "subject" ? conversation : null))
    .overrideProvider(CHAT_READABLE_CONVERSATION_LOOKUP)
    .useValue(findConversation)
    .overrideProvider(RUN_FINAL_ANSWER_LOOKUP)
    .useValue(readRunFinalAnswer)
  for (const worker of [AGENT_DISPATCH_DISPATCHER, AGENT_CANCELLATION_DISPATCHER, AGUI_PROJECTOR]) builder.overrideProvider(worker).useValue(null)
  const module = await builder.compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  t.after(async () => {
    app.getHttpServer().closeAllConnections()
    await app.close()
  })
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()
  const request = async (path = "/v1/sessions/session/runs/run/display", headers = {}, signal) => {
    const r = await fetch(`${base}${path}`, {
      signal,
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "test-secret",
        cookie: "kokoro-issuer.session_token=display-session",
        origin: "https://web.example.test",
        "x-kokoro-request-id": "display-test",
        ...headers,
      },
    })
    const downloaded = r.ok && r.headers.has("content-disposition")
    return { status: r.status, body: downloaded ? Buffer.from(await r.arrayBuffer()) : await r.json(), headers: r.headers }
  }
  return {
    request,
    calls,
    finalReads,
    setFinalProof: (v) => (finalProof = v),
    admission,
    setBody: (v) => (ownerBody = v),
    setVisible: (v) => (visible = v),
    setConversation: (v) => (conversation = v),
    setSubmitted: (v) => (submitted = v),
  }
}
test("workspace output bytes require published exact Run version and current Conversation at handoff", async (t) => {
  const bytes = Buffer.from("# Exact original bytes — 测试\n")
  const versionId = `wsv_${"b".repeat(64)}`
  const otherVersionId = `wsv_${"c".repeat(64)}`
  const privateAsset = "asset-private-output"
  const sha = createHash("sha256").update(bytes).digest("hex")
  const output = { version_id: versionId, virtual_path: "/outputs/report.md", content_sha256: sha, size_bytes: bytes.length, mime_type: "text/markdown" }
  const calls = []
  let releaseDuringGet = () => {}
  const connect = connectNodeAdapter({
    routes: (router) =>
      router.service(StorageService, {
        getDownloadReference(req, context) {
          calls.push({
            asset: req.assetId,
            sha: req.contentSha256,
            consumerRunId: req.consumerRunId,
            scope: context.requestHeader.get("x-kokoro-scope-id"),
            kind: context.requestHeader.get("x-kokoro-scope-kind"),
            subject: context.requestHeader.get("x-kokoro-subject-id"),
          })
          return {
            assetId: privateAsset,
            contentSha256: sha,
            sizeBytes: BigInt(bytes.length),
            mimeType: "text/markdown",
            scanState: ScanState.CLEAN,
            downloadReference: { url: origin + "/blob?private_reference=1", method: "GET", expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) } },
          }
        },
      }),
  })
  const server = createServer((request, response) => {
    if (request.url === "/blob?private_reference=1") {
      releaseDuringGet()
      response.writeHead(200, { "content-length": bytes.length }).end(bytes)
    } else connect(request, response)
  })
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const f = await fixture(t, { baseUrl: origin, objectOrigin: origin, secret: "storage-fixture" })
  f.setBody({ data: { ...display, workspace_outputs: [{ ...output, asset_id: privateAsset }] }, meta: { request_id: "agent-request" } })
  const facts = await f.request()
  assert.equal(facts.status, 200)
  assert.deepEqual(facts.body.data.workspace_outputs, [output])
  const content = (version) => `/v1/sessions/session/runs/run/workspace-outputs/${version}/content`
  assert.equal((await f.request(content(otherVersionId))).status, 404)
  assert.deepEqual(calls, [])
  const admissionBeforeDownload = f.admission.calls.length
  const result = await f.request(content(versionId))
  assert.equal(result.status, 200)
  assert.equal(f.admission.calls.length - admissionBeforeDownload, 2)
  assert.deepEqual(result.body, bytes)
  assert.equal(result.headers.get("content-type"), "text/markdown")
  assert.equal(result.headers.get("cache-control"), "no-store")
  assert.equal(result.headers.get("location"), null)
  assert.deepEqual(calls, [{ asset: privateAsset, sha, consumerRunId: "", scope: "session", kind: "conversation", subject: "subject" }])
  f.setConversation({ conversationId: "session", ownerId: "creator", projectRef: "project", projectAccess: { capabilities: ["read", "edit"] } })
  assert.deepEqual((await f.request(content(versionId))).body, bytes, "editor downloads own Run output without creator impersonation")
  releaseDuringGet = () =>
    f.setConversation({ conversationId: "session", ownerId: "creator", projectRef: "project", projectAccess: { capabilities: ["read"] } })
  const late = await f.request(content(versionId))
  assert.equal(late.status, 404)
  assert.equal(late.body.data, undefined)
  assert.equal(calls.length, 3)
})
test("shared Project editor reads only their actual Run; viewer and late downgrade never expose private process", async (t) => {
  const f = await fixture(t)
  const conversation = (role) => ({
    conversationId: "session",
    ownerId: "creator",
    projectRef: "project",
    projectAccess: {
      project_id: "project",
      role,
      expires_at: null,
      access_version: "1",
      capabilities: role === "editor" ? ["read", "edit"] : ["read"],
    },
  })
  const finalId = `msg_${"e".repeat(32)}`
  f.setConversation(conversation("editor"))
  f.setBody({ data: { ...display, final_message_id: finalId }, meta: { request_id: "owner" } })
  f.setFinalProof({ segment_id: finalId, revision: "8" })
  const own = await f.request()
  assert.equal(own.status, 200)
  assert.deepEqual(own.body.data.final_answer, { segment_id: finalId, revision: "8" })
  assert.equal(f.calls[0].headers["x-kokoro-subject-ref"], "subject")
  f.setSubmitted({ tenantId: "tenant", userId: "creator", conversationId: "session", runId: "run" })
  const beforePeer = f.calls.length
  assert.equal((await f.request()).status, 404)
  assert.equal(f.calls.length, beforePeer, "even an editor cannot fetch a peer Run")
  f.setSubmitted(true)
  f.setConversation(conversation("viewer"))
  assert.equal((await f.request()).status, 404)
  assert.equal(f.calls.length, beforePeer, "viewer never reaches the Agent private display")
  f.setConversation(conversation("editor"))
  f.setBody((_req, res) => {
    f.setConversation(conversation("viewer"))
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ data: display, meta: { request_id: "owner" } }))
  })
  const late = await f.request()
  assert.equal(late.status, 404)
  assert.equal(late.body.data, undefined)
})
test("exact owned Run display is an on-demand read of original facts, not current catalog or snapshot enrichment", async (t) => {
  const f = await fixture(t),
    r = await f.request()
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { data: display })
  assert.match(r.headers.get("cache-control"), /no-store/)
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].url, "/v1/runs/run/display")
  assert.equal(f.calls[0].headers.authorization, "Bearer owner-service")
  assert.equal(f.calls[0].headers["x-kokoro-subject-ref"], "subject")
})
test("display denies missing exact Run ownership before Agent I/O and rechecks current Conversation after read", async (t) => {
  const f = await fixture(t)
  f.setSubmitted(false)
  assert.equal((await f.request()).status, 404)
  assert.equal(f.calls.length, 0)
  for (const field of ["tenantId", "userId", "conversationId", "runId"]) {
    f.setSubmitted({ ...{ tenantId: "tenant", userId: "subject", conversationId: "session", runId: "run" }, [field]: "foreign" })
    assert.equal((await f.request()).status, 404)
    assert.equal(f.calls.length, 0)
  }
  f.setSubmitted(true)
  f.setVisible(false)
  assert.equal((await f.request()).status, 404)
  assert.equal(f.calls.length, 0)
  f.setVisible(true)
  const verify = f.admission.verify.bind(f.admission)
  f.admission.verify = async (q) => (f.calls.length ? { ok: false, status: 403, code: "session_forbidden" } : verify(q))
  const r = await f.request()
  assert.equal(r.status, 403)
  assert.equal(r.body.data, undefined)
})
test("display rejects untrusted framing and malformed owner facts without exposing raw data", async (t) => {
  const f = await fixture(t)
  assert.equal((await f.request(undefined, { "idempotency-key": "not-a-command" })).status, 400)
  assert.equal((await f.request("/v1/sessions/session/runs/run/display?actor=other")).status, 400)
  assert.equal(f.calls.length, 0)
  for (const value of [
    { ...display, run_id: "other" },
    { ...display, raw_args: "secret" },
    { ...display, tool_paths: [{ activity_id: activityId, virtual_path: "/workspace/.env" }] },
    { ...display, display_skills: [{ ...display.display_skills[0], revision: null }] },
  ]) {
    f.setBody({ data: value, meta: { request_id: "agent" } })
    const r = await f.request()
    assert.equal(r.status, 502)
    assert.equal(r.body.data, undefined)
  }
})

test("display caller abort retires its actual owner HTTP read and never retries", async (t) => {
  const f = await fixture(t)
  let enter, closed
  const entered = new Promise((r) => (enter = r)),
    ended = new Promise((r) => (closed = r))
  f.setBody((_req, res) => {
    res.once("close", closed)
    enter()
  })
  const controller = new AbortController(),
    pending = f.request(undefined, {}, controller.signal)
  await entered
  controller.abort()
  await assert.rejects(pending)
  await ended
  assert.equal(f.calls.length, 1)
})

test("final current Conversation check follows the immutable Run lookup, so late deletion never exposes private hints", async (t) => {
  const f = await fixture(t)
  f.setSubmitted((q) => {
    if (f.calls.length) f.setVisible(false)
    return { tenantId: q.tenantId, userId: "subject", runId: q.runId, conversationId: "session" }
  })
  const result = await f.request()
  assert.equal(result.status, 404)
  assert.equal(result.body.data, undefined)
})

test("display requires canonical positive revision and exact owner source/activity identifiers, not string minima", async (t) => {
  const f = await fixture(t)
  const candidates = [
    ...["0", "-1", "01", "", " 1", "１", "1\n", "1suffix", "9223372036854775808"].map((revision) => ({
      ...display,
      display_skills: [{ ...display.display_skills[0], revision }],
    })),
    { ...display, display_skills: [{ ...display.display_skills[0], source_ref: "other:pinned" }] },
    { ...display, display_skills: [{ ...display.display_skills[0], source_ref: "skill:pinned\n" }] },
    { ...display, tool_paths: [{ activity_id: `seg_${"a".repeat(64)}`, virtual_path: "/workspace/report.md" }] },
    { ...display, tool_paths: [{ activity_id: activityId + "x", virtual_path: "/workspace/report.md" }] },
    { ...display, tool_paths: [{ activity_id: activityId + "\n", virtual_path: "/workspace/report.md" }] },
  ]
  for (const [index, value] of candidates.entries())
    await t.test(`invalid display domain ${index + 1}`, async () => {
      f.setBody({ data: value, meta: { request_id: "agent" } })
      const r = await f.request()
      assert.equal(r.status, 502)
      assert.equal(r.body.data, undefined)
    })
})

test("exact historical MCP name and individual failed-tool facts are read-only adjuncts, not Run terminal rewrites", async (t) => {
  const f = await fixture(t)
  const facts = [
    { activity_id: `act_${"f".repeat(64)}`, display_detail: { kind: "mcp_tool", name: "ask_question" } },
    { activity_id: activityId, status: "failed" },
    { activity_id: `act_${"b".repeat(64)}`, display_detail: { kind: "mcp_tool", name: "🧭".repeat(120) }, status: "failed" },
  ]
  f.setBody({ data: { ...display, tool_facts: facts }, meta: { request_id: "agent" } })
  const result = await f.request()
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.data.tool_facts, facts)
  assert.deepEqual(result.body.data.display_skills, display.display_skills)
  assert.deepEqual(result.body.data.tool_paths, display.tool_paths)
})

test("Run tool adjuncts reject unproven empty facts, duplicate identities and values outside the existing safe MCP domain", async (t) => {
  const f = await fixture(t)
  const fact = { activity_id: activityId, display_detail: { kind: "mcp_tool", name: "ask_question" } }
  const invalid = [
    ["empty fact", [{ activity_id: activityId }]],
    ["duplicate activity", [fact, { activity_id: activityId, status: "failed" }]],
    ["file kind", [{ ...fact, display_detail: { kind: "file", name: "report.md" } }]],
    ["completed status", [{ activity_id: activityId, status: "completed" }]],
    ["extra path", [{ ...fact, display_detail: { ...fact.display_detail, virtual_path: "/workspace/report.md" } }]],
    ["wrong activity", [{ ...fact, activity_id: `seg_${"a".repeat(64)}` }]],
    ["activity suffix", [{ ...fact, activity_id: activityId + "\n" }]],
    ["blank name", [{ ...fact, display_detail: { kind: "mcp_tool", name: " " } }]],
    ["name scalar cap", [{ ...fact, display_detail: { kind: "mcp_tool", name: "a".repeat(121) } }]],
    ["unpaired scalar", [{ ...fact, display_detail: { kind: "mcp_tool", name: "\ud800" } }]],
    ["name control", [{ ...fact, display_detail: { kind: "mcp_tool", name: "ask\nquestion" } }]],
    ["name normalization", [{ ...fact, display_detail: { kind: "mcp_tool", name: "e\u0301" } }]],
    ["secret name", [{ ...fact, display_detail: { kind: "mcp_tool", name: "credentials" } }]],
    ["array cap", Array.from({ length: 129 }, (_, i) => ({ ...fact, activity_id: `act_${i.toString(16).padStart(64, "0")}` }))],
  ]
  for (const [label, tool_facts] of invalid)
    await t.test(label, async () => {
      f.setBody({ data: { ...display, tool_facts }, meta: { request_id: "agent" } })
      const result = await f.request()
      assert.equal(result.status, 502)
      assert.equal(result.body.data, undefined)
    })
})

test("required tool facts cannot silently fall back to an empty historical collection", async (t) => {
  const f = await fixture(t)
  const { tool_facts, ...legacy } = display
  assert.deepEqual(tool_facts, [])
  f.setBody({ data: legacy, meta: { request_id: "agent" } })
  assert.equal((await f.request()).status, 502)
})

test("real tool selectors containing sk inside a word stay visible, while actual key-prefix positions remain private", async (t) => {
  const f = await fixture(t)
  for (const name of ["ask_question", "task_read", "desk_tool", "1sk_name"]) {
    f.setBody({ data: { ...display, tool_facts: [{ activity_id: activityId, display_detail: { kind: "mcp_tool", name } }] }, meta: { request_id: "agent" } })
    const result = await f.request()
    assert.equal(result.status, 200, name)
    assert.equal(result.body.data.tool_facts[0].display_detail.name, name)
  }
  for (const name of ["sk-token", "sk_token", " sk-token", "/sk_token", ".sk-token", ":sk_token", "_sk-token", "SK-TOKEN", "credentials", "github_pat_token"]) {
    f.setBody({ data: { ...display, tool_facts: [{ activity_id: activityId, display_detail: { kind: "mcp_tool", name } }] }, meta: { request_id: "agent" } })
    assert.equal((await f.request()).status, 502, name)
  }
})

test("private activity details retain exact tools, targets and bounded free-text previews, not a name-only alphabet", async (t) => {
  const f = await fixture(t)
  const details = [
    {
      activity_id: activityId,
      tool_name: "read_file",
      target: { kind: "file", name: "report.md", virtual_path: "/workspace/results/report.md" },
      input_preview: { text: '{\n\t"path": "/workspace/results/report.md"\r\n}', truncated: false, redacted: false },
      output_preview: { text: "<b>literal</b>\ne\u0301\nhttps://example.org/result", truncated: true, redacted: true },
    },
  ]
  f.setBody({ data: { ...display, activity_details: details }, meta: { request_id: "agent" } })
  const result = await f.request()
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.data.activity_details, details)
  assert.equal(f.calls.length, 1)
})

test("private details enforce closed evidence, per-field UTF-8 and target semantics without weakening old display names", async (t) => {
  const f = await fixture(t)
  const detail = { activity_id: activityId, tool_name: "read_file" }
  const preview = (text) => ({ text, truncated: false, redacted: false })
  const invalid = [
    ["missing required collection", undefined],
    ["duplicate identity", [detail, detail]],
    ["wrong identity", [{ ...detail, activity_id: activityId + "\n" }]],
    ["unknown field", [{ ...detail, args: {} }]],
    ["missing tool", [{ activity_id: activityId }]],
    ["tool scalar cap", [{ ...detail, tool_name: "a".repeat(121) }]],
    ["tool control", [{ ...detail, tool_name: "read\nfile" }]],
    ["tool normalization", [{ ...detail, tool_name: "e\u0301" }]],
    ["tool secret", [{ ...detail, tool_name: "credentials" }]],
    ["null target", [{ ...detail, target: null }]],
    ["file basename mismatch", [{ ...detail, target: { kind: "file", name: "other.md", virtual_path: "/workspace/report.md" } }]],
    ["file non-basename", [{ ...detail, target: { kind: "file", name: "../report.md" } }]],
    ["MCP path", [{ ...detail, target: { kind: "mcp_tool", name: "ask_question", virtual_path: "/workspace/report.md" } }]],
    ["host target", [{ ...detail, target: { kind: "file", name: "report.md", virtual_path: "/Users/person/report.md" } }]],
    ["input bytes", [{ ...detail, input_preview: preview("🧭".repeat(513)) }]],
    ["output bytes", [{ ...detail, output_preview: preview("🧭".repeat(1025)) }]],
    ["null preview", [{ ...detail, output_preview: null }]],
    ["empty preview", [{ ...detail, output_preview: preview("") }]],
    ["missing flag", [{ ...detail, output_preview: { text: "result", truncated: false } }]],
    ["nonboolean flag", [{ ...detail, output_preview: { ...preview("result"), redacted: "true" } }]],
    ["unknown preview field", [{ ...detail, output_preview: { ...preview("result"), raw: "value" } }]],
    ...["\ud800", "bad\u0000text", "bad\u202Etext", "Authorization: value", "Traceback (most recent call last)", "/Users/person/file", "sk-test"].map(
      (text) => ["private preview " + JSON.stringify(text), [{ ...detail, output_preview: preview(text) }]],
    ),
    ["array cap", Array.from({ length: 129 }, (_, i) => ({ ...detail, activity_id: `act_${i.toString(16).padStart(64, "0")}` }))],
  ]
  for (const [label, activity_details] of invalid)
    await t.test(label, async () => {
      f.setBody({ data: { ...display, activity_details }, meta: { request_id: "agent" } })
      const r = await f.request()
      assert.equal(r.status, 502)
      assert.equal(r.body.data, undefined)
    })
  const boundary = [{ ...detail, tool_name: "🧭".repeat(120), input_preview: preview("🧭".repeat(512)), output_preview: preview("🧭".repeat(1024)) }]
  f.setBody({ data: { ...display, activity_details: boundary }, meta: { request_id: "agent" } })
  const r = await f.request()
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.data.activity_details, boundary)
})

test("private details remain behind late owned admission and the total owner response cap", async (t) => {
  const f = await fixture(t)
  const detail = { activity_id: activityId, tool_name: "read_file", output_preview: { text: "private result", truncated: false, redacted: false } }
  f.setBody({ data: { ...display, activity_details: [detail] }, meta: { request_id: "agent" } })
  const verify = f.admission.verify.bind(f.admission)
  f.admission.verify = async (q) => (f.calls.length ? { ok: false, status: 403, code: "session_forbidden" } : verify(q))
  const r = await f.request()
  assert.equal(r.status, 403)
  assert.equal(r.body.data, undefined)
  f.admission.verify = verify
  const oversized = Array.from({ length: 128 }, (_, i) => ({
    ...detail,
    activity_id: `act_${i.toString(16).padStart(64, "0")}`,
    target: { kind: "file", name: "report.md", virtual_path: `/workspace/${"a".repeat(4000)}/report.md` },
    input_preview: { text: "a".repeat(2048), truncated: true, redacted: false },
    output_preview: { text: "b".repeat(4096), truncated: true, redacted: false },
  }))
  const oversizedBody = { data: { ...display, activity_details: oversized }, meta: { request_id: "agent" } }
  assert.ok(Buffer.byteLength(JSON.stringify(oversizedBody)) > 1048576)
  f.setBody(oversizedBody)
  assert.equal((await f.request()).status, 502)
})

test("private details share the existing absolute read deadline and retire stalled owner I/O without retry", { timeout: 10000 }, async (t) => {
  const f = await fixture(t)
  let closed
  const ended = new Promise((resolve) => (closed = resolve))
  f.setBody((_req, res) => res.once("close", closed))
  const result = await f.request()
  assert.equal(result.status, 503)
  assert.equal(result.body.data, undefined)
  await ended
  assert.equal(f.calls.length, 1)
})

test("same-Run capability documentation remains private detail, bounded and bound to MCP selectors", async (t) => {
  const f = await fixture(t)
  const description = {
    text: "Read the repository documentation.\nReturns its page structure.",
    truncated: false,
    redacted: false,
  }
  const detail = {
    activity_id: activityId,
    tool_name: "mcp_call",
    target: { kind: "mcp_tool", name: "read_wiki_structure" },
    tool_description: description,
  }
  for (const tool_name of ["mcp_call", "mcp_describe_tool"]) {
    const valid = { ...detail, tool_name }
    f.setBody({
      data: { ...display, activity_details: [valid] },
      meta: { request_id: "agent" },
    })
    const result = await f.request()
    assert.equal(result.status, 200)
    assert.deepEqual(result.body.data.activity_details, [valid])
  }
  for (const invalid of [
    { ...detail, tool_name: "read_file" },
    { ...detail, target: undefined },
    { ...detail, target: { kind: "file", name: "guide.md" } },
    { ...detail, tool_description: null },
    ...["😀".repeat(257), "", "bad\u200btext", "\ud800", "Authorization: token", "https://example.org?token=private"].map((text) => ({
      ...detail,
      tool_description: { ...description, text },
    })),
    { ...detail, tool_description: { ...description, truncated: "false" } },
    { ...detail, tool_description: { text: "guide" } },
  ]) {
    f.setBody({
      data: { ...display, activity_details: [invalid] },
      meta: { request_id: "agent" },
    })
    assert.equal((await f.request()).status, 502, JSON.stringify(invalid))
  }
})

test("legacy owner final identity is exposed only after exact BFF parts binding and final admission", async (t) => {
  const f = await fixture(t)
  const id = `msg_${"d".repeat(32)}`
  f.setBody({ data: { ...display, final_message_id: id }, meta: { request_id: "owner" } })
  f.setFinalProof({ segment_id: id, revision: "9007199254740993" })
  const result = await f.request()
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.data, { ...display, final_answer: { segment_id: id, revision: "9007199254740993" } })
  assert.equal(f.finalReads.length, 1)
  const q = f.finalReads[0]
  assert.deepEqual([q.tenantId, q.subjectId, q.conversationId, q.runId, q.finalMessageId], ["tenant", "subject", "session", "run", id])
  assert.ok(q.signal instanceof AbortSignal)
  assert.ok(Number.isFinite(q.deadlineAt))
  f.setFinalProof(null)
  assert.deepEqual((await f.request()).body.data, display)
  f.setFinalProof(() => {
    f.setVisible(false)
    return { segment_id: id, revision: "9" }
  })
  assert.equal((await f.request()).status, 404)
})
