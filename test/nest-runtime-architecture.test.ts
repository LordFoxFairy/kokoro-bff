import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { test } from "node:test"
import path from "node:path"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")

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
  const [healthModule, legacyModule, server] = await Promise.all([
    readFile(path.join(root, "src/modules/health/health.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/legacy-routes/legacy-routes.module.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(healthModule, /@Get\("healthz"\)/u)
  assert.match(healthModule, /@Get\("readyz"\)/u)
  assert.match(legacyModule, /exclude\(/u)
  assert.match(legacyModule, /path: "healthz"/u)
  assert.match(legacyModule, /path: "readyz"/u)
  assert.doesNotMatch(server, /segments\.length === 1 && segments\[0\] === "healthz"/u)
  assert.doesNotMatch(server, /segments\.length === 1 && segments\[0\] === "readyz"/u)
})

test("transitional runtime receives Personal Knowledge from AccountModule instead of global store lookup", async () => {
  const [runtime, accountModule, legacyRuntime, server] = await Promise.all([
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
    readFile(path.join(root, "src/modules/account/account.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/legacy-routes/legacy-routes.runtime.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(accountModule, /PERSONAL_KNOWLEDGE_REPOSITORY/u)
  assert.match(legacyRuntime, /PERSONAL_KNOWLEDGE_REPOSITORY/u)
  assert.match(runtime, /personalKnowledgeRepository/u)
  assert.match(runtime, /businessStore\?\.personalKnowledge/u)
  assert.match(server, /composition\.personalKnowledgeRepository/u)
})

test("transitional runtime receives Skill usage from SkillsModule instead of only global store lookup", async () => {
  const [runtime, legacyModule, legacyRuntime, server] = await Promise.all([
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
    readFile(path.join(root, "src/modules/legacy-routes/legacy-routes.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/legacy-routes/legacy-routes.runtime.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(legacyModule, /SkillsModule/u)
  assert.match(legacyRuntime, /SKILL_USAGE_READER/u)
  assert.match(runtime, /skillUsageReader/u)
  assert.match(server, /composition\.skillUsageReader/u)
  assert.match(legacyRuntime, /SKILL_AI_ASSOCIATION/u)
  assert.match(runtime, /skillAiAssociation/u)
  assert.match(server, /composition\.skillAiAssociation/u)
  assert.match(legacyRuntime, /SKILL_SHARE_REPOSITORY/u)
  assert.match(runtime, /skillShareRepository/u)
  assert.match(server, /composition\.skillShareRepository/u)
  assert.match(legacyModule, /ChatModule/u)
  assert.match(legacyRuntime, /PUBLIC_SHARE_SERVICE/u)
  assert.match(runtime, /publicShareService/u)
  assert.match(server, /composition\.publicShareService/u)
  assert.match(legacyModule, /ScheduledTasksModule/u)
  assert.match(legacyRuntime, /SCHEDULED_TASK_READ_SERVICE/u)
  assert.match(runtime, /scheduledTaskReader/u)
  assert.match(server, /composition\.scheduledTaskReader/u)
  assert.match(legacyModule, /ProjectsModule/u)
  assert.match(legacyModule, /AgentDispatchModule/u)
  assert.match(legacyRuntime, /CHAT_SERVICE/u)
  assert.match(legacyRuntime, /CHAT_TURN_SERVICE/u)
  assert.match(legacyRuntime, /PROJECT_SERVICE/u)
  assert.match(runtime, /chatTurnService/u)
  assert.match(server, /composition\.chatTurnService/u)
})
