import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { test } from "node:test"
import path from "node:path"
import { inspect } from "node:util"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")

test("the compiled production AppModule resolves its real provider graph without external I/O", async () => {
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  // Both default test and test:architecture build dist before running this suite.
  const { AppModule } = await import("../dist/app.module.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const {
    AGENT_DISPATCH_OUTBOX,
    AGENT_RUNS_READER,
    AGUI_RUN_CONTROL_READER,
    AGUI_RUN_PROCESS_READER,
    BFF_CONFIG,
    BFF_DATABASE,
    BFF_POOL,
    BFF_REDIS,
    CHAT_CONVERSATION_LOOKUP,
    CHAT_SESSION_READS,
    CHAT_SESSION_MUTATIONS,
    CHAT_ARCHIVE,
    CHAT_SHARED_TASKS,
    CHAT_MESSAGE_FEEDBACK,
    CHAT_MOVE,
    CHAT_TURN_SERVICE,
    PROJECT_LOOKUP,
    PROJECT_MCP_RECOMMENDATIONS_PROVIDER,
    PROJECT_MCP_RECOMMENDATIONS_STORE,
    PROJECT_PINS,
    PROJECT_TASK_READER,
    PROJECT_READS,
    PROJECT_MUTATIONS,
    PROJECT_RENAME,
    PROJECT_DELETION,
    PROJECT_SKILL_SELECTION_PROVIDER,
    RUN_DISPLAY_PROVIDER,
    RUN_FINAL_ANSWER_LOOKUP,
    SKILL_INSTALLATION_CLIENT,
  } = await import("../dist/common/tokens.js")
  const { PERSONALIZATION_PROVIDER } = await import("../dist/modules/account/personalization.provider.js")
  const { AguiModule } = await import("../dist/modules/agui/agui.module.js")
  const { AgentDispatchModule } = await import("../dist/modules/agent-dispatch/agent-dispatch.module.js")
  const { AgentRunsModule } = await import("../dist/modules/agent-runs/agent-runs.module.js")
  const { ChatModule } = await import("../dist/modules/chat/chat.module.js")
  const { McpModule } = await import("../dist/modules/mcp/mcp.module.js")
  const { ProjectsModule } = await import("../dist/modules/projects/projects.module.js")
  const { ProjectAccessModule } = await import("../dist/modules/projects/project-access.module.js")
  const { SkillInstallationAccessModule } = await import("../dist/modules/skills/skill-installation-access.module.js")
  const config = loadConfig({
    KOKORO_BFF_SHARED_SECRET: "nest-graph-test-only",
    KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
    KOKORO_IAM_BASE_URL: "http://127.0.0.1:1",
    KOKORO_AGENT_ENABLED: "false",
  })
  const unexpectedIo = (): never => assert.fail("DI compilation must not access external resources")
  const database = {
    pool: { query: unexpectedIo, connect: unexpectedIo, end: unexpectedIo },
    redis: { connect: unexpectedIo, ping: unexpectedIo, close: unexpectedIo, destroy: unexpectedIo },
    ready: unexpectedIo,
    close: unexpectedIo,
  }
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue(database)
    .compile()
  try {
    const { SESSION_ADMISSION } = await import("../dist/common/tokens.js")
    const { AccountModule } = await import("../dist/modules/account/account.module.js")
    assert.throws(() => module.select(AccountModule).get(SESSION_ADMISSION, { strict: true }), "authentication must not be owned by AccountModule")
    const { AuthenticationModule } = await import("../dist/modules/authentication/authentication.module.js")
    const authentications = module.get(SESSION_ADMISSION, { each: true })
    assert.equal(authentications.length, 1)
    assert.equal(authentications[0], module.select(AuthenticationModule).get(SESSION_ADMISSION, { strict: true }))
    assert.ok(module.get(AppModule) instanceof AppModule)
    assert.equal(module.get(BFF_POOL), database.pool)
    assert.equal(module.get(BFF_REDIS), database.redis)
    for (const [owner, token] of [
      [AgentDispatchModule, CHAT_TURN_SERVICE],
      [AgentRunsModule, AGENT_RUNS_READER],
      [AguiModule, AGUI_RUN_PROCESS_READER],
      [AguiModule, AGUI_RUN_CONTROL_READER],
      [ChatModule, CHAT_SESSION_READS],
      [ChatModule, CHAT_SESSION_MUTATIONS],
      [ChatModule, CHAT_ARCHIVE],
      [ChatModule, CHAT_SHARED_TASKS],
      [ChatModule, CHAT_MESSAGE_FEEDBACK],
      [ChatModule, CHAT_MOVE],
      [ChatModule, CHAT_CONVERSATION_LOOKUP],
      [AgentRunsModule, RUN_FINAL_ANSWER_LOOKUP],
      [AccountModule, PERSONALIZATION_PROVIDER],
      [ProjectAccessModule, PROJECT_LOOKUP],
      [ProjectAccessModule, PROJECT_MCP_RECOMMENDATIONS_STORE],
      [McpModule, PROJECT_MCP_RECOMMENDATIONS_PROVIDER],
      [ProjectAccessModule, PROJECT_PINS],
      [ProjectAccessModule, PROJECT_TASK_READER],
      [ProjectsModule, PROJECT_READS],
      [ProjectsModule, PROJECT_MUTATIONS],
      [ProjectsModule, PROJECT_RENAME],
      [ProjectsModule, PROJECT_DELETION],
      [ProjectAccessModule, PROJECT_SKILL_SELECTION_PROVIDER],
      [SkillInstallationAccessModule, SKILL_INSTALLATION_CLIENT],
    ] as const) {
      // Module re-exports must expose the owner's provider, not register a second one.
      const instances = module.get(token, { each: true })
      assert.equal(instances.length, 1, `${String(token)} must have one provider registration`)
      assert.equal(instances[0], module.select(owner).get(token, { strict: true }))
    }
    const projectAccess = module.select(ProjectAccessModule)
    const lookup = projectAccess.get(PROJECT_LOOKUP, { strict: true })
    assert.deepEqual(Reflect.ownKeys(lookup), ["find"], "lookup must not expose Project mutations or another capability")
    assert.equal(typeof lookup.find, "function")
    const recommendations = projectAccess.get(PROJECT_MCP_RECOMMENDATIONS_STORE, { strict: true })
    assert.deepEqual(Reflect.ownKeys(recommendations), ["mcpRecommendations", "replaceMcpRecommendations"])
    assert.equal(module.select(McpModule).get(PROJECT_MCP_RECOMMENDATIONS_PROVIDER, { strict: true }).project, recommendations)
    assert.equal(projectAccess.get(PROJECT_SKILL_SELECTION_PROVIDER, { strict: true }).find, lookup.find)
    assert.deepEqual(Reflect.ownKeys(projectAccess.get(PROJECT_PINS, { strict: true })), ["listPins", "setPin"])
    assert.equal(typeof projectAccess.get(PROJECT_TASK_READER, { strict: true }), "function")
    const projects = module.select(ProjectsModule)
    assert.deepEqual(Reflect.ownKeys(projects.get(PROJECT_READS, { strict: true })), ["list", "revisions"])
    assert.deepEqual(Reflect.ownKeys(projects.get(PROJECT_MUTATIONS, { strict: true })), ["create", "updateInstruction"])
    assert.equal(typeof projects.get(PROJECT_RENAME, { strict: true }), "function")
    assert.deepEqual(Reflect.ownKeys(projects.get(PROJECT_DELETION, { strict: true })), ["delete", "deletion"])
    const reader = module.select(AgentRunsModule).get(AGENT_RUNS_READER, { strict: true })
    assert.notEqual(reader, module.select(AgentDispatchModule).get(AGENT_DISPATCH_OUTBOX, { strict: true }))
    assert.equal(typeof reader.readProjectExecutionBinding, "function")
    assert.equal(typeof reader.readSubmittedAgentRun, "function")
    const display = module.select(AgentRunsModule).get(RUN_DISPLAY_PROVIDER, { strict: true })
    assert.equal(display.submittedAgentRuns, reader)
    assert.equal(display.findConversation, module.select(ChatModule).get(CHAT_CONVERSATION_LOOKUP, { strict: true }))
    assert.equal(display.readRunFinalAnswer, module.select(AgentRunsModule).get(RUN_FINAL_ANSWER_LOOKUP, { strict: true }))
  } finally {
    await module.close()
  }
})

