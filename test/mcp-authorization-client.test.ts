import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http"
import { afterEach, test } from "node:test"
import { McpAuthorizationClient } from "../dist/auth/mcp-authorization.client.js"
import type { McpAuthorizationInput } from "../src/auth/mcp-authorization.types.js"
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
const decision = {
  allowed: true,
  tenant_id: "tenant-one",
  subject_id: "person-one",
  decision_source: "current_membership",
}
function input(signal = new AbortController().signal): McpAuthorizationInput {
  return {
    token: "human-token",
    requestId: "mcp-request",
    tenantId: "tenant-one",
    subjectId: "person-one",
    action: "read",
    signal,
  }
}
async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void, timeoutMs = 500, maxResponseBytes = 4096) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("no address")
  return new McpAuthorizationClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    timeoutMs,
    maxResponseBytes,
  })
}
function reply(request: IncomingMessage, response: ServerResponse, data: unknown = decision, headerOverrides: Record<string, string> = {}, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-request-id": String(request.headers["x-request-id"]),
    ...headerOverrides,
  })
  response.end(JSON.stringify(status === 200 ? { data } : data))
}
test("R357 current human MCP checker uses bounded session transport and exact resource/action/bearer", async () => {
  let body = ""
  const client = await fixture((request, response) => {
    request.on("data", (chunk) => {
      body += String(chunk)
    })
    request.on("end", () => {
      assert.equal(request.url, "/internal/v1/authorization/check")
      assert.equal(request.method, "POST")
      assert.equal(request.headers.authorization, "Bearer human-token")
      assert.equal(request.headers["x-kokoro-namespace"], undefined)
      reply(request, response)
    })
  })
  assert.deepEqual(await client.check(input()), { ok: true })
  assert.deepEqual(JSON.parse(body), {
    resource: "mcp_personal",
    action: "read",
  })
  assert.deepEqual(await client.check({ ...input(), action: "manage" }), {
    ok: true,
  })
  // Each HTTP request has one frozen body; inspect only the last concatenation through a separate parse.
})
for (const [name, data] of [
  ["false", { ...decision, allowed: false }],
  ["workload scope", { ...decision, decision_source: "client_scope" }],
  ["tenant mismatch", { ...decision, tenant_id: "other" }],
  ["subject mismatch", { ...decision, subject_id: "other" }],
  ["private extra", { ...decision, private: true }],
  ["missing decision", { allowed: true, tenant_id: "tenant-one", subject_id: "person-one" }],
] as const)
  test(`R357 checker rejects ${name}`, async () => {
    const client = await fixture((request, response) => reply(request, response, data))
    assert.deepEqual(await client.check(input()), {
      ok: false,
      status: name === "false" ? 403 : 503,
      code: name === "false" ? "session_forbidden" : "iam_admission_unavailable",
    })
  })
for (const [name, headers] of [
  ["request ID", { "x-request-id": "other-request" }],
  ["cache policy", { "cache-control": "public" }],
  ["content type", { "content-type": "text/plain" }],
] as const)
  test(`R357 checker rejects ${name} mismatch`, async () => {
    const client = await fixture((request, response) => reply(request, response, decision, headers))
    assert.equal((await client.check(input())).ok, false)
  })
for (const [status, code, expected] of [
  [401, "UNAUTHENTICATED", "session_invalid"],
  [403, "PERMISSION_DENIED", "session_forbidden"],
  [429, "RATE_LIMITED", "session_rate_limited"],
] as const)
  test(`R357 checker maps stable ${status}`, async () => {
    const client = await fixture((request, response) =>
      reply(
        request,
        response,
        {
          error: {
            code,
            message: "denied",
            retryable: status === 429,
            details: [],
          },
        },
        {},
        status,
      ),
    )
    assert.deepEqual(await client.check(input()), {
      ok: false,
      status,
      code: expected,
    })
  })
test("R357 checker rejects malformed/oversized owner bytes and closed-envelope extras", async () => {
  for (const body of ["not-json", JSON.stringify({ data: decision, private: true }), "x".repeat(5000)]) {
    const client = await fixture((request, response) => {
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-request-id": String(request.headers["x-request-id"]),
      })
      response.end(body)
    })
    assert.deepEqual(await client.check(input()), {
      ok: false,
      status: 503,
      code: "iam_admission_unavailable",
    })
  }
})
test("R357 timeout and cancellation reject late human permission without success", async () => {
  const client = await fixture((request, response) => {
    setTimeout(() => reply(request, response), 60).unref()
  }, 20)
  assert.equal((await client.check(input())).ok, false)
  const controller = new AbortController()
  const pending = client.check(input(controller.signal))
  controller.abort()
  assert.equal((await pending).ok, false)
})
