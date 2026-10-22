import assert from "node:assert/strict"
import { createServer, request as nodeRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { afterEach, test } from "node:test"

import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import {
  zListModelLabelResponse,
  zListModelRevisionResponse,
  zListRoutingPolicyResponse,
  zPutRoutingPolicyResponse,
} from "../dist/generated/system-http/zod.gen.js"
import type { BffConfig } from "../src/config/runtime.ts"

const servers: Server[] = []
const tenantId = "tenant-admin"
const actorId = "user-admin"
const labelId = "11111111-1111-4111-8111-111111111111"
const revisionId = "22222222-2222-4222-8222-222222222222"
const now = "2026-10-06T15:00:00.000Z"

async function listen(server: Server): Promise<string> {
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

function config(systemBaseUrl: string, timeoutMs = 1000): BffConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId,
    iamBaseUrl: null,
    sharedSecret: "browser-secret",
    upstreamSecret: "owner-secret",
    upstreamTimeoutMs: timeoutMs,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { system: systemBaseUrl },
    platformProjection: { baseUrl: null, credentialFile: null, timeoutMs },
    skillDraft: { enabled: false, platformBaseUrl: null, credentialFile: null, timeoutMs },
  }
}

function admission(platformAdmin: boolean, namespace = tenantId) {
  const calls: AbortSignal[] = []
  return {
    calls,
    verify: async ({ signal }: { signal: AbortSignal }) => {
      calls.push(signal)
      return signal.aborted
        ? ({ ok: false, status: 503, code: "iam_admission_unavailable" } as const)
        : ({ ok: true, identity: { namespace, userId: actorId }, platformAdmin } as const)
    },
  }
}

function browserHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "browser-secret",
    authorization: "Bearer admitted-admin-session",
    ...extra,
  }
}

const routing = {
  model_revision_id: revisionId,
  visible: true,
  is_default: false,
  priority: 10,
  id: "33333333-3333-4333-8333-333333333333",
  tenant_id: tenantId,
  label_id: labelId,
  feature_key: "chat",
  version: "1",
  created_at: now,
  updated_at: now,
}
const label = {
  id: labelId,
  label_key: "chat.default",
  display_name: null,
  feature_key: "chat",
  default_revision_id: revisionId,
  version: "1",
  created_at: now,
  updated_at: now,
  deleted_at: null,
}
const revision = {
  id: revisionId,
  model_id: "44444444-4444-4444-8444-444444444444",
  provider_id: "55555555-5555-4555-8555-555555555555",
  revision: 1,
  provider_model_name: "fixture-model",
  display_name: "Fixture model",
  input_modalities: ["text"],
  output_modalities: ["text"],
  request_model: "fixture/model",
  connection: {
    protocol: "openai_chat_completions",
    connection_type: "direct",
    base_url: "https://models.fixture.invalid/v1",
    secret_handle_ref: "secret://fixture/model",
  },
  context_window: 8192,
  max_output_tokens: 1024,
  priority: 10,
  version: "1",
  digest: "a".repeat(64),
  published_at: now,
  retired_at: null,
  created_at: now,
  updated_at: now,
}

type OwnerCall = Readonly<{ method: string; path: string; headers: IncomingMessage["headers"]; body: unknown }>

async function ownerFixture(responder?: (request: IncomingMessage) => Promise<{ status: number; body: unknown }> | { status: number; body: unknown }) {
  const calls: OwnerCall[] = []
  const origin = await listen(
    createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const raw = Buffer.concat(chunks).toString("utf8")
      calls.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers, body: raw === "" ? null : JSON.parse(raw) })
      const result =
        (await responder?.(request)) ??
        ({
          status: 200,
          body:
            request.url?.includes("/labels") === true
              ? { data: { items: [label], next_cursor: "labels-next" } }
              : request.url?.includes("/revisions") === true
                ? { data: { items: [revision], next_cursor: null } }
                : request.method === "PUT"
                  ? { data: routing }
                  : { data: { items: [routing], next_cursor: "routing-next" } },
        } as const)
      response.writeHead(result.status, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "system-request" })
      response.end(JSON.stringify(result.body))
    }),
  )
  return { origin, calls }
}

async function bffFixture(systemBaseUrl: string, platformAdmin = true, timeoutMs = 1000) {
  const sessionAdmission = admission(platformAdmin)
  const origin = await listen(
    createBffServer(config(systemBaseUrl, timeoutMs), {
      businessStore: null,
      readiness: async () => undefined,
      sessionAdmission,
    }),
  )
  return { origin, admissionCalls: sessionAdmission.calls }
}

async function rawRequest(
  origin: string,
  path: string,
  method: string,
  headers: readonly (readonly [string, string])[],
  body?: Buffer,
): Promise<{ status: number; text: string }> {
  const target = new URL(path, origin)
  return new Promise((resolve, reject) => {
    const request = nodeRequest(
      { hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method, headers: [["Host", target.host], ...headers].flat() },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        response.on("end", () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }))
      },
    )
    request.on("error", reject)
    request.end(body)
  })
}

async function expectSuccess(response: Response, expectedData: unknown): Promise<void> {
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const requestId = response.headers.get("x-request-id")
  assert.match(requestId ?? "", /^[A-Za-z0-9._:-]{1,128}$/u)
  assert.deepEqual(await response.json(), { data: expectedData, meta: { request_id: requestId } })
}

test("System owner success fixtures satisfy the four pinned strict generated schemas", () => {
  assert.equal(zListRoutingPolicyResponse.safeParse({ data: { items: [routing], next_cursor: "routing-next" } }).success, true)
  assert.equal(zListModelLabelResponse.safeParse({ data: { items: [label], next_cursor: "labels-next" } }).success, true)
  assert.equal(zListModelRevisionResponse.safeParse({ data: { items: [revision], next_cursor: null } }).success, true)
  assert.equal(zPutRoutingPolicyResponse.safeParse({ data: routing }).success, true)
})

