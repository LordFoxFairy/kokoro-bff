import assert from "node:assert/strict"
import { createServer, request as httpRequest, type Server } from "node:http"
import { afterEach, test } from "node:test"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { createBffServer } from "../dist/bootstrap/server.js"
import type { BffConfig } from "../src/config/runtime.ts"
import { createLiveTestBffServer } from "./doubles/server.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const servers: Server[] = []

function config(): BffConfig {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant-server",
    iamBaseUrl: null,
    sharedSecret: "test-secret",
    upstreamSecret: "upstream-secret",
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {
      system: null,
      capability: null,
      scheduler: null,
      agents: null,
      billing: null,
      music: null,
    },
  }
}

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
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

test("GET /v1/me projects only the online IAM-admitted Product identity", async () => {
  const iamCalls: string[] = []
  const iam = await listen(
    createServer((request, response) => {
      iamCalls.push(request.headers.authorization ?? "")
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-request" })
      response.end(
        JSON.stringify({ data: { allowed: true, tenant_id: "tenant-server", user_id: "user-trusted", session_id: "session-secret", client_id: "web-client" } }),
      )
    }),
  )
  const bff = await listen(createBffServer({ ...config(), iamBaseUrl: iam }, { businessStore: null, readiness: async () => undefined }))
  const response = await fetch(`${bff}/v1/me`, {
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      authorization: "Bearer product-token",
      "x-kokoro-namespace": "tenant-forged",
      "x-kokoro-principal-id": "user-forged",
      "x-kokoro-tenant-id": "tenant-forged",
      "x-request-id": "me-request",
    },
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("x-request-id"), "me-request")
  assert.deepEqual(await response.json(), { data: { user_id: "user-trusted", tenant_id: "tenant-server" }, meta: { request_id: "me-request" } })
  assert.deepEqual(iamCalls, ["Bearer product-token"])
  const forgedQuery = await fetch(`${bff}/v1/me?tenant_id=tenant-forged`, {
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      authorization: "Bearer product-token",
    },
  })
  assert.equal(forgedQuery.status, 400)
  assert.equal(((await forgedQuery.json()) as { error: { code: string } }).error.code, "current_user_query_invalid")
  assert.equal(iamCalls.length, 2)
  const bodyStatus = await new Promise<number>((resolve, reject) => {
    const upload = httpRequest(
      `${bff}/v1/me`,
      {
        method: "GET",
        headers: {
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "test-secret",
          authorization: "Bearer product-token",
          "content-type": "application/json",
          "content-length": "2",
        },
      },
      (reply) => {
        reply.resume()
        resolve(reply.statusCode ?? 0)
      },
    )
    upload.once("error", reject)
    upload.end("{}")
  })
  assert.equal(bodyStatus, 400)
  assert.equal(iamCalls.length, 3)
})

test("GET /v1/me preserves fixed-tenant and IAM denial semantics without business store", async () => {
  const iamCalls: string[] = []
  const iam = await listen(
    createServer((request, response) => {
      const bearer = request.headers.authorization ?? ""
      iamCalls.push(bearer)
      const status = bearer === "Bearer foreign-token" ? 200 : bearer === "Bearer rate-token" ? 429 : 401
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-request-id": "iam-request",
        ...(status === 429 ? { "retry-after": "60" } : {}),
      })
      response.end(
        status === 200
          ? JSON.stringify({
              data: { allowed: true, tenant_id: "tenant-foreign", user_id: "user-foreign", session_id: "session-foreign", client_id: "web-client" },
            })
          : JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "private IAM detail", retryable: status === 429, details: [] } }),
      )
    }),
  )
  const bff = await listen(createBffServer({ ...config(), iamBaseUrl: iam }, { businessStore: null, readiness: async () => undefined }))
  const headers = { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret" }
  const untrusted = await fetch(`${bff}/v1/me`, { headers: { ...headers, "x-kokoro-internal-secret": "wrong", authorization: "Bearer revoked-token" } })
  assert.equal(untrusted.status, 403)
  assert.equal(((await untrusted.json()) as { error: { code: string } }).error.code, "service_auth_failed")
  assert.equal(iamCalls.length, 0)
  const cases = [
    { authorization: undefined, status: 401, code: "session_authentication_required" },
    { authorization: "Bearer revoked-token", status: 401, code: "session_invalid" },
    { authorization: "Bearer foreign-token", status: 403, code: "product_tenant_forbidden" },
    { authorization: "Bearer rate-token", status: 429, code: "session_rate_limited" },
  ] as const
  for (const item of cases) {
    const response = await fetch(`${bff}/v1/me`, {
      headers: { ...headers, ...(item.authorization === undefined ? {} : { authorization: item.authorization }) },
    })
    assert.equal(response.status, item.status)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.match(response.headers.get("x-request-id") ?? "", /^[A-Za-z0-9_-]{1,128}$/u)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, item.code)
    assert.equal(response.headers.get("retry-after"), item.status === 429 ? "60" : null)
  }
  assert.deepEqual(iamCalls, ["Bearer revoked-token", "Bearer foreign-token", "Bearer rate-token"])
  const missingConfig = await listen(
    createBffServer({ ...config(), iamBaseUrl: iam, tenantId: null }, { businessStore: null, readiness: async () => undefined }),
  )
  const missing = await fetch(`${missingConfig}/v1/me`, { headers: { ...headers, authorization: "Bearer foreign-token" } })
  assert.equal(missing.status, 503)
  assert.equal(((await missing.json()) as { error: { code: string } }).error.code, "product_tenant_not_configured")
  assert.equal(iamCalls.length, 3)
  const unavailable = await listen(createBffServer({ ...config(), iamBaseUrl: null }, { businessStore: null, readiness: async () => undefined }))
  const dependency = await fetch(`${unavailable}/v1/me`, { headers: { ...headers, authorization: "Bearer revoked-token" } })
  assert.equal(dependency.status, 503)
  assert.equal(((await dependency.json()) as { error: { code: string } }).error.code, "iam_admission_unavailable")
})

