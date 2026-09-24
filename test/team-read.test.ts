import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { afterEach, test } from "node:test"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { createBffServer } from "../dist/bootstrap/server.js"
import type { BffConfig } from "../src/config/runtime.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const servers: Server[] = []

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

function config(iamBaseUrl: string): BffConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: null,
    iamBaseUrl,
    sharedSecret: "test-secret",
    upstreamSecret: null,
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 4096,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {},
  }
}

function memberPage(): object {
  return {
    data: [{ member_id: "member-1", user_id: "user-1", display_name: "Member", image_url: null, roles: ["owner"], joined_at: "2026-09-23T12:00:00.000Z" }],
    meta: { next_cursor: "cursor-next" },
  }
}

function userHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret", authorization: "Bearer team-token", ...extra }
}

test("Team read uses only admitted tenant and bearer, projects owner data and cursor without cache", async () => {
  const observed: Array<{ path: string; method: string; headers: IncomingMessage["headers"] }> = []
  const owner = await listen(
    createServer((request, response) => {
      observed.push({ path: request.url ?? "", method: request.method ?? "", headers: request.headers })
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-team-1" })
      response.end(JSON.stringify(memberPage()))
    }),
  )
  const bff = await listen(
    createBffServer(config(owner), {
      businessStore: null,
      readiness: async () => undefined,
      sessionAdmission: new SessionAdmissionDouble({ "team-token": { namespace: "tenant-verified", userId: "user-1" } }),
    }),
  )

  const response = await fetch(`${bff}/v1/team/members?limit=2&cursor=cursor-old`, {
    headers: userHeaders({ "x-kokoro-tenant-id": "tenant-attacker", "x-kokoro-principal-id": "user-attacker" }),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.match(response.headers.get("x-request-id") ?? "", /^[A-Za-z0-9_-]{1,128}$/u)
  assert.deepEqual(await response.json(), {
    data: (memberPage() as { data: unknown }).data,
    meta: { request_id: response.headers.get("x-request-id"), next_cursor: "cursor-next" },
  })
  assert.equal(observed.length, 1)
  assert.equal(observed[0]?.path, "/internal/v1/tenants/tenant-verified/members?limit=2&cursor=cursor-old")
  assert.equal(observed[0]?.method, "GET")
  assert.equal(observed[0]?.headers.authorization, "Bearer team-token")
  assert.equal(observed[0]?.headers["x-kokoro-tenant-id"], undefined)
  assert.equal(observed[0]?.headers["x-kokoro-principal-id"], undefined)
})

test("Team rejects malformed pagination and missing bearer before owner I/O", async () => {
  let ownerCalls = 0
  const owner = await listen(
    createServer((_request, response) => {
      ownerCalls += 1
      response.writeHead(500).end()
    }),
  )
  const bff = await listen(
    createBffServer(config(owner), {
      businessStore: null,
      readiness: async () => undefined,
      sessionAdmission: new SessionAdmissionDouble({ "team-token": { namespace: "tenant-verified", userId: "user-1" } }),
    }),
  )
  for (const query of ["limit=0", "limit=101", "limit=2&limit=3", "cursor=", "unknown=x"]) {
    const response = await fetch(`${bff}/v1/team/roles?${query}`, { headers: userHeaders() })
    assert.equal(response.status, 400, query)
  }
  const noBearer = await fetch(`${bff}/v1/team/roles`, { headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret" } })
  assert.equal(noBearer.status, 401)
  assert.equal(ownerCalls, 0)
})

test("Team owner errors are sanitized and malformed owner success fails closed", async () => {
  let status = 429
  const owner = await listen(
    createServer((_request, response) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-team-2", "retry-after": "60" })
      response.end(
        JSON.stringify(
          status !== 200
            ? { error: { code: status === 429 ? "RATE_LIMITED" : "UNAUTHENTICATED", message: "secret owner message", retryable: status === 429, details: [] } }
            : { ...memberPage(), secret: "owner-secret" },
        ),
      )
    }),
  )
  const bff = await listen(
    createBffServer(config(owner), {
      businessStore: null,
      readiness: async () => undefined,
      sessionAdmission: new SessionAdmissionDouble({ "team-token": { namespace: "tenant-verified", userId: "user-1" } }),
    }),
  )
  const limited = await fetch(`${bff}/v1/team/members`, { headers: userHeaders() })
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get("retry-after"), "60")
  assert.doesNotMatch(await limited.text(), /secret owner message/u)
  status = 401
  const revoked = await fetch(`${bff}/v1/team/members`, { headers: userHeaders() })
  assert.equal(revoked.status, 401)
  assert.doesNotMatch(await revoked.text(), /secret owner message/u)
  status = 200
  const malformed = await fetch(`${bff}/v1/team/members`, { headers: userHeaders() })
  assert.equal(malformed.status, 502)
  assert.doesNotMatch(await malformed.text(), /owner-secret/u)
})

test("invitations and roles use their distinct generated owner schemas", async () => {
  const pages: Record<string, object> = {
    invitations: {
      data: [
        {
          invitation_id: "invite-1",
          email: "member@example.test",
          roles: ["member"],
          status: "pending",
          created_at: "2026-09-23T12:00:00.000Z",
          expires_at: "2026-09-24T12:00:00.000Z",
        },
      ],
      meta: { next_cursor: null },
    },
    roles: { data: [{ role_id: null, name: "owner", kind: "builtin", permissions: { member: ["read"], tenant: ["read"] } }], meta: { next_cursor: null } },
  }
  const owner = await listen(
    createServer((request, response) => {
      const kind = request.url?.split("?")[0]?.split("/").at(-1) ?? ""
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-team-3" })
      response.end(JSON.stringify(pages[kind]))
    }),
  )
  const bff = await listen(
    createBffServer(config(owner), {
      businessStore: null,
      readiness: async () => undefined,
      sessionAdmission: new SessionAdmissionDouble({ "team-token": { namespace: "tenant-verified", userId: "user-1" } }),
    }),
  )
  for (const kind of ["invitations", "roles"] as const) {
    const response = await fetch(`${bff}/v1/team/${kind}`, { headers: userHeaders() })
    assert.equal(response.status, 200, kind)
    const wire = (await response.json()) as { data: unknown; meta: { next_cursor: string | null } }
    assert.deepEqual(wire.data, (pages[kind] as { data: unknown }).data)
    assert.equal(wire.meta.next_cursor, null)
  }
})

test("Team rejects owner cache drift, invalid media, oversized body and unexpected status", async () => {
  let mode = "cache"
  const owner = await listen(
    createServer((_request, response) => {
      const headers = {
        "content-type": mode === "media" ? "text/html" : "application/json",
        "cache-control": mode === "cache" ? "public, max-age=600" : "no-store",
        "x-request-id": "iam-team-4",
      }
      response.writeHead(mode === "status" ? 302 : 200, headers)
      response.end(JSON.stringify(mode === "size" ? { ...memberPage(), padding: "x".repeat(8192) } : memberPage()))
    }),
  )
  const bff = await listen(
    createBffServer(config(owner), {
      businessStore: null,
      readiness: async () => undefined,
      sessionAdmission: new SessionAdmissionDouble({ "team-token": { namespace: "tenant-verified", userId: "user-1" } }),
    }),
  )
  for (mode of ["cache", "media", "size", "status"]) {
    const response = await fetch(`${bff}/v1/team/members`, { headers: userHeaders() })
    assert.equal(response.status, 502, mode)
    assert.equal(response.headers.get("cache-control"), "no-store")
  }
})

test("disconnecting the browser cancels the in-flight IAM Team read", async () => {
  let reachedOwner!: () => void
  let ownerClosed!: () => void
  const reached = new Promise<void>((resolve) => {
    reachedOwner = resolve
  })
  const closed = new Promise<void>((resolve) => {
    ownerClosed = resolve
  })
  const owner = await listen(
    createServer((_request, response) => {
      response.once("close", ownerClosed)
      reachedOwner()
    }),
  )
  const bff = await listen(
    createBffServer(config(owner), {
      businessStore: null,
      readiness: async () => undefined,
      sessionAdmission: new SessionAdmissionDouble({ "team-token": { namespace: "tenant-verified", userId: "user-1" } }),
    }),
  )
  const abort = new AbortController()
  const browser = fetch(`${bff}/v1/team/roles`, { headers: userHeaders(), signal: abort.signal })
  await reached
  abort.abort()
  await assert.rejects(browser)
  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("IAM Team I/O was not cancelled")), 1000)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
})