test("unmatched Product routes keep the BFF error envelope without calling any owner", async (t) => {
  await import("reflect-metadata")
  const { createServer } = await import("node:http")
  const { once } = await import("node:events")
  const { Test } = await import("@nestjs/testing")
  const { AppModule } = await import("../dist/app.module.js")
  const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { BffExpressAdapter } = await import("../dist/http/bff-express-adapter.js")
  const { SessionAdmissionDouble } = await import("./doubles/session-admission.ts")
  const {
    AGENT_CANCELLATION_DISPATCHER,
    AGENT_DISPATCH_DISPATCHER,
    AGUI_PROJECTOR,
    BFF_CONFIG,
    BFF_DATABASE,
    PROJECT_SCOPE_RELEASE_DISPATCHER,
    SESSION_ADMISSION,
    SCHEDULED_TASK_DISPATCHER,
    SCHEDULED_AGENT_DISPATCHER,
    SCHEDULED_AGENT_TERMINAL_CONSUMER,
    SKILL_AUTHORIZATION,
  } = await import("../dist/common/tokens.js")
  let ownerCalls = 0
  const owner = createServer((_request, response) => {
    ownerCalls++
    response.writeHead(502).end()
  })
  t.after(() => new Promise<void>((resolve) => owner.close(() => resolve())))
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  const address = owner.address()
  assert.ok(address !== null && typeof address !== "string")
  const baseUrl = `http://127.0.0.1:${address.port}`
  const config = loadConfig({
    KOKORO_BFF_SHARED_SECRET: "test-secret",
    KOKORO_INTERNAL_SECRET_BFF: "fixture-internal-secret",
    KOKORO_BILLING_BFF_SERVICE_TOKEN: "fixture-billing-token",
    KOKORO_IAM_WEB_ORIGIN: "https://web.example.test",
    KOKORO_TENANT_ID: "test-tenant",
    KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
    KOKORO_AGENT_ENABLED: "true",
    KOKORO_AGENT_BASE_URL: baseUrl,
    KOKORO_BILLING_BASE_URL: baseUrl,
    KOKORO_STORAGE_RPC_BASE_URL: baseUrl,
    KOKORO_STORAGE_OBJECT_ORIGIN: baseUrl,
    KOKORO_BFF_STORAGE_SECRET: "fixture-storage-secret",
  })
  const admission = new SessionAdmissionDouble({ "unknown-product-session": { namespace: "test-tenant", userId: "test-user" } })
  const skillActions: string[] = []
  let storageCalls = 0
  const unexpected = (): never => {
    storageCalls++
    assert.fail("unmatched Product routes must not access PostgreSQL")
  }
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue({ ...config, upstreams: { ...config.upstreams, model: baseUrl } })
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpected, connect: unexpected } })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(admission)
    .overrideProvider(SKILL_AUTHORIZATION)
    .useValue({
      check: async ({ action }: { action: string }) => {
        skillActions.push(action)
        return { ok: true }
      },
    })
  for (const token of [
    AGENT_CANCELLATION_DISPATCHER,
    AGENT_DISPATCH_DISPATCHER,
    AGUI_PROJECTOR,
    PROJECT_SCOPE_RELEASE_DISPATCHER,
    SCHEDULED_TASK_DISPATCHER,
    SCHEDULED_AGENT_DISPATCHER,
    SCHEDULED_AGENT_TERMINAL_CONSUMER,
  ])
    builder.overrideProvider(token).useValue(null)
  const module = await builder.compile()
  const app = module.createNestApplication(new BffExpressAdapter(), { ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  t.after(() => app.close())
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()
  const headers = {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    cookie: "kokoro-issuer.session_token=unknown-product-session",
    origin: "https://web.example.test",
    "x-request-id": "unknown-product-test",
  }
  for (const route of [
    "connectors",
    "preferences",
    "cloud-computers",
    "integrations",
    "agents/unknown",
    "billing/unknown",
    "models/unknown",
    "library/unknown",
    "sessions/session_control/runs/run_control/unknown",
  ]) {
    const response = await fetch(`${base}/v1/${route}`, { headers })
    assert.equal(response.status, 404, route)
    assert.equal(response.headers.get("x-request-id"), "unknown-product-test", route)
    assert.equal(response.headers.get("cache-control"), "no-store", route)
    assert.deepEqual(
      await response.json(),
      {
        error: { code: "bff_route_not_found", message: "Business route was not found" },
        meta: { request_id: "unknown-product-test" },
      },
      route,
    )
  }
  const health = await fetch(`${base}/healthz`)
  assert.equal(health.status, 200)
  await health.arrayBuffer()
  const outside = await fetch(`${base}/v10/connectors`)
  assert.equal(outside.status, 404)
  assert.equal((await outside.json()).statusCode, 404)
  assert.equal(admission.calls.length, 0)
  assert.equal(storageCalls, 0)
  assert.equal(ownerCalls, 0)

  await t.test("System fallback never intercepts a current Skills command", async () => {
    const draft = await fetch(`${base}/v1/skills/drafts`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "draft-owner-boundary" },
      body: JSON.stringify({ display_name: "Draft owner boundary", summary: "", tags: [] }),
    })
    assert.equal(draft.status, 503)
    assert.equal((await draft.json()).error.code, "skill_dependency_unavailable")
    assert.deepEqual(skillActions, ["create_draft"])

    for (const [route, error] of [
      ["system/unknown", "system_projection_not_configured"],
      ["skills/quota", "platform_operation_not_available"],
    ]) {
      const response = await fetch(`${base}/v1/${route}`, { headers })
      assert.equal(response.status, 503, route)
      assert.equal((await response.json()).error.code, error, route)
    }
    assert.deepEqual(skillActions, ["create_draft"])
    assert.equal(ownerCalls, 0)
    assert.equal(storageCalls, 0)
  })
})

