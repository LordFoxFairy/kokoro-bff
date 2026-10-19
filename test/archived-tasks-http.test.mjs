import assert from "node:assert/strict"
import { request as nodeRequest } from "node:http"
import test from "node:test"
import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const item = { session_id: "历史任务😀", title: "本人归档", archived_at: "2026-10-01T01:02:03.000Z", project_ref: null }
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
        async listOwnedArchivedTasks(query) {
          reads.push(query)
          return options.read ? options.read(query) : { items: [item], nextPosition: null }
        },
        async readArchiveState(query) {
          reads.push(query)
          return options.state ? options.state(query) : { session_id: query.conversationId, archived_at: null }
        },
        async changeArchiveState(command) {
          reads.push(command)
          if (options.change) return options.change(command)
          return {
            kind: "changed",
            receipt: { data: { session_id: command.conversationId, archived_at: command.action === "archive" ? item.archived_at : null } },
          }
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

for (const [method, path, body] of [
  ["GET", "/v1/account/archived-tasks", undefined],
  ["GET", `/v1/sessions/${encodeURIComponent(item.session_id)}/archive`, undefined],
  ["POST", `/v1/sessions/${encodeURIComponent(item.session_id)}/archive`, "{}"],
  ["POST", `/v1/sessions/${encodeURIComponent(item.session_id)}/restore`, "{}"],
]) {
  test(`archive canonical ${method} ${path} admits owner and returns real projection`, async (t) => {
    const { base, reads } = await fixture(t)
    const response = await fetch(base + path, {
      method,
      headers: { ...headers, ...(body ? { "content-type": "application/json", "idempotency-key": "archive-one" } : {}) },
      body,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("x-request-id"), "shared-http")
    assert.equal(reads.length, 1)
    assert.equal(reads[0].tenantId, "tenant-verified")
    assert.equal(reads[0].subjectId, "user-one")
    if (path === "/v1/account/archived-tasks") assert.deepEqual(result, { data: { items: [item], next_cursor: null } })
    else assert.equal(result.data.session_id, item.session_id)
  })
}
test("archive anonymous and invalid input never reach owner", async (t) => {
  const { base, reads } = await fixture(t)
  for (const path of ["/v1/account/archived-tasks", "/v1/sessions/a/archive"]) {
    assert.equal((await fetch(base + path, { headers: { ...headers, authorization: "" } })).status, 401)
  }
  for (const path of [
    "/v1/account/archived-tasks?limit=0",
    "/v1/account/archived-tasks?limit=1&limit=2",
    "/v1/sessions/%FF/archive",
    "/v1/sessions/a/archive?x=1",
  ]) {
    assert.equal((await fetch(base + path, { headers })).status, 400)
  }
  assert.equal(reads.length, 0)
})
test("archive command strict JSON MIME encoding bounded body and key fail without mutation", async (t) => {
  const { base, reads } = await fixture(t)
  const path = base + "/v1/sessions/a/archive",
    valid = { ...headers, "content-type": "application/json", "idempotency-key": "one" }
  for (const [body, extra, status] of [
    ["{}", { "idempotency-key": "" }, 400],
    ["null", {}, 400],
    ['{"x":1}', {}, 400],
    ["\ufeff{}", {}, 400],
    ["{}", { "content-type": "text/plain" }, 415],
    ["{}", { "content-encoding": "gzip" }, 415],
    [" ".repeat(4097), {}, 413],
  ]) {
    assert.equal((await fetch(path, { method: "POST", headers: { ...valid, ...extra }, body })).status, status)
  }
  assert.equal(reads.length, 0)
})
test("archive shared scope includes owner key and action fingerprint without automatic write retries", async (t) => {
  const { base, reads } = await fixture(t)
  for (const action of ["archive", "restore"]) {
    assert.equal(
      (
        await fetch(base + `/v1/sessions/a/${action}`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": "one" },
          body: "{}",
        })
      ).status,
      200,
    )
  }
  assert.equal(reads.length, 2)
  assert.equal(reads[0].scope, reads[1].scope)
  assert.notEqual(reads[0].fingerprint, reads[1].fingerprint)
})
test("archive total admission deadline prevents late owner dispatch", async (t) => {
  let resolve
  const admission = {
    verify: () =>
      new Promise((r) => {
        resolve = r
      }),
  }
  const { base, reads } = await fixture(t, { timeout: 20, admission })
  const response = await fetch(base + "/v1/account/archived-tasks", { headers })
  assert.equal(response.status, 503)
  resolve({ ok: true, identity: { namespace: "tenant-verified", userId: "user-one" }, platformAdmin: false })
  await new Promise((r) => setImmediate(r))
  assert.equal(reads.length, 0)
})
test("archive hanging owner cancelled once and no late response commits", async (t) => {
  let query, resolve
  const { base, reads } = await fixture(t, {
    timeout: 20,
    read: (q) => {
      query = q
      return new Promise((r) => {
        resolve = r
      })
    },
  })
  const response = await fetch(base + "/v1/account/archived-tasks", { headers })
  assert.equal(response.status, 503)
  assert.equal(query.signal.aborted, true)
  assert.equal(reads.length, 1)
  resolve({ items: [item], nextPosition: null })
  await new Promise((r) => setImmediate(r))
  assert.equal((await response.json()).error.code, "archived_tasks_unavailable")
})
for (const unsafe of [
  { items: [{ ...item, share_id: "secret" }], nextPosition: null },
  { items: [item, item], nextPosition: null },
  { items: [], nextPosition: { archivedAt: item.archived_at, sessionId: item.session_id } },
  { items: [{ ...item, title: "x".repeat(1100000) }], nextPosition: null },
])
  test("archive unsafe projection is unavailable not leaked", async (t) => {
    const { base } = await fixture(t, { read: () => unsafe })
    const response = await fetch(base + "/v1/account/archived-tasks", { headers })
    assert.equal(response.status, 503)
    assert.ok(!(await response.text()).includes("secret"))
  })
test("archive cursor continuation rejects repository items before anchor", async (t) => {
  const { base, reads } = await fixture(t, { read: () => ({ items: [item], nextPosition: { archivedAt: item.archived_at, sessionId: item.session_id } }) })
  const first = await fetch(base + "/v1/account/archived-tasks?limit=1", { headers })
  const cursor = (await first.json()).data.next_cursor
  assert.equal((await fetch(base + `/v1/account/archived-tasks?limit=1&cursor=${cursor}`, { headers })).status, 503)
  assert.equal(reads.length, 2)
  assert.equal((await fetch(base + `/v1/account/archived-tasks?limit=2&cursor=${cursor}`, { headers })).status, 400)
  assert.equal(reads.length, 2)
})
test("archive state missing, foreign and closed conflict preserve exact response tuples", async (t) => {
  const missing = await fixture(t, { state: () => null })
  const response = await fetch(missing.base + "/v1/sessions/a/archive", { headers })
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: { code: "session_not_found", message: "session_not_found", retryable: false } })
  const conflict = await fixture(t, { change: () => ({ kind: "conflict" }) })
  assert.equal(
    (
      await fetch(conflict.base + "/v1/sessions/a/archive", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": "one" },
        body: "{}",
      })
    ).status,
    409,
  )
})
test("archive state and ACK reject subject-independent mismatched session IDs and extra fields", async (t) => {
  for (const state of [
    { session_id: "other", archived_at: null },
    { session_id: "a", archived_at: null, share_id: "capability" },
  ]) {
    const f = await fixture(t, { state: () => state, change: () => ({ kind: "changed", receipt: { data: state } }) })
    assert.equal((await fetch(f.base + "/v1/sessions/a/archive", { headers })).status, 503)
    const response = await fetch(f.base + "/v1/sessions/a/archive", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "one" },
      body: "{}",
    })
    assert.equal(response.status, 503)
    assert.ok(!(await response.text()).includes("capability"))
  }
})
test("archive noncooperative write is cancelled on total deadline with exactly one dispatch", async (t) => {
  let command,
    calls = 0,
    resolve
  const f = await fixture(t, {
    timeout: 20,
    change: (value) => {
      command = value
      calls += 1
      return new Promise((r) => {
        resolve = r
      })
    },
  })
  const response = await fetch(f.base + "/v1/sessions/a/archive", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "idempotency-key": "one" },
    body: "{}",
  })
  assert.equal(response.status, 503)
  assert.equal(command.signal.aborted, true)
  assert.equal(calls, 1)
  resolve({ kind: "changed", receipt: { data: { session_id: "a", archived_at: item.archived_at } } })
  await new Promise((r) => setImmediate(r))
  assert.equal(calls, 1)
})
test("archive incomplete input body shares the entry deadline and cannot dispatch owner", async (t) => {
  const f = await fixture(t, { timeout: 25 })
  const status = await new Promise((resolve, reject) => {
    const request = nodeRequest(
      f.base + "/v1/sessions/a/archive",
      { method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": "one", "content-length": "20" } },
      (response) => {
        response.resume()
        response.once("end", () => {
          resolve(response.statusCode)
          request.destroy()
        })
      },
    )
    request.on("error", (error) => {
      if (error.code !== "ECONNRESET") reject(error)
    })
    request.write("{")
  })
  assert.equal(status, 503)
  assert.equal(f.reads.length, 0)
})
test("archive response field order is irrelevant and successful body has only owner state", async (t) => {
  const f = await fixture(t, {
    state: () => ({ archived_at: null, session_id: "a" }),
    change: () => ({ receipt: { data: { archived_at: item.archived_at, session_id: "a" } }, kind: "changed" }),
  })
  assert.equal((await fetch(f.base + "/v1/sessions/a/archive", { headers })).status, 200)
  assert.equal(
    (
      await fetch(f.base + "/v1/sessions/a/archive", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": "one" },
        body: "{}",
      })
    ).status,
    200,
  )
})
test("archive native raw HTTP preserves dot-only historical IDs without pretending WHATWG fetch can transport them", async (t) => {
  const f = await fixture(t)
  const base = new URL(f.base)
  for (const id of [".", ".."]) {
    const result = await new Promise((resolve, reject) => {
      const request = nodeRequest({ hostname: base.hostname, port: base.port, method: "GET", path: `/v1/sessions/${id}/archive`, headers }, (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.once("end", () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }))
      })
      request.once("error", reject)
      request.end()
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.data.session_id, id)
  }
  assert.deepEqual(
    f.reads.map((query) => query.conversationId),
    [".", ".."],
  )
})
