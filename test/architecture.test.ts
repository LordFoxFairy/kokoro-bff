import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { access, readdir } from "node:fs/promises"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

type SourceFile = { relativePath: string; source: string }

const canonicalInstaller: SourceFile = {
  relativePath: "scripts/apply-schema.mjs",
  source: 'const schemaUrl = new URL("../database/schema.sql", import.meta.url)\nassertEmptyOwnerSchema([])',
}

function isSchemaInstallerScriptName(name: string): boolean {
  return /^db:(?:apply|install|setup|migrat(?:e|ion|ions))(?:[-:][a-z0-9_-]+)*$/u.test(name)
}

function nodeExecutionEntry(command: string): string | null {
  const tokens = command.trim().split(/\s+/u)
  if (tokens[0] !== "node") return null

  for (const token of tokens.slice(1)) {
    if (/^(?:--test(?:=|$)|--eval(?:=|$)|--print(?:=|$)|--check(?:=|$)|-[epc]$)/u.test(token)) return null
    const unquoted = token.replace(/^(?:"([^"]+)"|'([^']+)')$/u, "$1$2")
    if (/\.[cm]?[jt]s(?:[?#][^\s]*)?$/u.test(unquoted)) return unquoted
    if (/[;&|]/u.test(token)) return null
  }
  return null
}

function readsCanonicalSchema(source: string): boolean {
  return source.includes("database/schema.sql") || /["'`]database["'`]\s*,\s*["'`]schema\.sql["'`]/u.test(source)
}

function staticLiteralModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  // This architecture rule intentionally covers literal ES imports, require(), and import(); computed paths and eval are out of scope.
  for (const pattern of [
    /\bfrom(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*["'`]([^"'`]+)["'`]/gu,
    /\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))+["'`]([^"'`]+)["'`]/gu,
    /\b(?:import|require)(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*\((?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*["'`]([^"'`]+)["'`]/gu,
  ]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) specifiers.push(match[1])
    }
  }
  return specifiers
}

function importsCanonicalSchemaInstaller(relativePath: string, source: string): boolean {
  return staticLiteralModuleSpecifiers(source).some((specifier) => {
    const literalPath = specifier.split(/[?#]/u, 1)[0] ?? specifier
    const resolvedPath = literalPath.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), literalPath)) : literalPath
    return resolvedPath === canonicalInstaller.relativePath || resolvedPath.endsWith(`/${canonicalInstaller.relativePath}`)
  })
}

function assertSingleSchemaInstaller(scripts: Record<string, string>, sourceFiles: SourceFile[]): void {
  const schemaInstallEntries = Object.entries(scripts).filter(([name, command]) => isSchemaInstallerScriptName(name) && nodeExecutionEntry(command) !== null)
  const nonCanonicalSchemaReaders = sourceFiles
    .filter(({ relativePath, source }) => relativePath !== canonicalInstaller.relativePath && readsCanonicalSchema(source))
    .map(({ relativePath }) => relativePath)
    .sort()
  const nonCanonicalInstallerImports = sourceFiles
    .filter(({ relativePath, source }) => relativePath !== canonicalInstaller.relativePath && importsCanonicalSchemaInstaller(relativePath, source))
    .map(({ relativePath }) => relativePath)
    .sort()
  const installer = sourceFiles.find(({ relativePath }) => relativePath === canonicalInstaller.relativePath)?.source ?? ""

  assert.deepEqual(schemaInstallEntries, [["db:apply-schema", "node scripts/apply-schema.mjs"]], "BFF must expose a single schema installer command")
  assert.deepEqual(nonCanonicalSchemaReaders, [], "BFF source cannot read canonical schema outside the single schema installer")
  assert.deepEqual(nonCanonicalInstallerImports, [], "BFF source cannot use a static schema installer import outside the canonical installer")
  assert.match(installer, /new URL\("\.\.\/database\/schema\.sql", import\.meta\.url\)/u)
  assert.match(installer, /assertEmptyOwnerSchema/u)
  assert.doesNotMatch(installer, /ALTER TABLE|db:migrate/u)
}

async function readSchemaBoundarySources(): Promise<SourceFile[]> {
  const sources: SourceFile[] = []
  for (const relativeDirectory of ["src", "scripts"]) {
    const files = await readdir(path.join(root, relativeDirectory), { recursive: true })
    for (const file of files) {
      if (typeof file !== "string" || !/\.[cm]?[jt]s$/u.test(file)) continue
      const relativePath = `${relativeDirectory}/${file}`
      sources.push({ relativePath, source: await readFile(path.join(root, relativePath), "utf8") })
    }
  }
  return sources
}

async function exists(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(root, relativePath))
    return true
  } catch {
    return false
  }
}

test("BFF keeps contract, application, client, and repository boundaries explicit", async () => {
  for (const relativePath of [
    "src/bootstrap/runtime.ts",
    "src/bootstrap/server.ts",
    "src/config/runtime.ts",
    "src/domain/json.ts",
    "src/domain/request-context.ts",
    "src/domain/project/name.ts",
    "src/domain/scheduled-task/task.ts",
    "src/domain/scheduled-task/outbox.ts",
    "src/domain/chat/conversation.ts",
    "src/domain/chat/message.ts",
    "src/domain/chat/share.ts",
    "src/domain/chat/agent-dispatch.ts",
    "src/contracts/index.ts",
    "src/contracts/mori.ts",
    "src/application/idempotency.ts",
    "src/application/project-service.ts",
    "src/application/chat-service.ts",
    "src/application/chat-turn-service.ts",
    "src/application/agent-dispatch-outbox-dispatcher.ts",
    "src/application/chat/mappers.ts",
    "src/application/scheduled-task-service.ts",
    "src/application/services.ts",
    "src/application/ports/idempotency-repository.ts",
    "src/application/ports/project-repository.ts",
    "src/application/ports/chat-repository.ts",
    "src/application/ports/agent-dispatch-outbox-repository.ts",
    "src/application/ports/agent-dispatch-delivery.ts",
    "src/application/ports/scheduled-task-repository.ts",
    "src/application/ports/scheduled-task-outbox-repository.ts",
    "src/application/ports/scheduled-task-outbox-delivery.ts",
    "src/application/ports/scheduler-dispatch-receipt-repository.ts",
    "src/application/scheduled-task-outbox-dispatcher.ts",
    "src/application/scheduled/input.ts",
    "src/application/scheduled/mappers.ts",
    "src/application/mori/input.ts",
    "src/application/agui/errors.ts",
    "src/application/agui/project-chat-event.ts",
    "src/application/agui/project-session-events.ts",
    "src/application/agui/ports/agui-projection-repository.ts",
    "src/infrastructure/postgres/client.ts",
    "src/infrastructure/postgres/idempotency-repository.ts",
    "src/infrastructure/postgres/agui-projection-repository.ts",
    "src/infrastructure/postgres/project-repository.ts",
    "src/infrastructure/postgres/chat-repository.ts",
    "src/infrastructure/postgres/conversation-move.ts",
    "src/infrastructure/postgres/conversation-move-lease.ts",
    "src/infrastructure/postgres/agent-dispatch-outbox-repository.ts",
    "src/infrastructure/postgres/agui-consumer-registration.ts",
    "src/infrastructure/postgres/scheduled-task-repository.ts",
    "src/infrastructure/postgres/repositories.ts",
    "src/infrastructure/postgres/scheduler-dispatch-receipt-repository.ts",
    "src/http/routes/agent.ts",
    "src/http/routes/chat-authorization.ts",
    "src/http/routes/chat.ts",
    "src/http/routes/live-bff.ts",
    "src/http/routes/owner.ts",
    "src/http/routes/music.ts",
    "src/http/routes/scheduler.ts",
    "src/http/routes/routing.ts",
    "src/infrastructure/clients/agent/index.ts",
    "src/infrastructure/clients/agent/types.ts",
    "src/infrastructure/clients/agent/launch.ts",
    "src/infrastructure/clients/agent/outbox-delivery.ts",
    "src/infrastructure/clients/agent/control.ts",
    "src/infrastructure/clients/agent/projection.ts",
    "src/infrastructure/clients/upstream-response.ts",
    "src/infrastructure/clients/mori/owner-route.ts",
    "src/infrastructure/clients/scheduler/control-client.ts",
    "src/infrastructure/clients/scheduler/dispatch-identity.ts",
    "src/infrastructure/clients/scheduler/schedule.ts",
    "src/infrastructure/clients/scheduler/webhook-contract.ts",
    "src/infrastructure/clients/scheduler/outbox-delivery.ts",
    "src/infrastructure/clients/owner/identity.ts",
    "src/http/routes/platform-projection.ts",
    "src/infrastructure/clients/platform/projection-http.ts",
    "src/interfaces/http/agui/sse.ts",
    "test/doubles/bff-store.ts",
    "test/doubles/agui.ts",
    "test/doubles/mori-store.ts",
    "test/doubles/mock-route.ts",
    "test/doubles/mori-route.ts",
  ]) {
    assert.equal(await exists(relativePath), true, relativePath)
  }
  for (const legacyPath of [
    "src/contracts.ts",
    "src/business-store.ts",
    "src/store.ts",
    "src/migrate.ts",
    "src/adapters",
    "src/modules",
    "src/interfaces/http/agui/events.ts",
    "src/infrastructure/mock",
    "src/http/routes/mock.ts",
    "src/http/routes/mori.ts",
  ]) {
    assert.equal(await exists(legacyPath), false, legacyPath)
  }
})

test("Platform projection generated types stay behind one facade and old Capability transport is absent", async () => {
  const ownerRoute = await readFile(path.join(root, "src/http/routes/owner.ts"), "utf8")
  assert.match(ownerRoute, /livePlatformProjectionRead/u)
  assert.doesNotMatch(ownerRoute, /requestCapability|capability-http/u)
  const sources = await readSchemaBoundarySources()
  const generatedImporters = sources
    .filter(({ relativePath, source }) => relativePath.startsWith("src/") && /generated\/platform-http/u.test(source))
    .map(({ relativePath }) => relativePath)
    .sort()
  assert.deepEqual(generatedImporters, ["src/http/routes/platform-projection.ts", "src/infrastructure/clients/platform/projection-http.ts"])
  for (const { relativePath, source } of sources) {
    assert.doesNotMatch(source, /generated\/capability-http|infrastructure\/clients\/capability/u, relativePath)
    assert.doesNotMatch(source, /\/bff\/(?:skills|mcp)|[?&]q=/u, relativePath)
  }
})

test("BFF composition root stays small and delegates resource routes", async () => {
  const main = await readFile(path.join(root, "src/main.ts"), "utf8")
  const server = await readFile(path.join(root, "src/bootstrap/server.ts"), "utf8")
  assert.ok(main.split("\n").length < 80, "src/main.ts must remain a thin entry point")
  assert.match(main, /bootstrap\/server\.js/)
  assert.match(server, /routes\/agent\.js/)
  assert.match(server, /routes\/owner\.js/)
  assert.match(server, /routes\/scheduler\.js/)
  assert.doesNotMatch(server, /routes\/mock\.js|MockBffStore|MoriMockBffStore/)
})

test("BFF production composition requires the live PostgreSQL and Redis runtime", async () => {
  const [main, runtime, config] = await Promise.all([
    readFile(path.join(root, "src/main.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
    readFile(path.join(root, "src/config/runtime.ts"), "utf8"),
  ])
  assert.doesNotMatch(main, /infrastructure\/mock|new\s+(?:Mock|MoriMock)/u)
  assert.match(runtime, /PostgresBffRepositories/u)
  assert.match(runtime, /postgresUrl/u)
  assert.match(runtime, /redisUrl/u)
  assert.match(runtime, /required|not configured/u)
  assert.match(config, /mode:\s*"live"/u)
  assert.doesNotMatch(config, /mode:\s*"mock"|default.*mock/iu)
})

test("BFF runtime delegates canonical schema installation to the single declared installer", async () => {
  const [main, packageSource, sourceFiles] = await Promise.all([
    readFile(path.join(root, "src/main.ts"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
    readSchemaBoundarySources(),
  ])
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> }

  assert.equal(main.includes("ALTER TABLE"), false)
  assert.equal(main.includes("CREATE TABLE"), false)
  assert.equal(main.includes("new Pool"), false)
  assert.equal(main.includes("createClient"), false)
  assert.equal(await exists("src/database/setup.ts"), false)
  assertSingleSchemaInstaller(packageJson.scripts ?? {}, sourceFiles)
})

test("schema installer boundary rejects a second database installation command", () => {
  assert.throws(
    () =>
      assertSingleSchemaInstaller(
        {
          "db:apply-schema": "node scripts/apply-schema.mjs",
          "db:setup": "node scripts/install-schema.mjs",
        },
        [canonicalInstaller],
      ),
    /single schema installer/u,
  )
})

test("schema installer boundary rejects a restored runtime schema loader", () => {
  assert.throws(
    () =>
      assertSingleSchemaInstaller({ "db:apply-schema": "node scripts/apply-schema.mjs" }, [
        canonicalInstaller,
        {
          relativePath: "src/database/setup.ts",
          source: 'await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")',
        },
      ]),
    /single schema installer/u,
  )
})

test("schema installer boundary accepts a read-only database check command", () => {
  assert.doesNotThrow(() =>
    assertSingleSchemaInstaller(
      {
        "db:apply-schema": "node scripts/apply-schema.mjs",
        "db:check": "node --test test/schema-governance.test.mjs",
        "db:setup:test": "node --test test/apply-schema.mjs",
        "db:setup:search": "rg apply-schema",
      },
      [canonicalInstaller],
    ),
  )
})

test("schema installer boundary rejects a restored runtime that imports the canonical installer", () => {
  for (const installerImport of [
    'import { loadCanonicalSchema } from "../../scripts/apply-schema.mjs"',
    'const { loadCanonicalSchema } = require("../../scripts/apply-schema.mjs")',
    'const { loadCanonicalSchema } = await import("../../scripts/apply-schema.mjs")',
    'import { loadCanonicalSchema } from /* installer */ "../../scripts/apply-schema.mjs?source=runtime"',
    'const { loadCanonicalSchema } = require( /* installer */ "../../scripts/apply-schema.mjs?source=runtime")',
    'const { loadCanonicalSchema } = await import( /* installer */ "../../scripts/apply-schema.mjs?source=runtime", { with: { type: "module" } })',
  ]) {
    assert.throws(
      () =>
        assertSingleSchemaInstaller({ "db:apply-schema": "node scripts/apply-schema.mjs" }, [
          canonicalInstaller,
          {
            relativePath: "src/database/setup.ts",
            source: [installerImport, "const schema = await loadCanonicalSchema()", "await pool.query(schema)"].join("\n"),
          },
        ]),
      /static schema installer import/u,
      installerImport,
    )
  }
})

test("schema installer boundary rejects a second script importing the canonical installer", () => {
  assert.throws(
    () =>
      assertSingleSchemaInstaller(
        {
          "db:apply-schema": "node scripts/apply-schema.mjs",
          "db:setup": "node scripts/bootstrap.mjs",
        },
        [
          canonicalInstaller,
          {
            relativePath: "scripts/bootstrap.mjs",
            source: [
              'import { loadCanonicalSchema } from /* installer */ "./apply-schema.mjs"',
              "const schema = await loadCanonicalSchema()",
              "await pool.query(schema)",
            ].join("\n"),
          },
        ],
      ),
    /single schema installer|static schema installer import/u,
  )
})

test("BFF application ports stay free of infrastructure dependencies", async () => {
  const files = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(root, "src/application"), { recursive: true }))
  for (const file of files) {
    if (typeof file !== "string" || !file.endsWith(".ts")) continue
    const relativePath = `src/application/${file}`
    const source = await readFile(path.join(root, relativePath), "utf8")
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(?:node:http|\/http\/|\/infrastructure\/|(?:^|\/)pg(?:\.js)?|(?:^|\/)redis(?:\.js)?)[^"']*["']/u,
      relativePath,
    )
    assert.equal(source.includes("SELECT "), false, relativePath)
  }
})

test("BFF infrastructure never imports HTTP or interface implementations", async () => {
  const files = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(root, "src/infrastructure"), { recursive: true }))
  for (const file of files) {
    if (typeof file !== "string" || !file.endsWith(".ts")) continue
    const relativePath = `src/infrastructure/${file}`
    const source = await readFile(path.join(root, relativePath), "utf8")
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:\/http\/|\/interfaces\/)[^"']*["']/u, relativePath)
  }
})

test("BFF domain code is real policy, not an empty layer or transport adapter", async () => {
  const files = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(root, "src/domain"), { recursive: true }))
  assert.ok(files.some((file) => typeof file === "string" && file.endsWith(".ts")))
  for (const file of files) {
    if (typeof file !== "string" || !file.endsWith(".ts")) continue
    const source = await readFile(path.join(root, "src/domain", file), "utf8")
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(?:node:|\/http\/|\/infrastructure\/|\/interfaces\/|\/application\/|(?:^|\/)pg(?:\.js)?|(?:^|\/)redis(?:\.js)?|fastify|express)[^"']*["']/u,
      `src/domain/${file}`,
    )
  }
})

test("stable ScheduledTask outbox identity keeps crypto behind an infrastructure adapter", async () => {
  const [domainOutbox, stableIdAdapter, scheduledRepository] = await Promise.all([
    readFile(path.join(root, "src/domain/scheduled-task/outbox.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/identifiers/scheduled-task-outbox-id.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/scheduled-task-repository.ts"), "utf8"),
  ])
  assert.doesNotMatch(domainOutbox, /node:crypto|createHash/u)
  assert.match(domainOutbox, /scheduledTaskOutboxIdentityMaterial/u)
  assert.match(stableIdAdapter, /node:crypto/u)
  assert.match(stableIdAdapter, /StableIdGenerator/u)
  assert.match(scheduledRepository, /scheduledTaskOutboxId/u)
})

test("BFF test doubles are outside production source and are explicitly assembled", async () => {
  const files = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(root, "src"), { recursive: true }))
  for (const file of files) {
    if (typeof file !== "string" || !file.endsWith(".ts")) continue
    const source = await readFile(path.join(root, "src", file), "utf8")
    assert.doesNotMatch(source, /MockBffStore|MoriMockBffStore|routes\/mock\.js|routes\/mori\.js/u, `src/${file}`)
  }
  const composition = await readFile(path.join(root, "test/doubles/server.ts"), "utf8")
  assert.match(composition, /createBffServer/u)
  assert.match(composition, /businessStore:\s*null/u)
  assert.match(composition, /routeHandler/u)
})

test("BFF durable AG-UI persistence is parameterized, tenant/session scoped, and projected outside requests", async () => {
  const [repository, consumerRepository, database, route, projector, composition, schema] = await Promise.all([
    readFile(path.join(root, "src/infrastructure/postgres/agui-projection-repository.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/agui-consumer-repository.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/client.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/agent.ts"), "utf8"),
    readFile(path.join(root, "src/application/agui/projector.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
    readFile(path.join(root, "database/schema.sql"), "utf8"),
  ])

  assert.match(repository, /WHERE tenant_id = \$1 AND session_id = \$2/u)
  assert.match(repository, /source_high_watermark/u)
  assert.match(repository, /FOR UPDATE/u)
  assert.equal(repository.includes("SELECT *"), false)
  assert.equal(repository.includes("FOREIGN KEY"), false)
  assert.match(consumerRepository, /FOR UPDATE SKIP LOCKED/u)
  assert.match(consumerRepository, /consumer_fence = consumer_fence \+ 1/u)
  assert.match(consumerRepository, /consumer_failure_count/u)
  assert.match(consumerRepository, /bff_agui_cursor_tombstone/u)
  assert.match(consumerRepository, /retained\.event_type <> 'RUN_STARTED'/u)
  assert.match(consumerRepository, /started\.event_type = 'RUN_STARTED'/u)
  assert.equal(consumerRepository.includes("SELECT *"), false)
  assert.match(database, /\.publish\(/u)
  assert.match(database, /disableOfflineQueue: true/u)
  assert.equal(/redis\.(?:get|set|xAdd)\([^\n]*agui/iu.test(database), false)
  assert.match(projector, /projection\.ingest/u)
  assert.match(projector, /claimConsumers/u)
  assert.match(projector, /retryDelayMs\(lease\.failureCount\)/u)
  assert.match(composition, /AgentAgUiSourceReader/u)
  assert.match(route, /projection\.replay/u)
  assert.doesNotMatch(route, /events\?after_seq/u)
  assert.equal(route.includes("createAgUiProjectionState"), false)
  const sseComments = [...route.matchAll(/writer\.writeComment\(([^)]*)\)/gu)].map((match) => match[1]?.trim())
  assert.ok(sseComments.length > 0)
  assert.ok(sseComments.every((comment) => comment === '"keep-alive"'))
  assert.match(schema, /uq_bff_agui_event_source_frame/u)
  assert.equal(/FOREIGN KEY|REFERENCES/iu.test(schema), false)
})

test("Chat admission commits messages, AG-UI lineage, and Agent delivery before asynchronous dispatch", async () => {
  const [route, chatRepository, dispatchRepository, registration, dispatcher, runtime, schema] = await Promise.all([
    readFile(path.join(root, "src/http/routes/chat.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/chat-repository.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/agent-dispatch-outbox-repository.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/agui-consumer-registration.ts"), "utf8"),
    readFile(path.join(root, "src/application/agent-dispatch-outbox-dispatcher.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
    readFile(path.join(root, "database/schema.sql"), "utf8"),
  ])

  assert.match(route, /services\.chatTurns\.submit/u)
  assert.doesNotMatch(route, /callAgent|buildAgentLaunch/u)
  assert.doesNotMatch(chatRepository, /commitChatTurn|claimAgentDispatchOutbox/u)
  assert.match(dispatchRepository, /BEGIN/u)
  assert.match(dispatchRepository, /INSERT INTO bff_message/u)
  assert.match(dispatchRepository, /INSERT INTO bff_agent_dispatch_outbox/u)
  assert.match(dispatchRepository, /agUiConsumerRegistration/u)
  assert.match(registration, /INSERT INTO bff_agui_stream/u)
  assert.match(dispatchRepository, /SELECT 1 FROM bff_agui_stream[^`]*FOR UPDATE/u)
  assert.match(dispatchRepository, /current\.outbox_id = ANY\(\$5::text\[\]\)/u)
  assert.match(dispatchRepository, /conversation_dispatch_seq/u)
  assert.match(dispatchRepository, /lease_remaining_ms/u)
  assert.match(dispatchRepository, /current\.attempt_count < \$4/u)
  assert.doesNotMatch(dispatchRepository, /\(earlier\.created_at, earlier\.outbox_id\)/u)
  assert.doesNotMatch(dispatchRepository, /Number\(sequence/u)
  assert.match(dispatchRepository, /tenant_id = \$1 AND outbox_id = \$2/u)
  assert.doesNotMatch(dispatchRepository, /SELECT \*/u)
  assert.match(dispatcher, /claimAgentDispatchOutbox/u)
  assert.match(dispatcher, /markAgentDispatchUnknown/u)
  assert.match(dispatcher, /markAgentDispatchNotAdmitted/u)
  assert.match(dispatcher, /limit: 1/u)
  assert.match(runtime, /AgentDispatchOutboxDispatcher/u)
  assert.match(runtime, /AgentOutboxDelivery/u)
  assert.match(runtime, /AgentCancellationOutboxDispatcher/u)
  assert.match(runtime, /AgentCancellationDelivery/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_agent_dispatch_outbox/u)
  assert.match(schema, /uq_bff_agent_dispatch_business/u)
  assert.match(schema, /ck_bff_agent_dispatch_lease/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_agent_cancellation_outbox/u)
  assert.match(schema, /source_owner IN \('kokoro-agent', 'kokoro-bff'\)/u)
})

test("BFF Chat facts keep owner predicates and isolate public share capability reads", async () => {
  const [repository, publicShareRepository, route, server, schema] = await Promise.all([
    readFile(path.join(root, "src/infrastructure/postgres/chat-repository.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/public-share-repository.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/chat.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
    readFile(path.join(root, "database/schema.sql"), "utf8"),
  ])
  assert.match(repository, /tenant_id = \$1/u)
  assert.match(repository, /owner_id = \$2/u)
  assert.match(repository, /FOR UPDATE/u)
  assert.match(repository, /encodeCursor/u)
  assert.match(repository, /ORDER BY message\.message_seq ASC, message\.message_id ASC/u)
  assert.doesNotMatch(repository, /ORDER BY message\.created_at/u)
  assert.match(repository, /CURRENT_TIMESTAMP\(3\)/u)
  assert.equal(repository.includes("SELECT *"), false)
  assert.match(publicShareRepository, /Public share capability reads/u)
  assert.doesNotMatch(publicShareRepository, /subjectId/u)
  assert.equal(/FOREIGN KEY|REFERENCES/iu.test(schema), false)
  assert.match(route, /services\.chat/u)
  assert.match(route, /subjectId/u)
  assert.match(route, /services\.chatTurns\.submit/u)
  assert.doesNotMatch(route, /callAgent/u)
  assert.doesNotMatch(route, /Agent.*messages.*GET/u)
  assert.match(server, /services\.publicShares/u)
  assert.doesNotMatch(server, /services\.chat\.findActiveShare/u)
  assert.match(schema, /bff_conversation/u)
  assert.match(schema, /bff_message/u)
  assert.match(schema, /bff_share/u)
})

test("private BFF resources use named owner scopes before receipts and keep service capabilities separate", async () => {
  const [projectPort, projectRepository, scheduledPort, scheduledRepository, chatAuthorization, server, client, openapi, schema] = await Promise.all([
    readFile(path.join(root, "src/application/ports/project-repository.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/project-repository.ts"), "utf8"),
    readFile(path.join(root, "src/application/ports/scheduled-task-repository.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/scheduled-task-repository.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/chat-authorization.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/client.ts"), "utf8"),
    readFile(path.join(root, "contract/openapi/v1/openapi.yaml"), "utf8"),
    readFile(path.join(root, "database/schema.sql"), "utf8"),
  ])
  assert.match(projectPort, /ProjectOwnerScope/u)
  assert.match(scheduledPort, /ScheduledTaskOwnerScope/u)
  assert.match(projectRepository, /tenant_id = \$1 AND owner_id = \$2/u)
  assert.match(scheduledRepository, /tenant_id = \$1 AND owner_id = \$2/u)
  assert.match(scheduledRepository, /FOR SHARE/u)
  assert.doesNotMatch(client, /invalidateProjects|projects:\$\{tenant/u)
  assert.match(chatAuthorization, /scope must be omitted, empty, or direct/u)
  assert.match(chatAuthorization, /services\.chat\.findConversation/u)
  assert.ok(server.indexOf("authorizeChatRequest") < server.indexOf("mutationTicket("))
  assert.ok(server.indexOf("authorizeLiveBffMutation") < server.indexOf("mutationTicket("))
  assert.match(openapi, /DirectScopeQuery:[\s\S]*enum: \['', direct\]/u)
  assert.match(openapi, /ShareScopeQuery:[\s\S]*minLength: 1/u)
  assert.match(schema, /uq_bff_project_owner_slug/u)
  assert.match(schema, /ix_bff_project_owner_list/u)
  assert.match(schema, /ix_bff_scheduled_task_owner/u)
  assert.doesNotMatch(schema, /project_(?:acl|member)|authorization_grant/iu)
})

test("Conversation collection filtering stays one BFF-owned discriminated path without resource authorization drift", async () => {
  const [port, authorization, route, service, repository, openapi] = await Promise.all([
    readFile(path.join(root, "src/application/ports/chat-repository.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/chat-authorization.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/chat.ts"), "utf8"),
    readFile(path.join(root, "src/application/chat-service.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/chat-repository.ts"), "utf8"),
    readFile(path.join(root, "contract/openapi/v1/openapi.yaml"), "utf8"),
  ])

  assert.match(port, /ConversationCollectionFilter[\s\S]*kind: "all"[\s\S]*kind: "direct"[\s\S]*kind: "project"; projectRef: string/u)
  assert.match(authorization, /isConversationCollection && queryScope\.scope === "direct" && projectRef !== undefined/u)
  assert.ok(authorization.indexOf("scope=direct cannot be combined with project_ref") < authorization.indexOf("services.projects.find"))
  assert.match(authorization, /collectionFilter: ConversationCollectionFilter/u)
  assert.match(route, /authorization\.collectionFilter/u)
  assert.match(service, /filter: ConversationCollectionFilter/u)
  assert.match(repository, /filter\.kind === "direct"[\s\S]*project_ref IS NULL/u)
  assert.match(repository, /filter\.kind === "project" \? filter\.projectRef : null/u)
  assert.match(openapi, /^  version: 7\.1\.0$/mu)
  assert.match(openapi, /scope=direct and a nonempty project_ref are mutually exclusive/u)
  assert.doesNotMatch(port, /ConversationCollectionFilter\s*=\s*string/u)
})

test("Move input uses the neutral strict JSON decoder, not a Platform client dependency", async () => {
  const moveInput = await readFile(path.join(root, "src/http/move-session-input.ts"), "utf8")
  assert.match(moveInput, /from "\.\.\/infrastructure\/raw-json\.js"/u)
  assert.doesNotMatch(moveInput, /clients\/platform/u)
})

test("Conversation Move keeps one PostgreSQL implementation and a bounded driver-only lease", async () => {
  const [repository, move, lease, mappers] = await Promise.all([
    readFile(path.join(root, "src/infrastructure/postgres/chat-repository.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/conversation-move.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/conversation-move-lease.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/chat-repository-mappers.ts"), "utf8"),
  ])

  assert.ok(repository.trimEnd().split("\n").length <= 800, "Chat Repository must stay within the Root source-size gate")
  assert.ok(move.trimEnd().split("\n").length <= 800)
  assert.ok(lease.trimEnd().split("\n").length <= 800)
  assert.match(repository, /from "\.\/conversation-move\.js"/u)
  assert.match(
    repository,
    /public async moveConversation\(command: MoveConversationCommand\): Promise<MoveConversationResult> \{\s*return moveConversation\(this\.database, command\)\s*\}/u,
  )
  assert.doesNotMatch(repository, /MOVE_BUDGET_MS|MOVE_LOCK_WAIT_MS|MoveSqlLease|acquireMoveLease|MOVE_RECEIPT_INVALID|INSERT INTO bff_idempotency_receipt/u)
  assert.match(move, /from "\.\/conversation-move-lease\.js"/u)
  assert.match(move, /from "\.\/chat-repository-mappers\.js"/u)
  assert.match(move, /SELECT project_id FROM bff_project/u)
  assert.match(move, /FOR UPDATE/u)
  assert.match(move, /INSERT INTO bff_idempotency_receipt/u)
  assert.equal((move.match(/INSERT INTO bff_idempotency_receipt/gu) ?? []).length, 1)
  assert.match(move, /release\(true\)/u)
  assert.match(lease, /MOVE_BUDGET_MS = 4500/u)
  assert.match(lease, /MOVE_LOCK_WAIT_MS = 1000/u)
  assert.match(lease, /client\.release\(destroy\)/u)
  assert.doesNotMatch(lease, /bff_|tenant_id|owner_id|fingerprint|scope|FOR UPDATE/u)
  assert.match(mappers, /moveReceiptFromRow/u)
  assert.doesNotMatch(mappers, /from "pg"|\.query\(|\b(?:SELECT|INSERT|UPDATE|DELETE)\b/u)
})

test("ScheduledTask mutations use an owner-scoped transactional outbox and fenced dispatcher", async () => {
  const [scheduledRepository, outboxRepository, dispatcher, delivery, controlClient, liveRoute, schema] = await Promise.all([
    readFile(path.join(root, "src/infrastructure/postgres/scheduled-task-repository.ts"), "utf8"),
    readFile(path.join(root, "src/application/ports/scheduled-task-outbox-repository.ts"), "utf8"),
    readFile(path.join(root, "src/application/scheduled-task-outbox-dispatcher.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/clients/scheduler/outbox-delivery.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/clients/scheduler/control-client.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/live-bff.ts"), "utf8"),
    readFile(path.join(root, "database/schema.sql"), "utf8"),
  ])
  assert.match(scheduledRepository, /BEGIN/u)
  assert.match(scheduledRepository, /COMMIT/u)
  assert.match(scheduledRepository, /bff_scheduled_task_outbox/u)
  assert.match(scheduledRepository, /tenant_id = \$1/u)
  assert.match(scheduledRepository, /FOR UPDATE SKIP LOCKED/u)
  assert.match(scheduledRepository, /lease_token/u)
  assert.match(scheduledRepository, /fence/u)
  assert.match(outboxRepository, /markScheduledTaskOutboxSucceeded/u)
  assert.match(dispatcher, /markScheduledTaskOutboxRetryable/u)
  assert.match(dispatcher, /maxAttempts/u)
  assert.match(delivery, /SchedulerControlClient/u)
  assert.match(controlClient, /generated\/scheduler\/sdk\.gen\.js/u)
  assert.match(controlClient, /Idempotency-Key/u)
  assert.doesNotMatch(liveRoute, /reconcileSchedulerTask\(/u)
  assert.match(liveRoute, /mutationLineage/u)
  assert.match(schema, /CONSTRAINT uq_bff_scheduled_task_outbox_business UNIQUE/u)
  assert.equal(/FOREIGN KEY|REFERENCES/iu.test(schema), false)
})

test("BFF production code has one explicit owner boundary", async () => {
  const files = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(root, "src"), { recursive: true }))
  for (const file of files) {
    if (typeof file !== "string" || !file.endsWith(".ts")) continue
    const source = await readFile(path.join(root, "src", file), "utf8")
    assert.equal(source.includes("/adapters/"), false, `src/${file}`)
    assert.equal(source.includes("/modules/"), false, `src/${file}`)
  }
})

test("BFF governance documents distinguish implemented facts from accepted target decisions", async () => {
  const requiredDocuments = [
    "AGENTS.md",
    "INDEX.md",
    "docs/INDEX.md",
    "docs/CURRENT.md",
    "docs/TECHNICAL_DESIGN.md",
    "docs/API_CONTRACT.md",
    "docs/DATA_MODEL.md",
    "docs/SECURITY.md",
    "docs/RELIABILITY.md",
    "docs/SLO.md",
    "docs/RUNBOOK.md",
    "docs/ACCEPTANCE.md",
    "docs/ADR/README.md",
    "docs/ADR/ADR-001-public-product-api-and-ag-ui.md",
    "docs/ADR/ADR-002-durable-agui-ledger.md",
  ]
  for (const relativePath of requiredDocuments) {
    assert.equal(await exists(relativePath), true, relativePath)
  }

  const [readme, current, technicalDesign, apiContract, dataModel, reliability, schema, projectionService, consumerRepository, projector, sourceReader] =
    await Promise.all([
      readFile(path.join(root, "README.md"), "utf8"),
      readFile(path.join(root, "docs/CURRENT.md"), "utf8"),
      readFile(path.join(root, "docs/TECHNICAL_DESIGN.md"), "utf8"),
      readFile(path.join(root, "docs/API_CONTRACT.md"), "utf8"),
      readFile(path.join(root, "docs/DATA_MODEL.md"), "utf8"),
      readFile(path.join(root, "docs/RELIABILITY.md"), "utf8"),
      readFile(path.join(root, "database/schema.sql"), "utf8"),
      readFile(path.join(root, "src/application/agui/project-session-events.ts"), "utf8"),
      readFile(path.join(root, "src/infrastructure/postgres/agui-consumer-repository.ts"), "utf8"),
      readFile(path.join(root, "src/application/agui/projector.ts"), "utf8"),
      readFile(path.join(root, "src/infrastructure/clients/agent/projector-source.ts"), "utf8"),
    ])

  assert.match(readme, /唯一 public HTTP owner/u)
  assert.match(current, /^## 已实现事实$/mu)
  assert.match(current, /^## 未完成缺口$/mu)
  assert.match(current, /HTTP 只从该 ledger 输出 replay\/live/u)
  assert.match(technicalDesign, /AG-UI 是 Web ↔ BFF 唯一 Agent 网络协议/u)
  assert.match(apiContract, /contract\/openapi\/v1\/openapi\.yaml/u)
  assert.match(dataModel, /bff_agui_event/u)
  assert.match(dataModel, /bff_agui_cursor_tombstone/u)
  assert.match(dataModel, /GC 保留从最新 `RUN_STARTED` 到当前 head 的完整 run slice/u)
  assert.match(dataModel, /bff_scheduled_task_outbox/u)
  assert.match(reliability, /ScheduledTask.*outbox/u)
  assert.match(reliability, /唯一 durable truth 是 BFF PostgreSQL ledger/u)
  assert.equal(schema.includes("bff_agui_event"), true)
  assert.equal(schema.includes("expected_run_id TEXT"), true)
  assert.equal(schema.includes("latest_run_start_sequence"), true)
  assert.match(dataModel, /`expected_run_id` 是最新接纳的 run fence，`latest_run_id` 是最近投影的 source run/u)
  assert.match(consumerRepository, /lease_remaining_ms/u)
  assert.match(consumerRepository, /consumer_next_poll_at = CURRENT_TIMESTAMP\(3\)/u)
  assert.match(projector, /monotonicNow/u)
  assert.match(sourceReader, /monotonicNow/u)
  assert.match(projectionService, /validateAgUiFrames\(projectChatEvent/u)
  assert.match(projectionService, /EventSchemas\.parse\(frame\)/u)
  assert.equal(/CREATE TABLE IF NOT EXISTS bff_outbox\b/u.test(schema), false)
})

test("BFF consumes the pinned Platform 3.1 HTTP projection without owning its data", async () => {
  const [generatorConfig, generatorScript, manifestSource, schema] = await Promise.all([
    readFile(path.join(root, "openapi-ts.platform-http.config.ts"), "utf8"),
    readFile(path.join(root, "scripts/generate-platform-http-client.mjs"), "utf8"),
    readFile(path.join(root, "contract/dependencies/platform-http.json"), "utf8"),
    readFile(path.join(root, "database/schema.sql"), "utf8"),
  ])
  const manifest = JSON.parse(manifestSource) as { status: string; owner: { contract_version: string } }
  assert.equal(manifest.status, "generated")
  assert.equal(manifest.owner.contract_version, "3.1.0")
  assert.match(generatorConfig, /src\/generated\/platform-http/u)
  assert.match(generatorScript, /two byte-identical generations/u)
  assert.doesNotMatch(schema, /CREATE TABLE[^;]*capability/iu)
  assert.equal(await exists("src/generated/capability-http"), false)
  assert.equal(await exists("contract/dependencies/capability-http.json"), false)
})

test("Scheduler control and receiver implement distinct owner boundaries and durable recovery invariants", async () => {
  const [technical, api, data, current, config] = await Promise.all([
    readFile(path.join(root, "docs/TECHNICAL_DESIGN.md"), "utf8"),
    readFile(path.join(root, "docs/API_CONTRACT.md"), "utf8"),
    readFile(path.join(root, "docs/DATA_MODEL.md"), "utf8"),
    readFile(path.join(root, "docs/CURRENT.md"), "utf8"),
    readFile(path.join(root, "openapi-ts.scheduler.config.ts"), "utf8"),
  ])
  assert.match(technical, /^## Scheduler control and receiver cutover$/mu)
  assert.match(technical, /control-client\.ts/u)
  assert.match(technical, /webhook-contract\.ts/u)
  assert.match(technical, /zDispatchScheduleOccurrencePostWebhookRequest/u)
  assert.match(technical, /response-unknown/u)
  // These assertions govern documented implementation scope, not real Agent behavior.
  for (const document of [technical, data, current]) {
    assert.match(document, /Agent-owner closure（W4）/u)
    assert.match(document, /`EDGE-BFF-AGENT` 保持 broken/u)
    assert.match(document, /Agent receipt stub/u)
  }
  assert.match(api, /逐项递归序列化/u)
  assert.match(api, /integer-index key/u)
  assert.match(api, /`"2"`\/`"10"`\/`"01"`/u)
  assert.match(api, /X-Kokoro-Tenant-Id/u)
  assert.match(api, /400 invalid_scheduler_dispatch/u)
  assert.match(api, /canonical RFC3339Nano/u)
  assert.match(api, /SHA-256/u)
  assert.match(api, /425 idempotency_in_progress/u)
  assert.match(data, /^## Scheduler receiver receipt design$/mu)
  assert.match(data, /不同 fingerprint/u)
  assert.match(data, /claim_token/u)
  assert.match(data, /不删除/u)
  assert.match(data, /无 schema 变更/u)
  assert.match(current, /Scheduler manifest 状态为 `generated`/u)
  assert.match(current, /EDGE-BFF-SCHEDULER[\s\S]{0,120}broken/u)
  assert.match(current, /EDGE-SCHEDULER-BFF[\s\S]{0,120}broken/u)
  assert.match(config, /contract\/vendor\/kokoro-scheduler/u)
  assert.match(config, /src\/generated\/scheduler/u)
  assert.match(config, /clean:\s*true/u)
  assert.match(config, /module:\s*\{\s*extension:\s*"\.js"\s*\}/u)
  assert.match(config, /name:\s*"zod",\s*compatibilityVersion:\s*4/u)
  assert.match(config, /name:\s*"@hey-api\/client-fetch",[\s\S]*bundle:\s*true/u)
  assert.match(config, /name:\s*"@hey-api\/sdk",[\s\S]*strategy:\s*"flat"/u)
  assert.match(config, /paramsStructure:\s*"grouped"/u)
  assert.match(config, /responseStyle:\s*"fields"/u)
  assert.match(config, /validator:\s*\{\s*response:\s*"zod"\s*\}/u)
  for (const file of await readdir(path.join(root, "src"), { recursive: true })) {
    if (!file.endsWith(".ts") || file.startsWith("generated/")) continue
    const source = await readFile(path.join(root, "src", file), "utf8")
    if (["infrastructure/clients/scheduler/control-client.ts", "infrastructure/clients/scheduler/webhook-contract.ts"].includes(file)) continue
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*["'][^"']*generated\/scheduler(?:\/|["'])/u, file)
  }
})

test("BFF Library file slice uses personal Storage v2 without claiming Artifact completion", async () => {
  const [technical, api, data, current] = await Promise.all([
    readFile(path.join(root, "docs/TECHNICAL_DESIGN.md"), "utf8"),
    readFile(path.join(root, "docs/API_CONTRACT.md"), "utf8"),
    readFile(path.join(root, "docs/DATA_MODEL.md"), "utf8"),
    readFile(path.join(root, "docs/CURRENT.md"), "utf8"),
  ])

  assert.match(technical, /GET \/v1\/library.{0,80}kind=file/su)
  assert.match(technical, /Storage.*ConnectRPC/su)
  assert.match(api, /kind=file.*必填/su)
  assert.match(api, /personal_library/u)
  assert.match(data, /^## Storage projection data boundary$/mu)
  assert.match(data, /不保存.{0,120}(?:Library|Asset|Artifact).{0,120}(?:表|cursor|缓存|receipt|outbox)/su)
  assert.match(data, /不修改.{0,80}`database\/schema\.sql`/su)
  assert.match(current, /W2-LIBRARY-BFF-FILE/u)
  assert.match(current, /Artifact/u)
})

test("BFF user identity crosses one pinned IAM admission boundary and service-only routes stay separate", async () => {
  const [server, request, runtime, manifest, config, generatedSdk] = await Promise.all([
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
    readFile(path.join(root, "src/http/request.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/runtime-manifest.ts"), "utf8"),
    readFile(path.join(root, "openapi-ts.iam.config.ts"), "utf8"),
    readFile(path.join(root, "src/generated/iam-http/sdk.gen.ts"), "utf8"),
  ])
  assert.match(server, /authorizeUserRequest/u)
  assert.doesNotMatch(request, /export function authorize\(/u)
  assert.match(runtime, /new SessionAdmissionClient/u)
  assert.match(runtime, /sessionAdmission\?: SessionAdmission/u)
  assert.match(manifest, /authorizeServerOnly/u)
  assert.doesNotMatch(manifest, /authorizeUserRequest|userId:\s*["']runtime-manifest/u)
  assert.match(config, /POST \/internal\/v1\/session-authorizations\/verify/u)
  assert.match(generatedSdk, /export const verifySessionAuthorization/u)
  assert.doesNotMatch(generatedSdk, /getMetrics|healthz|readyz/u)
})

test("Library file handling has no retired Storage HTTP or BFF shadow Asset table", async () => {
  const [owner, projections, runtime, localEnv, prodEnv, account, mockRoute, mockStore, schema] = await Promise.all([
    readFile(path.join(root, "src/http/routes/owner.ts"), "utf8"),
    readFile(path.join(root, "src/application/projections.ts"), "utf8"),
    readFile(path.join(root, "src/config/runtime.ts"), "utf8"),
    readFile(path.join(root, ".env.local.example"), "utf8"),
    readFile(path.join(root, ".env.prod.example"), "utf8"),
    readFile(path.join(root, "src/contracts/account.ts"), "utf8"),
    readFile(path.join(root, "test/doubles/mock-route.ts"), "utf8"),
    readFile(path.join(root, "test/doubles/bff-store.ts"), "utf8"),
    readFile(path.join(root, "database/schema.sql"), "utf8"),
  ])

  assert.doesNotMatch(owner, /storage_integration_unavailable/u)
  for (const [name, source] of [
    ["owner route", owner],
    ["projection mapper", projections],
    ["runtime config", runtime],
    ["local env", localEnv],
    ["production env", prodEnv],
  ] as const) {
    assert.doesNotMatch(source, /\/internal\/bff\/library|KOKORO_STORAGE_BASE_URL|libraryData|libraryItemType/u, name)
  }
  assert.doesNotMatch(account, /\bLibraryItem\b/u)
  assert.doesNotMatch(mockRoute, /\bLibraryItem\b|store\.library/u)
  assert.match(mockRoute, /storage_integration_unavailable/u)
  assert.doesNotMatch(mockStore, /\bLibraryItem\b|readonly library/u)
  assert.doesNotMatch(schema, /bff_(?:library|asset|artifact)/u)
})