test("legacy identity headers cannot authorize a user request without a session bearer", async () => {
  let routeCalls = 0
  const server = createLiveTestBffServer(config(), {
    routeHandler: async ({ response }): Promise<void> => {
      routeCalls += 1
      response.writeHead(204).end()
    },
  })
  const base = await listen(server)

  const response = await fetch(`${base}/v1/projects`, {
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      "x-kokoro-namespace": "attacker-tenant",
      "x-kokoro-principal-id": "attacker-user",
    },
  })

  assert.equal(response.status, 401)
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "session_authentication_required")
  assert.equal(routeCalls, 0)
})

test("the default production composition fails user traffic and readiness closed when IAM is not configured", async () => {
  const server = createBffServer(config(), {
    businessStore: null,
    readiness: async (): Promise<void> => undefined,
  })
  const base = await listen(server)

  const ready = await fetch(`${base}/readyz`)
  const user = await fetch(`${base}/v1/projects`, {
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      authorization: "Bearer token",
    },
  })

  assert.equal(ready.status, 503)
  assert.equal(user.status, 503)
  assert.equal(((await user.json()) as { error: { code: string } }).error.code, "iam_admission_unavailable")
})

test("service and bearer rejection happen before IAM and route work", async () => {
  const admission = new SessionAdmissionDouble({ token: { namespace: "tenant-a", userId: "user-a" } })
  let routeCalls = 0
  const server = createLiveTestBffServer(config(), {
    sessionAdmission: admission,
    routeHandler: async ({ response }): Promise<void> => {
      routeCalls += 1
      response.writeHead(204).end()
    },
  })
  const base = await listen(server)

  const badService = await fetch(`${base}/v1/projects`, {
    headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "wrong", authorization: "Bearer token" },
  })
  const missingBearer = await fetch(`${base}/v1/projects`, {
    headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret" },
  })

  assert.equal(badService.status, 403)
  assert.equal(((await badService.json()) as { error: { code: string } }).error.code, "service_auth_failed")
  assert.equal(missingBearer.status, 401)
  assert.equal(((await missingBearer.json()) as { error: { code: string } }).error.code, "session_authentication_required")
  assert.equal(admission.calls.length, 0)
  assert.equal(routeCalls, 0)
})

