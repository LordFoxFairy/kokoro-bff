import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import { createServer, IncomingMessage, ServerResponse } from "node:http"
import { Socket } from "node:net"
import { handleProjectGrantRequest } from "../src/http/routes/project-grants.js"
import { DEFAULT_AGUI_CONFIG, type BffConfig } from "../src/config/runtime.js"
import type { ProjectGrantStore, ProjectGrantReceipt, ProjectGrantCommand } from "../src/infrastructure/postgres/project-grants.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const config = {
  host: "127.0.0.1",
  port: 0,
  mode: "live",
  domain: "dev.kokoro.localhost",
  tenantId: "tenant",
  iamBaseUrl: null,
  iamWebOrigin: "https://web.example.test",
  sharedSecret: "test-secret",
  upstreamSecret: null,
  upstreamTimeoutMs: 1000,
  upstreamMaxResponseBytes: 65536,
  schedulerServiceToken: null,
  schedulerTargetUrl: null,
  agentEnabled: false,
  postgresUrl: null,
  redisUrl: null,
  agUi: DEFAULT_AGUI_CONFIG,
  upstreams: {},
} as BffConfig
const headers = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
  cookie: "kokoro-issuer.session_token=owner",
  origin: "https://web.example.test",
  "x-kokoro-request-id": "grant-test",
}
const access = {
  project_id: "project_fixture",
  role: "owner" as const,
  expires_at: null,
  access_version: "1",
  capabilities: ["read", "edit", "manage"] as const,
}
const path = "/v1/projects/project_fixture/grants/recipient"
const body = { role: "editor", expires_at: null }
const writeHeaders = {
  "content-type": "application/json",
  "idempotency-key": "intent",
  "if-match": '"1"',
}
const forbiddenStore = () => assert.fail("unexpected store operation")
const idleStore: ProjectGrantStore = {
  access: forbiddenStore,
  list: forbiddenStore,
  receipt: forbiddenStore,
  mutate: forbiddenStore,
}

async function fixture(t: TestContext, options: { members?: any; store?: Partial<ProjectGrantStore> } = {}) {
  const calls: ProjectGrantCommand[] = [],
    memberships: any[] = []
  const receipts = new Map<string, ProjectGrantReceipt>()
  const admission = new SessionAdmissionDouble({
    owner: { namespace: "tenant", userId: "owner" },
    viewer: { namespace: "tenant", userId: "viewer" },
  })
  const store: ProjectGrantStore = {
    ...idleStore,
    access: async (scope) => (scope.subjectId === "owner" ? access : { ...access, role: "viewer", capabilities: ["read"] }),
    receipt: async (key) => receipts.get(key) ?? null,
    mutate: async (command) => {
      calls.push(command)
      const data = {
        project_id: command.projectId,
        subject_id: command.targetSubjectId,
        role: command.body?.role ?? "editor",
        expires_at: command.body?.expires_at ?? null,
        revoked_at: command.body ? null : "2026-11-13T00:00:00.000Z",
        access_version: "2",
      } as const
      receipts.set(command.receiptScope, {
        fingerprint: command.fingerprint,
        data,
      })
      return { kind: "committed", data, replayed: false }
    },
    list: async () => ({ items: [], next: null }),
    ...options.store,
  }
  const members = async (input: any) => {
    memberships.push(input)
    return options.members ? options.members(input) : { ok: true, data: [{ user_id: "recipient" }], nextCursor: null }
  }
  const server = createServer((req, res) => {
    void handleProjectGrantRequest(req, res, config, admission, store, members)
      .then((handled) => {
        if (!handled) {
          res.writeHead(404)
          res.end()
        }
      })
      .catch((error) => {
        res.destroy(error)
      })
  })
  server.listen(0, "127.0.0.1")
  await new Promise<void>((resolve) => server.once("listening", resolve))
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  )
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const call = async (url = path, method = "PUT", payload?: unknown, extra: Record<string, string> = writeHeaders) => {
    if (payload === undefined && method === "PUT") payload = body
    const res = await fetch(`http://127.0.0.1:${address.port}${url}`, {
      method,
      headers: { ...headers, ...extra },
      ...(payload === undefined
        ? {}
        : {
            body: typeof payload === "string" ? payload : JSON.stringify(payload),
          }),
    })
    return {
      status: res.status,
      body: (await res.json()) as any,
      headers: res.headers,
    }
  }
  return { call, calls, memberships, admission }
}

test("Project grant wire closes body/CAS before membership or writes and never promotes viewer", async (t) => {
  const f = await fixture(t)
  for (const payload of [{ role: "editor" }, { ...body, owner_id: "forged" }, '{"role":"viewer","role":"editor","expires_at":null}', {}])
    assert.equal((await f.call(path, "PUT", payload)).status, 400)
  assert.equal((await f.call(path, "PUT", body, { ...writeHeaders, "if-match": "*" })).status, 400)
  assert.equal(
    (
      await f.call(path, "PUT", body, {
        "content-type": "application/json",
        "idempotency-key": "intent",
      })
    ).status,
    428,
  )
  assert.equal(
    (
      await f.call(path, "PUT", body, {
        ...writeHeaders,
        cookie: "kokoro-issuer.session_token=viewer",
      })
    ).status,
    403,
  )
  assert.equal(f.calls.length, 0)
  assert.equal(f.memberships.length, 0)
})

