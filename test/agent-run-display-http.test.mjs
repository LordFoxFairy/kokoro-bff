import assert from "node:assert/strict"
import { createServer } from "node:http"
import { test } from "node:test"
import { createBffServer } from "../src/bootstrap/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
const activityId = `act_${"a".repeat(64)}`
const display = {
  run_id: "run",
  display_skills: [{ source_ref: "skill:pinned", name: "Original package name", virtual_path: "/.skills/cGlubmVk/SKILL.md", revision: "9007199254740993" }],
  tool_paths: [{ activity_id: activityId, virtual_path: "/workspace/results/report.md" }],
  tool_facts: [],
  activity_details: [],
}
async function fixture(t) {
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
  await new Promise((r) => owner.listen(0, "127.0.0.1", r))
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant",
    iamBaseUrl: null,
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
  }
  const admission = new SessionAdmissionDouble({ "display-session": { namespace: "tenant", userId: "subject" } })
  const server = createBffServer(config, {
    businessStore: {
      submittedAgentRuns: {
        readSubmittedAgentRun: async (q) =>
          typeof submitted === "function"
            ? submitted(q)
            : submitted
              ? typeof submitted === "object"
                ? submitted
                : { tenantId: q.tenantId, userId: "subject", runId: q.runId, conversationId: "session" }
              : null,
      },
      services: {
        chat: {
          findConversation: async () => (visible ? { session_id: "session" } : null),
          readRunFinalAnswer: async (q) => {
            finalReads.push(q)
            return typeof finalProof === "function" ? finalProof(q) : finalProof
          },
        },
      },
    },
    readiness: async () => undefined,
    sessionAdmission: admission,
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  t.after(async () => {
    for (const s of [server, owner]) {
      s.closeAllConnections()
      await new Promise((r) => s.close(r))
    }
  })
  const request = async (path = "/v1/sessions/session/runs/run/display", headers = {}, signal) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      signal,
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "test-secret",
        authorization: "Bearer display-session",
        "x-kokoro-request-id": "display-test",
        ...headers,
      },
    })
    return { status: r.status, body: await r.json(), headers: r.headers }
  }
  return {
    request,
    calls,
    finalReads,
    setFinalProof: (v) => (finalProof = v),
    admission,
    setBody: (v) => (ownerBody = v),
    setVisible: (v) => (visible = v),
    setSubmitted: (v) => (submitted = v),
  }
}
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
