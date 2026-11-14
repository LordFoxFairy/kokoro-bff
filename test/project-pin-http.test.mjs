import "reflect-metadata"
import { Test } from "@nestjs/testing"
import { BFF_CONFIG, BFF_DATABASE, PROJECT_LOOKUP, PROJECT_MUTATIONS, PROJECT_PINS, PROJECT_READS, SESSION_ADMISSION } from "../dist/common/tokens.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../dist/main.js"
import { ProjectsModule } from "../dist/modules/projects/projects.module.js"
import assert from "node:assert/strict"
import { test } from "node:test"
import { readFile } from "node:fs/promises"
import { load } from "js-yaml"
import { fromJSONSchema } from "zod"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
import { createServer, IncomingMessage, ServerResponse, request as httpRequest } from "node:http"
import { Socket } from "node:net"
import { SessionAdmissionClient } from "../src/auth/session-admission.client.ts"
import { handleProjectPinRequest } from "../src/http/routes/project-native.ts"
import { fixtureNativeSession } from "./doubles/iam-native-session.ts"
import { fixtureIamCredentials, TEST_IAM_USER_CONTEXT_SECRET } from "./doubles/iam-credentials.ts"
const spec = load(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"))
// Compile the published envelope graph; do not introduce a competing error DTO.
const errorEnvelope = fromJSONSchema(
  JSON.parse(JSON.stringify({ $ref: "#/components/schemas/ErrorEnvelope", $defs: spec.components.schemas }).replaceAll("#/components/schemas/", "#/$defs/")),
)

const headers = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
  cookie: "kokoro-issuer.session_token=pin-session",
  origin: "https://web.example.test",
  "x-kokoro-request-id": "pin-test",
}
async function fixture(t, websiteStores) {
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
    iamWebOrigin: "https://web.example.test",
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
  const builder = Test.createTestingModule({ imports: [ProjectsModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue({
      pool: { query: () => assert.fail("unexpected Project database query"), connect: () => assert.fail("unexpected Project database connection") },
      redis: Object.freeze({}),
    })
    .overrideProvider(PROJECT_PINS)
    .useValue(projects)
    .overrideProvider(PROJECT_LOOKUP)
    .useValue({ find: () => assert.fail("pin requests must use the scoped pin owner methods") })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(admission)
  if (websiteStores !== undefined) {
    builder.overrideProvider(PROJECT_READS).useValue(websiteStores)
    builder.overrideProvider(PROJECT_MUTATIONS).useValue(websiteStores)
  }
  const module = await builder.compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, logger: false })
  t.after(() => app.close())
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()
  const request = async (path, body, extra = {}, method) => {
    const r = await fetch(
      `${base}${path}`,
      body === undefined
        ? { method: method ?? "GET", headers: { ...headers, ...extra } }
        : {
            method: method ?? "PUT",
            headers: { ...headers, "content-type": "application/json", ...extra },
            body: typeof body === "string" ? body : JSON.stringify(body),
          },
    )
    return { status: r.status, body: await r.json(), headers: r.headers }
  }
  return { calls, request, admission, projects }
}

test("A06 formal Projects route returns scoped websites and normalizes URLs before any write", async (t) => {
  const id = "project_11111111-1111-4111-8111-111111111111"
  const path = `/v1/projects/${id}/websites`
  const reads = [],
    writes = []
  const f = await fixture(t, {
    readWebsites: async (query) => {
      reads.push(query)
      return { project_id: id, websites: [], state_version: "1" }
    },
    replaceWebsites: async (query) => {
      writes.push(query)
      return { kind: "replaced", data: { project_id: id, websites: query.websites, state_version: "2" } }
    },
  })
  const before = await f.request(path)
  assert.equal(before.status, 200)
  assert.equal(before.headers.get("cache-control"), "no-store")
  assert.deepEqual(before.body, { data: { project_id: id, websites: [], state_version: "1" } })
  const body = { websites: ["HTTPS://Example.test:443/a/../docs?tab=1#details", "http://z.example.test"], expected_state_version: "1" }
  const written = await f.request(path, body)
  assert.equal(written.status, 200)
  assert.deepEqual(written.body, {
    data: { project_id: id, websites: ["http://z.example.test/", "https://example.test/docs?tab=1#details"], state_version: "2" },
  })
  for (const websites of [
    ["https://alice:private@example.test/"],
    ["https://@example.test/"],
    ["https:///example.test/"],
    ["javascript:alert(1)"],
    ["https://example.test/\nextra"],
    ["https://example.test/a\\b"],
    ["https://example.test", "https://EXAMPLE.test:443/"],
    ["https://example.test/" + "a".repeat(2048)],
    Array.from({ length: 17 }, (_, index) => `https://example.test/${index}`),
  ]) {
    const invalid = await f.request(path, { ...body, websites })
    assert.equal(invalid.status, 400)
    assert.deepEqual(invalid.body.error.code, "invalid_project_websites_request")
    assert.ok(!JSON.stringify(invalid.body).includes("alice:private"))
  }
  assert.equal((await f.request(path, '{"websites":[],"websites":[],"expected_state_version":"1"}')).status, 400)
  assert.equal((await f.request(path, { ...body, expected_state_version: "2147483648" })).status, 400)
  assert.equal((await f.request(path + "?tenant_id=foreign")).status, 400)
  assert.equal((await f.request(path, body, { "idempotency-key": "not-an-operation-receipt" })).status, 400)
  assert.equal(reads.length, 1)
  assert.equal(writes.length, 1)
  for (const query of [...reads, ...writes]) assert.deepEqual([query.tenantId, query.subjectId, query.projectId], ["tenant", "subject", id])
})

// Source route + real HTTP peers keep iteration independent of the shared dist build.
async function pinPeerFixture(t, options = {}) {
  const iamCalls = [],
    reads = []
  const state = { allowed: true, tenant: "tenant", user: "subject", expiresAt: "2099-01-01T00:00:00.000Z", ...options.state }
  let releasePeer
  const peerReleased = new Promise((resolve) => {
    releasePeer = resolve
  })
  let peerStarted
  const started = new Promise((resolve) => {
    peerStarted = resolve
  })
  let peerClosed
  const cancelledPeer = new Promise((resolve) => {
    peerClosed = resolve
  })
  const peer = createServer((request, response) => {
    response.once("close", () => {
      if (!response.writableEnded) peerClosed()
    })
    iamCalls.push(request.url)
    const session = request.url.startsWith("/iam/get-session")
    if (session) {
      assert.equal(request.headers.cookie, headers.cookie)
      assert.equal(request.headers.origin, headers.origin)
    } else {
      assert.equal(request.url, "/internal/v1/authorization/check")
      assert.equal(request.headers.cookie, undefined)
      assert.equal(request.headers.origin, undefined)
      assert.equal(request.headers["x-kokoro-actor-id"], state.user)
      assert.equal(request.headers.authorization, `Bearer ${TEST_IAM_USER_CONTEXT_SECRET}`)
    }
    const reply = () => {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": request.headers["x-request-id"] })
      const native = fixtureNativeSession(state.tenant, state.user)
      native.session.expiresAt = state.expiresAt
      response.end(
        JSON.stringify(
          session ? native : { data: { allowed: state.allowed, tenant_id: "tenant", subject_id: state.user, decision_source: "current_membership" } },
        ),
      )
    }
    if (options.delay === (session ? "session" : "membership")) {
      peerStarted()
      void peerReleased.then(reply)
    } else reply()
  })
  const listen = async (server) => {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    t.after(async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    })
    return `http://127.0.0.1:${server.address().port}`
  }
  const owner = await listen(peer)
  t.after(() => releasePeer())
  const credentials = await fixtureIamCredentials("tenant")
  const admission =
    options.admission ??
    new SessionAdmissionClient({
      baseUrl: owner,
      credentialFile: credentials.iamUserContextServiceCredentialFile,
      webOrigin: headers.origin,
      tenantId: "tenant",
      timeoutMs: 1000,
      maxResponseBytes: 65536,
    })
  let storeStarted
  const storeEntered = new Promise((resolve) => {
    storeStarted = resolve
  })
  let releaseStore
  const storeReleased = new Promise((resolve) => {
    releaseStore = resolve
  })
  t.after(() => releaseStore())
  const store = {
    listPins: async (input) => {
      reads.push(input)
      storeStarted()
      if (options.delay === "late-store") await storeReleased
      if (options.delay === "store")
        await new Promise((resolve) => {
          if (input.signal.aborted) resolve()
          else input.signal.addEventListener("abort", resolve, { once: true })
        })
      return { items: [], nextPosition: null }
    },
    setPin: () => assert.fail("GET must not write"),
  }
  const config = { tenantId: "tenant", iamWebOrigin: headers.origin, sharedSecret: "test-secret", upstreamTimeoutMs: options.timeoutMs ?? 1000 }
  let routeFinished
  const finished = new Promise((resolve) => {
    routeFinished = resolve
  })
  const server = createServer((request, response) => {
    void handleProjectPinRequest(request, response, config, admission, store).finally(routeFinished)
  })
  const base = await listen(server)
  return { base, iamCalls, reads, state, started, storeEntered, finished, releasePeer, releaseStore, cancelledPeer }
}

