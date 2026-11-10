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

test("Slack associates only the admitted current setup, without retaining or revoking its workspace token", { timeout: 15_000 }, async (t) => {
  const postgres = new URL(process.env.KOKORO_TEST_POSTGRES_URL ?? "about:blank")
  const redis = new URL(process.env.KOKORO_TEST_REDIS_URL ?? "about:blank")
  for (const url of [postgres, redis]) assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && !url.hash)
  assert.ok(["postgres:", "postgresql:"].includes(postgres.protocol))
  assert.match(postgres.pathname, /^\/kokoro_bff_agent_connection_[0-9a-f]{32}$/u)
  assert.deepEqual(postgres.searchParams.getAll("schema"), ["kokoro_bff"])
  assert.equal(redis.protocol, "redis:")
  assert.match(redis.pathname, /^\/(?:[1-9]|1[0-5])$/u)
  assert.equal(redis.search, "")

  const tenant = "slack_" + randomUUID()
  const shared = "a13-owned-nest-fixture-secret"
  const appId = "A01NATIVE9"
  const teamId = "T01NATIVE9"
  const botId = "U01NATIVE9"
  const member = "U02NATIVE9"
  const clientId = "123456789.123456790"
  const clientSecret = "slack-native-client-fixture-secret"
  const token = "xoxb-slack-native-workspace-fixture-token"
  const callback = TEST_WEB_ORIGIN + "/api/agents/connections/slack/callback"
  const config = loadConfig({
    KOKORO_BFF_POSTGRES_URL: postgres.href,
    KOKORO_BFF_REDIS_URL: redis.href,
    KOKORO_BFF_SHARED_SECRET: shared,
    KOKORO_IAM_WEB_ORIGIN: TEST_WEB_ORIGIN,
    KOKORO_TENANT_ID: tenant,
    KOKORO_AGENT_ENABLED: "false",
    KOKORO_SLACK_APP_ID: appId,
    KOKORO_SLACK_CLIENT_ID: clientId,
    KOKORO_SLACK_CLIENT_SECRET: clientSecret,
  })
  const observer = new Pool({ connectionString: postgres.href, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 2 })
  const admission = new SessionAdmissionDouble({
    alice: { namespace: tenant, userId: "alice" }, bob: { namespace: tenant, userId: "bob" },
  })
  const providerEntered = Promise.withResolvers()
  const releaseProvider = Promise.withResolvers()
  const realFetch = globalThis.fetch
  const provider = []
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input)
    if (["localhost", "127.0.0.1"].includes(url.hostname)) return realFetch(input, options)
    assert.equal(url.origin, "https://slack.com")
    assert.equal(url.search, "")
    assert.equal(options.redirect, "error")
    assert.equal(options.credentials, "omit")
    const headers = new Headers(options.headers)
    if (url.pathname === "/api/oauth.v2.access") {
      assert.equal(options.method, "POST")
      assert.equal(headers.get("authorization"), "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64"))
      const form = new URLSearchParams(options.body)
      const code = form.get("code")
      assert.deepEqual([...form], [["code", code], ["redirect_uri", callback]])
      provider.push("exchange")
      if (code === "fixture.late") {
        providerEntered.resolve()
        await releaseProvider.promise
      }
      assert.ok(["fixture.first", "fixture.late"].includes(code))
      return Response.json({ ok: true, app_id: appId, bot_user_id: botId, token_type: "bot", scope: "team:read",
        access_token: token, team: { id: teamId }, authed_user: { id: member }, is_enterprise_install: false })
    }
    assert.equal(url.pathname, "/api/team.info")
    assert.equal(options.method, "GET")
    assert.equal(headers.get("authorization"), "Bearer " + token)
    provider.push("team")
    return Response.json({ ok: true, team: { id: teamId, name: "Fixture Workspace" } })
  })

  let app
  t.after(async () => {
    releaseProvider.resolve()
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
  let requests = 0
  const call = async (path, body, session = "alice") => {
    const id = "slack-test-" + ++requests
    const response = await realFetch(base + "/v1/agents/connections/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-request-id": id, "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": shared,
        ...(session === null ? { origin: TEST_WEB_ORIGIN } : fixtureSessionHeaders(session)), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(6000),
    })
    assert.equal(response.headers.get("cache-control"), "no-store")
    if (path === "slack/complete") assert.equal(response.headers.get("referrer-policy"), "no-referrer")
    const bytes = await response.text()
    assert.ok(!bytes.includes(token) && !bytes.includes(clientSecret) && !bytes.includes("fixture.first") && !bytes.includes("fixture.late"))
    const result = JSON.parse(bytes)
    assert.deepEqual(result.meta, { request_id: id })
    return { status: response.status, data: result.data, code: result.error?.code }
  }
  const get = (session) => call("setup?platform=slack", undefined, session)
  const command = (action, version, setupId, session) => call("setup?platform=slack", {
    action, expected_state_version: version, ...(setupId === undefined ? {} : { setup_id: setupId }),
  }, session)
  const complete = (state, code, session) => call("slack/complete", { state, code }, session)
  const rows = async () => (await observer.query("SELECT to_jsonb(bff_agent_connection) AS row FROM bff_agent_connection WHERE tenant_id=$1 ORDER BY subject_id", [tenant])).rows.map((result) => result.row)

  assert.deepEqual((await get()).data, { platform: "slack", status: "disconnected", state_version: "1" })
  assert.deepEqual(await rows(), [])
  const first = await command("start", "1")
  assert.equal(first.status, 200)
  assert.equal(first.data.status, "awaiting_slack")
  const url = new URL(first.data.continue_url)
  assert.equal(url.origin + url.pathname, "https://slack.com/oauth/v2/authorize")
  assert.deepEqual([...url.searchParams], [["client_id", clientId], ["scope", "team:read"], ["redirect_uri", callback], ["state", first.data.setup_id]])
  assert.equal((await complete(first.data.setup_id, "fixture.first", null)).status, 401)
  assert.equal((await complete(first.data.setup_id, "fixture.first", "bob")).status, 409)
  assert.deepEqual(provider, [])

  const connected = await complete(first.data.setup_id, "fixture.first")
  assert.equal(connected.status, 200)
  assert.deepEqual(connected.data, { platform: "slack", status: "connected", state_version: "4", connected_at: connected.data.connected_at })
  assert.deepEqual((await get()).data, connected.data)
  assert.equal((await complete(first.data.setup_id, "fixture.first")).status, 409)
  const [bound] = await rows()
  assert.equal(bound.bot_id, appId + ":" + teamId)
  assert.equal(bound.external_user_id, member)
  assert.equal(bound.proof_digest, null)
  assert.ok(!JSON.stringify(bound).includes(token))
  assert.deepEqual(provider, ["exchange", "team"])

  // Another local user can cancel while their Slack exchange is in flight. It
  // must not bind them, revoke the shared workspace or disturb Alice's binding.
  const second = (await command("start", "1", undefined, "bob")).data
  const late = complete(second.setup_id, "fixture.late", "bob")
  await Promise.race([providerEntered.promise, late.then(() => assert.fail("fixture exchange never started"))])
  const waiting = (await get("bob")).data
  assert.equal(waiting.status, "awaiting_slack_callback")
  assert.equal(waiting.continue_url, undefined)
  assert.equal((await command("cancel", "2", second.setup_id, "bob")).data.status, "disconnected")
  releaseProvider.resolve()
  assert.equal((await late).status, 409)
  assert.deepEqual((await get()).data, connected.data)

  assert.equal((await command("disconnect", "4")).data.status, "disconnected")
  assert.deepEqual(provider, ["exchange", "team", "exchange", "team"])
  for (const row of await rows()) for (const field of ["bot_id", "setup_id", "setup_expires_at", "proof_digest", "provider_update_id", "external_user_id", "connected_at"])
    assert.equal(row[field], null)
})