test("current platform administrator reaches each named System model-routing operation", async () => {
  const owner = await ownerFixture()
  const bff = await bffFixture(owner.origin)

  const routingResponse = await fetch(`${bff.origin}/v1/admin/model-routing?limit=50&cursor=routing-old`, { headers: browserHeaders() })
  assert.equal(routingResponse.status, 200)
  const routingRequestId = routingResponse.headers.get("x-request-id")
  assert.deepEqual(await routingResponse.json(), { data: [routing], meta: { request_id: routingRequestId, next_cursor: "routing-next" } })

  const labelsResponse = await fetch(`${bff.origin}/v1/admin/model-labels?limit=25&cursor=labels-old`, { headers: browserHeaders() })
  assert.equal(labelsResponse.status, 200)
  const labelsRequestId = labelsResponse.headers.get("x-request-id")
  assert.deepEqual(await labelsResponse.json(), { data: [label], meta: { request_id: labelsRequestId, next_cursor: "labels-next" } })

  const revisionsResponse = await fetch(`${bff.origin}/v1/admin/model-revisions?limit=10`, { headers: browserHeaders() })
  assert.equal(revisionsResponse.status, 200)
  const revisionsRequestId = revisionsResponse.headers.get("x-request-id")
  assert.deepEqual(await revisionsResponse.json(), { data: [revision], meta: { request_id: revisionsRequestId, next_cursor: null } })

  const updated = await fetch(`${bff.origin}/v1/admin/model-routing/${labelId}`, {
    method: "PUT",
    headers: browserHeaders({ "content-type": "application/json", "idempotency-key": "routing-write-1", "if-match": '"1"' }),
    body: JSON.stringify({ model_revision_id: revisionId, visible: true, is_default: false, priority: 10 }),
  })
  await expectSuccess(updated, routing)
  assert.equal(bff.admissionCalls.length, 4)
  assert.equal(
    bff.admissionCalls.every((signal) => !signal.aborted),
    true,
  )

  assert.deepEqual(
    owner.calls.map(({ method, path }) => [method, path]),
    [
      ["GET", "/v1/system/model-catalog/routing-policies?limit=50&cursor=routing-old"],
      ["GET", "/v1/system/model-catalog/labels?limit=25&cursor=labels-old"],
      ["GET", "/v1/system/model-catalog/revisions?limit=10"],
      ["PUT", `/v1/system/model-catalog/routing-policies/${labelId}`],
    ],
  )
  for (const [index, call] of owner.calls.entries()) {
    assert.equal(call.headers["x-kokoro-service"], "web-bff")
    assert.equal(call.headers["x-kokoro-tenant-id"], tenantId)
    assert.equal(call.headers["x-kokoro-actor-id"], actorId)
    assert.equal(call.headers["x-kokoro-iam-permissions"], index === 3 ? "system:write" : "system:read")
  }
  assert.equal(owner.calls[3]?.headers["idempotency-key"], "routing-write-1")
  assert.equal(owner.calls[3]?.headers["if-match"], '"1"')
})

test("non-admin and caller tenant claims fail closed before System", async () => {
  const owner = await ownerFixture()
  const bff = await bffFixture(owner.origin, false)
  for (const [path, headers] of [
    ["/v1/admin/model-routing", browserHeaders()],
    ["/v1/admin/model-labels", browserHeaders({ "x-kokoro-tenant-id": "tenant-attacker", "x-kokoro-actor-id": "attacker" })],
  ] as const) {
    const response = await fetch(`${bff.origin}${path}`, { headers })
    assert.equal(response.status, 403)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "admin_model_routing_forbidden")
  }
  assert.equal(bff.admissionCalls.length, 2)
  assert.equal(owner.calls.length, 0)
})

test("admin inputs reject unbounded pagination and ambiguous writes before System", async () => {
  const owner = await ownerFixture()
  const bff = await bffFixture(owner.origin)
  for (const query of ["limit=0", "limit=101", "cursor=", "unknown=x", "limit=2&limit=3"]) {
    const response = await fetch(`${bff.origin}/v1/admin/model-routing?${query}`, { headers: browserHeaders() })
    assert.equal(response.status, 400, query)
  }
  const body = JSON.stringify({ model_revision_id: revisionId, visible: false, is_default: false, priority: 0 })
  for (const extra of [
    { "content-type": "application/json", "idempotency-key": "write-1" },
    { "content-type": "application/json", "idempotency-key": "write-1", "if-match": '"1"', "if-none-match": "*" },
    { "content-type": "application/json", "if-match": '"1"' },
  ]) {
    const response = await fetch(`${bff.origin}/v1/admin/model-routing/${labelId}`, { method: "PUT", headers: browserHeaders(extra), body })
    assert.ok([400, 428].includes(response.status))
  }
  assert.equal(owner.calls.length, 0)
})

test("unknown owner success fields and owner failures are sanitized into stable BFF envelopes", async () => {
  let mode: "unknown" | "forbidden" = "unknown"
  const owner = await ownerFixture(() =>
    mode === "unknown"
      ? { status: 200, body: { data: { items: [routing], next_cursor: null }, owner_secret: "must-not-leak" } }
      : { status: 403, body: { error: { code: "FORBIDDEN", message: "owner secret", retryable: false } } },
  )
  const bff = await bffFixture(owner.origin)
  const malformed = await fetch(`${bff.origin}/v1/admin/model-routing`, { headers: browserHeaders() })
  assert.equal(malformed.status, 502)
  assert.equal(((await malformed.json()) as { error: { code: string } }).error.code, "admin_model_routing_response_invalid")
  mode = "forbidden"
  const forbidden = await fetch(`${bff.origin}/v1/admin/model-routing`, { headers: browserHeaders() })
  assert.equal(forbidden.status, 403)
  const body = await forbidden.text()
  assert.match(body, /admin_model_routing_forbidden/u)
  assert.doesNotMatch(body, /owner secret|must-not-leak/u)
})

test("a caller-aborted request is never dispatched to System", async () => {
  const owner = await ownerFixture()
  const bff = await bffFixture(owner.origin, true, 1)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(fetch(`${bff.origin}/v1/admin/model-routing`, { headers: browserHeaders(), signal: controller.signal }), /abort/u)
  assert.equal(owner.calls.length, 0)
})