test("PERF-02 pins GET uses one complete admission (two IAM HTTP reads), then rejects current revocation on the next request", async (t) => {
  const f = await pinPeerFixture(t)
  const result = await fetch(`${f.base}/v1/self/project-pins`, { headers })
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), { data: { items: [], next_cursor: null } })
  assert.equal(f.iamCalls.length, 2)
  assert.equal(f.reads.length, 1)
  assert.equal(f.reads[0].tenantId, "tenant")
  assert.equal(f.reads[0].subjectId, "subject")
  f.state.allowed = false
  const revoked = await fetch(`${f.base}/v1/self/project-pins`, { headers })
  assert.equal(revoked.status, 403)
  assert.equal(f.iamCalls.length, 4)
  assert.equal(f.reads.length, 1)
})

test("PERF-02 pins GET scopes the admitted actor and rejects a foreign current tenant before store work", async (t) => {
  const f = await pinPeerFixture(t, { state: { user: "another-user" } })
  assert.equal((await fetch(`${f.base}/v1/self/project-pins`, { headers })).status, 200)
  assert.equal(f.reads[0].subjectId, "another-user")
  f.state.tenant = "foreign"
  assert.equal((await fetch(`${f.base}/v1/self/project-pins`, { headers })).status, 403)
  assert.equal(f.reads.length, 1)
})

