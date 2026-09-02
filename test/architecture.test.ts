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

test("BFF keeps repository, service, contract, and adapter boundaries explicit", async () => {
  for (const relativePath of [
    "src/contracts/index.ts",
    "src/application/idempotency.ts",
    "src/application/project-service.ts",
    "src/application/scheduled-task-service.ts",
    "src/application/services.ts",
    "src/modules/idempotency/repository.ts",
    "src/modules/projects/repository.ts",
    "src/modules/scheduled/repository.ts",
    "src/infrastructure/postgres/client.ts",
    "src/infrastructure/postgres/idempotency-repository.ts",
    "src/infrastructure/postgres/project-repository.ts",
    "src/infrastructure/postgres/scheduled-task-repository.ts",
    "src/infrastructure/postgres/repositories.ts",
    "src/infrastructure/mock/bff-store.ts",
  ]) {
    assert.equal(await exists(relativePath), true, relativePath)
  }
  for (const legacyPath of [
    "src/contracts.ts",
    "src/business-store.ts",
    "src/store.ts",
    "src/migrate.ts",
  ]) {
    assert.equal(await exists(legacyPath), false, legacyPath)
  }
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

test("BFF module repository ports stay free of infrastructure dependencies", async () => {
  for (const relativePath of [
    "src/modules/idempotency/repository.ts",
    "src/modules/projects/repository.ts",
    "src/modules/scheduled/repository.ts",
  ]) {
    const source = await readFile(path.join(root, relativePath), "utf8")
    assert.equal(source.includes("from \"pg\""), false, relativePath)
    assert.equal(source.includes("infrastructure/"), false, relativePath)
    assert.equal(source.includes("SELECT "), false, relativePath)
  }
})
