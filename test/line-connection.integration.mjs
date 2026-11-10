import assert from "node:assert/strict"
import { createHmac, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { test } from "node:test"
import { Pool } from "pg"
import { loadConfig } from "../dist/config/runtime.js"
import { handleAgentConnectionSetupRequest } from "../dist/http/routes/agent-connection-setup-native.js"
import { fixtureSessionHeaders, SessionAdmissionDouble, TEST_WEB_ORIGIN } from "./doubles/session-admission.ts"

test("LINE links only the admitted setup owner and the same signed private LINE user", { timeout: 15_000 }, async (t) => {
  const database = new URL(process.env.KOKORO_TEST_POSTGRES_URL ?? "about:blank")
  assert.ok(["postgres:", "postgresql:"].includes(database.protocol) && ["127.0.0.1", "localhost"].includes(database.hostname) && !database.hash)
  assert.match(database.pathname, /^\/kokoro_bff_agent_connection_[0-9a-f]{32}$/u)
  assert.deepEqual(database.searchParams.getAll("schema"), ["kokoro_bff"])
  const pool = new Pool({ connectionString: database.href, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 2 })
  const tenant = `line_${randomUUID()}`
  const bot = "U" + "a".repeat(32),
    user = "U" + "b".repeat(32),
    differentUser = "U" + "c".repeat(32)
  const secret = "local-fixture-channel-secret-only-0001",
    accessToken = "line-fixture-channel-access-token",
    linkToken = "line-provider-fixture-link-token"
  const shared = "line-fixture-shared-secret"
  const config = loadConfig({
    KOKORO_BFF_POSTGRES_URL: database.href,
    KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:6379/13",
    KOKORO_BFF_SHARED_SECRET: shared,
    KOKORO_IAM_WEB_ORIGIN: TEST_WEB_ORIGIN,
    KOKORO_TENANT_ID: tenant,
    KOKORO_LINE_BOT_USER_ID: bot,
    KOKORO_LINE_OFFICIAL_ACCOUNT_ID: "@kokoro_fixture",
    KOKORO_LINE_CHANNEL_SECRET: secret,
    KOKORO_LINE_CHANNEL_ACCESS_TOKEN: accessToken,
  })
  const admitted = new SessionAdmissionDouble({ alice: { namespace: tenant, userId: "alice" }, bob: { namespace: tenant, userId: "bob" } })
  const actualFetch = globalThis.fetch
  const providerCalls = []
  let privateReply
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input)
    assert.equal(url.origin, "https://api.line.me")
    assert.equal(options.method, "POST")
    assert.equal(options.redirect, "error")
    assert.equal(new Headers(options.headers).get("authorization"), `Bearer ${accessToken}`)
    if (url.pathname === `/v2/bot/user/${user}/linkToken`) {
      providerCalls.push("issue")
      return Response.json({ linkToken })
    }
    assert.equal(url.pathname, "/v2/bot/message/reply")
    const payload = JSON.parse(options.body)
    assert.equal(payload.replyToken, "reply-fixture-1")
    privateReply = payload.messages?.[0]?.text
    providerCalls.push("reply")
    return Response.json({})
  })
  const server = createServer((request, response) => {
    void handleAgentConnectionSetupRequest(request, response, config, admitted, pool)
      .then((handled) => {
        if (!handled) response.writeHead(404).end()
      })
      .catch(() => {
        if (!response.headersSent) response.writeHead(500).end()
      })
  })
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await pool.end()
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${server.address().port}/v1/agents/connections`
  async function call(path, { method = "GET", headers = {}, body } = {}) {
    const response = await actualFetch(base + path, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(5000),
    })
    const text = await response.text()
    return { status: response.status, headers: response.headers, data: text ? JSON.parse(text).data : undefined }
  }
  const owner = (path, input, session = "alice") =>
    call(path, {
      method: input ? "POST" : "GET",
      headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": shared, ...fixtureSessionHeaders(session) },
      body: input && JSON.stringify(input),
    })
  const read = () => owner("/setup?platform=line")
  const write = (action, expected_state_version) => owner("/setup?platform=line", { action, expected_state_version })
  const webhook = (events, valid = true) => {
    const raw = JSON.stringify({ destination: bot, events }) + "\n"
    const signature = createHmac("sha256", secret)
      .update(valid ? raw : raw.trim())
      .digest("base64")
    return call("/line/webhook", { method: "POST", headers: { "x-line-signature": signature }, body: raw })
  }
  const state = (result, status, state_version) => {
    assert.equal(result.status, 200)
    assert.equal(result.headers.get("cache-control"), "no-store")
    assert.equal(result.data?.platform, "line")
    assert.equal(result.data?.status, status)
    assert.equal(result.data?.state_version, state_version)
    return result.data
  }
  state(await read(), "disconnected", "1")
  const pending = state(await write("start", "1"), "awaiting_line", "2")
  const { setup_id } = pending
  assert.equal(pending.continue_url, `https://line.me/R/oaMessage/%40kokoro_fixture/?Kokoro%20connect%20${setup_id}`)
  const dm = {
    type: "message",
    mode: "active",
    webhookEventId: "01FZ0000000000000000000001",
    replyToken: "reply-fixture-1",
    source: { type: "user", userId: user },
    message: { type: "text", text: `Kokoro connect ${setup_id}` },
  }
  assert.equal((await webhook([dm], false)).status, 403)
  assert.equal((await webhook([dm])).status, 204)
  assert.equal((await webhook([dm])).status, 204)
  assert.deepEqual(providerCalls, ["issue", "reply"])
  const reply = new URL(privateReply.match(/https:\/\/\S+/u)[0])
  assert.equal(reply.origin + reply.pathname, TEST_WEB_ORIGIN + "/app/agents")
  assert.equal(reply.search, "")
  const fragment = new URLSearchParams(reply.hash.slice(1))
  assert.equal(fragment.get("line_setup"), setup_id)
  assert.equal(fragment.get("link_token"), linkToken)
  state(await read(), "awaiting_line_approval", "3")
  const continueSetup = (revision, session) => owner("/line/continue", { setup_id, expected_state_version: revision, link_token: linkToken }, session)
  assert.equal((await continueSetup("1", "bob")).status, 409)
  const continued = await continueSetup("3", "alice")
  assert.equal(continued.headers.get("referrer-policy"), "no-referrer")
  const official = new URL(state(continued, "awaiting_line_callback", "4").continue_url)
  assert.equal(official.origin + official.pathname, "https://access.line.me/dialog/bot/accountLink")
  assert.equal(official.searchParams.get("linkToken"), linkToken)
  const nonce = official.searchParams.get("nonce")
  assert.match(nonce, /^[A-Za-z0-9_-]{64}$/u)
  assert.ok(!Object.hasOwn(state(await read(), "awaiting_line_callback", "4"), "continue_url"))
  const linked = {
    type: "accountLink",
    mode: "active",
    webhookEventId: "01FZ0000000000000000000002",
    source: { type: "user", userId: user },
    link: { result: "ok", nonce },
  }
  assert.equal((await webhook([{ ...linked, source: { type: "user", userId: differentUser } }])).status, 204)
  state(await read(), "awaiting_line_callback", "4")
  assert.equal((await webhook([linked])).status, 204)
  state(await read(), "connected", "5")
  state(await write("disconnect", "5"), "disconnected", "6")
  assert.equal((await webhook([linked])).status, 204)
  state(await read(), "disconnected", "6")
  assert.deepEqual(providerCalls, ["issue", "reply"])
})