test("PERF-02 an already retired pins request or zero budget starts no IAM or store work", async (t) => {
  for (const reason of ["request-aborted", "response-destroyed", "response-ended", "budget"])
    await t.test(reason, async () => {
      const request = new IncomingMessage(new Socket())
      request.method = "GET"
      request.url = "/v1/self/project-pins"
      request.headers = { ...headers }
      request.rawHeaders = Object.entries(headers).flat()
      const response = new ServerResponse(request)
      if (reason === "request-aborted") request.aborted = true
      if (reason === "response-destroyed") response.destroy()
      if (reason === "response-ended") response.end()
      let verifies = 0
      await handleProjectPinRequest(
        request,
        response,
        { tenantId: "tenant", iamWebOrigin: headers.origin, sharedSecret: "test-secret", upstreamTimeoutMs: reason === "budget" ? 0 : 1000 },
        {
          verify: async () => {
            verifies++
            return { ok: false, status: 503, code: "iam_admission_unavailable" }
          },
        },
        { listPins: () => assert.fail("retired read"), setPin: () => assert.fail("retired write") },
      )
      assert.equal(verifies, 0)
    })
})

test("PERF-02 pins GET requires a real unexpired admission expiry", async (t) => {
  for (const expiresAt of [undefined, "invalid", "2000-01-01T00:00:00.000Z"])
    await t.test(String(expiresAt), async (t) => {
      const f = await pinPeerFixture(t, {
        admission: {
          verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "subject" }, platformAdmin: false, expiresAt, setCookies: [] }),
        },
      })
      const response = await fetch(`${f.base}/v1/self/project-pins`, { headers })
      assert.equal(response.status, expiresAt?.startsWith("2000") ? 401 : 503)
      assert.equal(f.reads.length, 0)
    })
})

