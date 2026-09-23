import assert from "node:assert/strict"
import { request as httpRequest, type Server } from "node:http"
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

test("the IAM identity replaces malicious legacy identity headers", async () => {
  const admission = new SessionAdmissionDouble({ token: { namespace: "tenant-iam", userId: "user-iam" } })
  let capturedIdentity: unknown
  const server = createLiveTestBffServer(config(), {
    sessionAdmission: admission,
    routeHandler: async ({ response, context }): Promise<void> => {
      capturedIdentity = context.identity
      response.writeHead(204).end()
    },
  })
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
  const server = createLiveTestBffServer(config(), {
    sessionAdmission: admission,
    routeHandler: async ({ response }): Promise<void> => {
      routeCalls += 1
      response.writeHead(200, { "content-type": "application/json" }).end('{"data":{"ok":true}}')
    },
  })
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
