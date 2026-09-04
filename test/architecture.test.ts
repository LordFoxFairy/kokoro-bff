import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { access } from "node:fs/promises"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

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
    "src/infrastructure/postgres/agent-dispatch-outbox-repository.ts",
    "src/infrastructure/postgres/agui-consumer-registration.ts",
    "src/infrastructure/postgres/scheduled-task-repository.ts",
    "src/infrastructure/postgres/repositories.ts",
    "src/http/routes/agent.ts",
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
    "src/infrastructure/clients/scheduler/job.ts",
    "src/infrastructure/clients/scheduler/outbox-delivery.ts",
    "src/infrastructure/clients/owner/identity.ts",
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

test("BFF runtime has no compatibility migration or direct database setup in the route host", async () => {
  const main = await readFile(path.join(root, "src/main.ts"), "utf8")
  const setup = await readFile(path.join(root, "src/database/setup.ts"), "utf8")
  assert.equal(main.includes("ALTER TABLE"), false)
  assert.equal(main.includes("CREATE TABLE"), false)
  assert.equal(main.includes("new Pool"), false)
  assert.equal(main.includes("createClient"), false)
  assert.equal(setup.includes("ALTER TABLE"), false)
  assert.equal(setup.includes("unknown"), false)
  assert.equal(setup.includes("db:migrate"), false)
})

test("BFF application ports stay free of infrastructure dependencies", async () => {
  const files = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(root, "src/application"), { recursive: true }))
  for (const file of files) {
    if (typeof file !== "string" || !file.endsWith(".ts")) continue
    const relativePath = `src/application/${file}`
    const source = await readFile(path.join(root, relativePath), "utf8")
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:node:http|\/http\/|\/infrastructure\/|(?:^|\/)pg(?:\.js)?|(?:^|\/)redis(?:\.js)?)[^"']*["']/u, relativePath)
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
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:node:|\/http\/|\/infrastructure\/|\/interfaces\/|\/application\/|(?:^|\/)pg(?:\.js)?|(?:^|\/)redis(?:\.js)?|fastify|express)[^"']*["']/u, `src/domain/${file}`)
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
  assert.match(dispatchRepository, /FOR UPDATE SKIP LOCKED/u)
  assert.match(dispatchRepository, /tenant_id = \$1 AND outbox_id = \$2/u)
  assert.doesNotMatch(dispatchRepository, /SELECT \*/u)
  assert.match(dispatcher, /claimAgentDispatchOutbox/u)
  assert.match(dispatcher, /markAgentDispatchRetryable/u)
  assert.match(runtime, /AgentDispatchOutboxDispatcher/u)
  assert.match(runtime, /AgentOutboxDelivery/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_agent_dispatch_outbox/u)
  assert.match(schema, /uq_bff_agent_dispatch_business/u)
  assert.match(schema, /ck_bff_agent_dispatch_lease/u)
})

test("BFF Chat facts keep ownership, tenant predicates, locks, and opaque cursors in the BFF boundary", async () => {
  const [repository, route, schema] = await Promise.all([
    readFile(path.join(root, "src/infrastructure/postgres/chat-repository.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/chat.ts"), "utf8"),
    readFile(path.join(root, "database/schema.sql"), "utf8"),
  ])
  assert.match(repository, /tenant_id = \$1/u)
  assert.match(repository, /FOR UPDATE/u)
  assert.match(repository, /encodeCursor/u)
  assert.match(repository, /CURRENT_TIMESTAMP\(3\)/u)
  assert.equal(repository.includes("SELECT *"), false)
  assert.equal(/FOREIGN KEY|REFERENCES/iu.test(schema), false)
  assert.match(route, /services\.chat/u)
  assert.match(route, /services\.chatTurns\.submit/u)
  assert.doesNotMatch(route, /callAgent/u)
  assert.doesNotMatch(route, /Agent.*messages.*GET/u)
  assert.match(schema, /bff_conversation/u)
  assert.match(schema, /bff_message/u)
  assert.match(schema, /bff_share/u)
})

test("ScheduledTask mutations use a tenant-scoped transactional outbox and fenced dispatcher", async () => {
  const [scheduledRepository, outboxRepository, dispatcher, delivery, liveRoute, schema] = await Promise.all([
    readFile(path.join(root, "src/infrastructure/postgres/scheduled-task-repository.ts"), "utf8"),
    readFile(path.join(root, "src/application/ports/scheduled-task-outbox-repository.ts"), "utf8"),
    readFile(path.join(root, "src/application/scheduled-task-outbox-dispatcher.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/clients/scheduler/outbox-delivery.ts"), "utf8"),
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
  assert.match(delivery, /proxyUpstream/u)
  assert.match(delivery, /idempotency-key/u)
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

  const [
    readme,
    current,
    technicalDesign,
    apiContract,
    dataModel,
    reliability,
    schema,
    projectionService,
    consumerRepository,
    projector,
    sourceReader,
  ] = await Promise.all([
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
