import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { test } from "node:test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const featureModules = ["account", "chat", "agent-runs", "projects", "agui", "scheduled-tasks", "skills", "mcp", "billing", "system", "music"] as const

test("AppModule registers the canonical feature graph", async () => {
  const appModule = await readFile(path.join(root, "src/app.module.ts"), "utf8")
  for (const feature of featureModules) {
    assert.equal(appModule.includes(`./modules/${feature}/${feature}.module.js`), true, `${feature} must be registered by AppModule`)
    assert.equal(await fileExists(`src/modules/${feature}/${feature}.module.ts`), true, `${feature} module must exist`)
  }
})

test("feature controllers do not receive transport or database primitives", async () => {
  const controllers = await readTypeScriptFiles("src/modules")
  for (const { relativePath, source } of controllers.filter(({ relativePath }) => relativePath.endsWith(".controller.ts"))) {
    assert.doesNotMatch(source, /node:(?:http|pg)/u, `${relativePath} must not import node:http or pg`)
    assert.doesNotMatch(source, /from ["']redis["']/u, `${relativePath} must not import redis`)
    assert.doesNotMatch(source, /IncomingMessage|ServerResponse|PoolClient|RedisClient/u, `${relativePath} must not receive raw transport/database clients`)
  }
})

test("scheduled-task state reader port is owned by its feature module", async () => {
  assert.equal(await fileExists("src/modules/scheduled-tasks/scheduled-task-state-reader.ts"), true)
  assert.equal(await fileExists("src/application/ports/scheduled-task-state-reader.ts"), false)
})

async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await readFile(path.join(root, relativePath))
    return true
  } catch {
    return false
  }
}

async function readTypeScriptFiles(relativeDirectory: string): Promise<Array<{ relativePath: string; source: string }>> {
  const entries = await readdir(path.join(root, relativeDirectory), { recursive: true })
  const files: Array<{ relativePath: string; source: string }> = []
  for (const entry of entries) {
    if (!entry.endsWith(".ts")) continue
    const relativePath = path.join(relativeDirectory, entry)
    files.push({ relativePath, source: await readFile(path.join(root, relativePath), "utf8") })
  }
  return files
}
