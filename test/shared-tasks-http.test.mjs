import assert from "node:assert/strict"
import { request as nodeRequest } from "node:http"
import test from "node:test"
import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const item = { session_id: "conv_owned", title: "本人分享", shared_at: "2026-10-01T01:02:03.000Z", expires_at: null }
const headers = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
  authorization: "Bearer shared-token",
  "x-kokoro-request-id": "shared-http",
}
async function fixture(t, options = {}) {
  const reads = []
  const businessStore = {
    services: {
      chat: {
        async listOwnedSharedTasks(...args) {
          reads.push(args)
          return options.read ? options.read(...args) : { items: [item], nextPosition: null }
        },
      },
    },
    async ready() {},
    async close() {},
  }
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant-verified",
    iamBaseUrl: null,
    sharedSecret: "test-secret",
    upstreamSecret: null,
    upstreamTimeoutMs: options.timeout ?? 1000,
    upstreamMaxResponseBytes: 1048576,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {},
  }
  const admission = options.admission ?? new SessionAdmissionDouble({ "shared-token": { namespace: "tenant-verified", userId: "user-one" } })
  const server = createBffServer(config, { businessStore, readiness: async () => undefined, sessionAdmission: admission })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  return { base: `http://127.0.0.1:${server.address().port}`, reads }
}
test("shared tasks canonical GET reads admitted owner and returns only four safe fields", async (t) => {
  const { base, reads } = await fixture(t)
  const response = await fetch(`${base}/v1/account/shared-tasks`, { headers })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { data: { items: [item], next_cursor: null } })
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("x-request-id"), "shared-http")
  assert.equal(reads.length, 1)
  assert.deepEqual(reads[0].slice(0, 2), ["tenant-verified", "user-one"])
  assert.deepEqual(Object.keys(item).sort(), ["expires_at", "session_id", "shared_at", "title"])
})
test("shared tasks anonymous request cannot reach owner read", async (t) => {
  const { base, reads } = await fixture(t)
  const response = await fetch(`${base}/v1/account/shared-tasks`, { headers: { ...headers, authorization: "" } })
  assert.equal(response.status, 401)
  assert.equal(reads.length, 0)
})
test("shared tasks invalid query and GET body reject before owner read", async (t) => {
  const { base, reads } = await fixture(t)
  for (const query of ["?limit=0", "?limit=01", "?limit=1&limit=2", "?unknown=1", "?cursor=", "?cursor=%FF"]) {
    const response = await fetch(`${base}/v1/account/shared-tasks${query}`, { headers })
    assert.equal(response.status, 400, query)
    assert.equal((await response.json()).error.code, "shared_tasks_input_invalid")
  }
  const status = await new Promise((resolve, reject) => {
    const request = nodeRequest(`${base}/v1/account/shared-tasks`, { method: "GET", headers: { ...headers, "content-length": "2" } }, (response) => {
      response.resume()
      response.once("end", () => resolve(response.statusCode))
    })
    request.once("error", reject)
    request.end("{}")
  })
  assert.equal(status, 400)
  assert.equal(reads.length, 0)
})

test("shared tasks missing store is unavailable, not a fabricated empty list", async (t) => {
  const { base } = await fixture(t, {
    read: async () => {
      throw new Error("private SQL secret")
    },
  })
  const response = await fetch(`${base}/v1/account/shared-tasks`, { headers })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: { code: "shared_tasks_unavailable", message: "shared_tasks_unavailable", retryable: true } })
})
for (const output of [
  { items: [{ ...item, share_id: "secret-capability", url: "https://private" }], nextPosition: null },
  { items: [item, item], nextPosition: null },
  { items: [], nextPosition: { sharedAt: item.shared_at, sessionId: item.session_id } },
  { items: [{ ...item, title: "x".repeat(1100000) }], nextPosition: null },
])
  test("shared tasks rejects unsafe or inconsistent query projection", async (t) => {
    const { base } = await fixture(t, { read: async () => output })
    const response = await fetch(`${base}/v1/account/shared-tasks`, { headers })
    assert.equal(response.status, 503)
    assert.ok(!JSON.stringify(await response.json()).includes("secret-capability"))
  })
