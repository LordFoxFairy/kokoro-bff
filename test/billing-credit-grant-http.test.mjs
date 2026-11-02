import assert from "node:assert/strict"
import { createServer, request as nodeRequest } from "node:http"
import { afterEach, test } from "node:test"
import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
const servers = []
async function listen(server) {
  servers.push(server)
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  return `http://127.0.0.1:${address.port}`
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections()
          server.close(resolve)
        }),
    ),
  )
})
const command = {
  funding_id: "11111111-1111-4111-8111-111111111111",
  subject_id: "recipient",
  amount_credits: "1000",
  reason: "Non-cash acceptance",
  effective_at: "2026-01-01T00:00:00.000Z",
}
const ids = {
  account_id: "22222222-2222-4222-8222-222222222222",
  grant_id: "33333333-3333-4333-8333-333333333333",
  journal_id: "44444444-4444-4444-8444-444444444444",
}
const u1 = (value) => "u1." + Buffer.from(value).toString("base64url")
const browserHeaders = {
  "x-kokoro-service": "admin-web-bff",
  "x-kokoro-internal-secret": "admin-browser-secret",
  authorization: "Bearer current-admin-session",
  "content-type": "application/json",
  "idempotency-key": "original-funding-key",
  "x-kokoro-request-id": "funding-request-1",
}
function reply(response, status, data) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-request-id": "funding-request-1",
  })
  response.end(JSON.stringify(data))
}
async function setup(options = {}) {
  const ownerCalls = [],
    memberCalls = [],
    admissions = []
  const iam = await listen(
    createServer(async (request, response) => {
      memberCalls.push({
        url: request.url,
        authorization: request.headers.authorization,
      })
      if (options.members) {
        await options.members(request, response, memberCalls.length)
        return
      }
      reply(response, 200, {
        data: [
          {
            member_id: "membership",
            user_id: "recipient",
            display_name: "Recipient",
            image_url: null,
            roles: ["member"],
            joined_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        meta: { next_cursor: null },
      })
    }),
  )
  const billing = await listen(
    createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      ownerCalls.push({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: JSON.parse(Buffer.concat(chunks).toString()),
      })
      if (options.billing) {
        await options.billing(request, response, ownerCalls.length)
        return
      }
      reply(response, 201, { data: ids })
    }),
  )
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant-current",
    iamBaseUrl: iam,
    sharedSecret: "product-browser-secret",
    adminWebSharedSecret: "admin-browser-secret",
    upstreamSecret: "billing-internal-secret-0000000000001",
    billingServiceToken: "billing-service-token-000000000000001",
    billingOperatorProxySecret: "billing-operator-secret-00000000000001",
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 65536,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { billing },
    platformProjection: {
      baseUrl: null,
      credentialFile: null,
      timeoutMs: 1000,
    },
    skillDraft: {
      enabled: false,
      platformBaseUrl: null,
      credentialFile: null,
      timeoutMs: 1000,
    },
    ...options.config,
  }
  const base = await listen(
    createBffServer(config, {
      businessStore: null,
      readiness: async () => undefined,
      sessionAdmission: {
        verify: async (input) => {
          admissions.push(input)
          return (
            options.admission?.(input, admissions.length) ?? {
              ok: true,
              identity: {
                namespace: "tenant-current",
                userId: "operator-current",
              },
              platformAdmin: true,
            }
          )
        },
      },
    }),
  )
  return { base, ownerCalls, memberCalls, admissions, config }
}
test("current administrator funds a current-tenant member once through the fixed owner command", async () => {
  const state = await setup()
  const response = await fetch(state.base + "/v1/admin/billing/credit-grants", {
    method: "POST",
    headers: browserHeaders,
    body: JSON.stringify(command),
  })
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), {
    data: ids,
    meta: { request_id: "funding-request-1" },
  })
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(state.ownerCalls.length, 1)
  const sent = state.ownerCalls[0]
  assert.deepEqual(sent.body, command)
  assert.equal(sent.method, "POST")
  assert.equal(sent.url, "/v1/admin/billing/credit-grants")
  assert.equal(sent.headers.authorization, `Bearer ${state.config.billingServiceToken}`)
  assert.equal(sent.headers["x-kokoro-subject"], u1("operator-current"))
  assert.equal(sent.headers["x-kokoro-tenant-id"], u1("tenant-current"))
  assert.equal(sent.headers["x-kokoro-proxy-secret"], state.config.billingOperatorProxySecret)
  assert.equal(sent.headers["idempotency-key"], browserHeaders["idempotency-key"])
  assert.equal(state.memberCalls[0].authorization, browserHeaders.authorization)
  assert.equal(state.memberCalls[0].url, "/internal/v1/tenants/tenant-current/members?limit=100")
  assert.equal(state.admissions.length, 2)
})
const post = (state, body = command, headers = browserHeaders, suffix = "") =>
  fetch(state.base + "/v1/admin/billing/credit-grants" + suffix, {
    method: "POST",
    headers,
    body: typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  })
