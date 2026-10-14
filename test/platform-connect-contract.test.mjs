import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, readFile } from "node:fs/promises"
import { test } from "node:test"
import { getTextEncoding } from "@bufbuild/protobuf/wire"
import { configureBffProtobufTextEncoding } from "../dist/infrastructure/protobuf-text-encoding.js"

configureBffProtobufTextEncoding()

const root = new URL("../", import.meta.url)
const ownerCommit = "7f10eaad1b737e04358f1725040ccb3bde7bfac8"
const sources = {
  "kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "kokoro/platform/v1/platform_runtime.proto": "0399dc93a8c97a23213953e1fccc149225f38e165d34dad695baf8e82e4412ee",
  "kokoro/storage/v3/storage.proto": "1021e603065978871c51519ddba5b23c9b97f16b781a08bd98e019b3342bf5f9",
}
const artifacts = {
  "descriptor/platform-v1.binpb": "fe5354739d45125dad2adf3b7509b8cc77560e5cbef6bfda95d567cd47b59cc9",
  "execution-operations/mcp-private-server-v1.json": "038758d2007f6f623b2a14d752e89d38082812e7db1bf6e40c4f21aee8ab7f1a",
  "provenance.json": "402e0948642c4a6c01310097b9949bb75cb7da3da56ec9ffe5a79117c47bdaeb",
}
const combinedSha256 = "5fce7c3bb36c855acc5e3e349eb22ae87cbf63aaf9fcc0892d09c200827a730f"
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

async function sourceBytes() {
  return Object.fromEntries(
    await Promise.all(Object.keys(sources).map(async (file) => [file, await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/proto/${file}`)])),
  )
}

test("Platform consumer pins one current v1 owner contract bundle", async () => {
  const manifest = JSON.parse(await requiredFile("contract/dependencies/platform-connect.json"))
  assert.deepEqual(manifest.owner, {
    repository_path: "apps/kokoro-capability",
    repository_commit: ownerCommit,
    package_name: "kokoro.platform.v1",
    sources: Object.entries(sources).map(([file, digest]) => ({ path: `contract/proto/${file}`, sha256: digest })),
    artifacts: [
      { path: "contract/execution-operations/mcp-private-server-v1.json", sha256: artifacts["execution-operations/mcp-private-server-v1.json"] },
      { path: "contract/descriptor/platform-v1.binpb", sha256: artifacts["descriptor/platform-v1.binpb"] },
    ],
    provenance: { path: "contract/provenance.json", sha256: artifacts["provenance.json"], combined_sha256: combinedSha256 },
  })
  assert.equal(manifest.status, "generated")
  assert.equal(manifest.lockfile_sha256, sha256(await requiredFile("pnpm-lock.yaml")))
  for (const [file, bytes] of Object.entries(await sourceBytes())) assert.equal(sha256(bytes), sources[file])
  for (const [file, digest] of Object.entries(artifacts))
    assert.equal(sha256(await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/${file}`)), digest)
  assert.equal(JSON.parse(await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/provenance.json`)).combinedSha256, combinedSha256)
  for (const generated of manifest.generated) {
    assert.equal(sha256(await requiredFile(`src/generated/platform-connect/${generated.path}`)), generated.sha256)
  }
})

test("Platform generator rejects input, artifact, provenance and vendor-layout drift", async () => {
  const { assertArtifactDigests, assertGeneratedTree, assertSourceDigests, assertVendorLayout } =
    await import("../scripts/generate-platform-connect-client.mjs")
  const bytes = await sourceBytes()
  assert.doesNotThrow(() => assertSourceDigests(bytes))
  assert.throws(() => assertSourceDigests({ ...bytes, extra: Buffer.from("") }), /source allowlist/u)
  assert.throws(
    () =>
      assertSourceDigests({
        ...bytes,
        "kokoro/platform/v1/platform_runtime.proto": Buffer.concat([bytes["kokoro/platform/v1/platform_runtime.proto"], Buffer.from("\n")]),
      }),
    /digest/u,
  )
  const artifactBytes = Object.fromEntries(
    await Promise.all(Object.keys(artifacts).map(async (file) => [file, await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/${file}`)])),
  )
  assert.doesNotThrow(() => assertArtifactDigests(artifactBytes))
  assert.throws(() => assertArtifactDigests({ ...artifactBytes, extra: Buffer.from("") }), /artifact allowlist/u)
  assert.throws(() => assertArtifactDigests({ ...artifactBytes, "execution-operations/mcp-private-server-v1.json": Buffer.from("{}") }), /artifact digest/u)
  assert.doesNotThrow(() =>
    assertVendorLayout({
      directories: [
        "descriptor",
        "execution-operations",
        "proto",
        "proto/kokoro",
        "proto/kokoro/common",
        "proto/kokoro/common/v1",
        "proto/kokoro/platform",
        "proto/kokoro/platform/v1",
        "proto/kokoro/storage",
        "proto/kokoro/storage/v3",
      ],
      files: [...Object.keys(artifacts), ...Object.keys(sources).map((file) => `proto/${file}`)].sort(),
    }),
  )
  assert.throws(() => assertVendorLayout({ directories: [], files: [] }), /vendor/u)
  assert.doesNotThrow(() =>
    assertGeneratedTree({
      directories: ["kokoro", "kokoro/common", "kokoro/common/v1", "kokoro/platform", "kokoro/platform/v1", "kokoro/storage", "kokoro/storage/v3"],
      files: ["kokoro/common/v1/common_pb.ts", "kokoro/platform/v1/platform_runtime_pb.ts", "kokoro/storage/v3/storage_pb.ts"],
    }),
  )
})

test("one generated client exposes Skills, private MCP v1 and provider administration", async () => {
  const generated = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  for (const [service, methods] of [
    ["SkillCatalogService", ["createSkillDraft", "publishSkill"]],
    [
      "ProductMcpPersonalService",
      [
        "listPersonalMcpConnectors",
        "listPersonalMcpConnections",
        "registerPersonalMcpServer",
        "getPersonalMcpServer",
        "preparePersonalMcpServer",
        "updatePersonalMcpServer",
      ],
    ],
    ["McpProviderAdminService", ["listMcpProviderAdminRecords", "createMcpProviderAdminRecord"]],
  ]) {
    assert.equal(generated[service].typeName, `kokoro.platform.v1.${service}`)
    for (const method of methods) assert.equal(generated[service].method[method].methodKind, "unary")
  }
})

test("current CreateSkillDraft wire data is generated rather than handwritten", async () => {
  const { create, fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const { CreateSkillDraftRequestSchema } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const request = create(CreateSkillDraftRequestSchema, {
    requestId: "request-1",
    command: { commandId: "command-1", requestDigest: "a".repeat(64) },
    ownerScope: { kind: "user", id: "user-1" },
    metadata: { displayName: "Draft", metadataJson: new TextEncoder().encode("{}") },
    productContext: { subjectId: "user-1", ownerScope: { kind: "user", id: "user-1" } },
  })
  assert.deepEqual(fromBinary(CreateSkillDraftRequestSchema, toBinary(CreateSkillDraftRequestSchema, request)), request)
})

test("BFF initializes one strict Protobuf text codec", () => {
  const codec = getTextEncoding()
  configureBffProtobufTextEncoding()
  assert.equal(getTextEncoding(), codec)
  assert.equal(codec.decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), true), "\uFEFFa")
  assert.throws(() => codec.decodeUtf8(new Uint8Array([0xff]), true), TypeError)
})
