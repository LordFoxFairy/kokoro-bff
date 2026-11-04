import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { afterEach, test } from "node:test"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import type { BffConfig } from "../src/config/runtime.ts"
import { startAccountTestApp } from "./doubles/account-app.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
import { fixtureIamCredentials, TEST_IAM_USER_CONTEXT_SECRET } from "./doubles/iam-credentials.ts"

const credentials = await fixtureIamCredentials("tenant-verified")

const servers: Server[] = []
const appClosers: Array<() => Promise<void>> = []

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
  const results = await Promise.allSettled([
    ...appClosers.splice(0).map(async (close) => close()),
    ...servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  ])
  const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
  if (failures.length > 0) throw new AggregateError(failures, "Team HTTP fixture cleanup failed")
})

function config(iamBaseUrl: string): BffConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant-verified",
    iamBaseUrl,
    iamWebOrigin: "https://web.example.test",
    ...credentials,
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

async function startTeamBff(owner: string): Promise<string> {
  const app = await startAccountTestApp(config(owner), new SessionAdmissionDouble({ "team-token": { namespace: "tenant-verified", userId: "user-1" } }))
  appClosers.push(() => app.close())
  return app.base
}

function memberPage(): object {
  return {
    data: [{ member_id: "member-1", user_id: "user-1", display_name: "Member", image_url: null, roles: ["owner"], joined_at: "2026-09-23T12:00:00.000Z" }],
    meta: { next_cursor: "cursor-next" },
  }
}

function userHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    cookie: "kokoro-issuer.session_token=team-token",
    origin: "https://web.example.test",
    ...extra,
  }
}

test("Team read uses only admitted tenant, actor and service credential, projects owner data and cursor without cache", async () => {
  const observed: Array<{ path: string; method: string; headers: IncomingMessage["headers"] }> = []
  const owner = await listen(
    createServer((request, response) => {
      observed.push({ path: request.url ?? "", method: request.method ?? "", headers: request.headers })
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-team-1" })
      response.end(JSON.stringify(memberPage()))
    }),
  )
  const bff = await startTeamBff(owner)

  const response = await fetch(`${bff}/v1/team/members?limit=2&cursor=cursor-old`, {
    headers: userHeaders({ "x-kokoro-tenant-id": "tenant-attacker", "x-kokoro-principal-id": "user-attacker", "x-kokoro-actor-id": "user-attacker" }),
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
  assert.equal(observed[0]?.headers.authorization, `Bearer ${TEST_IAM_USER_CONTEXT_SECRET}`)
  assert.equal(observed[0]?.headers["x-kokoro-actor-id"], "user-1")
  assert.equal(observed[0]?.headers.cookie, undefined)
  assert.equal(observed[0]?.headers.origin, undefined)
  assert.equal(observed[0]?.headers["x-kokoro-tenant-id"], undefined)
  assert.equal(observed[0]?.headers["x-kokoro-principal-id"], undefined)
})

test("Team rejects malformed pagination and missing session before owner I/O", async () => {
  let ownerCalls = 0
  const owner = await listen(
    createServer((_request, response) => {
      ownerCalls += 1
      response.writeHead(500).end()
    }),
  )
  const bff = await startTeamBff(owner)
  for (const query of ["limit=0", "limit=101", "limit=2&limit=3", "cursor=", "unknown=x"]) {
    const response = await fetch(`${bff}/v1/team/roles?${query}`, { headers: userHeaders() })
    assert.equal(response.status, 400, query)
  }
  const noSession = await fetch(`${bff}/v1/team/roles`, {
    headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret", origin: "https://web.example.test" },
  })
  assert.equal(noSession.status, 401)
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
  const bff = await startTeamBff(owner)
  const limited = await fetch(`${bff}/v1/team/members`, { headers: userHeaders() })
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get("retry-after"), "60")
  assert.doesNotMatch(await limited.text(), /secret owner message/u)
  status = 401
  const unavailable = await fetch(`${bff}/v1/team/members`, { headers: userHeaders() })
  assert.equal(unavailable.status, 503)
  assert.equal(((await unavailable.clone().json()) as { error: { code: string } }).error.code, "team_owner_unavailable")
  assert.doesNotMatch(await unavailable.text(), /secret owner message/u)
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
    roles: {
      data: [
        {
          role_id: null,
          name: "owner",
          kind: "builtin",
          permissions: {
            organization: ["update"],
            member: ["create", "read", "update", "delete"],
            invitation: ["create", "read", "cancel"],
            ac: ["create", "read", "update"],
            tenant: ["read"],
            audit: ["read"],
            platform: ["execute"],
            skill: [
              "create_draft",
              "create_version",
              "begin_upload",
              "complete_upload",
              "abort_upload",
              "validate_draft",
              "publish",
              "withdraw",
              "set_status",
              "install",
              "set_installation_enabled",
              "remove_installation",
              "update_draft",
              "discard_draft",
              "set_publication_audience",
            ],
          },
        },
        {
          role_id: null,
          name: "admin",
          kind: "builtin",
          permissions: {
            organization: ["update"],
            member: ["create", "read", "update", "delete"],
            invitation: ["create", "read", "cancel"],
            ac: ["read"],
            tenant: ["read"],
            audit: ["read"],
            platform: ["execute"],
            skill: [
              "create_draft",
              "create_version",
              "begin_upload",
              "complete_upload",
              "abort_upload",
              "validate_draft",
              "publish",
              "withdraw",
              "set_status",
              "install",
              "set_installation_enabled",
              "remove_installation",
              "update_draft",
              "discard_draft",
              "set_publication_audience",
            ],
          },
        },
        { role_id: null, name: "member", kind: "builtin", permissions: { member: ["read"], ac: ["read"], tenant: ["read"], platform: ["execute"] } },
      ],
      meta: { next_cursor: null },
    },
  }
  const owner = await listen(
    createServer((request, response) => {
      const kind = request.url?.split("?")[0]?.split("/").at(-1) ?? ""
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-team-3" })
      response.end(JSON.stringify(pages[kind]))
    }),
  )
  const bff = await startTeamBff(owner)
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
  const bff = await startTeamBff(owner)
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
  const bff = await startTeamBff(owner)
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

for (const [label, permissions] of Object.entries({
  unknownDomain: { platform: ["execute"], unknown: ["read"] },
  unknownPlatformAction: { platform: ["unknown"] },
  unknownSkillAction: { skill: ["unknown"] },
  emptyPlatform: { platform: [] },
  emptySkill: { skill: [] },
})) {
  test(`SET13 Team rejects ${label} in the actual owner response`, async () => {
    const owner = await listen(
      createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-set13" })
        response.end(JSON.stringify({ data: [{ role_id: null, name: "member", kind: "builtin", permissions }], meta: { next_cursor: null } }))
      }),
    )
    const bff = await startTeamBff(owner)
    const response = await fetch(`${bff}/v1/team/roles`, { headers: userHeaders() })
    assert.equal(response.status, 502)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "team_owner_response_invalid")
  })
}