test("HealthModule preserves the probe response when readiness is blocked", async (t) => {
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  const { BFF_CONFIG, BFF_DATABASE } = await import("../dist/common/tokens.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
  const { HealthModule } = await import("../dist/modules/health/health.module.js")
  for (const { name, iamConfigured, databaseReady, expectedStatus, expectedReads } of [
    { name: "IAM missing", iamConfigured: false, databaseReady: true, expectedStatus: 503, expectedReads: 0 },
    { name: "database unavailable", iamConfigured: true, databaseReady: false, expectedStatus: 503, expectedReads: 1 },
    { name: "ready", iamConfigured: true, databaseReady: true, expectedStatus: 200, expectedReads: 1 },
  ]) {
    await t.test(name, async (t) => {
      const config = loadConfig({
        KOKORO_BFF_SHARED_SECRET: "health-probe-test-only",
        KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
        KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
        KOKORO_AGENT_ENABLED: "false",
        ...(iamConfigured ? { KOKORO_IAM_BASE_URL: "http://127.0.0.1:1" } : {}),
      })
      let readinessReads = 0
      const unexpectedIo = (): never => assert.fail("HealthModule must not access PostgreSQL or Redis directly")
      const module = await Test.createTestingModule({ imports: [HealthModule] })
        .overrideProvider(BFF_CONFIG)
        .useValue(config)
        .overrideProvider(BFF_DATABASE)
        .useValue({
          pool: { query: unexpectedIo, connect: unexpectedIo },
          ready: async () => {
            readinessReads++
            if (!databaseReady) throw new Error("readiness fixture must not be disclosed")
          },
        })
        .compile()
      const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, logger: false })
      t.after(async () => {
        app.getHttpServer().closeAllConnections()
        await app.close()
      })
      await app.listen(0, "127.0.0.1")
      const base = await app.getUrl()
      const body = { status: "ok", service: "kokoro-bff", mode: "live" }
      const health = await fetch(base + "/healthz", { signal: AbortSignal.timeout(2000) })
      assert.deepEqual({ status: health.status, body: await health.json() }, { status: 200, body })
      assert.equal(readinessReads, 0)
      const readiness = await fetch(base + "/readyz", { signal: AbortSignal.timeout(2000) })
      assert.equal(readinessReads, expectedReads)
      assert.deepEqual({ status: readiness.status, body: await readiness.json() }, { status: expectedStatus, body })
    })
  }
})

test("production Nest listener begins worker drain during an active request and retains resources until both settle", { timeout: 10_000 }, async (t) => {
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  const { setImmediate } = await import("node:timers/promises")
  const { AppModule } = await import("../dist/app.module.js")
  const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { PostgresBffDatabase } = await import("../dist/infrastructure/postgres/client.js")
  const {
    AGENT_CANCELLATION_DISPATCHER,
    AGENT_DISPATCH_DISPATCHER,
    AGUI_PROJECTOR,
    BFF_CONFIG,
    BFF_DATABASE,
    PROJECT_SCOPE_RELEASE_DISPATCHER,
    SCHEDULED_AGENT_DISPATCHER,
    SCHEDULED_AGENT_TERMINAL_CONSUMER,
    SCHEDULED_TASK_DISPATCHER,
  } = await import("../dist/common/tokens.js")
  const config = loadConfig({
    KOKORO_BFF_SHARED_SECRET: "nest-close-test-only",
    KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
    KOKORO_IAM_BASE_URL: "http://127.0.0.1:1",
    KOKORO_AGENT_ENABLED: "false",
  })
  const scenarios = [
    { feature: "AgentDispatch", gatedToken: AGENT_DISPATCH_DISPATCHER },
    { feature: "Agui", gatedToken: AGUI_PROJECTOR },
    { feature: "ProjectScopeRelease", gatedToken: PROJECT_SCOPE_RELEASE_DISPATCHER },
    { feature: "ScheduledTask", gatedToken: SCHEDULED_TASK_DISPATCHER },
  ].flatMap((feature) => (["request", "worker"] as const).map((releaseFirst) => ({ ...feature, releaseFirst })))
  for (const { feature, gatedToken, releaseFirst } of scenarios) {
    await t.test(`${feature}: ${releaseFirst} settles first`, async (t) => {
      const database = new PostgresBffDatabase(config.postgresUrl!, config.redisUrl!)
      const unexpectedIoCalls: string[] = []
      const unexpectedIo = (operation: string): never => {
        unexpectedIoCalls.push(operation)
        assert.fail(`the listener lifecycle test must not perform ${operation}`)
      }
      t.mock.method(database.pool, "connect", () => unexpectedIo("Pool.connect"))
      t.mock.method(database.redis, "connect", () => unexpectedIo("Redis.connect"))
      t.mock.method(database.redis, "destroy", () => unexpectedIo("Redis.destroy"))
      // Keep real readiness, close and the Nest hook; replace only managed-client I/O and state.
      let redisOpen = true
      t.mock.getter(database.redis, "isReady", () => redisOpen)
      t.mock.getter(database.redis, "isOpen", () => redisOpen)
      const ping = t.mock.method(database.redis, "ping", async () => "PONG")
      let enterRequest!: () => void
      const requestEntered = new Promise<void>((resolve) => {
        enterRequest = resolve
      })
      let releaseRequest!: () => void
      const requestGate = new Promise<void>((resolve) => {
        releaseRequest = resolve
      })
      let readinessCalls = 0
      t.mock.method(database.pool, "query", async () => {
        readinessCalls += 1
        if (readinessCalls > 2) unexpectedIo("unexpected Pool.query")
        if (readinessCalls === 2) {
          enterRequest()
          await requestGate
        }
        return {
          command: "SELECT",
          rowCount: 1,
          oid: 0,
          fields: [],
          rows: [{ schema: "kokoro_bff", installed: true }],
        }
      })
      let workerStopping = false
      let workerStopped = false
      let releaseWorker!: () => void
      const workerGate = new Promise<void>((resolve) => {
        releaseWorker = resolve
      })
      let finishWorker!: () => void
      const workerFinished = new Promise<void>((resolve) => {
        finishWorker = resolve
      })
      const workers = [
        AGENT_DISPATCH_DISPATCHER,
        AGENT_CANCELLATION_DISPATCHER,
        AGUI_PROJECTOR,
        PROJECT_SCOPE_RELEASE_DISPATCHER,
        SCHEDULED_AGENT_DISPATCHER,
        SCHEDULED_AGENT_TERMINAL_CONSUMER,
        SCHEDULED_TASK_DISPATCHER,
      ].map((token) => ({
        token,
        start: t.mock.fn(() => undefined),
        stop: t.mock.fn(async () => {
          if (token !== gatedToken) return
          workerStopping = true
          await workerGate
          workerStopped = true
          finishWorker()
        }),
      }))
      let responseFinished = false
      const releases: {
        responseFinished: boolean
        workerStopped: boolean
      }[] = []
      const poolEnd = t.mock.method(database.pool, "end", async () => {
        releases.push({ responseFinished, workerStopped })
      })
      const redisClose = t.mock.method(database.redis, "close", async () => {
        releases.push({ responseFinished, workerStopped })
        redisOpen = false
      })
      const builder = Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(BFF_CONFIG)
        .useValue(config)
        .overrideProvider(BFF_DATABASE)
        .useValue(database)
      // ScheduledTask's dispatcher starts even with Agent disabled; no real worker may perform background I/O.
      for (const worker of workers) builder.overrideProvider(worker.token).useValue(worker)
      const module = await builder.compile()
      const app = module.createNestApplication({
        ...BFF_NEST_APPLICATION_OPTIONS,
        logger: false,
      })
      const server = app.getHttpServer<import("node:http").Server>()
      let request: Promise<{ status: number; body: unknown }> | undefined
      let closing: Promise<void> | undefined
      let primaryFailure: { error: unknown } | undefined
      try {
        await app.listen(0, "127.0.0.1")
        const base = await app.getUrl()
        for (const worker of workers) assert.equal(worker.start.mock.callCount(), 1, `${String(worker.token)} starts during real Nest initialization`)
        const health = await fetch(`${base}/healthz`, {
          headers: { connection: "close" },
          signal: t.signal,
        })
        assert.equal(health.status, 200)
        assert.deepEqual(await health.json(), {
          status: "ok",
          service: "kokoro-bff",
          mode: config.mode,
        })
        const ready = await fetch(`${base}/readyz`, {
          headers: { connection: "close" },
          signal: t.signal,
        })
        assert.equal(ready.status, 200)
        assert.deepEqual(await ready.json(), {
          status: "ok",
          service: "kokoro-bff",
          mode: config.mode,
        })
        assert.equal(readinessCalls, 1)
        assert.equal(ping.mock.callCount(), 1)
        server.once("request", (_request, response) => {
          response.once("finish", () => {
            responseFinished = true
          })
        })
        request = fetch(`${base}/readyz`, {
          headers: { connection: "close" },
          signal: t.signal,
        }).then(async (response) => ({
          status: response.status,
          body: await response.json(),
        }))
        let abortWaiting!: () => void
        const requestAborted = new Promise<never>((_resolve, reject) => {
          abortWaiting = () => reject(t.signal.reason)
          t.signal.addEventListener("abort", abortWaiting, { once: true })
          if (t.signal.aborted) abortWaiting()
        })
        try {
          await Promise.race([
            requestEntered,
            request.then(() => assert.fail("the held readiness request must enter the database gate before responding")),
            requestAborted,
          ])
        } finally {
          t.signal.removeEventListener("abort", abortWaiting)
        }
        closing = app.close()
        // Observe a real shutdown boundary, not an elapsed-time guess: the worker begins or the listener stops accepting connections.
        while (!workerStopping && server.listening) await setImmediate(undefined, { signal: t.signal })
        assert.equal(responseFinished, false, "the real readiness response remains in flight")
        assert.equal(workerStopping, true, "worker drain must begin before an active HTTP request finishes")
        assert.equal(poolEnd.mock.callCount(), 0)
        assert.equal(redisClose.mock.callCount(), 0)
        if (feature === "AgentDispatch" && releaseFirst === "request") {
          for (const route of ["/healthz", "/readyz"]) {
            const denied = await fetch(`${base}${route}`, { signal: t.signal })
            await denied.arrayBuffer()
            assert.equal(denied.status, 503, `${route} must reject new requests while the worker drains`)
            assert.equal(denied.headers.get("connection"), "close", `${route} must close its rejected connection`)
            assert.equal(readinessCalls, 2, "closing admission must not invoke readiness dependencies")
            assert.equal(ping.mock.callCount(), 1, "the active readiness request must remain at its database gate")
          }
        }
        if (releaseFirst === "request") {
          releaseRequest()
          await request
          assert.equal(responseFinished, true)
          assert.equal(workerStopped, false)
        } else {
          releaseWorker()
          await workerFinished
          assert.equal(workerStopped, true)
          assert.equal(responseFinished, false)
        }
        // Let runnable shutdown hooks advance while the other activity is still held.
        await setImmediate(undefined, { signal: t.signal })
        assert.equal(poolEnd.mock.callCount(), 0, "Pool must wait for both HTTP completion and worker settlement")
        assert.equal(redisClose.mock.callCount(), 0, "Redis must wait for both HTTP completion and worker settlement")
        releaseRequest()
        releaseWorker()
        const response = await request
        assert.equal(response.status, 200)
        assert.deepEqual(response.body, {
          status: "ok",
          service: "kokoro-bff",
          mode: config.mode,
        })
        await closing
        assert.equal(readinessCalls, 2)
        assert.equal(ping.mock.callCount(), 2)
        assert.deepEqual(releases, [
          { responseFinished: true, workerStopped: true },
          { responseFinished: true, workerStopped: true },
        ])
      } catch (error) {
        primaryFailure = { error }
        throw error
      } finally {
        releaseRequest()
        releaseWorker()
        const cleanup = await Promise.allSettled([request, closing ?? app.close()])
        const cleanupFailures: unknown[] = cleanup.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
        try {
          assert.equal(server.listening, false)
          for (const worker of workers) {
            assert.equal(worker.stop.mock.callCount(), 1, `${String(worker.token)} stops once through the real Nest lifecycle`)
          }
          assert.equal(poolEnd.mock.callCount(), 1, "Nest releases its real database owner's Pool once")
          assert.equal(redisClose.mock.callCount(), 1, "Nest releases its real database owner's Redis once")
          assert.deepEqual(unexpectedIoCalls, [], "background workers must not hide unexpected I/O failures")
        } catch (error) {
          cleanupFailures.push(error)
        }
        if (cleanupFailures.length > 0) {
          throw new AggregateError(
            primaryFailure ? [primaryFailure.error, ...cleanupFailures] : cleanupFailures,
            "listener lifecycle cleanup failed; all request and application-close outcomes were collected",
          )
        }
      }
    })
  }
})

