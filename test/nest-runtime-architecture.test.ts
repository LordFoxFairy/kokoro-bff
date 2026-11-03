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
  const { BFF_CONFIG, BFF_DATABASE, BFF_POOL, BFF_REDIS, CHAT_TURN_SERVICE, PROJECT_SERVICE, PROJECT_SKILL_SELECTION_PROVIDER, SKILL_INSTALLATION_CLIENT } =
    await import("../dist/common/tokens.js")
  const { AgentDispatchModule } = await import("../dist/modules/agent-dispatch/agent-dispatch.module.js")
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
      [ProjectAccessModule, PROJECT_SERVICE],
      [ProjectAccessModule, PROJECT_SKILL_SELECTION_PROVIDER],
      [SkillInstallationAccessModule, SKILL_INSTALLATION_CLIENT],
    ] as const) {
      // Module re-exports must expose the owner's provider, not register a second one.
      const instances = module.get(token, { each: true })
      assert.equal(instances.length, 1, `${String(token)} must have one provider registration`)
      assert.equal(instances[0], module.select(owner).get(token, { strict: true }))
    }
  } finally {
    await module.close()
  }
})

test("production AppModule finishes its worker stop before releasing its real database owner", { timeout: 10_000 }, async (t) => {
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  const { AppModule } = await import("../dist/app.module.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { PostgresBffDatabase } = await import("../dist/infrastructure/postgres/client.js")
  const { AGENT_DISPATCH_DISPATCHER, BFF_CONFIG, BFF_DATABASE } = await import("../dist/common/tokens.js")
  const config = loadConfig({
    KOKORO_BFF_SHARED_SECRET: "nest-close-test-only",
    KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
    KOKORO_IAM_BASE_URL: "http://127.0.0.1:1",
    KOKORO_AGENT_ENABLED: "false",
  })
  const database = new PostgresBffDatabase(config.postgresUrl!, config.redisUrl!)
  const unexpectedIo = (): never => assert.fail("the lifecycle test must not access external resources")
  t.mock.method(database.pool, "query", unexpectedIo)
  t.mock.method(database.pool, "connect", unexpectedIo)
  t.mock.method(database.redis, "connect", unexpectedIo)
  t.mock.method(database.redis, "ping", unexpectedIo)
  // Only the managed clients' I/O and state observations are replaced, not close or the Nest hook.
  t.mock.getter(database.redis, "isReady", () => true)
  t.mock.getter(database.redis, "isOpen", () => true)
  let stopped = false
  const releases: boolean[] = []
  const poolEnd = t.mock.method(database.pool, "end", async () => {
    releases.push(stopped)
  })
  const redisClose = t.mock.method(database.redis, "close", async () => {
    releases.push(stopped)
  })
  let signalStopStarted!: () => void
  const stopStarted = new Promise<void>((resolve) => {
    signalStopStarted = resolve
  })
  let releaseStop!: () => void
  const stopGate = new Promise<void>((resolve) => {
    releaseStop = resolve
  })
  const stop = t.mock.fn(async () => {
    signalStopStarted()
    await stopGate
    stopped = true
  })
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue(database)
    .overrideProvider(AGENT_DISPATCH_DISPATCHER)
    .useValue({ start: () => undefined, stop })
    .compile()
  await module.init()
  const closing = module.close()
  try {
    await stopStarted
    assert.equal(poolEnd.mock.callCount(), 0, "Pool must remain available while the worker drains")
    assert.equal(redisClose.mock.callCount(), 0, "Redis must remain available while the worker drains")
    releaseStop()
    await closing
    assert.equal(stop.mock.callCount(), 1)
    assert.equal(poolEnd.mock.callCount(), 1, "Nest must close the real database owner")
    assert.equal(redisClose.mock.callCount(), 1)
    assert.equal(releases.length, 2)
    assert.ok(releases.every(Boolean), "both resources must be released after the worker stop settles")
  } finally {
    releaseStop()
    await closing
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
  // The pinned Nest hook dispatcher logs rejected hooks through allSettled; close itself resolves.
  await assert.doesNotReject(() => module.close())
  assert.equal(poolEnd.mock.callCount(), 1)
  const argumentsLogged = logged.mock.calls.flatMap((call) => call.arguments)
  const failure = argumentsLogged.find((value) => value instanceof Error && value.message === "bff_database_shutdown_failed")
  assert.ok(failure instanceof Error, "Nest must record the database shutdown category")
  assert.equal(failure.cause, undefined, "the hook error must not retain raw I/O errors as causes")
  assert.doesNotMatch(inspect(argumentsLogged, { depth: null }), /POOL_CLOSE_TEST_CANARY|REDIS_CLOSE_TEST_CANARY/u)
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
  const [healthModule, appModule, server] = await Promise.all([
    readFile(path.join(root, "src/modules/health/health.module.ts"), "utf8"),
    readFile(path.join(root, "src/app.module.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(healthModule, /@Get\("healthz"\)/u)
  assert.match(healthModule, /@Get\("readyz"\)/u)
  assert.doesNotMatch(appModule, /LegacyRoutesModule|GracefulShutdown/u)
  assert.doesNotMatch(server, /segments\.length === 1 && segments\[0\] === "healthz"/u)
  assert.doesNotMatch(server, /segments\.length === 1 && segments\[0\] === "readyz"/u)
})

test("Nest production has no legacy route composition", async () => {
  const [appModule, main] = await Promise.all([readFile(path.join(root, "src/app.module.ts"), "utf8"), readFile(path.join(root, "src/main.ts"), "utf8")])
  assert.doesNotMatch(appModule, /LegacyRoutesModule|GracefulShutdown/u)
  assert.doesNotMatch(main, /LegacyRoutesRuntime|handleBffRequest/u)
  assert.equal(await exists("src/modules/legacy-routes/legacy-routes.runtime.ts"), false)
})