test("owner error tuples preserve three conflicts and precondition while rejecting unknown combinations", async () => {
  let status = 409
  let code = "VERSION_CONFLICT"
  const owner = await ownerFixture(() => ({ status, body: { error: { code, message: "owner detail", retryable: status === 503 } } }))
  const bff = await bffFixture(owner.origin)
  const write = async (): Promise<{ status: number; code: string }> => {
    const response = await fetch(`${bff.origin}/v1/admin/model-routing/${labelId}`, {
      method: "PUT",
      headers: browserHeaders({ "content-type": "application/json", "idempotency-key": `tuple-${code}`, "if-match": '"1"' }),
      body: JSON.stringify({ model_revision_id: revisionId, visible: true, is_default: false, priority: 10 }),
    })
    return { status: response.status, code: ((await response.json()) as { error: { code: string } }).error.code }
  }
  for (const tuple of [
    [409, "VERSION_CONFLICT", 409, "admin_model_routing_version_conflict"],
    [409, "IDEMPOTENCY_KEY_REUSED", 409, "admin_model_routing_idempotency_conflict"],
    [409, "INVALID_STATE", 409, "admin_model_routing_invalid_state"],
    [428, "PRECONDITION_REQUIRED", 428, "admin_model_routing_precondition_required"],
    [403, "service_auth_failed", 503, "admin_model_routing_unavailable"],
    [503, "SYSTEM_UNAVAILABLE", 503, "admin_model_routing_unavailable"],
    [401, "UNAUTHENTICATED", 502, "admin_model_routing_response_invalid"],
    [400, "INVALID_CURSOR", 502, "admin_model_routing_response_invalid"],
    [418, "TEAPOT", 502, "admin_model_routing_response_invalid"],
    [400, "UNKNOWN", 502, "admin_model_routing_response_invalid"],
  ] as const) {
    ;[status, code] = tuple
    assert.deepEqual(await write(), { status: tuple[2], code: tuple[3] })
  }
})

test("each list maps only the formal INVALID_CURSOR owner tuple", async () => {
  let code = "INVALID_CURSOR"
  const owner = await ownerFixture(() => ({ status: 400, body: { error: { code, message: "owner detail", retryable: false } } }))
  const bff = await bffFixture(owner.origin)
  for (const path of ["/v1/admin/model-routing", "/v1/admin/model-labels", "/v1/admin/model-revisions"]) {
    const response = await fetch(`${bff.origin}${path}`, { headers: browserHeaders() })
    assert.equal(response.status, 400, path)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "invalid_admin_model_routing_request")
  }
  code = "INVALID_ARGUMENT"
  const invalidReadArgument = await fetch(`${bff.origin}/v1/admin/model-routing`, { headers: browserHeaders() })
  assert.equal(invalidReadArgument.status, 400)
  assert.equal(((await invalidReadArgument.json()) as { error: { code: string } }).error.code, "invalid_admin_model_routing_request")
})

test("non-named admin paths, GET write shapes and duplicate raw mutation headers never reach System", async () => {
  const owner = await ownerFixture()
  const bff = await bffFixture(owner.origin)
  const common: [string, string][] = Object.entries(browserHeaders())
  for (const path of ["/v1/admin/constructor", "/v1/admin/toString", "/v1/admin/__proto__"]) {
    assert.equal((await rawRequest(bff.origin, path, "GET", common)).status, 404)
  }
  for (const extra of [[["Idempotency-Key", "read-key"]], [["If-Match", '"1"']], [["If-None-Match", "*"]]] as const) {
    assert.equal((await rawRequest(bff.origin, "/v1/admin/model-routing", "GET", [...common, ...extra])).status, 400)
  }
  assert.equal((await rawRequest(bff.origin, "/v1/admin/model-routing", "GET", [...common, ["Content-Length", "2"]], Buffer.from("{}"))).status, 400)
  const writeBody = Buffer.from(JSON.stringify({ model_revision_id: revisionId, visible: true, is_default: false, priority: 10 }))
  assert.equal(
    (
      await rawRequest(
        bff.origin,
        `/v1/admin/model-routing/${labelId}`,
        "PUT",
        [
          ...common,
          ["Content-Type", "application/json"],
          ["Content-Length", String(writeBody.byteLength)],
          ["Idempotency-Key", "one"],
          ["Idempotency-Key", "two"],
          ["If-Match", '"1"'],
        ],
        writeBody,
      )
    ).status,
    400,
  )
  assert.equal(owner.calls.length, 0)
})

test("raw duplicate keys and invalid UTF-8 are rejected before an owner write", async () => {
  const owner = await ownerFixture()
  const bff = await bffFixture(owner.origin)
  const common: [string, string][] = [
    ...Object.entries(browserHeaders()),
    ["Content-Type", "application/json"],
    ["Idempotency-Key", "raw-write"],
    ["If-Match", '"1"'],
  ]
  const duplicate = Buffer.from(`{"model_revision_id":"${revisionId}","visible":false,"visible":true,"is_default":false,"priority":10}`)
  assert.equal(
    (await rawRequest(bff.origin, `/v1/admin/model-routing/${labelId}`, "PUT", [...common, ["Content-Length", String(duplicate.byteLength)]], duplicate))
      .status,
    400,
  )
  const invalidUtf8 = Buffer.concat([
    Buffer.from(`{"model_revision_id":"${revisionId}","visible":true,"is_default":false,"priority":10,"x":"`),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('"}'),
  ])
  assert.equal(
    (await rawRequest(bff.origin, `/v1/admin/model-routing/${labelId}`, "PUT", [...common, ["Content-Length", String(invalidUtf8.byteLength)]], invalidUtf8))
      .status,
    400,
  )
  assert.equal(owner.calls.length, 0)
})

