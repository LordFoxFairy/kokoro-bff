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
  display_name: "Chat default",
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
  feature_key: "chat",
  input_modalities: ["text"],
  output_modalities: ["text"],
  transport: "litellm",
  gateway_model_name: "fixture/model",
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