test("shared tasks cursor continuation is bound to last actual row and current owner", async (t) => {
  const { base, reads } = await fixture(t, { read: async () => ({ items: [item], nextPosition: { sharedAt: item.shared_at, sessionId: item.session_id } }) })
  const response = await fetch(`${base}/v1/account/shared-tasks?limit=1`, { headers })
  assert.equal(response.status, 200)
  const cursor = (await response.json()).data.next_cursor
  assert.ok(cursor.startsWith("sht1_"))
  const encoded = JSON.parse(Buffer.from(cursor.slice(5), "base64url").toString())
  assert.equal(encoded.subjectId, "user-one")
  assert.ok(!JSON.stringify(encoded).includes("share_id"))
  const wrong = await fetch(`${base}/v1/account/shared-tasks?limit=2&cursor=${cursor}`, { headers })
  assert.equal(wrong.status, 400)
  assert.equal(reads.length, 1)
})
test("shared tasks total admission budget blocks late successful admission from reading owner", async (t) => {
  let resolve
  const admission = {
    verify: () =>
      new Promise((r) => {
        resolve = r
      }),
  }
  const { base, reads } = await fixture(t, { timeout: 20, admission })
  const response = await fetch(`${base}/v1/account/shared-tasks`, { headers })
  assert.equal(response.status, 503)
  resolve({ ok: true, identity: { namespace: "tenant-verified", userId: "user-one" }, platformAdmin: false })
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(reads.length, 0)
})
test("shared tasks hanging query is cancelled once within same total deadline", async (t) => {
  let signal
  let calls = 0
  const { base } = await fixture(t, {
    timeout: 25,
    read: (...args) => {
      calls += 1
      signal = args[4]
      return new Promise(() => {})
    },
  })
  const response = await fetch(`${base}/v1/account/shared-tasks`, { headers })
  assert.equal(response.status, 503)
  assert.equal(signal.aborted, true)
  assert.equal(calls, 1)
})
test("shared tasks maps only closed admission errors without private messages", async (t) => {
  for (const rejected of [
    { status: 403, code: "session_forbidden" },
    { status: 429, code: "session_rate_limited", retryAfter: "2" },
    { status: 401, code: "private_unknown" },
  ]) {
    const { base, reads } = await fixture(t, { admission: { verify: async () => ({ ok: false, ...rejected }) } })
    const response = await fetch(`${base}/v1/account/shared-tasks`, { headers })
    assert.equal(response.status, rejected.code === "private_unknown" ? 503 : rejected.status)
    assert.deepEqual(Object.keys(await response.json()), ["error"])
    assert.equal(response.headers.get("retry-after"), rejected.status === 429 ? "2" : null)
    assert.equal(reads.length, 0)
  }
})

test("shared tasks closed response cancels read and late resolution cannot revive delivery", async (t) => {
  let resolveRead
  let startedResolve
  let readSignal
  const started = new Promise((resolve) => {
    startedResolve = resolve
  })
  const { base, reads } = await fixture(t, {
    read: (...args) => {
      readSignal = args[4]
      startedResolve()
      return new Promise((resolve) => {
        resolveRead = resolve
      })
    },
  })
  const controller = new AbortController()
  const pending = fetch(`${base}/v1/account/shared-tasks`, { headers, signal: controller.signal })
  await started
  controller.abort()
  await assert.rejects(pending)
  for (let i = 0; i < 20 && !readSignal.aborted; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(readSignal.aborted, true)
  resolveRead({ items: [item], nextPosition: null })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(reads.length, 1)
})

test("shared tasks oversized output anchor fails unavailable rather than blaming caller input", async (t) => {
  const id = "x".repeat(3000)
  const { base } = await fixture(t, { read: async () => ({ items: [{ ...item, session_id: id }], nextPosition: { sharedAt: item.shared_at, sessionId: id } }) })
  const response = await fetch(`${base}/v1/account/shared-tasks`, { headers })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, "shared_tasks_unavailable")
})