test("strict valid owner routing rows remain bound to the admitted tenant and requested label", async () => {
  let wrong = { ...routing, tenant_id: "tenant-other" }
  const owner = await ownerFixture((request) => ({
    status: 200,
    body: request.method === "PUT" ? { data: wrong } : { data: { items: [wrong], next_cursor: null } },
  }))
  const bff = await bffFixture(owner.origin)
  const read = await fetch(`${bff.origin}/v1/admin/model-routing`, { headers: browserHeaders() })
  assert.equal(read.status, 502)
  assert.doesNotMatch(await read.text(), /tenant-other/u)
  wrong = { ...routing, label_id: "66666666-6666-4666-8666-666666666666" }
  const write = await fetch(`${bff.origin}/v1/admin/model-routing/${labelId}`, {
    method: "PUT",
    headers: browserHeaders({ "content-type": "application/json", "idempotency-key": "wrong-label", "if-match": '"1"' }),
    body: JSON.stringify({ model_revision_id: revisionId, visible: true, is_default: false, priority: 10 }),
  })
  assert.equal(write.status, 502)
  assert.doesNotMatch(await write.text(), /66666666/u)
})

test("one short backend budget covers slow request body and owner headers followed by a black hole", async () => {
  let ownerCalls = 0
  const slowOwner = await listen(
    createServer((_request, response) => {
      ownerCalls += 1
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "slow-owner" })
      response.flushHeaders()
    }),
  )
  const bff = await bffFixture(slowOwner, true, 5)
  const timed = await fetch(`${bff.origin}/v1/admin/model-routing`, { headers: browserHeaders() })
  assert.equal(timed.status, 503)
  assert.equal(((await timed.json()) as { error: { code: string } }).error.code, "admin_model_routing_unavailable")

  const body = Buffer.from(JSON.stringify({ model_revision_id: revisionId, visible: true, is_default: false, priority: 10 }))
  const target = new URL(`/v1/admin/model-routing/${labelId}`, bff.origin)
  const slowBody = await new Promise<number>((resolve, reject) => {
    const request = nodeRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "PUT",
        headers: {
          ...browserHeaders(),
          "content-type": "application/json",
          "content-length": body.byteLength,
          "idempotency-key": "slow-body",
          "if-match": '"1"',
        },
      },
      (response) => {
        response.resume()
        response.on("end", () => resolve(response.statusCode ?? 0))
      },
    )
    request.on("error", reject)
    request.write(body.subarray(0, 1))
    setTimeout(() => request.end(body.subarray(1)), 30)
  })
  assert.equal(slowBody, 503)
  assert.equal(ownerCalls, 1)
})

test("disconnect after admission starts but before it resolves never dispatches System", async () => {
  const owner = await ownerFixture()
  let release!: () => void
  let entered!: () => void
  const admitted = new Promise<void>((resolve) => (release = resolve))
  const started = new Promise<void>((resolve) => (entered = resolve))
  const bffServer = createBffServer(config(owner.origin), {
    businessStore: null,
    readiness: async () => undefined,
    sessionAdmission: {
      verify: async () => {
        entered()
        await admitted
        return { ok: true as const, identity: { namespace: tenantId, userId: actorId }, platformAdmin: true }
      },
    },
  })
  let observedClose!: () => void
  const responseClosed = new Promise<void>((resolve) => (observedClose = resolve))
  const onRequest = (incoming: IncomingMessage, response: ServerResponse): void => {
    if (incoming.url === "/v1/admin/model-routing") response.once("close", observedClose)
  }
  bffServer.on("request", onRequest)
  try {
    const bff = await listen(bffServer)
    const target = new URL("/v1/admin/model-routing", bff)
    const request = nodeRequest({ hostname: target.hostname, port: target.port, path: target.pathname, headers: browserHeaders() })
    request.on("error", () => undefined)
    request.end()
    await started
    request.destroy()
    await responseClosed
    release()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(owner.calls.length, 0)
  } finally {
    release()
    bffServer.removeListener("request", onRequest)
  }
})

test("named admin reads accept application/json Content-Type when the request has no body", async () => {
  const owner = await ownerFixture()
  const bff = await bffFixture(owner.origin)
  for (const path of ["/v1/admin/model-routing", "/v1/admin/model-labels", "/v1/admin/model-revisions"]) {
    const response = await fetch(`${bff.origin}${path}`, { headers: browserHeaders({ "content-type": "application/json" }) })
    assert.equal(response.status, 200, path)
  }
  assert.deepEqual(
    owner.calls.map(({ method, path }) => [method, path]),
    [
      ["GET", "/v1/system/model-catalog/routing-policies?limit=50"],
      ["GET", "/v1/system/model-catalog/labels?limit=50"],
      ["GET", "/v1/system/model-catalog/revisions?limit=50"],
    ],
  )
})

test("named admin reads accept formal System success responses without an owner Cache-Control header", async () => {
  const ownerCalls: string[] = []
  const owner = await listen(
    createServer((request, response) => {
      ownerCalls.push(request.url ?? "")
      const body =
        request.url?.includes("/labels") === true
          ? { data: { items: [label], next_cursor: null } }
          : request.url?.includes("/revisions") === true
            ? { data: { items: [revision], next_cursor: null } }
            : { data: { items: [routing], next_cursor: null } }
      response.writeHead(200, { "content-type": "application/json", "x-request-id": "system-without-cache-header" })
      response.end(JSON.stringify(body))
    }),
  )
  const bff = await bffFixture(owner)
  for (const path of ["/v1/admin/model-routing", "/v1/admin/model-labels", "/v1/admin/model-revisions"]) {
    const response = await fetch(`${bff.origin}${path}`, { headers: browserHeaders() })
    assert.equal(response.status, 200, path)
    assert.equal(response.headers.get("cache-control"), "no-store", path)
  }
  assert.deepEqual(ownerCalls, [
    "/v1/system/model-catalog/routing-policies?limit=50",
    "/v1/system/model-catalog/labels?limit=50",
    "/v1/system/model-catalog/revisions?limit=50",
  ])
})