test("native owner grants current same-tenant recipient, exact original replay does not regrant or requery IAM", async (t) => {
  const f = await fixture(t)
  const saved = await f.call()
  assert.equal(saved.status, 200)
  assert.equal(saved.headers.get("cache-control"), "no-store")
  assert.equal(saved.headers.get("x-request-id"), "grant-test")
  assert.equal(saved.body.data.role, "editor")
  assert.equal(saved.body.data.access_version, "2")
  assert.equal(f.memberships.length, 1)
  assert.equal(f.memberships[0].subjectId, "owner")
  assert.equal(f.memberships[0].tenantId, "tenant")
  assert.deepEqual((await f.call()).body, saved.body)
  assert.equal(f.memberships.length, 1)
  assert.equal(f.calls.length, 1)
  assert.equal((await f.call(path, "PUT", { ...body, role: "viewer" })).status, 409)
  assert.equal(f.admission.calls.length, 3)
  const revoke = await f.call(path, "DELETE", undefined, {
    "idempotency-key": "revoke",
    "if-match": '"2"',
  })
  assert.equal(revoke.status, 200)
  assert.equal(f.memberships.length, 1)
})

test("membership pagination is bounded and incomplete or denied lookup never means target absent or writes", async (t) => {
  let n = 0
  const f = await fixture(t, {
    members: async () => ({ ok: true, data: [], nextCursor: `page-${++n}` }),
  })
  assert.equal((await f.call()).status, 503)
  assert.equal(f.memberships.length, 20)
  assert.equal(f.calls.length, 0)
  const denied = await fixture(t, {
    members: async () => ({
      ok: false,
      status: 403,
      code: "permission_denied",
    }),
  })
  assert.equal((await denied.call()).status, 403)
  assert.equal(denied.calls.length, 0)
  const absent = await fixture(t, {
    members: async () => ({ ok: true, data: [], nextCursor: null }),
  })
  assert.equal((await absent.call()).status, 409)
  assert.equal(absent.calls.length, 0)
})

test("grant page cursor is scoped and query closed while access reads reveal no grants", async (t) => {
  const f = await fixture(t)
  const cursor = Buffer.from(JSON.stringify(["other-tenant", "project_fixture", "recipient"])).toString("base64url")
  assert.equal((await f.call(`/v1/projects/project_fixture/grants?cursor=${cursor}`, "GET", undefined, {})).status, 400)
  assert.equal((await f.call("/v1/projects/project_fixture/grants?role=owner", "GET", undefined, {})).status, 400)
  const viewer = await f.call("/v1/projects/project_fixture/access", "GET", undefined, { cookie: "kokoro-issuer.session_token=viewer" })
  assert.equal(viewer.status, 200)
  assert.deepEqual(viewer.body.data.capabilities, ["read"])
  assert.equal(f.memberships.length, 0)
})

test("Project grant deadline terminates HTTP response as well as retiring the physical work", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const req = new IncomingMessage(new Socket()),
    res = new ServerResponse(req)
  req.method = "GET"
  req.url = "/v1/projects/project_fixture/access"
  req.headers = headers
  req.rawHeaders = Object.entries(headers).flatMap(([key, value]) => [key, value])
  let entered!: () => void
  const ready = new Promise<void>((resolve) => {
    entered = resolve
  })
  let retired = false
  const store: ProjectGrantStore = {
    ...idleStore,
    access: async (_scope, _project, signal) => {
      entered()
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            retired = true
            reject(Error("retired"))
          },
          { once: true },
        ),
      )
    },
  }
  const running = handleProjectGrantRequest(
    req,
    res,
    config,
    new SessionAdmissionDouble({
      owner: { namespace: "tenant", userId: "owner" },
    }),
    store,
  )
  await ready
  t.mock.timers.tick(10_000)
  await running
  assert.equal(retired, true)
  assert.equal(res.statusCode, 503)
  assert.equal(res.writableEnded, true)
})

test("explicit grant replay remains historical after its expiry; a new expired intent cannot renew it", async (t) => {
  let now = Date.now()
  t.mock.method(Date, "now", () => now)
  const f = await fixture(t),
    expiring = {
      role: "viewer",
      expires_at: new Date(now + 1000).toISOString(),
    }
  const first = await f.call(path, "PUT", expiring)
  assert.equal(first.status, 200)
  now += 1001
  assert.deepEqual((await f.call(path, "PUT", expiring)).body, first.body)
  assert.equal(f.calls.length, 1)
  assert.equal(f.memberships.length, 1)
  assert.equal(
    (
      await f.call(path, "PUT", expiring, {
        ...writeHeaders,
        "idempotency-key": "new-intent",
      })
    ).status,
    400,
  )
  assert.equal(f.calls.length, 1)
})