const member = (user_id) => ({
  member_id: "membership-" + user_id,
  user_id,
  display_name: "Member",
  image_url: null,
  roles: ["member"],
  joined_at: "2026-01-01T00:00:00.000Z",
})
test("rejects ordinary users and revoked or substituted administrator sessions without touching funds", async () => {
  for (const admission of [
    () => ({
      ok: true,
      identity: { namespace: "tenant-current", userId: "operator-current" },
      platformAdmin: false,
    }),
    (_input, call) => ({
      ok: true,
      identity: {
        namespace: "tenant-current",
        userId: call === 1 ? "operator-current" : "different-actor",
      },
      platformAdmin: true,
    }),
    (_input, call) =>
      call === 1
        ? {
            ok: true,
            identity: {
              namespace: "tenant-current",
              userId: "operator-current",
            },
            platformAdmin: true,
          }
        : { ok: false, status: 403, code: "session_revoked" },
  ]) {
    const state = await setup({ admission })
    assert.equal((await post(state)).status, 403)
    assert.equal(state.ownerCalls.length, 0)
  }
})
test("requires current tenant membership, follows bounded pages and fails closed on incomplete or cyclic pagination", async () => {
  const next = await setup({
    members: (_request, response, call) =>
      reply(response, 200, {
        data: [member(call === 1 ? "someone-else" : "recipient")],
        meta: { next_cursor: call === 1 ? "page-2" : null },
      }),
  })
  assert.equal((await post(next)).status, 201)
  assert.match(next.memberCalls[1].url, /cursor=page-2$/u)
  const absent = await setup({
    members: (_request, response) =>
      reply(response, 200, {
        data: [member("not-recipient")],
        meta: { next_cursor: null },
      }),
  })
  assert.equal((await post(absent)).status, 403)
  assert.equal(absent.ownerCalls.length, 0)
  const cyclic = await setup({
    members: (_request, response) => reply(response, 200, { data: [], meta: { next_cursor: "same-page" } }),
  })
  assert.equal((await post(cyclic)).status, 502)
  assert.equal(cyclic.memberCalls.length, 2)
  assert.equal(cyclic.ownerCalls.length, 0)
  const incomplete = await setup({
    config: { upstreamTimeoutMs: 5000 },
    members: (_request, response, count) =>
      reply(response, 200, {
        data: [],
        meta: { next_cursor: "page-" + count },
      }),
  })
  assert.equal((await post(incomplete)).status, 503)
  assert.equal(incomplete.memberCalls.length, 20)
  assert.equal(incomplete.ownerCalls.length, 0)
})
test("rejects unsupported funding, identity, amount and time inputs before any qualification or owner call", async () => {
  const state = await setup()
  for (const patch of [
    { tenant_id: "other-tenant" },
    { actor_id: "spoofed" },
    { source_kind: "cash" },
    { amount_credits: 1 },
    { amount_credits: "0" },
    { amount_credits: "1.5" },
    { amount_credits: "1e3" },
    { amount_credits: "01" },
    { amount_credits: "9223372036855" },
    { funding_id: "11111111-1111-1111-8111-111111111111" },
    { subject_id: "\u0000" },
    { subject_id: "\ud800" },
    { reason: " " },
    { reason: "\ud800" },
    { reason: "\u0000" },
    { effective_at: "2026-02-30T00:00:00.000Z" },
    { effective_at: "2026-01-01T00:00:00Z" },
    { effective_at: "2026-01-01T00:00:00.000+00:00" },
  ])
    assert.equal((await post(state, { ...command, ...patch })).status, 400, JSON.stringify(patch))
  for (const raw of [
    "null",
    "[]",
    JSON.stringify(command).replace('"subject_id":"recipient"', '"subject_id":"evil","subject_id":"recipient"'),
    Buffer.from([0xff]),
    Buffer.from("\ufeff" + JSON.stringify(command)),
    JSON.stringify({ ...command, reason: "x".repeat(17000) }),
  ])
    assert.equal((await post(state, raw)).status, 400)
  assert.equal((await post(state, command, browserHeaders, "?tenant_id=other")).status, 400)
  assert.equal(
    (
      await post(state, command, {
        ...browserHeaders,
        "content-type": "text/plain",
      })
    ).status,
    400,
  )
  const { "idempotency-key": _ignored, ...missingKey } = browserHeaders
  assert.equal((await post(state, command, missingKey)).status, 400)
  assert.equal(state.memberCalls.length, 0)
  assert.equal(state.ownerCalls.length, 0)
})
test("preserves Unicode code-point bounds and whole-credit strings whose micros exceed Number precision", async () => {
  const recipient = "😀".repeat(255)
  const state = await setup({
    members: (_request, response) =>
      reply(response, 200, {
        data: [member(recipient)],
        meta: { next_cursor: null },
      }),
  })
  const body = {
    ...command,
    subject_id: recipient,
    reason: "😀".repeat(500),
    amount_credits: "9223372036854",
  }
  assert.equal((await post(state, body)).status, 201)
  assert.deepEqual(state.ownerCalls[0].body, body)
})
test("refuses malformed member evidence instead of authorizing from repaired or duplicate JSON", async () => {
  for (const raw of [
    JSON.stringify({
      data: [member("recipient")],
      meta: { next_cursor: null },
    }).replace('"user_id":"recipient"', '"user_id":"someone-else","user_id":"recipient"'),
    Buffer.concat([
      Buffer.from(
        JSON.stringify({
          data: [member("recipient")],
          meta: { next_cursor: null },
        }).split("Member")[0],
      ),
      Buffer.from([0xff]),
      Buffer.from(
        JSON.stringify({
          data: [member("recipient")],
          meta: { next_cursor: null },
        }).split("Member")[1],
      ),
    ]),
  ]) {
    const state = await setup({
      members: (_request, response) => {
        response.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-request-id": "funding-request-1",
        })
        response.end(raw)
      },
    })
    assert.equal((await post(state)).status, 502)
    assert.equal(state.ownerCalls.length, 0)
  }
})
test("keeps the original command on explicit replay and never performs an automatic retry", async () => {
  const state = await setup()
  assert.equal((await post(state)).status, 201)
  assert.equal(state.ownerCalls.length, 1)
  assert.equal((await post(state)).status, 201)
  assert.equal(state.ownerCalls.length, 2)
  assert.deepEqual(state.ownerCalls[0].body, state.ownerCalls[1].body)
  assert.equal(state.ownerCalls[0].headers["idempotency-key"], state.ownerCalls[1].headers["idempotency-key"])
})
test("maps only strict owner conflicts/disabled results and treats bad acknowledgements as unconfirmed", async () => {
  for (const [status, code, retryable, expected] of [
    [409, "billing.idempotency_conflict", false, 409],
    [403, "billing.credit_account_disabled", false, 403],
    [500, "billing.internal_error", false, 503],
    [503, "billing.dependency_unavailable", true, 503],
    [409, "forged-conflict", false, 502],
  ]) {
    const state = await setup({
      billing: (_request, response) =>
        reply(response, status, {
          error: { code, message: "private owner message", retryable },
        }),
    })
    const response = await post(state)
    assert.equal(response.status, expected)
    assert.doesNotMatch(await response.text(), /private owner message/u)
    assert.equal(state.ownerCalls.length, 1)
  }
  for (const replyBody of [{ data: { ...ids, balance: "999" } }, { data: { ...ids, grant_id: "not-a-uuid" } }, { data: ids, extra: true }]) {
    const state = await setup({
      billing: (_request, response) => reply(response, 201, replyBody),
    })
    assert.equal((await post(state)).status, 502)
    assert.equal(state.ownerCalls.length, 1)
  }
})
test("bounds owner streaming and does not follow redirects or consume missing credentials", async () => {
  const state = await setup({
    config: { upstreamTimeoutMs: 75 },
    billing: (_request, response) => {
      response.writeHead(201, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-request-id": "funding-request-1",
      })
      response.write('{"data":')
    },
  })
  assert.equal((await post(state)).status, 503)
  assert.equal(state.ownerCalls.length, 1)
  const redirect = await setup({
    billing: (_request, response) => {
      response.writeHead(307, { location: "/other" })
      response.end()
    },
  })
  assert.equal((await post(redirect)).status, 502)
  assert.equal(redirect.ownerCalls.length, 1)
  const absent = await setup({ config: { billingOperatorProxySecret: null } })
  assert.equal((await post(absent)).status, 503)
  assert.equal(absent.ownerCalls.length, 0)
})
test("a hung final administrator recheck is bounded by the shared command deadline", async () => {
  const state = await setup({
    config: { upstreamTimeoutMs: 75 },
    admission: (_input, count) =>
      count === 1
        ? {
            ok: true,
            identity: {
              namespace: "tenant-current",
              userId: "operator-current",
            },
            platformAdmin: true,
          }
        : new Promise(() => {}),
  })
  const response = await fetch(state.base + "/v1/admin/billing/credit-grants", {
    method: "POST",
    headers: browserHeaders,
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(1000),
  })
  assert.equal(response.status, 503)
  assert.equal(state.ownerCalls.length, 0)
})

