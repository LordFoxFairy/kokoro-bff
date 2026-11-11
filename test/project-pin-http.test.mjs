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
    check(result, status)
    if (status === 429) assert.equal(result.headers.get("retry-after"), "7")
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