test("production Nest retires AG-UI transports before worker drain while retaining physically pending handlers", { timeout: 15_000 }, async (t) => {
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  const { setImmediate } = await import("node:timers/promises")
  const { AppModule } = await import("../dist/app.module.js")
  const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { PostgresBffDatabase } = await import("../dist/infrastructure/postgres/client.js")
  const tokens = await import("../dist/common/tokens.js")
  const config = loadConfig({
    KOKORO_BFF_SHARED_SECRET: "nest-agui-close-test-only",
    KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
    KOKORO_IAM_BASE_URL: "http://127.0.0.1:1",
    KOKORO_IAM_WEB_ORIGIN: "https://web.example.test",
    KOKORO_TENANT_ID: "tenant_agui_close",
    KOKORO_AGENT_ENABLED: "false",
    KOKORO_AGUI_LEDGER_POLL_BASE_DELAY_MS: "100",
    KOKORO_AGUI_LEDGER_POLL_MAX_DELAY_MS: "100",
  })
  for (const phase of ["stream", "shared_replay", "admission", "project", "authorization", "register", "replay", "status"] as const) {
    await t.test(phase, async (t) => {
      const physical = Promise.withResolvers<void>()
      const entered = Promise.withResolvers<void>()
      const streaming = Promise.withResolvers<void>()
      const stopping = Promise.withResolvers<void>()
      const workerGate = Promise.withResolvers<void>()
      const timedOut = Promise.withResolvers<never>()
      const abortObservation = () => timedOut.reject(t.signal.reason)
      t.signal.addEventListener("abort", abortObservation, { once: true })
      const calls = {
        admission: 0,
        project: 0,
        authorization: 0,
        register: 0,
        replay: 0,
        status: 0,
      }
      const atPhase = async (candidate: keyof typeof calls): Promise<void> => {
        calls[candidate] += 1
        if (phase === candidate || (phase === "shared_replay" && candidate === "replay")) {
          entered.resolve()
          await physical.promise
        }
      }
      const database = new PostgresBffDatabase(config.postgresUrl!, config.redisUrl!)
      const unexpectedIoCalls: string[] = []
      const unexpectedIo = (operation: string): never => {
        unexpectedIoCalls.push(operation)
        assert.fail(`the AG-UI listener test must not perform ${operation}`)
      }
      t.mock.method(database.pool, "query", () => unexpectedIo("Pool.query"))
      t.mock.method(database.pool, "connect", () => unexpectedIo("Pool.connect"))
      t.mock.method(database.redis, "connect", () => unexpectedIo("Redis.connect"))
      t.mock.method(database.redis, "destroy", () => unexpectedIo("Redis.destroy"))
      let redisOpen = true
      t.mock.getter(database.redis, "isReady", () => redisOpen)
      t.mock.getter(database.redis, "isOpen", () => redisOpen)
      const poolEnd = t.mock.method(database.pool, "end", async () => undefined)
      const redisClose = t.mock.method(database.redis, "close", async () => {
        redisOpen = false
      })
      let workerStopping = false
      let response: import("node:http").ServerResponse | undefined
      let endedBeforeWorker: boolean | undefined
      let retiring = false
      const lateResponseWork: string[] = []
      const workers = [
        tokens.AGENT_DISPATCH_DISPATCHER,
        tokens.AGENT_CANCELLATION_DISPATCHER,
        tokens.AGUI_PROJECTOR,
        tokens.PROJECT_SCOPE_RELEASE_DISPATCHER,
        tokens.SCHEDULED_AGENT_DISPATCHER,
        tokens.SCHEDULED_AGENT_TERMINAL_CONSUMER,
        tokens.SCHEDULED_TASK_DISPATCHER,
      ].map((token) => ({
        token,
        start: t.mock.fn(() => undefined),
        stop: t.mock.fn(async () => {
          if (token !== tokens.AGUI_PROJECTOR) return
          workerStopping = true
          endedBeforeWorker = response?.writableEnded
          stopping.resolve()
          await workerGate.promise
        }),
      }))
      const admission = {
        verify: async () => {
          await atPhase("admission")
          return {
            ok: true,
            identity: {
              namespace: "tenant_agui_close",
              userId: "owner_agui_close",
            },
            platformAdmin: false,
            expiresAt: "2099-01-01T00:00:00.000Z",
            setCookies: phase === "admission" ? ["__Secure-kokoro-issuer.session_token=late; Path=/; HttpOnly; Secure"] : [],
          }
        },
      }
      const findConversation = async () => {
        await atPhase("authorization")
        return { ownerId: "owner_agui_close" }
      }
      const projects = {
        find: async () => {
          await atPhase("project")
          return { id: "project_agui_close" }
        },
      }
      const consumers = {
        registerConsumer: async () => {
          await atPhase("register")
        },
      }
      const projection = {
        replay: async () => {
          await atPhase("replay")
          return {
            kind: "page",
            frames: [],
            atHead: true,
            terminalRunId: null,
          }
        },
        status: async () => {
          await atPhase("status")
          return {
            sourceHighWatermark: 0,
            currentCursor: null,
            consumerState: "active",
            consumerLastErrorCode: null,
            consumerLastPolledAt: null,
          }
        },
      }
      const builder = Test.createTestingModule({ imports: [AppModule] })
      for (const [token, value] of [
        [tokens.BFF_CONFIG, config],
        [tokens.BFF_DATABASE, database],
        [tokens.SESSION_ADMISSION, admission],
        [tokens.CHAT_CONVERSATION_LOOKUP, findConversation],
        [tokens.PROJECT_LOOKUP, projects],
        [tokens.AGUI_PROJECTION_CONSUMERS, consumers],
        [tokens.AGUI_PROJECTION, projection],
        [tokens.AGUI_SOURCE_PROJECTION_ACTIVE, true],
      ] as const)
        builder.overrideProvider(token).useValue(value)
      for (const worker of workers) builder.overrideProvider(worker.token).useValue(worker)
      const module = await builder.compile()
      // Keep the production factory instance and its actual Nest-discovered hooks.
      const runtime = module.get(tokens.AGUI_RUNTIME)
      const app = module.createNestApplication({
        ...BFF_NEST_APPLICATION_OPTIONS,
        logger: false,
      })
      const server = app.getHttpServer<import("node:http").Server>()
      const abortClient = new AbortController()
      const abortClientB = new AbortController()
      let request:
        | Promise<{
            ok: boolean
            status?: number
            body?: string
            error?: unknown
          }>
        | undefined
      let requestB: typeof request
      let closing: Promise<void> | undefined
      let primaryFailure: unknown
      try {
        await app.listen(0, "127.0.0.1")
        server.on("request", (_request, currentResponse) => {
          response = currentResponse
          const setHeader = currentResponse.setHeader.bind(currentResponse)
          t.mock.method(currentResponse, "setHeader", (name, value) => {
            if (retiring) lateResponseWork.push(`header:${name.toLowerCase()}`)
            return setHeader(name, value)
          })
          const writeHead = currentResponse.writeHead.bind(currentResponse)
          t.mock.method(currentResponse, "writeHead", (...args) => {
            if (retiring) lateResponseWork.push("headers")
            return writeHead(...args)
          })
          const write = currentResponse.write.bind(currentResponse)
          t.mock.method(currentResponse, "write", (...args) => {
            if (retiring) lateResponseWork.push("body")
            return write(...args)
          })
          const end = currentResponse.end.bind(currentResponse)
          t.mock.method(currentResponse, "end", (...args) => {
            if (retiring && args[0] !== undefined) lateResponseWork.push("end:body")
            return end(...args)
          })
        })
        const target = `${await app.getUrl()}/v1/sessions/session_agui_close/events${phase === "project" ? "?project_ref=project_agui_close" : ""}`
        const headers = {
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "nest-agui-close-test-only",
          cookie: "kokoro-issuer.session_token=fixture",
          origin: "https://web.example.test",
        }
        const readStream = async (result: Response) => {
          const reader = result.body!.getReader()
          let body = ""
          for (;;) {
            const chunk = await reader.read()
            if (chunk.done) return { ok: true, status: result.status, body }
            body += new TextDecoder().decode(chunk.value)
            if (body.includes(": keep-alive\n\n")) streaming.resolve()
          }
        }
        request = fetch(target, { headers, signal: AbortSignal.any([abortClient.signal, t.signal]) })
          .then(readStream)
          .catch((error: unknown) => ({ ok: false, error }))
        await Promise.race([
          phase === "stream" ? streaming.promise : entered.promise,
          request.then((result) => assert.fail(`the expected AG-UI phase was not reached: ${inspect(result)}`)),
          timedOut.promise,
        ])
        assert.equal(runtime.connections.snapshot().global, ["stream", "shared_replay", "replay", "status"].includes(phase) ? 1 : 0)
        if (phase === "shared_replay") {
          requestB = fetch(target, { headers, signal: AbortSignal.any([abortClientB.signal, t.signal]) })
            .then(readStream)
            .catch((error: unknown) => ({ ok: false, error }))
          while (runtime.connections.snapshot().global !== 2) await setImmediate(undefined, { signal: t.signal })
          assert.equal(calls.replay, 1, "both clients must share the same physical replay load")
          abortClient.abort()
          await request
          assert.equal(poolEnd.mock.callCount(), 0)
          physical.resolve()
          await Promise.race([
            streaming.promise,
            requestB.then((result) => assert.fail(`client B lost its shared replay: ${inspect(result)}`)),
            timedOut.promise,
          ])
          while (runtime.connections.snapshot().global !== 1) await setImmediate(undefined, { signal: t.signal })
          assert.equal(response?.writableEnded, false, "client B must remain active after client A leaves the shared replay")
        }
        const callsBeforeRetirement = { ...calls }
        retiring = true
        closing = app.close()
        if (phase === "stream" || phase === "shared_replay") {
          await Promise.race([stopping.promise, timedOut.promise])
          assert.equal(endedBeforeWorker, true, "an active SSE must end before the projector worker begins draining")
          assert.equal(runtime.connections.snapshot().global, 0, "the connection lease retires before worker drain")
        } else {
          // All hooks before the held physical operation are local; advance the runnable close microtasks once.
          await setImmediate(undefined, { signal: t.signal })
          assert.equal(workerStopping, false, "a physically pending handler must settle before worker drain starts")
          assert.equal(poolEnd.mock.callCount(), 0)
          assert.equal(redisClose.mock.callCount(), 0)
          physical.resolve()
          await Promise.race([stopping.promise, timedOut.promise])
        }
        assert.deepEqual(calls, callsBeforeRetirement, "retirement must not begin another authorization, register, replay, or status operation")
        assert.deepEqual(lateResponseWork, [], "late physical settlement must not write cookies, headers, or body after retirement")
        assert.equal(poolEnd.mock.callCount(), 0, "Pool stays owned while worker drain is held")
        assert.equal(redisClose.mock.callCount(), 0, "Redis stays owned while worker drain is held")
        workerGate.resolve()
        await Promise.race([closing, timedOut.promise])
        const result = await (requestB ?? request)
        if (phase === "stream" || phase === "shared_replay") {
          assert.equal(result.ok, true)
          assert.equal(result.status, 200)
          assert.equal(result.body, ": keep-alive\n\n", "transport retirement must not manufacture an AG-UI terminal")
        }
      } catch (error) {
        primaryFailure = error
        throw error
      } finally {
        physical.resolve()
        workerGate.resolve()
        abortClient.abort()
        abortClientB.abort()
        t.signal.removeEventListener("abort", abortObservation)
        const cleanup = await Promise.allSettled([request, requestB, closing ?? app.close()])
        const cleanupFailures = cleanup.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
        try {
          // The old implementation only notices disconnect on its next poll. Await its actual lease release too,
          // so the deliberately failing baseline leaves no handler or timer behind for subsequent scenarios.
          await setImmediate(undefined, { signal: t.signal })
          while (runtime.connections.snapshot().global !== 0) await setImmediate(undefined, { signal: t.signal })
          assert.equal(server.listening, false)
          assert.equal(runtime.connections.snapshot().global, 0)
          for (const worker of workers) assert.equal(worker.stop.mock.callCount(), 1)
          assert.equal(poolEnd.mock.callCount(), 1)
          assert.equal(redisClose.mock.callCount(), 1)
          assert.deepEqual(unexpectedIoCalls, [])
        } catch (error) {
          cleanupFailures.push(error)
        }
        if (cleanupFailures.length)
          throw new AggregateError(primaryFailure === undefined ? cleanupFailures : [primaryFailure, ...cleanupFailures], "AG-UI listener cleanup failed")
      }
    })
  }
})