test("PERF-02 a late admission success after the request budget starts no pins store", async (t) => {
  let admissionSignal
  const f = await pinPeerFixture(t, {
    timeoutMs: 20,
    admission: {
      verify: async ({ signal }) => {
        admissionSignal = signal
        await new Promise((resolve) => setTimeout(resolve, 60))
        return { ok: true, identity: { namespace: "tenant", userId: "subject" }, platformAdmin: false, expiresAt: "2099-01-01T00:00:00.000Z", setCookies: [] }
      },
    },
  })
  assert.equal((await fetch(`${f.base}/v1/self/project-pins`, { headers })).status, 503)
  assert.equal(admissionSignal.aborted, true)
  assert.equal(f.reads.length, 0)
})

test("PERF-02 delayed IAM pins reads retire on deadline or disconnect with no late store work", { timeout: 4000 }, async (t) => {
  for (const delay of ["session", "membership"])
    for (const retirement of ["deadline", "disconnect"])
      await t.test(`${delay}/${retirement}`, async (t) => {
        const f = await pinPeerFixture(t, { delay, timeoutMs: retirement === "deadline" ? 60 : 1000 })
        if (retirement === "deadline") {
          const response = await fetch(`${f.base}/v1/self/project-pins`, { headers })
          assert.equal(response.status, 503)
        } else {
          const request = httpRequest(`${f.base}/v1/self/project-pins`, { headers })
          request.on("error", () => {})
          request.end()
          await f.started
          request.destroy()
        }
        await f.finished
        await f.cancelledPeer
        f.releasePeer()
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(f.iamCalls.length, delay === "session" ? 1 : 2)
        assert.equal(f.reads.length, 0)
      })
})

test("PERF-02 Session expiry during membership admission prevents a late success from starting the store", async (t) => {
  const f = await pinPeerFixture(t, { delay: "membership", state: { expiresAt: new Date(Date.now() + 180).toISOString() } })
  const pending = fetch(`${f.base}/v1/self/project-pins`, { headers })
  await f.started
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(f.state.expiresAt) - Date.now() + 5)))
  f.releasePeer()
  const response = await pending
  assert.equal(response.status, 401)
  assert.equal(f.reads.length, 0)
  assert.equal(f.iamCalls.length, 2)
})

test("PERF-02 a delayed pins store is aborted at the admitted Session expiry, without another IAM read or success", async (t) => {
  const f = await pinPeerFixture(t, { delay: "store", timeoutMs: 600, state: { expiresAt: new Date(Date.now() + 180).toISOString() } })
  const response = await fetch(`${f.base}/v1/self/project-pins`, { headers })
  assert.equal(response.status, 401)
  assert.equal((await response.json()).error.code, "session_invalid")
  assert.equal(f.iamCalls.length, 2)
  assert.equal(f.reads.length, 1)
  assert.equal(f.reads[0].signal.aborted, true)
})

test("PERF-02 late store success after the request budget retires cannot publish an ACK or start more IAM work", async (t) => {
  const f = await pinPeerFixture(t, { delay: "late-store", timeoutMs: 60 })
  const response = await fetch(`${f.base}/v1/self/project-pins`, { headers })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).data, undefined)
  await f.finished
  assert.equal(f.reads[0].signal.aborted, true)
  f.releaseStore()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.reads.length, 1)
  assert.equal(f.iamCalls.length, 2)
})