test("System5 direct and LiteLLM snapshots pass through unchanged while legacy and malformed revisions fail closed", async () => {
  let row: Record<string, unknown> = revision
  const owner = await ownerFixture(() => ({ status: 200, body: { data: { items: [row], next_cursor: null } } }))
  const bff = await bffFixture(owner.origin)
  for (const connectionType of ["direct", "litellm"]) {
    row = { ...revision, connection: { ...revision.connection, connection_type: connectionType } }
    const response = await fetch(`${bff.origin}/v1/admin/model-revisions`, { headers: browserHeaders() })
    assert.equal(response.status, 200)
    assert.deepEqual(((await response.json()) as { data: unknown }).data, [row])
  }
  const { request_model: _requestModel, connection: _connection, ...legacyBase } = revision
  const { protocol: _protocol, ...missingProtocol } = revision.connection
  const { secret_handle_ref: _secret, ...missingSecret } = revision.connection
  for (const invalid of [
    { ...legacyBase, transport: "litellm", gateway_model_name: "legacy/fixture" },
    { ...revision, transport: "litellm", gateway_model_name: "legacy/fixture" },
    { ...legacyBase, connection: revision.connection },
    { ...legacyBase, request_model: revision.request_model },
    { ...revision, feature_key: "chat" },
    { ...revision, request_model: "" },
    { ...revision, request_model: "x".repeat(256) },
    { ...revision, connection: { ...revision.connection, protocol: "openai_responses" } },
    { ...revision, connection: { ...revision.connection, connection_type: "proxy" } },
    { ...revision, connection: missingProtocol },
    { ...revision, connection: missingSecret },
    { ...revision, connection: { ...revision.connection, base_url: "ftp://models.fixture.invalid" } },
    { ...revision, connection: { ...revision.connection, base_url: "https://models.fixture.invalid?token=private" } },
    { ...revision, connection: { ...revision.connection, secret_handle_ref: "bad secret value" } },
    { ...revision, connection: { ...revision.connection, api_key: "private-owner-material" } },
    { ...revision, unexpected: "private-owner-material" },
  ]) {
    row = invalid
    const response = await fetch(`${bff.origin}/v1/admin/model-revisions`, { headers: browserHeaders() })
    assert.equal(response.status, 502)
    const body = await response.text()
    assert.equal(JSON.parse(body).error.code, "admin_model_routing_response_invalid")
    assert.doesNotMatch(body, /legacy\/fixture|private-owner-material|private|models\.fixture/u)
  }
})

test("administrator creates a write-only model connection and recovers its identity with a separate machine credential", async () => {
  const provider = {
    id: revisionId,
    provider: "fixture",
    provider_key: "connection-one",
    display_name: "Shared connection",
    protocol: "openai_chat_completions",
    connection_type: "direct",
    base_url: "https://models.fixture.invalid/v1",
    secret_handle_ref: "model-key:fixture",
    priority: 0,
    version: "1",
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }
  const input = {
    provider: "fixture",
    provider_key: "connection-one",
    display_name: "Shared connection",
    protocol: "openai_chat_completions",
    connection_type: "direct",
    base_url: "https://models.fixture.invalid/v1",
    priority: 0,
    api_key: "fixture-key-not-real",
  }
  const calls: string[] = []
  const owner = await listen(
    createServer(async (request, response) => {
      assert.equal(request.headers["x-kokoro-service"], "model-management")
      assert.equal(request.headers["authorization"], "Bearer model-management-fixture-token")
      assert.equal(request.headers["x-kokoro-tenant-id"], tenantId)
      assert.equal(request.headers["x-kokoro-actor-id"], actorId)
      assert.equal(request.headers["x-kokoro-iam-permissions"], "system:write")
      calls.push(`${request.method} ${request.url}`)
      response.setHeader("content-type", "application/json")
      response.setHeader("cache-control", "no-store")
      response.setHeader("x-request-id", "owner-fixture")
      if (request.method === "POST") {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), input)
        assert.equal(request.headers["idempotency-key"], "model-create-one")
        response.writeHead(201)
        response.end(JSON.stringify({ data: provider }))
      } else response.end(JSON.stringify({ data: { provider_id: revisionId, credential_status: "stored", deleted_at: null } }))
    }),
  )
  const verified = admission(true)
  const bff = await listen(
    createBffServer(
      { ...config(owner), systemModelManagementToken: "model-management-fixture-token" },
      { businessStore: null, readiness: async () => undefined, sessionAdmission: verified },
    ),
  )
  const created = await fetch(`${bff}/v1/admin/model-providers`, {
    method: "POST",
    headers: browserHeaders({ "content-type": "application/json", "idempotency-key": "model-create-one" }),
    body: JSON.stringify(input),
  })
  assert.equal(created.status, 201)
  const text = await created.text()
  assert.equal(text.includes(input.api_key), false)
  assert.deepEqual(JSON.parse(text).data, provider)
  const recovered = await fetch(`${bff}/v1/admin/model-provider-creations?idempotency_key=model-create-one`, { headers: browserHeaders() })
  assert.equal(recovered.status, 200)
  assert.equal(recovered.headers.get("cache-control"), "no-store")
  assert.deepEqual((await recovered.json()).data, { provider_id: revisionId, credential_status: "stored", deleted_at: null })
  assert.equal(calls.length, 2)
})