test("missing fixed Product tenant fails before IAM and business work without changing service-only or issuer paths", async () => {
  const admission = new SessionAdmissionDouble({ token: { namespace: "tenant-a", userId: "user-a" } })
  let routeCalls = 0
  const server = createLiveTestBffServer(
    { ...config(), tenantId: null },
    {
      sessionAdmission: admission,
      routeHandler: async ({ response }): Promise<void> => {
        routeCalls += 1
        response.writeHead(204).end()
      },
      sharedSessionReader: {
        findSharedSession: () => ({ session_id: "session-share" }),
        readSession: () => ({ session_id: "session-share" }),
      },
    },
  )
  const base = await listen(server)
  const headers = { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret", authorization: "Bearer token" }

  const user = await fetch(`${base}/v1/projects`, { headers })
  const share = await fetch(`${base}/v1/shared/share-a`, { headers })
  const manifest = await fetch(`${base}/v1/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=user-web`, { headers })
  const issuer = await fetch(`${base}/iam/get-session`, { headers })

  assert.equal(user.status, 503)
  assert.equal(((await user.json()) as { error: { code: string } }).error.code, "product_tenant_not_configured")
  assert.equal(user.headers.get("cache-control"), "no-store")
  assert.match(user.headers.get("x-request-id") ?? "", /^[A-Za-z0-9_-]{1,128}$/u)
  assert.equal(share.status, 200)
  assert.equal(manifest.status, 503)
  assert.equal(((await manifest.json()) as { error: { code: string } }).error.code, "upstream_not_configured")
  assert.equal(issuer.status, 503)
  assert.equal(((await issuer.json()) as { error: { code: string } }).error.code, "iam_relay_unavailable")
  assert.equal(admission.calls.length, 0)
  assert.equal(routeCalls, 0)
})

test("foreign IAM tenant is denied before body parsing, receipt claim, Team or owner I/O despite forged tenant headers", async () => {
  const admission = new SessionAdmissionDouble({ token: { namespace: "tenant-other", userId: "user-other" } })
  const idempotency = new Map()
  let routeCalls = 0
  const server = createLiveTestBffServer(
    { ...config(), tenantId: "tenant-fixed" },
    {
      sessionAdmission: admission,
      idempotency,
      routeHandler: async ({ response }): Promise<void> => {
        routeCalls += 1
        response.writeHead(204).end()
      },
    },
  )
  const base = await listen(server)
  const headers = {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    authorization: "Bearer token",
    "x-kokoro-tenant-id": "tenant-fixed",
    "x-kokoro-namespace": "tenant-fixed",
    "x-kokoro-principal-id": "forged",
  }
  const mutation = await fetch(`${base}/v1/projects`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "idempotency-key": "fixed-tenant-key" },
    body: "not-json",
  })
  const team = await fetch(`${base}/v1/team/members`, { headers })

  for (const response of [mutation, team]) {
    assert.equal(response.status, 403)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "product_tenant_forbidden")
    assert.equal(response.headers.get("cache-control"), "no-store")
  }
  assert.equal(admission.calls.length, 2)
  assert.equal(idempotency.size, 0)
  assert.equal(routeCalls, 0)
})

test("the IAM identity replaces malicious legacy identity headers", async () => {
  const admission = new SessionAdmissionDouble({ token: { namespace: "tenant-iam", userId: "user-iam" } })
  let capturedIdentity: unknown
  const server = createLiveTestBffServer(
    { ...config(), tenantId: "tenant-iam" },
    {
      sessionAdmission: admission,
      routeHandler: async ({ response, context }): Promise<void> => {
        capturedIdentity = context.identity
        response.writeHead(204).end()
      },
    },
  )
  const base = await listen(server)

  const response = await fetch(`${base}/v1/projects`, {
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      authorization: "Bearer token",
      "x-kokoro-namespace": "tenant-attacker",
      "x-kokoro-principal-id": "user-attacker",
    },
  })

  assert.equal(response.status, 204)
  assert.deepEqual(capturedIdentity, { namespace: "tenant-iam", userId: "user-iam" })
  assert.equal(admission.calls.length, 1)
})

test("a revoked session is denied before an existing idempotency result can replay", async () => {
  const admission = new SessionAdmissionDouble({ token: { namespace: "tenant-a", userId: "user-a" } })
  let routeCalls = 0
  const server = createLiveTestBffServer(
    { ...config(), tenantId: "tenant-a" },
    {
      sessionAdmission: admission,
      routeHandler: async ({ response }): Promise<void> => {
        routeCalls += 1
        response.writeHead(200, { "content-type": "application/json" }).end('{"data":{"ok":true}}')
      },
    },
  )
  const base = await listen(server)
  const init = {
    method: "POST",
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      authorization: "Bearer token",
      "content-type": "application/json",
      "idempotency-key": "same-key",
    },
    body: JSON.stringify({ value: 1 }),
  }

  assert.equal((await fetch(`${base}/v1/projects`, init)).status, 200)
  admission.deny("token", { ok: false, status: 401, code: "session_invalid" })
  const denied = await fetch(`${base}/v1/projects`, init)

  assert.equal(denied.status, 401)
  assert.equal(((await denied.json()) as { error: { code: string } }).error.code, "session_invalid")
  assert.equal(admission.calls.length, 2)
  assert.equal(routeCalls, 1)
})