test("PERF-02 a delayed pins store retires on deadline or disconnect, without a success or further IAM read", async (t) => {
  for (const retirement of ["deadline", "disconnect"])
    await t.test(retirement, async (t) => {
      const f = await pinPeerFixture(t, { delay: "store", timeoutMs: retirement === "deadline" ? 60 : 1000 })
      if (retirement === "deadline") {
        const response = await fetch(`${f.base}/v1/self/project-pins`, { headers })
        assert.equal(response.status, 503)
      } else {
        const request = httpRequest(`${f.base}/v1/self/project-pins`, { headers })
        request.on("error", () => {})
        request.end()
        await f.storeEntered
        request.destroy()
      }
      await f.finished
      assert.equal(f.reads.length, 1)
      assert.equal(f.reads[0].signal.aborted, true)
      assert.equal(f.iamCalls.length, 2)
    })
})
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
  assert.equal(
    (await f.request("/v1/self/project-pins", undefined, { cookie: "kokoro-issuer.session_token=wrong", origin: "https://web.example.test" })).status,
    401,
  )
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
  assert.equal(f.admission.calls.length, 3)
})

test("all pin failures and initial Session denials use the canonical error envelope", async (t) => {
  const check = (result, status) => {
    assert.equal(result.status, status)
    const parsed = errorEnvelope.safeParse(result.body)
    assert.equal(parsed.success, true, parsed.success ? undefined : JSON.stringify(parsed.error.issues))
    assert.deepEqual(result.body.meta, { request_id: "pin-test" })
    assert.equal(result.headers.get("x-request-id"), "pin-test")
    assert.deepEqual(Object.keys(result.body.error).sort(), ["code", "message"])
  }
  assert.equal(errorEnvelope.safeParse({ error: { code: "project_pin_request_invalid", message: "old malformed error", retryable: false } }).success, false)
  const invalid = await fixture(t)
  check(await invalid.request("/v1/projects/project/pin", { is_pinned: null }), 400)
  check(await invalid.request("/v1/self/project-pins?project_id=foreign"), 404)
  check(await invalid.request("/v1/projects/project/pin"), 405)
  check(await invalid.request("/v1/self/project-pins", undefined, { cookie: "kokoro-issuer.session_token=wrong", origin: "https://web.example.test" }), 401)
  for (const status of [401, 403, 429, 503]) {
    const denied = await fixture(t)
    denied.admission.deny("pin-session", { ok: false, status, code: "fixture_admission_denied", ...(status === 429 ? { retryAfter: "7" } : {}) })
    const result = await denied.request("/v1/self/project-pins")
    check(result, status)
    if (status === 429) assert.equal(result.headers.get("retry-after"), "7")
  }
  for (const status of [403, 429, 503]) {
    const f = await fixture(t)
    const original = f.projects.listPins
    f.projects.listPins = async (input) => {
      const result = await original(input)
      f.admission.deny("pin-session", { ok: false, status, code: "fixture_admission_denied", ...(status === 429 ? { retryAfter: "7" } : {}) })
      return result
    }
    const result = await f.request("/v1/self/project-pins")
    // The already admitted GET is not a cross-owner revocation barrier. The next
    // request must perform a fresh complete admission, including current membership.
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, { data: { items: [], next_cursor: null } })
    const next = await f.request("/v1/self/project-pins")
    check(next, status)
    if (status === 429) assert.equal(next.headers.get("retry-after"), "7")
    assert.equal(f.calls.filter(([kind]) => kind === "read").length, 1)
  }
  const unavailable = await fixture(t)
  unavailable.projects.listPins = async () => {
    throw new Error("fixture private database failure")
  }
  const result = await unavailable.request("/v1/self/project-pins")
  check(result, 503)
  assert.equal(result.body.error.code, "project_pin_unavailable")
  assert.doesNotMatch(JSON.stringify(result.body), /fixture private database failure/u)
})