test("model configuration rejects missing credentials, non-admins and invalid sensitive bodies before owner I/O", async () => {
  let ownerCalls = 0
  const owner = await listen(
    createServer((_request, response) => {
      ownerCalls++
      response.writeHead(500)
      response.end()
    }),
  )
  for (const [allowed, token, expected] of [
    [false, "model-management-fixture-token", 403],
    [true, null, 503],
  ] as const) {
    const bff = await listen(
      createBffServer(
        { ...config(owner), systemModelManagementToken: token },
        { businessStore: null, readiness: async () => undefined, sessionAdmission: admission(allowed) },
      ),
    )
    const response = await fetch(`${bff}/v1/admin/model-providers?limit=50`, { headers: browserHeaders() })
    assert.equal(response.status, expected)
  }
  const bff = await listen(
    createBffServer(
      { ...config(owner), systemModelManagementToken: "model-management-fixture-token" },
      { businessStore: null, readiness: async () => undefined, sessionAdmission: admission(true) },
    ),
  )
  for (const [path, method, body, extra, status] of [
    ["model-providers", "POST", { api_key: "fixture-secret-key", tenant_id: "forged" }, {}, 400],
    [`model-revisions/${revisionId}/publish`, "POST", undefined, {}, 428],
    [`model-labels/${labelId}`, "PATCH", { display_name: null }, {}, 428],
    ["model-provider-creations?idempotency_key=a&idempotency_key=b", "GET", undefined, {}, 400],
    ["model-provider-creations?idempotency_key=a&tenant_id=forged", "GET", undefined, {}, 400],
    ["model-providers", "POST", {}, { "if-match": '"1"' }, 400],
  ] as const) {
    const response = await fetch(`${bff}/v1/admin/${path}`, {
      method,
      headers: browserHeaders({
        ...(method === "GET" ? {} : { "idempotency-key": "sensitive-command" }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...extra,
      }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    assert.equal(response.status, status)
    assert.equal((await response.text()).includes("fixture-secret-key"), false)
  }
  assert.equal(ownerCalls, 0)
})

test("sensitive creation lookup preserves unconfirmed status and never retries writes or leaks owner messages", async () => {
  const methods: string[] = []
  const owner = await listen(
    createServer((request, response) => {
      methods.push(request.method ?? "")
      response.setHeader("content-type", "application/json")
      response.setHeader("x-request-id", "lookup-fixture")
      response.setHeader("cache-control", "no-store")
      response.writeHead(request.method === "GET" ? 404 : 503)
      response.end(
        JSON.stringify({
          error: { code: request.method === "GET" ? "NOT_FOUND" : "SYSTEM_UNAVAILABLE", message: "fixture-private-key", retryable: request.method !== "GET" },
        }),
      )
    }),
  )
  const bff = await listen(
    createBffServer(
      { ...config(owner), systemModelManagementToken: "model-management-fixture-token" },
      { businessStore: null, readiness: async () => undefined, sessionAdmission: admission(true) },
    ),
  )
  const input = {
    provider: "fixture",
    provider_key: "unknown-key",
    display_name: "Fixture",
    protocol: "openai_chat_completions",
    base_url: "https://model.fixture.invalid/v1",
    priority: 0,
    api_key: "fixture-private-key",
  }
  const first = await fetch(`${bff}/v1/admin/model-providers`, {
    method: "POST",
    headers: browserHeaders({ "content-type": "application/json", "idempotency-key": "original-sensitive-command" }),
    body: JSON.stringify(input),
  })
  assert.equal(first.status, 503)
  assert.equal((await first.text()).includes(input.api_key), false)
  const lookup = await fetch(`${bff}/v1/admin/model-provider-creations?idempotency_key=original-sensitive-command`, { headers: browserHeaders() })
  assert.equal(lookup.status, 404)
  assert.equal((await lookup.text()).includes(input.api_key), false)
  assert.deepEqual(methods, ["POST", "GET"])
})

test("configuration acknowledgements bind owner defaults without changing original command bytes", async () => {
  const cases = [
    {
      path: "model-providers",
      input: {
        provider: "fixture",
        provider_key: "connection-default",
        display_name: "Default connection",
        protocol: "openai_chat_completions",
        base_url: "https://models.fixture.invalid/v1",
        priority: 0,
        api_key: "fixture-key",
      },
      reply: {
        id: revisionId,
        provider: "fixture",
        provider_key: "connection-default",
        display_name: "Default connection",
        protocol: "openai_chat_completions",
        connection_type: "litellm",
        base_url: "https://models.fixture.invalid/v1",
        secret_handle_ref: "model-key:fixture",
        priority: 0,
        version: "1",
        created_at: now,
        updated_at: now,
        deleted_at: null,
      },
    },
    {
      path: "model-labels",
      input: { label_key: label.label_key, feature_key: label.feature_key, default_revision_id: label.default_revision_id },
      reply: { ...label, display_name: "unexpected alias" },
    },
  ]
  for (const entry of cases) {
    let calls = 0
    const owner = await listen(
      createServer(async (request, response) => {
        calls++
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), entry.input)
        response.setHeader("content-type", "application/json")
        response.setHeader("x-request-id", "default-fixture")
        response.setHeader("cache-control", "no-store")
        response.writeHead(201)
        response.end(JSON.stringify({ data: entry.reply }))
      }),
    )
    const bff = await listen(
      createBffServer(
        { ...config(owner), systemModelManagementToken: "model-management-fixture-token" },
        { businessStore: null, readiness: async () => undefined, sessionAdmission: admission(true) },
      ),
    )
    const result = await fetch(`${bff}/v1/admin/${entry.path}`, {
      method: "POST",
      headers: browserHeaders({ "content-type": "application/json", "idempotency-key": "default-protected-command" }),
      body: JSON.stringify(entry.input),
    })
    assert.equal(result.status, 502)
    assert.equal(calls, 1)
  }
})

test("a response parsed after the absolute model configuration deadline is never acknowledged", async () => {
  const { systemModelConfiguration } = await import("../dist/infrastructure/clients/owner/system-model-configuration.js")
  const originalFetch = globalThis.fetch,
    originalParse = JSON.parse,
    originalNow = Date.now
  const started = originalNow(),
    deadlineAt = started + 10_000
  let clock = started
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: { items: [], next_cursor: null } }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "deadline-fixture" },
      })
    Date.now = () => clock
    JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
      const value = originalParse(...args)
      clock = deadlineAt + 1
      return value
    }) as typeof JSON.parse
    const result = await systemModelConfiguration({
      baseUrl: "https://fixture.invalid",
      secret: "model-management-fixture-token",
      tenantId,
      actorId,
      requestId: "deadline-fixture",
      signal: new AbortController().signal,
      deadlineAt,
      maxResponseBytes: 1024 * 1024,
      operation: "providers",
      query: new URLSearchParams(),
    })
    assert.deepEqual(result, { ok: false, status: 503, code: "admin_model_routing_unavailable" })
  } finally {
    globalThis.fetch = originalFetch
    JSON.parse = originalParse
    Date.now = originalNow
  }
})