test("database close releases each resource once for concurrent and repeated successful callers", { timeout: 10_000 }, async (t) => {
  const { PostgresBffDatabase } = await import("../dist/infrastructure/postgres/client.js")
  const database = new PostgresBffDatabase("postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff", "redis://127.0.0.1:1/8")
  t.mock.getter(database.redis, "isReady", () => true)
  t.mock.getter(database.redis, "isOpen", () => true)
  let signalEndStarted!: () => void
  const endStarted = new Promise<void>((resolve) => {
    signalEndStarted = resolve
  })
  let releaseEnd!: () => void
  const endGate = new Promise<void>((resolve) => {
    releaseEnd = resolve
  })
  const poolEnd = t.mock.method(database.pool, "end", async () => {
    signalEndStarted()
    await endGate
  })
  const redisClose = t.mock.method(database.redis, "close", async () => undefined)
  const closing = [database.close(), database.close()]
  try {
    await endStarted
    assert.equal(poolEnd.mock.callCount(), 1, "concurrent callers must share one resource-release attempt")
    releaseEnd()
    await Promise.all(closing)
    await database.close()
    assert.equal(poolEnd.mock.callCount(), 1)
    assert.equal(redisClose.mock.callCount(), 1)
  } finally {
    releaseEnd()
    await Promise.allSettled(closing)
  }
})

