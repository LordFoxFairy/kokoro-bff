import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { test } from "node:test"
import path from "node:path"

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
    redis: { connect: unexpectedIo, ping: unexpectedIo, quit: unexpectedIo, destroy: unexpectedIo },
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