test("upstream provider candidates use the explicit management read with trusted identity and no body or pagination", async () => {
  const candidate = { provider_id: revisionId, items: [{ id: "vendor/model" }] }
  const owner = await ownerFixture(() => ({ status: 200, body: { data: candidate } }))
  const verified = admission(true)
  const origin = await listen(
    createBffServer(
      { ...config(owner.origin), adminWebSharedSecret: "admin-browser-secret", systemModelManagementToken: "model-management-fixture-token" },
      { businessStore: null, readiness: async () => undefined, sessionAdmission: verified },
    ),
  )
  const response = await fetch(`${origin}/v1/admin/model-providers/${revisionId}/upstream-models`, {
    headers: browserHeaders({
      "x-kokoro-service": "admin-web-bff",
      "x-kokoro-internal-secret": "admin-browser-secret",
      "x-kokoro-user-id": "forged",
      "x-kokoro-tenant-id": "forged",
    }),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const result = (await response.json()) as { data: unknown; meta: { request_id: string } }
  assert.deepEqual(result.data, candidate)
  assert.equal(result.meta.request_id, response.headers.get("x-request-id"))
  assert.equal(owner.calls.length, 1)
  const call = owner.calls[0]!
  assert.equal(call.path, `/v1/system/model-catalog/providers/${revisionId}/upstream-models`)
  assert.equal(call.headers["x-kokoro-service"], "model-management")
  assert.equal(call.headers.authorization, "Bearer model-management-fixture-token")
  assert.equal(call.headers["x-kokoro-iam-permissions"], "system:write")
  assert.equal(call.headers["x-kokoro-actor-id"], actorId)
  assert.equal(call.headers["x-kokoro-tenant-id"], tenantId)
  assert.equal(call.headers["content-type"], undefined)
  assert.equal(call.headers["content-length"], undefined)
  assert.equal(call.body, null)
})

test("upstream provider candidates reject non-admins and missing management credentials without owner I/O", async () => {
  const owner = await ownerFixture(() => ({ status: 200, body: { data: { provider_id: revisionId, items: [] } } }))
  for (const [platformAdmin, key, status] of [
    [false, "manager-fixture", 403],
    [true, null, 503],
  ] as const) {
    const origin = await listen(
      createBffServer(
        { ...config(owner.origin), systemModelManagementToken: key },
        { businessStore: null, readiness: async () => undefined, sessionAdmission: admission(platformAdmin) },
      ),
    )
    const result = await fetch(`${origin}/v1/admin/model-providers/${revisionId}/upstream-models`, {
      headers: browserHeaders({ "x-kokoro-platform-admin": "true", "x-kokoro-tenant-id": "forged" }),
    })
    assert.equal(result.status, status)
  }
  assert.equal(owner.calls.length, 0)
})

test("upstream provider candidates reject all query, body framing and command headers before owner I/O", async () => {
  const owner = await ownerFixture()
  const origin = await listen(
    createBffServer(
      { ...config(owner.origin), systemModelManagementToken: "manager-fixture" },
      { businessStore: null, readiness: async () => undefined, sessionAdmission: admission(true) },
    ),
  )
  const path = `/v1/admin/model-providers/${revisionId}/upstream-models`
  const normal = Object.entries(browserHeaders())
  for (const [name, value] of [
    ["content-length", "0"],
    ["content-type", "application/json"],
    ["idempotency-key", "fixture"],
    ["if-match", '"1"'],
    ["if-none-match", "*"],
    ["transfer-encoding", "chunked"],
  ]) {
    const response = await rawRequest(origin, path, "GET", [...normal, [name!, value!]], name === "transfer-encoding" ? Buffer.alloc(0) : undefined)
    assert.equal(response.status, 400, name)
  }
  for (const query of ["limit=50", "cursor=opaque", "url=ignored", "tenant_id=forged"])
    assert.equal((await fetch(`${origin}${path}?${query}`, { headers: browserHeaders() })).status, 400)
  assert.equal(owner.calls.length, 0)
})

test("upstream provider candidates bind the exact provider and strictly reject credential-bearing or malformed owner data", async () => {
  for (const data of [
    { provider_id: labelId, items: [] },
    { provider_id: revisionId, items: [{ id: "model", api_key: "fixture-secret" }] },
    { provider_id: revisionId, items: [], secret_handle_ref: "fixture-secret" },
    { provider_id: revisionId, items: [{ id: "" }] },
  ]) {
    const owner = await ownerFixture(() => ({ status: 200, body: { data } }))
    const origin = await listen(
      createBffServer(
        { ...config(owner.origin), systemModelManagementToken: "manager-fixture" },
        { businessStore: null, readiness: async () => undefined, sessionAdmission: admission(true) },
      ),
    )
    const response = await fetch(`${origin}/v1/admin/model-providers/${revisionId}/upstream-models`, { headers: browserHeaders() })
    assert.equal(response.status, 502)
    assert.equal((await response.text()).includes("fixture-secret"), false)
    assert.equal(owner.calls.length, 1)
  }
})

test("upstream provider candidate owner failures are stable, sanitized and never retried", async () => {
  for (const [status, code, retryable, expected] of [
    [503, "MODEL_UNAVAILABLE", false, 503],
    [503, "MODEL_UNAVAILABLE", true, 503],
    [403, "POLICY_DENIED", false, 403],
    [404, "NOT_FOUND", false, 404],
    [403, "service_auth_failed", false, 503],
    [503, "unknown_supplier_error", true, 502],
  ] as const) {
    const owner = await ownerFixture(() => ({ status, body: { error: { code, message: "fixture-secret", retryable } } }))
    const origin = await listen(
      createBffServer(
        { ...config(owner.origin), systemModelManagementToken: "manager-fixture" },
        { businessStore: null, readiness: async () => undefined, sessionAdmission: admission(true) },
      ),
    )
    const response = await fetch(`${origin}/v1/admin/model-providers/${revisionId}/upstream-models`, { headers: browserHeaders() })
    assert.equal(response.status, expected, code)
    assert.equal((await response.text()).includes("fixture-secret"), false)
    assert.equal(owner.calls.length, 1)
  }
})

test("upstream provider candidate deadline cancels the actual upstream response socket", { timeout: 2000 }, async () => {
  let sends = 0
  let closed!: () => void
  const done = new Promise<void>((resolve) => {
    closed = resolve
  })
  const owner = await listen(
    createServer((_request, response) => {
      sends++
      response.once("close", closed)
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "fixture" })
      response.write('{"data":')
    }),
  )
  const origin = await listen(
    createBffServer(
      { ...config(owner, 50), systemModelManagementToken: "manager-fixture" },
      { businessStore: null, readiness: async () => undefined, sessionAdmission: admission(true) },
    ),
  )
  const response = await fetch(`${origin}/v1/admin/model-providers/${revisionId}/upstream-models`, { headers: browserHeaders() })
  assert.equal(response.status, 503)
  await done
  assert.equal(sends, 1)
})

