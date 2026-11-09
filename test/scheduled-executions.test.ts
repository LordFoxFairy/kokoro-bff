import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { test } from "node:test"
import { parseScheduledExecutionQuery, scheduledExecutionCursor } from "../src/contracts/scheduled-executions.ts"
import { handleScheduledTaskReadRequest } from "../src/http/routes/scheduled-task-native.ts"
import { DEFAULT_AGUI_CONFIG, type BffConfig } from "../src/config/runtime.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const scope = { tenantId: "tenant", subjectId: "owner" }

test("execution pagination is bounded and cursor stays bound to owner and filters", () => {
  const query = { limit: 20, projectId: "project" }
  const position = ["2026-11-09T03:08:00.000000000Z", `scheduled_agent_${"a".repeat(32)}`] as const
  const cursor = scheduledExecutionCursor(scope, query, position)
  assert.deepEqual(parseScheduledExecutionQuery(new URLSearchParams({ project_id: "project", cursor }), scope), { ...query, before: position })
  assert.equal(parseScheduledExecutionQuery(new URLSearchParams({ project_id: "other", cursor }), scope), null)
  assert.equal(parseScheduledExecutionQuery(new URLSearchParams({ project_id: "project", cursor }), { ...scope, subjectId: "other" }), null)
  for (const input of ["limit=0", "limit=51", "limit=01", "task_id=", "limit=2&limit=3", "other=x", "cursor=invalid", "project_id=%20project"])
    assert.equal(parseScheduledExecutionQuery(new URLSearchParams(input), scope), null, input)
})

const config = {
  tenantId: "tenant",
  sharedSecret: "web-secret",
  iamWebOrigin: "https://web.example.test",
  upstreamTimeoutMs: 200,
  agUi: DEFAULT_AGUI_CONFIG,
} as BffConfig
const headers = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "web-secret",
  cookie: "kokoro-issuer.session_token=session",
  origin: "https://web.example.test",
}

test("execution GET is distinct from task lookup, enforces query and fresh identity before disclosure", async () => {
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "owner" } })
  let reads = 0,
    revoke = false
  const page = { executions: [], next_cursor: null }
  const server = createServer((request, response) => {
    void handleScheduledTaskReadRequest(request, response, config, admission, null, {
      read: async (receivedScope, query, signal) => {
        signal.throwIfAborted()
        assert.deepEqual(receivedScope, scope)
        assert.equal(query.limit, 20)
        reads++
        if (revoke) admission.deny("session", { ok: false, status: 403, code: "session_forbidden" })
        return page
      },
    }).then((handled) => {
      if (!handled) response.writeHead(404).end()
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const url = `http://127.0.0.1:${address.port}/v1/scheduled-tasks/executions`
  try {
    const invalid = await fetch(`${url}?limit=0`, { headers })
    assert.equal(invalid.status, 400)
    await invalid.arrayBuffer()
    assert.equal(reads, 0)
    const valid = await fetch(url, { headers })
    assert.equal(valid.status, 200)
    assert.deepEqual((await valid.json()).data, page)
    assert.equal(valid.headers.get("cache-control"), "no-store")
    revoke = true
    const denied = await fetch(url, { headers })
    assert.equal(denied.status, 403)
    assert.equal((await denied.json()).error.code, "session_forbidden")
    assert.equal(reads, 2)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

test("aborted execution requests stop before starting the read", async () => {
  let reads = 0
  const request = Object.assign(new (await import("node:events")).EventEmitter(), {
    method: "GET",
    url: "/v1/scheduled-tasks/executions",
    rawHeaders: Object.entries(headers).flat(),
    aborted: true,
  })
  const response = Object.assign(new (await import("node:events")).EventEmitter(), {
    destroyed: true,
    writableEnded: false,
    headersSent: false,
    setHeader: () => undefined,
  })
  await handleScheduledTaskReadRequest(request as never, response as never, config, new SessionAdmissionDouble(), null, {
    read: async () => {
      reads++
      return { executions: [], next_cursor: null }
    },
  })
  assert.equal(reads, 0)
})
