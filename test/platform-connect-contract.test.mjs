import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, readFile } from "node:fs/promises"
import { test } from "node:test"
import { getTextEncoding } from "@bufbuild/protobuf/wire"
import { configureBffProtobufTextEncoding } from "../dist/infrastructure/protobuf-text-encoding.js"
import {
  artifactDigests as artifacts,
  ownerCommit,
  ownerGenerated,
  provenanceCombinedSha256 as combinedSha256,
  sourceDigests as sources,
} from "../scripts/generate-platform-connect-client.mjs"

configureBffProtobufTextEncoding()

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

async function sourceBytes() {
  return Object.fromEntries(
    await Promise.all(Object.keys(sources).map(async (file) => [file, await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/proto/${file}`)])),
  )
}

test("Platform consumer pins one current v1 owner contract bundle", async () => {
  assert.deepEqual(JSON.parse(await requiredFile("buf.platform.json")), {
    version: "v2",
    modules: [{ path: `contract/vendor/kokoro-platform/${ownerCommit}/proto` }],
  })
  const manifest = JSON.parse(await requiredFile("contract/dependencies/platform-connect.json"))
  assert.deepEqual(manifest.owner, {
    repository_path: "apps/kokoro-capability",
    repository_commit: ownerCommit,
    package_name: "kokoro.platform.v1",
    sources: Object.entries(sources).map(([file, digest]) => ({ path: `contract/proto/${file}`, sha256: digest })),
    artifacts: [
      "errors/command-receipt-v1.json",
      "auth/bff-service-auth-v1.json",
      "execution-operations/skill-installation-update-v1.json",
      "execution-operations/custom-api-v1.json",
      "execution-operations/mcp-private-server-v1.json",
      "descriptor/platform-v1.binpb",
      "execution-operations/skill-acquisition-v1.json",
      "execution-operations/project-skill-installation-v1.json",
      "openapi/platform-http.openapi.json",
      "mcp-package-admin/v1/profile.json",
      "mcp-package-admin/v1/request-vectors.json",
      "descriptor/mcp-package-admin-v1.binpb",
    ].map((file) => ({
      path: `contract/${file}`,
      sha256: artifacts[file],
    })),
    provenance: { path: "contract/provenance.json", sha256: artifacts["provenance.json"], combined_sha256: combinedSha256 },
    generated: ownerGenerated,
  })
  assert.equal(manifest.owner.repository_commit, "fa5c5e53151b3c72145b680a3ee4a45d92c17ec7")
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
  assert.throws(() => assertArtifactDigests({ ...artifactBytes, "auth/bff-service-auth-v1.json": Buffer.from("{}") }), /artifact digest/u)
  assert.throws(() => assertArtifactDigests({ ...artifactBytes, "errors/command-receipt-v1.json": Buffer.from("{}") }), /artifact digest/u)
  assert.throws(() => assertArtifactDigests({ ...artifactBytes, "mcp-package-admin/v1/profile.json": Buffer.from("{}") }), /artifact digest/u)
  assert.throws(() => assertArtifactDigests({ ...artifactBytes, "execution-operations/skill-acquisition-v1.json": Buffer.from("{}") }), /artifact digest/u)
  assert.doesNotThrow(() =>
    assertVendorLayout({
      directories: [
        "auth",
        "descriptor",
        "errors",
        "execution-operations",
        "mcp-package-admin",
        "mcp-package-admin/v1",
        "openapi",
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
      files: [
        "command-receipt-errors.ts",
        "kokoro/common/v1/common_pb.ts",
        "kokoro/platform/v1/mcp_package_admin_pb.ts",
        "kokoro/platform/v1/platform_runtime_pb.ts",
        "kokoro/storage/v3/storage_pb.ts",
      ],
    }),
  )
})

test("one generated client exposes Skills, private MCP v1 and provider administration", async () => {
  const generated = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const { McpPackageAdminService } = await import("../dist/generated/platform-connect/kokoro/platform/v1/mcp_package_admin_pb.js")
  assert.deepEqual(
    McpPackageAdminService.methods.map((method) => method.name),
    ["BeginMcpPackageUpload", "CompleteMcpPackageUpload", "AbortMcpPackageUpload", "GetMcpPackageUploadStatus", "PublishMcpPackage"],
  )

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
        "deletePersonalMcpServer",
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