test("the real Redis driver closes its socket gracefully without sending QUIT", { timeout: 10_000 }, async (t) => {
  const { createServer } = await import("node:net")
  const { once } = await import("node:events")
  const { PostgresBffDatabase } = await import("../dist/infrastructure/postgres/client.js")
  const sockets = new Set<import("node:net").Socket>()
  const commands: string[][] = []
  const unexpected: string[][] = []
  let peerClosed = false
  let signalPeerClosed!: () => void
  const closed = new Promise<void>((resolve) => {
    signalPeerClosed = resolve
  })
  // A RESP peer for the pinned driver's handshake and a rejected QUIT, not a Redis engine.
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => {
      sockets.delete(socket)
      peerClosed = true
      signalPeerClosed()
    })
    socket.on("error", () => undefined)
    let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      for (;;) {
        const headerEnd = buffered.indexOf("\r\n")
        if (headerEnd < 0) return
        const count = Number(buffered.subarray(1, headerEnd).toString())
        let offset = headerEnd + 2
        const command: string[] = []
        for (let index = 0; index < count; index += 1) {
          const sizeEnd = buffered.indexOf("\r\n", offset)
          if (sizeEnd < 0) return
          const size = Number(buffered.subarray(offset + 1, sizeEnd).toString())
          offset = sizeEnd + 2
          if (buffered.length < offset + size + 2) return
          command.push(buffered.subarray(offset, offset + size).toString())
          offset += size + 2
        }
        buffered = buffered.subarray(offset)
        commands.push(command)
        if (command[0] === "QUIT") socket.write("-ERR QUIT rejected by the driver regression peer\r\n")
        else if (
          (command[0] === "SELECT" && command[1] === "8") ||
          (command[0] === "CLIENT" && command[1] === "SETINFO" && ["LIB-NAME", "LIB-VER"].includes(command[2]!))
        ) {
          socket.write("+OK\r\n")
        } else {
          unexpected.push(command)
          socket.write("-ERR unexpected driver command\r\n")
        }
      }
    })
  })
  let database: InstanceType<typeof PostgresBffDatabase> | undefined
  try {
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    database = new PostgresBffDatabase("postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff", `redis://127.0.0.1:${address.port}/8`)
    t.mock.method(database.pool, "end", async () => undefined)
    await database.connectRedis()
    assert.equal(database.redis.isReady, true)
    assert.deepEqual(unexpected, [])
    const outcome = await database.close().then(
      () => "fulfilled",
      () => "rejected",
    )
    assert.equal(outcome, "fulfilled", JSON.stringify({ outcome, isOpen: database.redis.isOpen, isReady: database.redis.isReady, peerClosed, commands }))
    assert.equal(commands.filter((command) => command[0] === "QUIT").length, 0)
    assert.equal(database.redis.isOpen, false)
    assert.equal(database.redis.isReady, false)
    await new Promise<void>((resolve, reject) => {
      const aborted = (): void => reject(t.signal.reason)
      t.signal.addEventListener("abort", aborted, { once: true })
      void closed.then(() => {
        t.signal.removeEventListener("abort", aborted)
        resolve()
      })
      if (t.signal.aborted) aborted()
    })
    assert.equal(peerClosed, true)
  } finally {
    if (database?.redis.isOpen) database.redis.destroy()
    for (const socket of sockets) socket.destroy()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("database close attempts graceful Redis cleanup after Pool failure and memoizes either resource failure", async (t) => {
  const { PostgresBffDatabase } = await import("../dist/infrastructure/postgres/client.js")
  for (const scenario of [
    { name: "Pool failure alone", poolFails: true, redisFails: false },
    { name: "Redis graceful close failure alone", poolFails: false, redisFails: true },
    { name: "both resources fail", poolFails: true, redisFails: true },
  ]) {
    await t.test(scenario.name, async (t) => {
      const database = new PostgresBffDatabase("postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff", "redis://127.0.0.1:1/8")
      let redisOpen = true
      t.mock.getter(database.redis, "isReady", () => true)
      t.mock.getter(database.redis, "isOpen", () => redisOpen)
      const poolEnd = t.mock.method(database.pool, "end", async () => {
        if (scenario.poolFails) throw new Error("POOL_CLOSE_TEST_CANARY")
      })
      const redisClose = t.mock.method(database.redis, "close", async () => {
        if (scenario.redisFails) throw new Error("REDIS_CLOSE_TEST_CANARY")
        redisOpen = false
      })
      const redisDestroy = t.mock.method(database.redis, "destroy", () => {
        redisOpen = false
      })
      const results = await Promise.allSettled([database.close(), database.close()])
      results.push(...(await Promise.allSettled([database.close()])))
      assert.ok(
        results.every((result) => result.status === "rejected" && result.reason instanceof Error),
        "either resource failure must reject every caller",
      )
      assert.equal(redisClose.mock.callCount(), 1, "Pool failure must not skip Redis cleanup")
      assert.equal(redisDestroy.mock.callCount(), scenario.redisFails ? 1 : 0, "a failed graceful close must destroy the still-open Redis client")
      assert.equal(poolEnd.mock.callCount(), 1, "a failed release must not be retried by later callers")
      for (const result of results) {
        if (result.status !== "rejected") assert.fail("a failed close must not become a successful retry")
        assert.equal(result.reason.message, "bff_database_shutdown_failed")
        assert.equal(result.reason.cause, undefined)
      }
      assert.doesNotMatch(inspect(results, { depth: null }), /POOL_CLOSE_TEST_CANARY|REDIS_CLOSE_TEST_CANARY/u)
    })
  }
})

test("Nest records only a stable safe category when its real database shutdown fails", { timeout: 10_000 }, async (t) => {
  await import("reflect-metadata")
  const { Logger } = await import("@nestjs/common")
  const { Test } = await import("@nestjs/testing")
  const { AppModule } = await import("../dist/app.module.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { PostgresBffDatabase } = await import("../dist/infrastructure/postgres/client.js")
  const { BFF_CONFIG, BFF_DATABASE } = await import("../dist/common/tokens.js")
  const config = loadConfig({
    KOKORO_BFF_SHARED_SECRET: "nest-close-test-only",
    KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
    KOKORO_IAM_BASE_URL: "http://127.0.0.1:1",
    KOKORO_AGENT_ENABLED: "false",
  })
  const database = new PostgresBffDatabase(config.postgresUrl!, config.redisUrl!)
  const unexpectedIo = (): never => assert.fail("the shutdown failure test must not access external resources")
  t.mock.method(database.pool, "query", unexpectedIo)
  t.mock.method(database.pool, "connect", unexpectedIo)
  t.mock.method(database.redis, "connect", unexpectedIo)
  t.mock.method(database.redis, "ping", unexpectedIo)
  t.mock.getter(database.redis, "isReady", () => true)
  t.mock.getter(database.redis, "isOpen", () => true)
  const poolEnd = t.mock.method(database.pool, "end", async () => {
    throw new Error("POOL_CLOSE_TEST_CANARY")
  })
  t.mock.method(database.redis, "close", async () => {
    throw new Error("REDIS_CLOSE_TEST_CANARY")
  })
  t.mock.method(database.redis, "destroy", () => undefined)
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue(database)
    .compile()
  const logged = t.mock.method(Logger, "error", (..._arguments: unknown[]) => undefined)
  const previousExitCode = process.exitCode
  try {
    // The pinned Nest hook dispatcher logs rejected hooks through allSettled; close itself resolves.
    await assert.doesNotReject(() => module.close())
    assert.equal(poolEnd.mock.callCount(), 1)
    const argumentsLogged = logged.mock.calls.flatMap((call) => call.arguments)
    const failure = argumentsLogged.find((value) => value instanceof Error && value.message === "bff_database_shutdown_failed")
    assert.ok(failure instanceof Error, "Nest must record the database shutdown category")
    assert.equal(failure.cause, undefined, "the hook error must not retain raw I/O errors as causes")
    assert.doesNotMatch(inspect(argumentsLogged, { depth: null }), /POOL_CLOSE_TEST_CANARY|REDIS_CLOSE_TEST_CANARY/u)
  } finally {
    process.exitCode = previousExitCode
  }
})

async function exists(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(root, relativePath))
    return true
  } catch {
    return false
  }
}

