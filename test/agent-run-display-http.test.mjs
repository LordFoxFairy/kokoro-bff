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
}
async function fixture(t) {
  const calls = []
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
      services: { chat: { findConversation: async () => (visible ? { session_id: "session" } : null) } },
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
  return { request, calls, admission, setBody: (v) => (ownerBody = v), setVisible: (v) => (visible = v), setSubmitted: (v) => (submitted = v) }
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
