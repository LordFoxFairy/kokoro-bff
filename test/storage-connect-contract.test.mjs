import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, readFile } from "node:fs/promises"
import { test } from "node:test"

const ownerCommit = "094847da9f4f03e5f3dbda06658430c74bc32f54"
const sources = {
  "kokoro/common/v1/common.proto": "4604725ec7d5896c9d74b53c6f06d19b20ee758d5ab9e1cb90177ede95bba9fd",
  "kokoro/storage/v2/storage.proto": "e6a599c447d19f9d97b097751156ef8e84f2ce34ffe38c67f4f83dcdc22a4def",
}
const root = new URL("../", import.meta.url)
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

async function requiredFile(relative) {
  assert.equal(
    await access(new URL(relative, root)).then(
      () => true,
      () => false,
    ),
    true,
    `missing Storage consumer artifact: ${relative}`,
  )
  return readFile(new URL(relative, root))
}

async function generator() {
  await requiredFile("scripts/generate-storage-connect-client.mjs")
  return import("../scripts/generate-storage-connect-client.mjs")
}

async function sourceBytes() {
  return Object.fromEntries(
    await Promise.all(Object.keys(sources).map(async (file) => [file, await requiredFile(`contract/vendor/kokoro-storage/${ownerCommit}/proto/${file}`)])),
  )
}

test("Storage consumer pins exact owner Proto bytes and generated provenance, not an execution artifact", async () => {
  const manifest = JSON.parse(await requiredFile("contract/dependencies/storage-connect.json"))
  assert.equal(manifest.owner.repository_commit, ownerCommit)
  assert.equal(manifest.owner.package_name, "kokoro.storage.v2")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-storage")
  assert.equal(manifest.execution_artifact, null)
  assert.deepEqual(
    manifest.owner.sources,
    Object.entries(sources).map(([file, digest]) => ({ path: `contract/proto/${file}`, sha256: digest })),
  )
  for (const [file, bytes] of Object.entries(await sourceBytes())) assert.equal(sha256(bytes), sources[file])
  assert.equal(manifest.lockfile_sha256, sha256(await readFile(new URL("pnpm-lock.yaml", root))))
  for (const file of manifest.generated) assert.equal(sha256(await requiredFile(`src/generated/storage-connect/${file.path}`)), file.sha256)
})

test("Storage generator rejects source tamper, missing source, extra source and generated tree drift", async () => {
  const { assertSourceDigests, assertGeneratedTree } = await generator()
  const bytes = await sourceBytes()
  assert.doesNotThrow(() => assertSourceDigests(bytes))
  for (const file of Object.keys(sources)) {
    assert.throws(() => assertSourceDigests({ ...bytes, [file]: Buffer.concat([bytes[file], Buffer.from("\n")]) }), /digest/)
    const missing = { ...bytes }
    delete missing[file]
    assert.throws(() => assertSourceDigests(missing), /source allowlist/)
  }
  assert.throws(() => assertSourceDigests({ ...bytes, "kokoro/storage/v1/storage.proto": Buffer.from("") }), /source allowlist/)
  const files = ["kokoro/common/v1/common_pb.ts", "kokoro/storage/v2/storage_pb.ts"]
  const directories = ["kokoro", "kokoro/common", "kokoro/common/v1", "kokoro/storage", "kokoro/storage/v2"]
  assert.doesNotThrow(() => assertGeneratedTree({ files, directories }))
  assert.throws(() => assertGeneratedTree({ files: files.slice(1), directories }), /file allowlist/)
  assert.throws(() => assertGeneratedTree({ files: [...files, "manual.ts"], directories }), /file allowlist/)
  assert.throws(() => assertGeneratedTree({ files, directories: [...directories, "extra"] }), /directory allowlist/)
})

test("all pinned consumer manifests track the same lockfile without replacing existing owners", async () => {
  const digest = sha256(await readFile(new URL("pnpm-lock.yaml", root)))
  for (const name of ["agent-http", "capability-http", "iam-http", "scheduler", "platform-connect", "storage-connect"]) {
    const manifest = JSON.parse(await requiredFile(`contract/dependencies/${name}.json`))
    assert.equal(manifest.lockfile_sha256, digest, `${name} lockfile pin`)
  }
})
