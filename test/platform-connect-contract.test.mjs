import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, readFile } from "node:fs/promises"
import { test } from "node:test"

const ownerCommit = "f26d147a09350c3a041722107d277beb93eaad60"
const sources = {
  "kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "kokoro/platform/v1/platform_runtime.proto": "282bf886ea9648f7ce5208abd36ab47d879b2002a036d90aada2af59e74b4020",
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
    `missing Platform consumer artifact: ${relative}`,
  )
  return readFile(new URL(relative, root))
}

async function generator() {
  await requiredFile("scripts/generate-platform-connect-client.mjs")
  return import("../scripts/generate-platform-connect-client.mjs")
}

async function sourceBytes() {
  return Object.fromEntries(
    await Promise.all(Object.keys(sources).map(async (file) => [file, await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/proto/${file}`)])),
  )
}

test("Platform consumer pins exact owner Proto bytes and generated provenance, not an execution artifact", async () => {
  const manifest = JSON.parse(await requiredFile("contract/dependencies/platform-connect.json"))
  assert.equal(manifest.owner.repository_commit, ownerCommit)
  assert.equal(manifest.owner.package_name, "kokoro.platform.v1")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-capability")
  assert.equal(manifest.execution_artifact, null)
  assert.deepEqual(
    manifest.owner.sources,
    Object.entries(sources).map(([file, digest]) => ({ path: `contract/proto/${file}`, sha256: digest })),
  )
  for (const [file, bytes] of Object.entries(await sourceBytes())) assert.equal(sha256(bytes), sources[file])
  assert.equal(manifest.lockfile_sha256, sha256(await readFile(new URL("pnpm-lock.yaml", root))))
  for (const file of manifest.generated) assert.equal(sha256(await requiredFile(`src/generated/platform-connect/${file.path}`)), file.sha256)
})

test("Platform generator rejects source tamper, missing source, extra source and generated tree drift", async () => {
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
  const files = ["kokoro/common/v1/common_pb.ts", "kokoro/platform/v1/platform_runtime_pb.ts"]
  const directories = ["kokoro", "kokoro/common", "kokoro/common/v1", "kokoro/platform", "kokoro/platform/v1"]
  assert.doesNotThrow(() => assertGeneratedTree({ files, directories }))
  assert.throws(() => assertGeneratedTree({ files: files.slice(1), directories }), /file allowlist/)
  assert.throws(() => assertGeneratedTree({ files: [...files, "manual.ts"], directories }), /file allowlist/)
  assert.throws(() => assertGeneratedTree({ files, directories: [...directories, "extra"] }), /directory allowlist/)
})

test("all pinned consumer manifests track the same lockfile without replacing existing owners", async () => {
  const digest = sha256(await readFile(new URL("pnpm-lock.yaml", root)))
  for (const name of ["agent-http", "capability-http", "iam-http", "scheduler", "platform-connect"]) {
    const manifest = JSON.parse(await requiredFile(`contract/dependencies/${name}.json`))
    assert.equal(manifest.lockfile_sha256, digest, `${name} lockfile pin`)
  }
})

test("generated Platform descriptor preserves CreateDraft wire tags, bytes, Product context and uint64", async () => {
  await requiredFile("src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts")
  const { create, toBinary, fromBinary } = await import("@bufbuild/protobuf")
  const { CreateSkillDraftRequestSchema, CreateSkillDraftResponseSchema, SkillCatalogService, SkillStatus } =
    await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  assert.equal(SkillCatalogService.typeName, "kokoro.platform.v1.SkillCatalogService")
  assert.equal(SkillCatalogService.method.createSkillDraft.name, "CreateSkillDraft")
  assert.equal(SkillCatalogService.method.createSkillDraft.methodKind, "unary")
  assert.deepEqual(
    CreateSkillDraftRequestSchema.fields.map((f) => [f.name, f.number]),
    [
      ["request_id", 1],
      ["command", 2],
      ["owner_scope", 3],
      ["metadata", 4],
      ["product_context", 5],
    ],
  )
  const request = create(CreateSkillDraftRequestSchema, {
    requestId: "request-1",
    command: { commandId: "command-1", requestDigest: "a".repeat(64) },
    ownerScope: { kind: "user", id: "user-1" },
    metadata: { displayName: "Draft 🦊", summary: "", tags: ["z", "a"], metadataJson: new Uint8Array([0, 255, 123, 125]) },
    productContext: { subjectId: "user-1", ownerScope: { kind: "user", id: "user-1" } },
  })
  assert.deepEqual(fromBinary(CreateSkillDraftRequestSchema, toBinary(CreateSkillDraftRequestSchema, request)), request)
  const response = create(CreateSkillDraftResponseSchema, {
    skillId: { value: "skill-1" },
    seriesId: { value: "series-1" },
    revision: 9007199254740993n,
    status: SkillStatus.DRAFT,
    replayed: false,
  })
  assert.deepEqual(fromBinary(CreateSkillDraftResponseSchema, toBinary(CreateSkillDraftResponseSchema, response)), response)
})

test("Connect consumes the generated service descriptor without a handwritten RPC DTO", async () => {
  await requiredFile("src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts")
  const { createClient, createRouterTransport } = await import("@connectrpc/connect")
  const { SkillCatalogService, SkillStatus } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  let calls = 0
  const transport = createRouterTransport((router) =>
    router.service(SkillCatalogService, {
      createSkillDraft(request) {
        calls++
        assert.equal(request.productContext.subjectId, "user-1")
        assert.equal(request.ownerScope.id, "user-1")
        assert.deepEqual([...request.metadata.metadataJson], [123, 125])
        return { skillId: { value: "skill-1" }, seriesId: { value: "series-1" }, revision: 1n, status: SkillStatus.DRAFT, replayed: false }
      },
    }),
  )
  const client = createClient(SkillCatalogService, transport)
  const response = await client.createSkillDraft({
    requestId: "request-1",
    productContext: { subjectId: "user-1", ownerScope: { kind: "user", id: "user-1" } },
    ownerScope: { kind: "user", id: "user-1" },
    metadata: { displayName: "Draft", metadataJson: new TextEncoder().encode("{}") },
  })
  assert.equal(response.revision, 1n)
  assert.equal(response.status, SkillStatus.DRAFT)
  assert.equal(calls, 1)
})
