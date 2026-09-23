import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { afterEach, test } from "node:test"

import { SessionAdmissionClient } from "../dist/auth/session-admission.client.js"

const servers: Server[] = []

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})

function responseHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-request-id": "iam-request-1",
    ...overrides,
  }
}

function client(baseUrl: string, overrides: { timeoutMs?: number; maxResponseBytes?: number } = {}): SessionAdmissionClient {
  return new SessionAdmissionClient({
    baseUrl,
    timeoutMs: overrides.timeoutMs ?? 1000,
    maxResponseBytes: overrides.maxResponseBytes ?? 4096,
  })
}

test("IAM admission sends one bodyless bearer request and returns only the trusted identity", async () => {
  let captured: { method?: string; url?: string; body: Buffer; headers: IncomingMessage["headers"] } | undefined
  const baseUrl = await listen((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      captured = { method: request.method, url: request.url, body: Buffer.concat(chunks), headers: request.headers }
      response.writeHead(200, responseHeaders())
      response.end(JSON.stringify({ data: { allowed: true, tenant_id: "tenant-a", user_id: "user-a", session_id: "session-a", client_id: "web-a" } }))
    })
  })

  const result = await client(baseUrl).verify({ token: "session-token", requestId: "public-request", signal: new AbortController().signal })

  assert.equal(captured?.method, "POST")
  assert.equal(captured?.url, "/internal/v1/session-authorizations/verify")
  assert.equal(captured?.body.length, 0)
  assert.equal(captured?.headers.authorization, "Bearer session-token")
  assert.equal(captured?.headers.accept, "application/json")
  assert.equal(captured?.headers["x-request-id"], "public-request")
  assert.equal(captured?.headers["x-kokoro-namespace"], undefined)
  assert.equal(captured?.headers["x-kokoro-principal-id"], undefined)
  assert.deepEqual(result, { ok: true, identity: { namespace: "tenant-a", userId: "user-a" } })
})

test("IAM admission replaces an invalid caller request id before owner I/O", async () => {
  let ownerRequestId = ""
  const baseUrl = await listen((request, response) => {
    ownerRequestId = String(request.headers["x-request-id"] ?? "")
    response.writeHead(200, responseHeaders())
    response.end(JSON.stringify({ data: { allowed: true, tenant_id: "tenant-a", user_id: "user-a", session_id: "session-a", client_id: "web-a" } }))
  })

  const result = await client(baseUrl).verify({ token: "session-token", requestId: "invalid request id!", signal: new AbortController().signal })

  assert.equal(result.ok, true)
  assert.match(ownerRequestId, /^[A-Za-z0-9_-]{1,128}$/u)
  assert.notEqual(ownerRequestId, "invalid request id!")
})

test("IAM admission rejects false, incomplete, and extra-field success payloads", async () => {
  const payloads = [
    { data: { allowed: false, tenant_id: "tenant-a", user_id: "user-a", session_id: "session-a", client_id: "web-a" } },
    { data: { allowed: true, tenant_id: "", user_id: "user-a", session_id: "session-a", client_id: "web-a" } },
    { data: { allowed: true, tenant_id: "tenant-a", user_id: "user-a", session_id: "session-a", client_id: "web-a", extra: true } },
    { data: { allowed: true, tenant_id: "tenant-a", user_id: "user-a", session_id: "session-a", client_id: "web-a" }, extra: true },
  ]
  let index = 0
  const baseUrl = await listen((_request, response) => {
    response.writeHead(200, responseHeaders())
    response.end(JSON.stringify(payloads[index++]))
  })
  const admission = client(baseUrl)

  for (const _payload of payloads) {
    const result = await admission.verify({ token: "session-token", requestId: "public-request", signal: new AbortController().signal })
    assert.deepEqual(result, { ok: false, status: 503, code: "iam_admission_unavailable" })
  }
})

