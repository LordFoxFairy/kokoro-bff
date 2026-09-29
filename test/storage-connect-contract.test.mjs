import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, readFile } from "node:fs/promises"
import { test } from "node:test"

const ownerCommit = "d5cfc442c675e32363ae767f5ec662a9e0d9eaea"
const sources = {
  "kokoro/common/v1/common.proto": "4604725ec7d5896c9d74b53c6f06d19b20ee758d5ab9e1cb90177ede95bba9fd",
  "kokoro/storage/v2/storage.proto": "5a5dcaec2e1fd0d5eed369b8f79477fd0f8f653b32f9ebe14a8c339f4eb713ac",
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
  assert.equal(manifest.owner.published_combined_sha256, "8317e644d45c8db310b44f114afa22892a6a40d6ee7d0c1c4a37a8203e79f427")
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
  for (const name of ["agent-http", "platform-http", "iam-http", "scheduler", "platform-connect", "storage-connect"]) {
    const manifest = JSON.parse(await requiredFile(`contract/dependencies/${name}.json`))
    assert.equal(manifest.lockfile_sha256, digest, `${name} lockfile pin`)
  }
})

test("Storage generated ListAssets wire contract carries only bounded query and metadata", async () => {
  const { StorageService, ListAssetsRequestSchema, ListAssetItemSchema } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  assert.equal(StorageService.method.listAssets.name, "ListAssets")
  assert.deepEqual(
    ListAssetsRequestSchema.fields.map((f) => [f.name, f.number]),
    [
      ["limit", 1],
      ["cursor", 2],
    ],
  )
  assert.deepEqual(
    ListAssetItemSchema.fields.map((f) => f.name),
    ["asset_id", "filename", "mime_type", "content_sha256", "size_bytes", "upload_purpose", "origin", "scan_state", "created_at"],
  )
})

test("Storage F2 generated Artifact reads preserve owner identity and byte-reference fields", async () => {
  const {
    StorageService,
    ArtifactKind,
    GetFinalArtifactRequestSchema,
    FinalArtifactItemSchema,
    GetFinalArtifactDownloadReferenceRequestSchema,
    GetFinalArtifactDownloadReferenceResponseSchema,
  } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  assert.equal(StorageService.method.listFinalArtifacts.name, "ListFinalArtifacts")
  assert.equal(StorageService.method.getFinalArtifact.name, "GetFinalArtifact")
  assert.equal(StorageService.method.getFinalArtifactDownloadReference.name, "GetFinalArtifactDownloadReference")
  assert.deepEqual(
    Object.entries(ArtifactKind).filter(([name]) => Number.isNaN(Number(name))),
    [
      ["UNSPECIFIED", 0],
      ["DOCUMENT", 1],
      ["CODE", 2],
      ["IMAGE", 3],
      ["AUDIO", 4],
      ["VIDEO", 5],
      ["DATA", 6],
      ["ARCHIVE", 7],
      ["OTHER", 8],
    ],
  )
  assert.deepEqual(
    GetFinalArtifactRequestSchema.fields.map((field) => field.name),
    ["artifact_id"],
  )
  assert.deepEqual(
    FinalArtifactItemSchema.fields.map((field) => field.name),
    ["artifact_id", "asset_id", "content_sha256", "kind", "title", "source_run_id", "filename", "mime_type", "size_bytes", "created_at", "finalized_at"],
  )
  assert.deepEqual(
    GetFinalArtifactDownloadReferenceRequestSchema.fields.map((field) => field.name),
    ["command", "artifact_id"],
  )
  assert.deepEqual(
    GetFinalArtifactDownloadReferenceResponseSchema.fields.map((field) => field.name),
    ["artifact_id", "asset_id", "content_sha256", "download_reference"],
  )
})