test("duplicate raw Authorization headers are rejected before IAM", async () => {
  const admission = new SessionAdmissionDouble({ first: { namespace: "tenant-a", userId: "user-a" } })
  const server = createLiveTestBffServer(config(), {
    sessionAdmission: admission,
    routeHandler: async ({ response }): Promise<void> => {
      response.writeHead(204).end()
    },
  })
  const base = new URL(await listen(server))

  const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(
      {
        host: base.hostname,
        port: Number(base.port),
        path: "/v1/projects",
        method: "GET",
        headers: {
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "test-secret",
          authorization: ["Bearer first", "Bearer second"],
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }))
      },
    )
    request.once("error", reject)
    request.end()
  })

  assert.equal(result.status, 401)
  assert.equal((JSON.parse(result.body) as { error: { code: string } }).error.code, "session_authentication_required")
  assert.equal(admission.calls.length, 0)
})

test("IAM rate limiting forwards only the admitted Retry-After value", async () => {
  const admission = new SessionAdmissionDouble()
  admission.deny("limited", { ok: false, status: 429, code: "session_rate_limited", retryAfter: "60" })
  const server = createLiveTestBffServer(config(), { sessionAdmission: admission })
  const base = await listen(server)

  const response = await fetch(`${base}/v1/projects`, {
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      authorization: "Bearer limited",
    },
  })

  assert.equal(response.status, 429)
  assert.equal(response.headers.get("retry-after"), "60")
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.match(response.headers.get("x-request-id") ?? "", /^[A-Za-z0-9_-]{1,128}$/u)
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "session_rate_limited")
})

test("the HTTP boundary drops an uncontrolled Retry-After returned by an invalid admission implementation", async () => {
  const admission = new SessionAdmissionDouble()
  admission.deny("limited", { ok: false, status: 429, code: "session_rate_limited", retryAfter: "99999" })
  const server = createLiveTestBffServer(config(), { sessionAdmission: admission })
  const base = await listen(server)

  const response = await fetch(`${base}/v1/projects`, {
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      authorization: "Bearer limited",
    },
  })

  assert.equal(response.status, 429)
  assert.equal(response.headers.get("retry-after"), null)
})

test("disconnecting during admission aborts IAM and prevents route work", async () => {
  let admissionStarted!: () => void
  const started = new Promise<void>((resolve) => {
    admissionStarted = resolve
  })
  let observedAbort!: () => void
  const aborted = new Promise<void>((resolve) => {
    observedAbort = resolve
  })
  let routeCalls = 0
  const admission = {
    verify: async ({ signal }: { signal: AbortSignal }): Promise<{ ok: false; status: 503; code: string }> => {
      admissionStarted()
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener("abort", () => resolve(), { once: true })
      })
      observedAbort()
      return { ok: false, status: 503, code: "iam_admission_unavailable" }
    },
  }
  const server = createLiveTestBffServer(config(), {
    sessionAdmission: admission,
    routeHandler: async ({ response }): Promise<void> => {
      routeCalls += 1
      response.writeHead(204).end()
    },
  })
  const base = new URL(await listen(server))
  const request = httpRequest({
    host: base.hostname,
    port: Number(base.port),
    path: "/v1/projects",
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      authorization: "Bearer pending",
    },
  })
  request.on("error", () => undefined)
  request.end()
  await started
  request.destroy()
  await aborted

  assert.equal(routeCalls, 0)
})

test("Share, runtime manifest, and Scheduler callback remain separate service boundaries", async () => {
  const admission = new SessionAdmissionDouble()
  const server = createLiveTestBffServer(config(), {
    sessionAdmission: admission,
    sharedSessionReader: {
      findSharedSession: () => ({ session_id: "session-share" }),
      readSession: () => ({ session_id: "session-share" }),
    },
  })
  const base = await listen(server)
  const serviceHeaders = {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    authorization: "Bearer irrelevant-extra-header",
  }

  const share = await fetch(`${base}/v1/shared/share-a`, { headers: serviceHeaders })
  const manifest = await fetch(`${base}/v1/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=user-web`, { headers: serviceHeaders })
  const scheduler = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, { method: "POST", headers: serviceHeaders })

  assert.equal(share.status, 200)
  assert.equal(manifest.status, 503)
  assert.equal(((await manifest.json()) as { error: { code: string } }).error.code, "upstream_not_configured")
  assert.equal(scheduler.status, 401)
  assert.equal(admission.calls.length, 0)
})