test("IAM admission maps owner denial and a bounded Retry-After without exposing owner errors", async () => {
  const responses = [
    { status: 401, code: "session_invalid" },
    { status: 403, code: "session_forbidden" },
    { status: 404, code: "session_forbidden" },
    { status: 409, code: "session_forbidden" },
    { status: 429, code: "session_rate_limited", retryAfter: "60" },
  ] as const
  let index = 0
  const baseUrl = await listen((_request, response) => {
    const item = responses[index++]
    response.writeHead(item.status, responseHeaders(item.status === 429 ? { "retry-after": "60" } : {}))
    response.end(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "owner secret message", retryable: false, details: [] } }))
  })
  const admission = client(baseUrl)

  for (const expected of responses) {
    const result = await admission.verify({ token: "session-token", requestId: "public-request", signal: new AbortController().signal })
    assert.deepEqual(result, {
      ok: false,
      status: expected.status === 404 || expected.status === 409 ? 403 : expected.status,
      code: expected.code,
      ...(expected.retryAfter === undefined ? {} : { retryAfter: expected.retryAfter }),
    })
  }
})

test("IAM admission keeps owner rate limits when Retry-After is missing", async () => {
  const baseUrl = await listen((_request, response) => {
    response.writeHead(429, responseHeaders())
    response.end(JSON.stringify({ error: { code: "RATE_LIMITED", message: "slow", retryable: true, details: [] } }))
  })

  assert.deepEqual(await client(baseUrl).verify({ token: "session-token", requestId: "public-request", signal: new AbortController().signal }), {
    ok: false,
    status: 429,
    code: "session_rate_limited",
  })
})

test("IAM admission keeps owner rate limits but drops invalid Retry-After values", async () => {
  const retryAfterValues = ["0", "1.5", "86401", "tomorrow"] as const
  let index = 0
  const baseUrl = await listen((_request, response) => {
    const retryAfter = retryAfterValues[index++]
    response.writeHead(429, responseHeaders({ "retry-after": retryAfter }))
    response.end(JSON.stringify({ error: { code: "RATE_LIMITED", message: "slow", retryable: true, details: [] } }))
  })
  const admission = client(baseUrl)

  for (const _retryAfter of retryAfterValues) {
    assert.deepEqual(await admission.verify({ token: "session-token", requestId: "public-request", signal: new AbortController().signal }), {
      ok: false,
      status: 429,
      code: "session_rate_limited",
    })
  }
})

test("IAM admission forwards Retry-After integer boundaries", async () => {
  const retryAfterValues = ["1", "86400"] as const
  let index = 0
  const baseUrl = await listen((_request, response) => {
    const retryAfter = retryAfterValues[index++]
    response.writeHead(429, responseHeaders({ "retry-after": retryAfter }))
    response.end(JSON.stringify({ error: { code: "RATE_LIMITED", message: "slow", retryable: true, details: [] } }))
  })
  const admission = client(baseUrl)

  for (const retryAfter of retryAfterValues) {
    assert.deepEqual(await admission.verify({ token: "session-token", requestId: "public-request", signal: new AbortController().signal }), {
      ok: false,
      status: 429,
      code: "session_rate_limited",
      retryAfter,
    })
  }
})

test("IAM admission fails closed on invalid response headers, envelopes, and statuses", async () => {
  const fixtures = [
    {
      status: 200,
      headers: responseHeaders({ "cache-control": "public" }),
      body: { data: { allowed: true, tenant_id: "tenant-a", user_id: "user-a", session_id: "session-a", client_id: "web-a" } },
    },
    {
      status: 200,
      headers: responseHeaders({ "x-request-id": "bad id" }),
      body: { data: { allowed: true, tenant_id: "tenant-a", user_id: "user-a", session_id: "session-a", client_id: "web-a" } },
    },
    { status: 400, headers: responseHeaders(), body: { error: { code: "INVALID_ARGUMENT", message: "bad", retryable: false, details: [], extra: true } } },
    { status: 418, headers: responseHeaders(), body: { error: { code: "INTERNAL", message: "tea", retryable: false, details: [] } } },
  ]
  let index = 0
  const baseUrl = await listen((_request, response) => {
    const fixture = fixtures[index++]
    response.writeHead(fixture.status, fixture.headers)
    response.end(JSON.stringify(fixture.body))
  })
  const admission = client(baseUrl)

  for (const _fixture of fixtures) {
    assert.deepEqual(await admission.verify({ token: "session-token", requestId: "public-request", signal: new AbortController().signal }), {
      ok: false,
      status: 503,
      code: "iam_admission_unavailable",
    })
  }
})

