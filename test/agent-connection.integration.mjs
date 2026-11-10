import "reflect-metadata"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { Test } from "@nestjs/testing"
import { Pool } from "pg"
import {
  AGENT_CANCELLATION_DISPATCHER, AGENT_DISPATCH_DISPATCHER, AGUI_PROJECTOR, BFF_CONFIG, BFF_DATABASE, SESSION_ADMISSION,
} from "../dist/common/tokens.js"
import { loadConfig } from "../dist/config/runtime.js"
import { BffExpressAdapter } from "../dist/http/bff-express-adapter.js"
import { RunSteerDispatcher } from "../dist/infrastructure/postgres/run-steer-dispatch.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../dist/main.js"
import { AgentRunsModule } from "../dist/modules/agent-runs/agent-runs.module.js"
import { fixtureSessionHeaders, SessionAdmissionDouble, TEST_WEB_ORIGIN } from "./doubles/session-admission.ts"

test("Telegram setup is confirmed by the original user; replay, cancel, expiry, and unlink stay durable", { timeout: 30_000 }, async (t) => {
  const postgres = new URL(process.env.KOKORO_TEST_POSTGRES_URL ?? "about:blank")
  const redis = new URL(process.env.KOKORO_TEST_REDIS_URL ?? "about:blank")
  for (const url of [postgres, redis]) assert.ok(["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) && !url.hash)
  assert.ok(["postgres:", "postgresql:"].includes(postgres.protocol))
  assert.match(postgres.pathname, /^\/kokoro_bff_agent_connection_[0-9a-f]{32}$/u, "dedicated A13 fixture database required")
  assert.deepEqual(postgres.searchParams.getAll("schema"), ["kokoro_bff"])
  assert.equal(redis.protocol, "redis:")
  assert.match(redis.pathname, /^\/(?:[1-9]|1[0-5])$/u)
  assert.equal(redis.search, "")

  const tenant = `tenant_${randomUUID()}`
  const users = { alice: { namespace: tenant, userId: "alice" }, bob: { namespace: tenant, userId: "bob" },
    outside: { namespace: "not_this_tenant", userId: "alice" } }
  const shared = "a13-owned-nest-fixture-secret"
  const token = "123456789:LocalOnlyTelegramTestBotKey_123456"
  const callbackSecret = "LocalOnlyTelegramCallbackFixture_1234"
  const config = loadConfig({
    KOKORO_BFF_POSTGRES_URL: postgres.href,
    KOKORO_BFF_REDIS_URL: redis.href,
    KOKORO_BFF_SHARED_SECRET: shared,
    KOKORO_IAM_WEB_ORIGIN: TEST_WEB_ORIGIN,
    KOKORO_TENANT_ID: tenant,
    KOKORO_AGENT_ENABLED: "false",
    KOKORO_TELEGRAM_BOT_TOKEN: token,
    KOKORO_TELEGRAM_BOT_USERNAME: "kokoro_fixture_bot",
    KOKORO_TELEGRAM_WEBHOOK_SECRET: callbackSecret,
  })
  const observer = new Pool({ connectionString: postgres.href, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 2 })
  const admission = new SessionAdmissionDouble(users)
  const sent = []
  let transportUnknown = false
  const realFetch = globalThis.fetch
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input)
    if (["localhost", "127.0.0.1"].includes(url.hostname)) return realFetch(input, options)
    assert.equal(url.href, `https://api.telegram.org/bot${token}/sendMessage`)
    assert.equal(options.method, "POST")
    assert.equal(options.redirect, "error")
    assert.equal(options.credentials, "omit")
    const { chat_id, text, protect_content } = JSON.parse(options.body)
    assert.equal(protect_content, true)
    const proof = /^Enter this one-time code in the Kokoro connection dialog: ([A-Za-z0-9_-]{22})$/u.exec(text)?.[1]
    assert.ok(proof)
    sent.push({ chat_id, proof })
    if (transportUnknown) throw Error("fixture disconnected after receiving the provider request")
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), {
      headers: { "content-type": "application/json" },
    })
  })
  let app
  t.after(async () => {
    try { await app?.close() } finally { await observer.end() }
  })
  assert.deepEqual((await observer.query("SELECT current_database() AS db,current_schema() AS schema")).rows,
    [{ db: postgres.pathname.slice(1), schema: "kokoro_bff" }])
  const builder = Test.createTestingModule({ imports: [AgentRunsModule] })
    .overrideProvider(BFF_CONFIG).useValue(config).overrideProvider(SESSION_ADMISSION).useValue(admission)
  for (const provider of [AGENT_DISPATCH_DISPATCHER, AGENT_CANCELLATION_DISPATCHER, AGUI_PROJECTOR, RunSteerDispatcher])
    builder.overrideProvider(provider).useValue(null)
  const module = await builder.compile()
  app = module.createNestApplication(new BffExpressAdapter(), { ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  await app.get(BFF_DATABASE).ready()
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()
  const userPath = "/v1/agents/connections/setup?platform=telegram"
  const callbackPath = "/v1/agents/connections/telegram/webhook"
  let requestCount = 0
  async function call(path, method, headers, body) {
    const id = `a13-test-${++requestCount}`
    const response = await realFetch(base + path, {
      method, headers: { ...headers, "x-request-id": id, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(6000),
    })
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("x-request-id"), id)
    const text = await response.text()
    assert.ok(!text.includes(token) && !text.includes(callbackSecret) && sent.every(({ proof }) => !text.includes(proof)))
    const decoded = text ? JSON.parse(text) : null
    if (decoded) assert.deepEqual(decoded.meta, { request_id: id })
    return { status: response.status, data: decoded?.data, code: decoded?.error?.code }
  }
  const user = (session = "alice", command) => call(userPath, command === undefined ? "GET" : "POST", {
    "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": shared, ...fixtureSessionHeaders(session),
  }, command)
  const update = (setup, id, from, chat = { id: from, type: "private" }, secret = callbackSecret) =>
    call(callbackPath, "POST", { "x-telegram-bot-api-secret-token": secret },
      { update_id: id, message: { text: `/start ${setup}`, from: { id: from, is_bot: false }, chat } })
  const start = (session, revision) => user(session, { action: "start", expected_state_version: revision })
  const confirm = (session, revision, setup_id, proof) => user(session, { action: "confirm", expected_state_version: revision, setup_id, proof })
  const cancel = (session, revision, setup_id) => user(session, { action: "cancel", expected_state_version: revision, setup_id })
  const disconnect = (session, revision) => user(session, { action: "disconnect", expected_state_version: revision })
  const rows = async () => (await observer.query(
    "SELECT subject_id,state_version,setup_id,proof_digest,provider_update_id,external_user_id,connected_at FROM bff_agent_connection WHERE tenant_id=$1 ORDER BY subject_id",
    [tenant])).rows
  const state = (res, phase, revision) => {
    assert.equal(res.status, 200)
    assert.equal(res.data.platform, "telegram")
    assert.equal(res.data.status, phase)
    assert.equal(res.data.state_version, revision)
    return res.data
  }
  const error = (res, status, code) => assert.deepEqual(res, { status, data: undefined, code })

  state(await user(), "disconnected", "1")
  assert.deepEqual(await rows(), [])
  const first = state(await start("alice", "1"), "awaiting_telegram", "2")
  assert.equal(first.continue_url, `https://t.me/kokoro_fixture_bot?start=${first.setup_id}`)
  assert.match(first.setup_id, /^[A-Za-z0-9_-]{32}$/u)
  error(await start("alice", "1"), 412, "agent_connection_precondition_failed")
  assert.deepEqual(state(await user(), "awaiting_telegram", "2"), first)
  const beforeCallbacks = admission.calls.length
  error(await update(first.setup_id, 100, 10101, undefined, "invalid"), 403, "telegram_webhook_forbidden")
  assert.equal((await update(first.setup_id, 101, 10101, { id: 10101, type: "group" })).status, 204)
  assert.equal((await update(first.setup_id, 102, 10101, { id: 20202, type: "private" })).status, 204)
  assert.equal(sent.length, 0)
  assert.equal((await update(first.setup_id, 103, 10101)).status, 204)
  assert.equal((await update(first.setup_id, 103, 10101)).status, 204)
  assert.equal(admission.calls.length, beforeCallbacks)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].chat_id, 10101)
  const pending = state(await user(), "awaiting_confirmation", "3")
  assert.ok(!("continue_url" in pending))
  const [claimed] = await rows()
  assert.match(claimed.proof_digest, /^[0-9a-f]{64}$/u)
  assert.notEqual(claimed.proof_digest, sent[0].proof)
  assert.equal(claimed.provider_update_id, "103")
  assert.equal(claimed.connected_at, null)
  error(await confirm("bob", "1", first.setup_id, sent[0].proof), 409, "agent_connection_state_conflict")
  error(await confirm("outside", "3", first.setup_id, sent[0].proof), 403, "product_tenant_forbidden")
  error(await confirm("alice", "3", first.setup_id, "A".repeat(22)), 409, "agent_connection_proof_invalid")
  const connected = state(await confirm("alice", "3", first.setup_id, sent[0].proof), "connected", "4")
  assert.deepEqual(Object.keys(connected).sort(), ["connected_at", "platform", "state_version", "status"])
  assert.deepEqual(state(await user(), "connected", "4"), connected)
  error(await cancel("alice", "2", first.setup_id), 409, "agent_connection_already_connected")
  const [bound] = await rows()
  assert.equal(bound.setup_id, null)
  assert.equal(bound.proof_digest, null)
  assert.equal(bound.external_user_id, "10101")

  const second = state(await start("bob", "1"), "awaiting_telegram", "2")
  assert.equal((await update(second.setup_id, 104, 10101)).status, 204)
  error(await confirm("bob", "3", second.setup_id, sent[1].proof), 409, "agent_connection_identity_in_use")
  // Cancel can win when this exact attempt advanced one revision due to the callback.
  state(await cancel("bob", "2", second.setup_id), "disconnected", "4")
  assert.equal((await update(second.setup_id, 104, 10101)).status, 204)
  assert.equal(sent.length, 2)

  const enabled = config.telegramConnection
  config.telegramConnection = null
  state(await user(), "connected", "4")
  state(await disconnect("alice", "4"), "disconnected", "5")
  error(await user(), 503, "agent_connection_provider_unavailable")
  config.telegramConnection = enabled
  state(await user(), "disconnected", "5")

  const third = state(await start("alice", "5"), "awaiting_telegram", "6")
  transportUnknown = true
  assert.equal((await update(third.setup_id, 105, 30303)).status, 204)
  assert.equal((await update(third.setup_id, 105, 30303)).status, 204)
  assert.equal(sent.length, 3)
  state(await user(), "awaiting_confirmation", "7")
  await observer.query("UPDATE bff_agent_connection SET setup_expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND subject_id='alice'", [tenant])
  state(await user(), "expired", "7")
  error(await confirm("alice", "7", third.setup_id, sent[2].proof), 409, "agent_connection_state_conflict")
  assert.equal((await update(third.setup_id, 106, 30303)).status, 204)
  assert.equal((await update(first.setup_id, 103, 10101)).status, 204)
  assert.equal(sent.length, 3)
  assert.ok((await rows()).every((row) => row.connected_at === null))
})