test("rejects duplicate transport headers using actual HTTP bytes", async () => {
  const state = await setup()
  for (const [name, expected] of [
    ["idempotency-key", 400],
    ["authorization", 401],
    ["x-kokoro-internal-secret", 403],
  ]) {
    const status = await new Promise((resolve, reject) => {
      const rawHeaders = [
        "Host",
        new URL(state.base).host,
        "Content-Length",
        String(Buffer.byteLength(JSON.stringify(command))),
        ...Object.entries(browserHeaders).flat(),
        name,
        browserHeaders[name],
      ]
      const request = nodeRequest(new URL(state.base + "/v1/admin/billing/credit-grants"), { method: "POST", headers: rawHeaders }, (response) => {
        let text = ""
        response.on("data", (chunk) => {
          text += chunk
        })
        response.once("end", () => {
          try {
            assert.equal(JSON.parse(text).meta.request_id, "funding-request-1")
            resolve(response.statusCode)
          } catch (error) {
            reject(error)
          }
        })
      })
      request.once("error", reject)
      request.end(JSON.stringify(command))
    })
    assert.equal(status, expected, name)
  }
  assert.equal(state.ownerCalls.length, 0)
})
test("bounds incomplete input bodies before any IAM membership read or owner dispatch", async () => {
  const state = await setup({ config: { upstreamTimeoutMs: 75 } })
  const status = await new Promise((resolve, reject) => {
    const request = nodeRequest(
      new URL(state.base + "/v1/admin/billing/credit-grants"),
      {
        method: "POST",
        headers: { ...browserHeaders, "content-length": "1000" },
      },
      (response) => {
        response.resume()
        response.once("end", () => {
          request.destroy()
          resolve(response.statusCode)
        })
      },
    )
    request.setTimeout(1000, () => {
      request.destroy()
      reject(new Error("Input deadline was not enforced"))
    })
    request.once("error", reject)
    request.write('{"funding_id":')
  })
  assert.equal(status, 503)
  assert.equal(state.memberCalls.length, 0)
  assert.equal(state.ownerCalls.length, 0)
})
test("rejects duplicate owner ACK fields, wrong binding headers and oversized complete envelopes", async () => {
  for (const mutate of [
    (response) => {
      response.writeHead(201, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-request-id": "funding-request-1",
      })
      response.end(JSON.stringify({ data: ids }).replace('"grant_id":', '"grant_id":"55555555-5555-4555-8555-555555555555","grant_id":'))
    },
    (response) => {
      response.writeHead(201, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-request-id": "wrong-request",
      })
      response.end(JSON.stringify({ data: ids }))
    },
    (response) => {
      response.writeHead(201, {
        "content-type": "application/json",
        "x-request-id": "funding-request-1",
      })
      response.end(JSON.stringify({ data: ids }))
    },
    (response) => {
      response.writeHead(201, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-request-id": "funding-request-1",
      })
      response.end(" ".repeat(65537) + JSON.stringify({ data: ids }))
    },
  ]) {
    const state = await setup({
      billing: (_request, response) => mutate(response),
    })
    assert.equal((await post(state)).status, 502)
    assert.equal(state.ownerCalls.length, 1)
  }
})

test("final recheck consuming the absolute budget never dispatches, even before the abort timer runs", async () => {
  const realNow = Date.now
  try {
    const state = await setup({
      admission: (_input, count) => {
        if (count === 2) Date.now = () => realNow() + 2000
        return { ok: true, identity: { namespace: "tenant-current", userId: "operator-current" }, platformAdmin: true }
      },
    })
    assert.equal((await post(state)).status, 503)
    assert.equal(state.ownerCalls.length, 0)
  } finally {
    Date.now = realNow
  }
})
test("a valid ACK decoded beyond the absolute budget is unconfirmed, not a successful late acknowledgement", async () => {
  const realNow = Date.now
  try {
    const state = await setup({
      billing: (_request, response) => {
        Date.now = () => realNow() + 2000
        reply(response, 201, { data: ids })
      },
    })
    assert.equal((await post(state)).status, 503)
    assert.equal(state.ownerCalls.length, 1)
  } finally {
    Date.now = realNow
  }
})