test("IAM admission does not follow redirects or retry transport failures", async () => {
  let attempts = 0
  const baseUrl = await listen((_request, response) => {
    attempts += 1
    response.writeHead(302, { location: "/internal/v1/session-authorizations/verify" }).end()
  })

  const result = await client(baseUrl).verify({ token: "session-token", requestId: "public-request", signal: new AbortController().signal })

  assert.deepEqual(result, { ok: false, status: 503, code: "iam_admission_unavailable" })
  assert.equal(attempts, 1)
})

test("IAM admission applies one deadline to slow headers and slow bodies", async () => {
  const slowHeaders = await listen((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, responseHeaders())
      response.end(JSON.stringify({ data: { allowed: true, tenant_id: "tenant-a", user_id: "user-a", session_id: "session-a", client_id: "web-a" } }))
    }, 100)
  })
  const slowBody = await listen((_request, response) => {
    response.writeHead(200, responseHeaders())
    response.write('{"data":')
    setTimeout(() => response.end('{"allowed":true}}'), 100)
  })

  for (const baseUrl of [slowHeaders, slowBody]) {
    assert.deepEqual(
      await client(baseUrl, { timeoutMs: 20 }).verify({ token: "session-token", requestId: "public-request", signal: new AbortController().signal }),
      { ok: false, status: 503, code: "iam_admission_unavailable" },
    )
  }
})

test("IAM admission enforces its response cap and caller cancellation", async () => {
  const oversized = await listen((_request, response) => {
    response.writeHead(200, responseHeaders())
    response.end(JSON.stringify({ data: { allowed: true, tenant_id: "tenant-a", user_id: "user-a", session_id: "session-a", client_id: "x".repeat(200) } }))
  })
  assert.deepEqual(
    await client(oversized, { maxResponseBytes: 64 }).verify({ token: "session-token", requestId: "public-request", signal: new AbortController().signal }),
    { ok: false, status: 503, code: "iam_admission_unavailable" },
  )

  let ownerClosed = false
  let ownerStarted!: () => void
  const started = new Promise<void>((resolve) => {
    ownerStarted = resolve
  })
  const pending = await listen((request, _response) => {
    ownerStarted()
    request.once("close", () => {
      ownerClosed = true
    })
  })
  const controller = new AbortController()
  const resultPromise = client(pending).verify({ token: "session-token", requestId: "public-request", signal: controller.signal })
  await started
  controller.abort()
  assert.deepEqual(await resultPromise, { ok: false, status: 503, code: "iam_admission_unavailable" })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(ownerClosed, true)
})

test("IAM admission rejects response headers that exceed its response cap", async () => {
  const oversizedHeader = await listen((_request, response) => {
    response.writeHead(200, responseHeaders({ "x-padding": "h".repeat(1024) }))
    response.end(JSON.stringify({ data: { allowed: true, tenant_id: "tenant-a", user_id: "user-a", session_id: "session-a", client_id: "web-a" } }))
  })
  assert.deepEqual(
    await client(oversizedHeader, { maxResponseBytes: 512 }).verify({
      token: "session-token",
      requestId: "public-request",
      signal: new AbortController().signal,
    }),
    { ok: false, status: 503, code: "iam_admission_unavailable" },
  )
})

test("IAM admission rejects a combined header and body size above its response cap", async () => {
  const combinedOverCap = await listen((_request, response) => {
    response.writeHead(200, responseHeaders({ "x-padding": "h".repeat(200) }))
    response.end(JSON.stringify({ data: { allowed: true, tenant_id: "tenant-a", user_id: "user-a", session_id: "session-a", client_id: "b".repeat(200) } }))
  })
  assert.deepEqual(
    await client(combinedOverCap, { maxResponseBytes: 512 }).verify({
      token: "session-token",
      requestId: "public-request",
      signal: new AbortController().signal,
    }),
    { ok: false, status: 503, code: "iam_admission_unavailable" },
  )
})
