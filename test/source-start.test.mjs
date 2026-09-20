import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { describe, it } from "node:test"

const tsxCli = new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url)
const sourceEntry = new URL("../src/main.ts", import.meta.url)

describe("BFF source runtime entry", () => {
  it("permits only the pinned tsx binary dependency build", () => {
    const workspacePolicy = readFileSync(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8")
    assert.equal(workspacePolicy, "strictDepBuilds: true\nallowBuilds:\n  esbuild: true\n")
  })

  it("loads the TypeScript module graph before configuration validation", () => {
    assert.equal(existsSync(tsxCli), true, "tsx must be installed from the frozen development toolchain")
    const result = spawnSync(process.execPath, [tsxCli.pathname, sourceEntry.pathname], {
      encoding: "utf8",
      env: {
        ...process.env,
        KOKORO_BFF_SHARED_SECRET: "",
        KOKORO_BFF_POSTGRES_URL: "",
        KOKORO_BFF_REDIS_URL: "",
      },
      timeout: 10_000,
    })
    const output = `${result.stdout}${result.stderr}`
    assert.notEqual(result.status, 0)
    assert.match(output, /KOKORO_BFF_SHARED_SECRET is required/u)
    assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND/u)
  })
})
