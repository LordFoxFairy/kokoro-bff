import assert from "node:assert/strict"
import { test } from "node:test"
import { createBffServer } from "../src/bootstrap/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
const headers = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
  authorization: "Bearer pin-session",
  "x-kokoro-request-id": "pin-test",
}
async function fixture(t) {
  const calls = []
  let saved = null
  const projects = {
    listPins: async (q) => {
      calls.push(["read", q])
      return q.projectId === "foreign" ? null : { items: saved ? [saved] : [], nextPosition: null }
    },
    setPin: async (q) => {
      calls.push(["write", q])
      if (q.projectId === "foreign") return null
      if (q.isPinned) saved ??= { projectId: q.projectId, pinnedAt: new Date("2026-10-27T00:00:00.000Z") }
      else saved = null
      return { projectId: q.projectId, isPinned: q.isPinned, pinnedAt: saved?.pinnedAt ?? null }
    },
  }
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
  const admission = new SessionAdmissionDouble({ "pin-session": { namespace: "tenant", userId: "subject" } })
  const server = createBffServer(config, { businessStore: { services: { projects } }, readiness: async () => undefined, sessionAdmission: admission })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  })
  const request = async (path, body, extra = {}) => {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}${path}`,
      body === undefined
        ? { headers: { ...headers, ...extra } }
        : {
            method: "PUT",
            headers: { ...headers, "content-type": "application/json", ...extra },
            body: typeof body === "string" ? body : JSON.stringify(body),
          },
    )
    return { status: r.status, body: await r.json(), headers: r.headers }
  }
  return { calls, request, admission, projects }
}
test("formal bootstrap exposes scoped pin GET and naturally idempotent PUT with no command receipt", async (t) => {
  const f = await fixture(t)
  assert.equal((await f.request("/v1/self/project-pins")).status, 200)
  const first = await f.request("/v1/projects/project/pin", { is_pinned: true })
  assert.equal(first.status, 200)
  assert.equal(first.headers.get("x-request-id"), "pin-test")
  assert.deepEqual(first.body, { data: { project_id: "project", is_pinned: true, pinned_at: "2026-10-27T00:00:00.000Z" } })
  assert.deepEqual((await f.request("/v1/projects/project/pin", { is_pinned: true })).body, first.body)
  assert.deepEqual((await f.request("/v1/projects/project/pin", { is_pinned: false })).body, {
    data: { project_id: "project", is_pinned: false, pinned_at: null },
  })
  assert.deepEqual((await f.request("/v1/self/project-pins?project_id=project")).body, { data: { items: [], next_cursor: null } })
  assert.equal((await f.request("/v1/self/project-pins?project_id=foreign")).status, 404)
  assert.equal((await f.request("/v1/projects/foreign/pin", { is_pinned: false })).status, 404)
  assert.ok(f.calls.every(([, q]) => q.tenantId === "tenant" && q.subjectId === "subject"))
})
test("bad bodies, scoped cursor/filter combinations and command headers never call the pin owner", async (t) => {
  const f = await fixture(t)
  for (const body of [{ is_pinned: null }, { is_pinned: true, subject_id: "other" }, '{"is_pinned":true,"is_pinned":false}'])
    assert.equal((await f.request("/v1/projects/project/pin", body)).status, 400)
  for (const query of ["project_id=project&limit=1", "project_id=project&cursor=x", "limit=101", "cursor="])
    assert.equal((await f.request("/v1/self/project-pins?" + query)).status, 400)
  for (const key of ["idempotency-key", "if-match"])
    assert.equal((await f.request("/v1/projects/project/pin", { is_pinned: true }, { [key]: "not-allowed" })).status, 400)
  assert.equal(f.calls.length, 0)
  assert.equal((await f.request("/v1/self/project-pins", undefined, { authorization: "Bearer wrong" })).status, 401)
  assert.equal(f.calls.length, 0)
})

test("a post-write Session revocation never emits a false success ACK or retries the state PUT", async (t) => {
  const f = await fixture(t),
    original = f.projects.setPin
  f.projects.setPin = async (input) => {
    const result = await original(input)
    f.admission.deny("pin-session", { ok: false, status: 403, code: "session_forbidden" })
    return result
  }
  const result = await f.request("/v1/projects/project/pin", { is_pinned: true })
  assert.equal(result.status, 403)
  assert.equal(result.body.data, undefined)
  assert.equal(f.calls.filter(([kind]) => kind === "write").length, 1)
})
