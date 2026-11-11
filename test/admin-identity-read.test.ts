import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { afterEach, test } from "node:test"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import type { SessionAdmission } from "../src/auth/session-admission.types.ts"
import type { BffConfig } from "../src/config/runtime.ts"
import { startAccountTestApp } from "./doubles/account-app.ts"
import { fixtureIamCredentials } from "./doubles/iam-credentials.ts"
import { fixtureSessionCookie, fixtureSessionHeaders, TEST_WEB_ORIGIN } from "./doubles/session-admission.ts"

const servers: Server[] = []
const tenantId = "tenant-admin"
const adminToken = "admin-session"
const { iamUserContextServiceCredentialFile } = await fixtureIamCredentials(tenantId)

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
    tenantId,
    iamBaseUrl,
    iamWebOrigin: TEST_WEB_ORIGIN,
    iamUserContextServiceCredentialFile,
    sharedSecret: "web-secret",
    adminWebSharedSecret: "admin-secret",
    upstreamSecret: null,
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {},
    platformProjection: { baseUrl: null, credentialFile: null, timeoutMs: 1000 },
    skillDraft: { enabled: false, platformBaseUrl: null, credentialFile: null, timeoutMs: 1000 },
  }
}

function admission(platformAdmin: boolean): SessionAdmission {
  return {
    async verify({ cookie }) {
      if (cookie !== fixtureSessionCookie(adminToken)) return { ok: false, status: 401, code: "session_invalid" }
      return {
        ok: true,
        identity: { namespace: tenantId, userId: "user-admin" },
        platformAdmin,
        expiresAt: "2099-01-01T00:00:00.000Z",
        setCookies: [],
      }
    },
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-kokoro-service": "admin-web-bff", "x-kokoro-internal-secret": "admin-secret", ...fixtureSessionHeaders(adminToken), ...extra }
}

function page(kind: string): object {
  if (kind === "members")
    return {
      data: [{ member_id: "member-1", user_id: "user-1", display_name: "Member", image_url: null, roles: ["owner"], joined_at: "2026-10-09T12:00:00.000Z" }],
      meta: { next_cursor: null },
    }
  if (kind === "invitations")
    return {
      data: [
        {
          invitation_id: "invite-1",
          email: "member@example.test",
          roles: ["member"],
          status: "pending",
          created_at: "2026-10-09T12:00:00.000Z",
          expires_at: "2026-10-10T12:00:00.000Z",
        },
      ],
      meta: { next_cursor: null },
    }
  return { data: [{ role_id: null, name: "owner", kind: "builtin", permissions: { member: ["read"], tenant: ["read"] } }], meta: { next_cursor: null } }
}

test("administrator identity reads expose only the admitted tenant and accepted page query", async (t) => {
  const calls: string[] = []
  const iam = await listen(
    createServer((request, response) => {
      calls.push(request.url ?? "")
      const kind = request.url?.split("?")[0]?.split("/").at(-1) ?? ""
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-admin-1" })
      response.end(JSON.stringify(page(kind)))
    }),
  )
  const { base: bff, close } = await startAccountTestApp(config(iam), admission(true))
  t.after(close)

  for (const kind of ["members", "invitations", "roles"]) {
    const response = await fetch(`${bff}/v1/admin/identity/${kind}?limit=2&cursor=opaque`, { headers: headers({ "x-kokoro-tenant-id": "attacker" }) })
    assert.equal(response.status, 200, kind)
    assert.equal(response.headers.get("cache-control"), "no-store")
    const body = (await response.json()) as { meta: { next_cursor: string | null } }
    assert.equal(body.meta.next_cursor, null)
  }
  assert.deepEqual(calls, [
    `/internal/v1/tenants/${tenantId}/members?limit=2&cursor=opaque`,
    `/internal/v1/tenants/${tenantId}/invitations?limit=2&cursor=opaque`,
    `/internal/v1/tenants/${tenantId}/roles?limit=2&cursor=opaque`,
  ])
})

test("administrator identity reads reject ordinary users, malformed routes and malformed pages before IAM", async (t) => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls += 1
      response.writeHead(500).end()
    }),
  )
  const { base: adminBff, close: closeAdmin } = await startAccountTestApp(config(iam), admission(true))
  t.after(closeAdmin)
  const { base: ordinaryBff, close: closeOrdinary } = await startAccountTestApp(config(iam), admission(false))
  t.after(closeOrdinary)

  assert.equal((await fetch(`${ordinaryBff}/v1/admin/identity/members`, { headers: headers() })).status, 403)
  for (const target of ["members?limit=0", "members?limit=101", "members?cursor=", "members?tenant_id=attacker", "unknown"]) {
    assert.equal((await fetch(`${adminBff}/v1/admin/identity/${target}`, { headers: headers() })).status, target === "unknown" ? 403 : 400, target)
  }
  assert.equal(calls, 0)
})
