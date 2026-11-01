import assert from "node:assert/strict"
import test from "node:test"
import { request as httpRequest } from "node:http"
import { createBffServer } from "../src/bootstrap/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const headers = { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret", authorization: "Bearer token", "x-kokoro-request-id": "runs-http" }
const row = () => ({
  sourceKind: "calendar",
  sourceObservedAt: null,
  dispatchId: "dispatch-1",
  tenantId: "tenant",
  subjectId: "owner",
  taskId: "task-1",
  title: "Current title",
  projectRef: null,
  taskRevision: "1",
  runId: "run-1",
  orderKey: "2026-10-21T00:00:00.000000001Z",
  status: "pending",
  unknownSeen: false,
  terminals: [],
})
async function fixture(t, options = {}) {
  const reads = [],
    admission = options.admission ?? new SessionAdmissionDouble({ token: { namespace: "tenant", userId: "owner" } })
  const businessStore = {
    services: {},
    scheduledTaskRuns: {
      async readSnapshot(query) {
        reads.push(query)
        return options.read ? options.read(query, reads.length) : { taskExists: true, rows: [row()] }
      },
    },
    ready: async () => {},
    close: async () => {},
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
  const server = createBffServer(config, { businessStore, sessionAdmission: admission, readiness: async () => {} })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  return { base: `http://127.0.0.1:${server.address().port}`, reads, admission }
}
test("runs HTTP current owner metadata requires two snapshots and two IAM admissions", async (t) => {
  const f = await fixture(t),
    response = await fetch(f.base + "/v1/scheduled-task-runs", { headers })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    data: {
      items: [
        {
          task_id: "task-1",
          title: "Current title",
          project_ref: null,
          run_id: "run-1",
          trigger_kind: "calendar",
          scheduled_for: "2026-10-21T00:00:00.000000001Z",
          state: "pending",
          terminal_event_at: null,
        },
      ],
      next_cursor: null,
    },
  })
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("x-request-id"), "runs-http")
  assert.equal(f.reads.length, 2)
  assert.equal(f.admission.calls.length, 2)
  assert.equal(f.reads[0].deadlineAt, f.reads[1].deadlineAt)
})
test("runs HTTP invalid inputs and raw aliases perform zero owner IO", async (t) => {
  const f = await fixture(t)
  for (const path of [
    "/v1/scheduled-task-runs?limit=01",
    "/v1/scheduled-task-runs?limit=101",
    "/v1/scheduled-task-runs?limit=1&limit=2",
    "/v1/scheduled-task-runs?tenant_id=x",
    "/v1/scheduled-task-runs?task_id=",
    "/v1/scheduled-task-runs?task_id=%FF",
    "/v1/scheduled-task-runs?cursor=x",
  ]) {
    assert.equal((await fetch(f.base + path, { headers })).status, 400, path)
  }
  const url = new URL(f.base)
  for (const path of [
    "/v1//scheduled-task-runs",
    "/v1/%73cheduled-task-runs",
    f.base + "/v1/scheduled-task-runs",
    "/v1/./scheduled-task-runs",
    "/v1/scheduled-task-runs/",
  ]) {
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: url.hostname, port: url.port, path, headers }, (res) => {
        res.resume()
        res.on("end", () => resolve(res.statusCode))
      })
      req.on("error", reject)
      req.end()
    })
    assert.equal(status, 400, path)
  }
  assert.equal(f.reads.length, 0)
})
test("runs HTTP unavailable or changed page fails whole response", async (t) => {
  for (const read of [
    () => ({ taskExists: true, rows: [{ ...row(), status: "terminal" }] }),
    (_, n) => ({ taskExists: true, rows: [{ ...row(), title: n === 1 ? "before" : "after" }] }),
    () => ({ taskExists: true, rows: [{ ...row(), title: "x".repeat(1048577) }] }),
  ]) {
    const f = await fixture(t, { read }),
      response = await fetch(f.base + "/v1/scheduled-task-runs", { headers })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, "scheduled_task_runs_unavailable")
  }
})
test("runs HTTP exact missing task is private404 and global empty is200", async (t) => {
  const f = await fixture(t, { read: () => ({ taskExists: false, rows: [] }) })
  assert.equal((await fetch(f.base + "/v1/scheduled-task-runs?task_id=foreign", { headers })).status, 404)
  assert.equal((await fetch(f.base + "/v1/scheduled-task-runs", { headers })).status, 200)
})
test("runs HTTP noncooperative first IAM is finite and late admission cannot read", async (t) => {
  let release
  const f = await fixture(t, {
    timeout: 25,
    admission: {
      verify: () =>
        new Promise((resolve) => {
          release = resolve
        }),
    },
  })
  assert.equal((await fetch(f.base + "/v1/scheduled-task-runs", { headers })).status, 503)
  release({ ok: true, identity: { namespace: "tenant", userId: "owner" }, platformAdmin: false })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.reads.length, 0)
})
test("runs HTTP final IAM revocation and subject change retire data without second read", async (t) => {
  for (const result of [
    { ok: false, status: 403, code: "session_forbidden" },
    { ok: true, identity: { namespace: "tenant", userId: "other" }, platformAdmin: false },
  ]) {
    let calls = 0
    const f = await fixture(t, {
      admission: {
        async verify() {
          return ++calls === 1 ? { ok: true, identity: { namespace: "tenant", userId: "owner" }, platformAdmin: false } : result
        },
      },
    })
    const response = await fetch(f.base + "/v1/scheduled-task-runs", { headers })
    assert.equal(response.status, result.ok ? 503 : 403)
    assert.equal(f.reads.length, 1)
  }
})
test("runs HTTP reader cancellation and final IAM share original short total budget", async (t) => {
  let release,
    calls = 0
  const f = await fixture(t, {
    timeout: 60,
    admission: {
      async verify() {
        calls++
        if (calls === 1) return { ok: true, identity: { namespace: "tenant", userId: "owner" }, platformAdmin: false }
        return new Promise((resolve) => {
          release = resolve
        })
      },
    },
    read: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { taskExists: true, rows: [row()] }
    },
  })
  const start = performance.now(),
    response = await fetch(f.base + "/v1/scheduled-task-runs", { headers })
  assert.equal(response.status, 503)
  assert.ok(performance.now() - start < 250)
  assert.equal(f.reads.length, 1)
  release({ ok: true, identity: { namespace: "tenant", userId: "owner" }, platformAdmin: false })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.reads.length, 1)
})
test("runs HTTP actual five-second cap covers noncooperative initial IAM", async (t) => {
  let release
  const f = await fixture(t, {
    timeout: 20000,
    admission: {
      verify: () =>
        new Promise((resolve) => {
          release = resolve
        }),
    },
  })
  const start = performance.now(),
    response = await fetch(f.base + "/v1/scheduled-task-runs", { headers }),
    elapsed = performance.now() - start
  assert.equal(response.status, 503)
  assert.ok(elapsed >= 4900 && elapsed < 6500, String(elapsed))
  assert.equal(f.reads.length, 0)
  release({ ok: true, identity: { namespace: "tenant", userId: "owner" }, platformAdmin: false })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.reads.length, 0)
})
test("runs HTTP request disconnect aborts noncooperative owner without subsequent admission", async (t) => {
  let started, release
  const observed = new Promise((resolve) => {
    started = resolve
  })
  const f = await fixture(t, {
    read: (q) => {
      started(q)
      return new Promise((resolve) => {
        release = resolve
      })
    },
  })
  const request = httpRequest(f.base + "/v1/scheduled-task-runs", { headers })
  request.on("error", () => {})
  request.end()
  const query = await observed
  request.destroy()
  await new Promise((resolve) => (query.signal.aborted ? resolve() : query.signal.addEventListener("abort", resolve, { once: true })))
  release({ taskExists: true, rows: [row()] })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.reads.length, 1)
  assert.equal(f.admission.calls.length, 1)
})
test("runs HTTP strict request headers and actual GET body reject before owner reads", async (t) => {
  const f = await fixture(t),
    base = new URL(f.base)
  for (const extra of [
    { "content-length": "1" },
    { "transfer-encoding": "chunked" },
    { "idempotency-key": "not-a-command" },
    { "content-encoding": "identity" },
  ]) {
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest(
        { hostname: base.hostname, port: base.port, path: "/v1/scheduled-task-runs", method: "GET", headers: { ...headers, ...extra } },
        (response) => {
          response.resume()
          response.once("end", () => resolve(response.statusCode))
        },
      )
      req.on("error", reject)
      req.end(extra["content-length"] || extra["transfer-encoding"] ? "x" : undefined)
    })
    assert.equal(status, 400)
  }
  assert.equal(f.reads.length, 0)
  assert.equal(f.admission.calls.length, 0)
})
test("runs HTTP closed initial IAM tuples retain current status without projection leaks", async (t) => {
  for (const [status, code, retryAfter] of [
    [401, "session_invalid", undefined],
    [403, "session_forbidden", undefined],
    [429, "session_rate_limited", "2"],
    [503, "iam_admission_unavailable", undefined],
  ]) {
    const f = await fixture(t, { admission: { verify: async () => ({ ok: false, status, code, retryAfter }) } })
    const response = await fetch(f.base + "/v1/scheduled-task-runs", { headers })
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error: { code, message: code, retryable: status === 429 || status === 503 } })
    assert.equal(response.headers.get("retry-after"), retryAfter ?? null)
    assert.equal(f.reads.length, 0)
  }
})