test("upstream provider candidate deadline includes fresh admission without restarting the budget", async () => {
  const owner = await ownerFixture()
  const originalNow = Date.now
  let clock = originalNow()
  try {
    Date.now = () => clock
    const source = {
      verify: async () => {
        clock += 11_000
        return { ok: true, identity: { namespace: tenantId, userId: actorId }, platformAdmin: true } as const
      },
    }
    const origin = await listen(
      createBffServer(
        { ...config(owner.origin, 10_000), systemModelManagementToken: "manager-fixture" },
        { businessStore: null, readiness: async () => undefined, sessionAdmission: source },
      ),
    )
    const result = await fetch(`${origin}/v1/admin/model-providers/${revisionId}/upstream-models`, { headers: browserHeaders() })
    assert.equal(result.status, 503)
    assert.equal(owner.calls.length, 0)
  } finally {
    Date.now = originalNow
  }
})

test("upstream provider candidates parsed after the absolute deadline are not returned", async () => {
  const { systemModelConfiguration } = await import("../dist/infrastructure/clients/owner/system-model-configuration.js")
  const originalFetch = globalThis.fetch,
    originalParse = JSON.parse,
    originalNow = Date.now
  const deadlineAt = originalNow() + 10_000
  const prepared = new Response(JSON.stringify({ data: { provider_id: revisionId, items: [] } }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "fixture" },
  })
  let clock = deadlineAt - 1000
  try {
    globalThis.fetch = async () => prepared
    Date.now = () => clock
    JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
      const result = originalParse(...args)
      clock = deadlineAt + 1
      return result
    }) as typeof JSON.parse
    const result = await systemModelConfiguration({
      baseUrl: "https://fixture.invalid",
      secret: "manager-fixture",
      tenantId,
      actorId,
      requestId: "fixture",
      signal: new AbortController().signal,
      deadlineAt,
      maxResponseBytes: 1024 * 1024,
      operation: "upstreamModels",
      id: revisionId,
      query: new URLSearchParams(),
    })
    assert.deepEqual(result, { ok: false, status: 503, code: "admin_model_routing_unavailable" })
  } finally {
    globalThis.fetch = originalFetch
    JSON.parse = originalParse
    Date.now = originalNow
  }
})

test("upstream provider candidate caller cancellation closes the owner socket without retry", { timeout: 2000 }, async () => {
  let started!: () => void,
    closed!: () => void,
    sends = 0
  const seen = new Promise<void>((resolve) => {
      started = resolve
    }),
    done = new Promise<void>((resolve) => {
      closed = resolve
    })
  const owner = await listen(
    createServer((_request, response) => {
      sends++
      response.once("close", closed)
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "fixture" })
      response.write('{"data":')
      started()
    }),
  )
  const origin = await listen(
    createBffServer(
      { ...config(owner), systemModelManagementToken: "manager-fixture" },
      { businessStore: null, readiness: async () => undefined, sessionAdmission: admission(true) },
    ),
  )
  const abort = new AbortController(),
    pending = fetch(`${origin}/v1/admin/model-providers/${revisionId}/upstream-models`, { headers: browserHeaders(), signal: abort.signal })
  await seen
  abort.abort()
  await assert.rejects(pending)
  await done
  assert.equal(sends, 1)
})

test("upstream provider candidate reads require owner no-store and the complete one-MiB response budget", async () => {
  const data = JSON.stringify({ data: { provider_id: revisionId, items: [] } })
  for (const [cache, body] of [
    [null, data],
    ["no-store", " ".repeat(1024 * 1024) + data],
  ] as const) {
    let sends = 0
    const owner = await listen(
      createServer((_request, response) => {
        sends++
        response.writeHead(200, { "content-type": "application/json", "x-request-id": "fixture", ...(cache === null ? {} : { "cache-control": cache }) })
        response.end(body)
      }),
    )
    const origin = await listen(
      createBffServer(
        { ...config(owner), systemModelManagementToken: "manager-fixture" },
        { businessStore: null, readiness: async () => undefined, sessionAdmission: admission(true) },
      ),
    )
    assert.equal((await fetch(`${origin}/v1/admin/model-providers/${revisionId}/upstream-models`, { headers: browserHeaders() })).status, 502)
    assert.equal(sends, 1)
  }
})

for (const mode of ["deadline", "abort"] as const)
  test(`upstream provider candidate owner error decoding rechecks ${mode} before mapping status`, async () => {
    const { systemModelConfiguration } = await import("../dist/infrastructure/clients/owner/system-model-configuration.js")
    const originalFetch = globalThis.fetch,
      originalParse = JSON.parse,
      originalNow = Date.now
    const prepared = new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "fixture", retryable: false } }), {
      status: 404,
      headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "fixture" },
    })
    const deadlineAt = originalNow() + 10_000,
      controller = new AbortController()
    let clock = deadlineAt - 1000,
      parses = 0
    try {
      globalThis.fetch = async () => prepared
      Date.now = () => clock
      JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
        const result = originalParse(...args)
        parses++
        if (mode === "deadline") clock = deadlineAt + 1
        else controller.abort()
        return result
      }) as typeof JSON.parse
      const result = await systemModelConfiguration({
        baseUrl: "https://fixture.invalid",
        secret: "manager-fixture",
        tenantId,
        actorId,
        requestId: "fixture",
        signal: controller.signal,
        deadlineAt,
        maxResponseBytes: 1024 * 1024,
        operation: "upstreamModels",
        id: revisionId,
        query: new URLSearchParams(),
      })
      assert.equal(parses, 1)
      assert.deepEqual(result, { ok: false, status: 503, code: "admin_model_routing_unavailable" })
    } finally {
      globalThis.fetch = originalFetch
      JSON.parse = originalParse
      Date.now = originalNow
    }
  })
