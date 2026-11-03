import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const commit = "896405d146c4ff96f5f39d5c2ce1bc788d46c2c7"
const digest = "823d36d5dae8e667e1b92d486e03a21348a86b7e2a4dadb07787a485b7cbcdd2"
const source = `contract/vendor/kokoro-iam/${commit}/better-auth.v1.7.3.json`
const output = path.join(root, "src/generated/iam-auth")
const files = ["types.gen.ts", "zod.gen.ts"]
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const mode = process.argv[2]
assert.ok(mode === "--write" || mode === "--check")
assert.equal(process.versions.node, "24.20.0")
assert.equal(hash(await readFile(path.join(root, source))), digest)
const temporary = await mkdtemp(path.join(tmpdir(), "kokoro-iam-auth-"))
async function generate(directory) {
  execFileSync(process.execPath, [path.join(root, "node_modules/@hey-api/openapi-ts/bin/run.js"), "--silent", "-f", "openapi-ts.iam-auth.config.ts"], {
    cwd: root,
    env: { ...process.env, IAM_AUTH_CLIENT_OUTPUT: directory },
    stdio: "inherit",
  })
  assert.deepEqual((await readdir(directory)).sort(), files)
  const zodPath = path.join(directory, "zod.gen.ts")
  let text = await readFile(zodPath, "utf8")
  // Schema defaults describe issuer writes, never permission to invent missing response facts.
  assert.equal(text.split(".default(false)").length - 1, 2)
  assert.equal(text.split(".default(0)").length - 1, 1)
  text = text.replaceAll(".default(false)", "").replaceAll(".default(0)", "")
  await writeFile(zodPath, text)
  execFileSync(process.execPath, [path.join(root, "node_modules/prettier/bin/prettier.cjs"), "--no-semi", "--print-width", "160", "--write", directory], {
    cwd: root,
    stdio: "inherit",
  })
}
try {
  const directory = path.join(temporary, "one")
  await generate(directory)
  const manifest = {
    schema_version: 1,
    owner: {
      repository_path: "apps/kokoro-iam",
      repository_commit: commit,
      framework: "better-auth",
      framework_version: "1.7.3",
      contract_path: "contract/vendor/better-auth.v1.7.3.json",
      contract_sha256: digest,
    },
    generator: {
      package: "@hey-api/openapi-ts",
      version: "0.99.0",
      config_path: "openapi-ts.iam-auth.config.ts",
      config_sha256: hash(await readFile(path.join(root, "openapi-ts.iam-auth.config.ts"))),
    },
    runtime: { node: process.versions.node, pnpm: "11.25.0", zod: "4.5.4" },
    lockfile_sha256: hash(await readFile(path.join(root, "pnpm-lock.yaml"))),
    generated: await Promise.all(files.map(async (file) => ({ path: file, sha256: hash(await readFile(path.join(directory, file))) }))),
  }
  const manifestPath = path.join(root, "contract/dependencies/iam-auth.json")
  if (mode === "--write") {
    await rm(output, { recursive: true, force: true })
    await cp(directory, output, { recursive: true })
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
  } else {
    const repeated = path.join(temporary, "two")
    await generate(repeated)
    assert.deepEqual((await readdir(output)).sort(), files)
    for (const file of files) {
      assert.deepEqual(await readFile(path.join(directory, file)), await readFile(path.join(repeated, file)), `non-deterministic ${file}`)
      assert.deepEqual(await readFile(path.join(output, file)), await readFile(path.join(directory, file)), file)
    }
    assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), manifest)
  }
  console.log(`PASS IAM official auth ${mode} (${files.length} files)`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
