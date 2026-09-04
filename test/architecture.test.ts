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
    "src/contracts/index.ts",
    "src/contracts/mori.ts",
    "src/application/idempotency.ts",
    "src/application/project-service.ts",
    "src/application/scheduled-task-service.ts",
    "src/application/services.ts",
    "src/application/ports/idempotency-repository.ts",
    "src/application/ports/project-repository.ts",
    "src/application/ports/scheduled-task-repository.ts",
    "src/application/scheduled/input.ts",
    "src/application/mori/input.ts",
    "src/application/agui/errors.ts",
    "src/application/agui/project-chat-event.ts",
    "src/application/agui/project-session-events.ts",
    "src/application/agui/ports/agui-projection-repository.ts",
    "src/infrastructure/postgres/client.ts",
    "src/infrastructure/postgres/idempotency-repository.ts",
    "src/infrastructure/postgres/agui-projection-repository.ts",
    "src/infrastructure/postgres/project-repository.ts",
    "src/infrastructure/postgres/scheduled-task-repository.ts",
    "src/infrastructure/postgres/repositories.ts",
    "src/infrastructure/mock/bff-store.ts",
    "src/infrastructure/mock/agui.ts",
    "src/http/routes/agent.ts",
    "src/http/routes/live-bff.ts",
    "src/http/routes/owner.ts",
    "src/http/routes/music.ts",
    "src/http/routes/mock.ts",
    "src/http/routes/mori.ts",
    "src/http/routes/scheduler.ts",
    "src/http/routes/routing.ts",
    "src/infrastructure/clients/agent/index.ts",
    "src/infrastructure/clients/agent/types.ts",
    "src/infrastructure/clients/agent/launch.ts",
    "src/infrastructure/clients/agent/control.ts",
    "src/infrastructure/clients/agent/projection.ts",
    "src/infrastructure/clients/mori/owner-route.ts",
    "src/infrastructure/clients/scheduler/job.ts",
    "src/infrastructure/mock/mori-store.ts",
    "src/interfaces/http/agui/sse.ts",
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
  ]) {
    assert.equal(await exists(legacyPath), false, legacyPath)
  }
})

test("BFF composition root stays small and delegates resource routes", async () => {
  const main = await readFile(path.join(root, "src/main.ts"), "utf8")
  assert.ok(main.split("\n").length < 400, "src/main.ts must remain a composition root")
  assert.match(main, /routes\/agent\.js/)
  assert.match(main, /routes\/owner\.js/)
  assert.match(main, /routes\/scheduler\.js/)
  assert.match(main, /routes\/mock\.js/)
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
  for (const relativePath of [
    "src/application/ports/idempotency-repository.ts",
    "src/application/ports/project-repository.ts",
    "src/application/ports/scheduled-task-repository.ts",
    "src/application/agui/ports/agui-projection-repository.ts",
  ]) {
    const source = await readFile(path.join(root, relativePath), "utf8")
    assert.equal(source.includes("from \"pg\""), false, relativePath)
    assert.equal(source.includes("infrastructure/"), false, relativePath)
    assert.equal(source.includes("SELECT "), false, relativePath)
  }
})

test("BFF durable AG-UI persistence is parameterized, tenant/session scoped, and Redis-notification-only", async () => {
  const [repository, database, route, schema] = await Promise.all([
    readFile(path.join(root, "src/infrastructure/postgres/agui-projection-repository.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/client.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/agent.ts"), "utf8"),
    readFile(path.join(root, "database/schema.sql"), "utf8"),
  ])

  assert.match(repository, /WHERE tenant_id = \$1 AND session_id = \$2/u)
  assert.match(repository, /source_high_watermark/u)
  assert.match(repository, /FOR UPDATE/u)
  assert.equal(repository.includes("SELECT *"), false)
  assert.equal(repository.includes("FOREIGN KEY"), false)
  assert.match(database, /\.publish\(/u)
  assert.match(database, /disableOfflineQueue: true/u)
  assert.equal(/redis\.(?:get|set|xAdd)\([^\n]*agui/iu.test(database), false)
  assert.match(route, /projection\.ingest/u)
  assert.match(route, /projection\.replay/u)
  assert.equal(route.includes("createAgUiProjectionState"), false)
  assert.match(schema, /uq_bff_agui_event_source_frame/u)
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

  const [readme, current, technicalDesign, apiContract, dataModel, reliability, schema] = await Promise.all([
    readFile(path.join(root, "README.md"), "utf8"),
    readFile(path.join(root, "docs/CURRENT.md"), "utf8"),
    readFile(path.join(root, "docs/TECHNICAL_DESIGN.md"), "utf8"),
    readFile(path.join(root, "docs/API_CONTRACT.md"), "utf8"),
    readFile(path.join(root, "docs/DATA_MODEL.md"), "utf8"),
    readFile(path.join(root, "docs/RELIABILITY.md"), "utf8"),
    readFile(path.join(root, "database/schema.sql"), "utf8"),
  ])

  assert.match(readme, /唯一 public HTTP owner/u)
  assert.match(current, /^## 已实现事实$/mu)
  assert.match(current, /^## 未完成缺口$/mu)
  assert.match(current, /HTTP 只从该 ledger 输出 replay\/live/u)
  assert.match(technicalDesign, /AG-UI 是 Web ↔ BFF 唯一 Agent 网络协议/u)
  assert.match(apiContract, /contract\/openapi\/v1\/openapi\.yaml/u)
  assert.match(dataModel, /bff_agui_event/u)
  assert.match(dataModel, /AG-UI ledger 当前 append-only 且不自动删除/u)
  assert.match(dataModel, /当前 schema 没有 outbox 表/u)
  assert.match(reliability, /当前不具备事务型 outbox/u)
  assert.match(reliability, /唯一 durable truth 是 BFF PostgreSQL ledger/u)
  assert.equal(schema.includes("bff_agui_event"), true)
  assert.equal(schema.includes("bff_outbox"), false)
})
