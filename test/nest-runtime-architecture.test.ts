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