test("BFF runtime uses native Nest bootstrap and composition root", async () => {
  const [packageSource, main] = await Promise.all([readFile(path.join(root, "package.json"), "utf8"), readFile(path.join(root, "src/main.ts"), "utf8")])
  const packageJson = JSON.parse(packageSource) as { dependencies?: Record<string, string> }
  for (const dependency of ["@nestjs/common", "@nestjs/core", "@nestjs/platform-express", "reflect-metadata", "rxjs"]) {
    assert.equal(typeof packageJson.dependencies?.[dependency], "string", `${dependency} must be a runtime dependency`)
  }
  assert.equal(await exists("src/app.module.ts"), true)
  assert.match(main, /NestFactory/u)
  assert.doesNotMatch(main, /node:http/u)
  assert.match(main, /NestFactory/u)
})

test("BFF production entrypoint does not create a second raw HTTP listener", async () => {
  const main = await readFile(path.join(root, "src/main.ts"), "utf8")
  assert.doesNotMatch(main, /createServer\(|node:http/u)
})

test("Nest health controller owns health and readiness instead of the legacy route adapter", async () => {
  const [healthModule, appModule] = await Promise.all([
    readFile(path.join(root, "src/modules/health/health.module.ts"), "utf8"),
    readFile(path.join(root, "src/app.module.ts"), "utf8"),
  ])
  assert.match(healthModule, /@Get\("healthz"\)/u)
  assert.match(healthModule, /@Get\("readyz"\)/u)
  assert.match(appModule, /imports:\s*\[[^\]]*\bHealthModule\b/u)
  assert.doesNotMatch(appModule, /LegacyRoutesModule|GracefulShutdown/u)
})

test("Nest production has no legacy route composition", async () => {
  const [appModule, main] = await Promise.all([readFile(path.join(root, "src/app.module.ts"), "utf8"), readFile(path.join(root, "src/main.ts"), "utf8")])
  assert.doesNotMatch(appModule, /LegacyRoutesModule|GracefulShutdown/u)
  assert.doesNotMatch(main, /LegacyRoutesRuntime|handleBffRequest/u)
  assert.equal(await exists("src/modules/legacy-routes/legacy-routes.runtime.ts"), false)
})

test("production Nest collects finite shutdown failures without skipping cleanup or losing nonzero process status", { timeout: 10_000 }, async (t) => {
  await import("reflect-metadata")
  const { Logger } = await import("@nestjs/common")
  const { Test } = await import("@nestjs/testing")
  const { AppModule } = await import("../dist/app.module.js")
  const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { PostgresBffDatabase } = await import("../dist/infrastructure/postgres/client.js")
  const {
    AGENT_CANCELLATION_DISPATCHER,
    AGENT_DISPATCH_DISPATCHER,
    AGUI_PROJECTOR,
    BFF_CONFIG,
    BFF_DATABASE,
    PROJECT_SCOPE_RELEASE_DISPATCHER,
    SCHEDULED_AGENT_DISPATCHER,
    SCHEDULED_AGENT_TERMINAL_CONSUMER,
    SCHEDULED_TASK_DISPATCHER,
  } = await import("../dist/common/tokens.js")
  const config = loadConfig({
    KOKORO_BFF_SHARED_SECRET: "nest-finite-close-test-only",
    KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
    KOKORO_IAM_BASE_URL: "http://127.0.0.1:1",
    KOKORO_AGENT_ENABLED: "false",
  })
  const scenarios = [
    { name: "Agent cancellation synchronous throw", token: AGENT_CANCELLATION_DISPATCHER, synchronous: true, category: "bff_agent_dispatch_shutdown_failed" },
    { name: "Scheduled terminal rejection", token: SCHEDULED_AGENT_TERMINAL_CONSUMER, synchronous: false, category: "bff_scheduled_task_shutdown_failed" },
    { name: "AG-UI projector rejection", token: AGUI_PROJECTOR, synchronous: false, category: "bff_agui_projector_shutdown_failed" },
    {
      name: "Project scope-release rejection",
      token: PROJECT_SCOPE_RELEASE_DISPATCHER,
      synchronous: false,
      category: "bff_project_scope_release_shutdown_failed",
    },
    { name: "Database Pool rejection", token: null, synchronous: false, category: "bff_database_shutdown_failed" },
  ]
  for (const scenario of scenarios) {
    await t.test(scenario.name, async (t) => {
      const previousExitCode = process.exitCode
      process.exitCode = 0
      const canary = "PRIVATE_FINITE_SHUTDOWN_FAILURE_CANARY"
      const database = new PostgresBffDatabase(config.postgresUrl!, config.redisUrl!)
      const unexpectedIoCalls: string[] = []
      const unexpectedIo = (operation: string): never => {
        unexpectedIoCalls.push(operation)
        assert.fail(`the finite shutdown test must not perform ${operation}`)
      }
      t.mock.method(database.pool, "query", () => unexpectedIo("Pool.query"))
      t.mock.method(database.pool, "connect", () => unexpectedIo("Pool.connect"))
      t.mock.method(database.redis, "connect", () => unexpectedIo("Redis.connect"))
      t.mock.method(database.redis, "ping", () => unexpectedIo("Redis.ping"))
      let redisOpen = true
      t.mock.getter(database.redis, "isReady", () => redisOpen)
      t.mock.getter(database.redis, "isOpen", () => redisOpen)
      const poolEnd = t.mock.method(database.pool, "end", async () => {
        if (scenario.token === null) throw new Error(canary)
      })
      const redisClose = t.mock.method(database.redis, "close", async () => {
        redisOpen = false
      })
      const redisDestroy = t.mock.method(database.redis, "destroy", () => unexpectedIo("Redis.destroy"))
      const stopEvents: { token: symbol; phase: "called" | "settled" }[] = []
      const workers = [
        AGENT_DISPATCH_DISPATCHER,
        AGENT_CANCELLATION_DISPATCHER,
        AGUI_PROJECTOR,
        PROJECT_SCOPE_RELEASE_DISPATCHER,
        SCHEDULED_AGENT_DISPATCHER,
        SCHEDULED_AGENT_TERMINAL_CONSUMER,
        SCHEDULED_TASK_DISPATCHER,
      ].map((token) => ({
        token,
        start: t.mock.fn(() => undefined),
        stop: t.mock.fn((): Promise<void> => {
          stopEvents.push({ token, phase: "called" })
          if (token === scenario.token && scenario.synchronous) {
            stopEvents.push({ token, phase: "settled" })
            throw new Error(canary)
          }
          return Promise.resolve().then(() => {
            stopEvents.push({ token, phase: "settled" })
            if (token === scenario.token) throw new Error(canary)
          })
        }),
      }))
      let app: import("@nestjs/common").INestApplication | undefined
      let closing: Promise<void> | undefined
      let primaryFailure: { error: unknown } | undefined
      try {
        const builder = Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(BFF_CONFIG)
          .useValue(config)
          .overrideProvider(BFF_DATABASE)
          .useValue(database)
        for (const worker of workers) builder.overrideProvider(worker.token).useValue(worker)
        const module = await builder.compile()
        app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, logger: false })
        await app.init()
        for (const worker of workers) assert.equal(worker.start.mock.callCount(), 1)
        const logged = t.mock.method(Logger, "error", (..._arguments: unknown[]) => undefined)
        // Nest 12 collects hook rejections; a resolved close is not proof of successful cleanup.
        closing = app.close()
        await assert.doesNotReject(closing)
        const argumentsLogged = logged.mock.calls.flatMap((call) => call.arguments)
        const loggedErrors = argumentsLogged.filter((value): value is Error => value instanceof Error)
        assert.deepEqual(
          {
            workersNotStoppedExactlyOnce: workers
              .filter((worker) => worker.stop.mock.callCount() !== 1)
              .map((worker) => ({ token: String(worker.token), calls: worker.stop.mock.callCount() })),
            agentStopOrder: stopEvents.filter(({ token }) => token === AGENT_CANCELLATION_DISPATCHER || token === AGENT_DISPATCH_DISPATCHER),
            scheduledStopOrder: stopEvents.filter(
              ({ token }) => token === SCHEDULED_AGENT_TERMINAL_CONSUMER || token === SCHEDULED_AGENT_DISPATCHER || token === SCHEDULED_TASK_DISPATCHER,
            ),
            poolEndCalls: poolEnd.mock.callCount(),
            redisCloseCalls: redisClose.mock.callCount(),
            redisDestroyCalls: redisDestroy.mock.callCount(),
            safeCategoryRecorded: loggedErrors.some((error) => error.message === scenario.category),
            rawCanaryRecorded: inspect(argumentsLogged, { depth: null }).includes(canary),
            rawCauseRetained: loggedErrors.some((error) => error.cause !== undefined),
            exitCode: process.exitCode,
            unexpectedIoCalls,
          },
          {
            workersNotStoppedExactlyOnce: [],
            agentStopOrder: [AGENT_CANCELLATION_DISPATCHER, AGENT_DISPATCH_DISPATCHER].flatMap((token) => [
              { token, phase: "called" },
              { token, phase: "settled" },
            ]),
            scheduledStopOrder: [SCHEDULED_AGENT_TERMINAL_CONSUMER, SCHEDULED_AGENT_DISPATCHER, SCHEDULED_TASK_DISPATCHER].flatMap((token) => [
              { token, phase: "called" },
              { token, phase: "settled" },
            ]),
            poolEndCalls: 1,
            redisCloseCalls: 1,
            redisDestroyCalls: 0,
            safeCategoryRecorded: true,
            rawCanaryRecorded: false,
            rawCauseRetained: false,
            exitCode: 1,
            unexpectedIoCalls: [],
          },
          "every finite failure must retain the original stop order, finish independent cleanup, log only a safe category, and survive Nest's rejection collection",
        )
      } catch (error) {
        primaryFailure = { error }
        throw error
      } finally {
        try {
          const cleanup = await Promise.allSettled([closing ?? (app === undefined ? database.close() : app.close())])
          const failures = cleanup.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
          if (failures.length)
            throw new AggregateError(primaryFailure === undefined ? failures : [primaryFailure.error, ...failures], "finite shutdown fixture cleanup failed")
        } finally {
          process.exitCode = previousExitCode
        }
      }
    })
  }
})
