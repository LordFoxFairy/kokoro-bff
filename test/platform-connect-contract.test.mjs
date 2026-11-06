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
      "execution-operations/project-skill-installation-content-v1.json",
      "execution-operations/mcp-icon-v1.json",
      "execution-operations/mcp-icon-request-vectors-v1.json",
      "execution-operations/app-skill-binding-v1.json",
      "execution-operations/skill-series-delete-v1.json",
      "execution-operations/skill-publication-precondition-v1.json",
      "execution-operations/skill-publication-precondition-v1.vectors.json",
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
      "execution-operations/mcp-personal-product-v1.json",
      "execution-operations/mcp-availability-v1.json",
      "descriptor/platform-mcp-personal-sse-parent.availability.profile.json.snapshot",
      "descriptor/platform-mcp-personal-sse-parent.http.openapi.json.snapshot",
      "descriptor/platform-mcp-personal-sse-parent.icon.profile.json.snapshot",
      "descriptor/platform-mcp-personal-sse-parent.personal-product.profile.json.snapshot",
      "descriptor/platform-mcp-personal-sse-parent.platform.binpb.snapshot",
      "descriptor/platform-mcp-personal-sse-parent.platform.generated.ts.snapshot",
      "descriptor/platform-mcp-personal-sse-parent.platform.proto.snapshot",
      "descriptor/platform-mcp-personal-sse-parent.private-server.profile.json.snapshot",
      "descriptor/platform-mcp-personal-sse-parent.provenance.json.snapshot",
      "descriptor/platform-mcp-personal-sse-parent.runtime.binpb.snapshot",
      "descriptor/platform-mcp-personal-sse-parent.runtime.generated.ts.snapshot",
      "descriptor/platform-mcp-personal-sse-parent.runtime.profile.json.snapshot",
      "descriptor/platform-mcp-personal-sse-parent.runtime.proto.snapshot",
      "descriptor/platform-mcp-personal-sse-parent.runtime.request-vectors.json.snapshot",
      "descriptor/platform-mcp-personal-sse-parents.json",
      "descriptor/platform-mcp-personal-sse-source-delta.json",
      "execution-operations/mcp-personal-sse-request-vectors-v1.json",
      "execution-operations/mcp-personal-sse-v1.json",
      "execution-operations/mcp-prepare-receipt-v1.json",
      "execution-operations/mcp-prepare-receipt-v1.vectors.json",
      "descriptor/platform-mcp-prepare-receipt-parent.platform_runtime.proto.snapshot",
      "descriptor/platform-mcp-prepare-receipt-parent.platform-v1.binpb.snapshot",
      "descriptor/platform-mcp-prepare-receipt-parent.platform_runtime_pb.ts.snapshot",
      "descriptor/platform-mcp-prepare-receipt-parent.mcp-private-server-v1.json.snapshot",
      "descriptor/platform-mcp-prepare-receipt-parent.provenance.json.snapshot",
      "descriptor/platform-mcp-prepare-receipt-parent.mcp-runtime-v1.binpb.snapshot",
      "descriptor/platform-mcp-prepare-receipt-parent.mcp-runtime-v1.json.snapshot",
      "descriptor/platform-mcp-prepare-receipt-parent.mcp-personal-sse-v1.json.snapshot",
      "descriptor/mcp-runtime-v1.binpb",
      "execution-operations/mcp-runtime-v1.json",
      "descriptor/platform-mcp-prepare-receipt-parents.json",
      "descriptor/platform-mcp-prepare-receipt-delta.json",
      "execution-operations/mcp-prepare-rejection-v1.json",
      "descriptor/platform-mcp-prepare-rejection-parents.json",
      "descriptor/platform-mcp-prepare-rejection-parent.platform_runtime.proto.snapshot",
      "descriptor/platform-mcp-prepare-rejection-parent.platform-v1.binpb.snapshot",
      "descriptor/platform-mcp-prepare-rejection-parent.platform_runtime_pb.ts.snapshot",
    ].map((file) => ({
      path: `contract/${file}`,
      sha256: artifacts[file],
    })),
    provenance: { path: "contract/provenance.json", sha256: artifacts["provenance.json"], combined_sha256: combinedSha256 },
    generated: ownerGenerated,
  })
  assert.equal(manifest.owner.repository_commit, "94e574c68d6c972078b661fa7d917dab90c71042")
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
  assert.throws(
    () =>
      assertArtifactDigests({
        ...artifactBytes,
        "descriptor/platform-v1.binpb": Buffer.concat([artifactBytes["descriptor/platform-v1.binpb"], Buffer.from([0])]),
      }),
    /artifact digest/u,
  )
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
        "kokoro/platform/v1/mcp_project_publication_pb.ts",
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

test("MCP availability publication pins the exact required enum without activating normal execution", async () => {
  const profile = JSON.parse(await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/execution-operations/mcp-availability-v1.json`))
  const { McpAvailability } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  assert.equal(profile.profile, "mcp-local-availability-v1")
  assert.equal(profile.version, "1.0.0")
  assert.equal(profile.status, "prepared")
  assert.equal(profile.runtime_verified, false)
  assert.deepEqual(
    profile.enum,
    Object.fromEntries(
      ["UNSPECIFIED", "AVAILABLE", "REFRESH_REQUIRED", "REFRESHING", "REAUTHORIZATION_REQUIRED", "UNAVAILABLE"].map((name) => [name, McpAvailability[name]]),
    ),
  )
  assert.deepEqual(profile.response_fields, { PersonalMcpConnector: 13, PersonalMcpServer: 15 })
  assert.deepEqual(profile.json_values, ["available", "refresh_required", "refreshing", "reauthorization_required", "unavailable"])
})

test("independent publication pins exact committed owner artifacts without claiming execution readiness", async () => {
  const { fromBinary } = await import("@bufbuild/protobuf")
  const { FileDescriptorSetSchema } = await import("@bufbuild/protobuf/wkt")
  const { canonicalizeJcs } = await import("../dist/infrastructure/clients/platform/jcs.js")
  const manifest = JSON.parse(await requiredFile("contract/dependencies/platform-connect.json"))
  const candidate = manifest.publication
  assert.ok(candidate, "missing exact committed publication manifest")
  assert.equal(candidate.status, "published-owner-contract")
  assert.equal(candidate.base_commit, "7d8115a4b0dc752687babe7db35d0a936f51c76a")
  assert.equal(candidate.repository_commit, "dd8d536a28059cbdbe0674debc47bf28d039fb47")
  assert.equal(candidate.runtime_binding_implemented, false)
  const provenance = JSON.parse(await requiredFile(`${candidate.vendor}/publication-provenance.json`))
  assert.equal(provenance.repository_commit, candidate.repository_commit)
  assert.equal(provenance.status, "published-owner-contract")
  assert.equal(provenance.runtime_binding_implemented, false)
  for (const [file, digest] of Object.entries(candidate.inputs)) assert.equal(sha256(await requiredFile(`${candidate.vendor}/${file}`)), digest)
  const profile = JSON.parse(await requiredFile(`${candidate.vendor}/mcp-project-publication/v1/profile.json`))
  const vectors = JSON.parse(await requiredFile(`${candidate.vendor}/mcp-project-publication/v1/request-vectors.json`))
  assert.equal(profile.vectors_sha256, sha256(canonicalizeJcs(vectors)))
  assert.equal(profile.semantics.execution_ready, "required presence and false")
  const descriptor = fromBinary(FileDescriptorSetSchema, await requiredFile(`${candidate.vendor}/descriptor/mcp-project-publication-v1.binpb`))
  const generated = await import("../dist/generated/platform-connect/kokoro/platform/v1/mcp_project_publication_pb.js")
  const published = descriptor.file.find((file) => file.name === "kokoro/platform/v1/mcp_project_publication.proto")
  assert.deepEqual(generated.file_kokoro_platform_v1_mcp_project_publication.proto, published)
  assert.deepEqual(
    generated.ProductMcpProjectPublicationService.methods.map((method) => method.name),
    profile.methods.map((method) => method.method),
  )
})

test("private publication schemas publish exact status-code-retryable tuples from the one shared receipt profile", async () => {
  const contract = JSON.parse(await requiredFile("contract/openapi/browser/v1/mcp-project-publication.json"))
  const policy = contract["x-kokoro-publication-policy"],
    sharedBytes = await requiredFile("contract/connector-command-errors-v1.json"),
    shared = JSON.parse(sharedBytes)
  assert.equal(policy.version, "1.1.0")
  assert.equal(contract["x-kokoro-shared-command-errors"].sha256, sha256(sharedBytes))
  assert.equal(contract["x-kokoro-shared-command-errors"].group, "mcp")
  const { mcpProjectPublicationError } = await import("../src/application/mcp-project-publication.contract.ts")
  for (const paths of Object.values(contract.paths))
    for (const operation of Object.values(paths)) {
      for (const [status, response] of Object.entries(operation.responses)) {
        if (status === "200") continue
        const schema = response.content["application/json"].schema,
          alternatives = schema.anyOf ?? [schema]
        assert.ok(alternatives.length > 0)
        for (const alternative of alternatives) {
          assert.equal(alternative.additionalProperties, false)
          const error = alternative.properties.error
          assert.equal(error.additionalProperties, false)
          assert.equal(typeof error.properties.code.const, "string")
          assert.equal(typeof error.properties.retryable.const, "boolean")
        }
        const validator = mcpProjectPublicationError(Number(status), Object.values(shared.mcp))
        assert.equal(validator.safeParse({ error: { code: "unrecognized_failure", message: "opaque", retryable: false } }).success, false)
        for (const alternative of alternatives) {
          const value = alternative.properties.error.properties
          assert.equal(validator.safeParse({ error: { code: value.code.const, message: "opaque", retryable: !value.retryable.const } }).success, false)
        }
      }
    }
  const vectors = contract["x-kokoro-publication-error-vectors"]
  for (const value of Object.values(shared.mcp))
    for (const prior_unknown of [false, true]) {
      const vector = vectors.find((item) => item.code === value.code && item.prior_unknown === prior_unknown)
      assert.equal(vector.status, value.status)
      assert.equal(vector.retryable, value.retryable)
      assert.equal(vector.recovery, value.recovery)
      assert.equal(vector.new_command_authorized, false)
    }
  assert.deepEqual(
    vectors
      .filter((value) => value.new_command_authorized)
      .map((value) => value.code)
      .sort(),
    ["mcp_project_publication_precondition_failed", "mcp_project_publication_request_invalid"],
  )
  assert.equal(
    vectors.some((value) => value.prior_unknown && value.new_command_authorized),
    false,
  )
})

test("SSE successor: generated native optional fields match the fixed descriptor known shape and pinned profile", async () => {
  const { fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const { FileDescriptorSetSchema, FileDescriptorProtoSchema } = await import("@bufbuild/protobuf/wkt")
  const generated = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const graph = fromBinary(FileDescriptorSetSchema, await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/descriptor/platform-v1.binpb`))
  const current = graph.file.find((file) => file.name === "kokoro/platform/v1/platform_runtime.proto")
  assert.ok(current)
  // protoc-gen-es omits compiler metadata unknown to its native descriptor runtime.
  // The preceding artifact test pins the complete original bytes (including field8042).
  assert.deepEqual(
    toBinary(FileDescriptorProtoSchema, generated.file_kokoro_platform_v1_platform_runtime.proto, { writeUnknownFields: false }),
    toBinary(FileDescriptorProtoSchema, current, { writeUnknownFields: false }),
  )
  for (const [name, tag] of [
    ["RegisterPersonalMcpServerRequest", 9],
    ["PersonalMcpServer", 17],
  ]) {
    const field = current.messageType.find((message) => message.name === name)?.field.find((field) => field.number === tag)
    assert.equal(field?.name, "transport")
    assert.equal(field?.proto3Optional, true)
    assert.equal(field?.typeName, ".kokoro.platform.v1.McpTransport")
    assert.equal(generated[name + "Schema"].fields.find((field) => field.number === tag)?.presence, 1)
  }
  const profile = JSON.parse(await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/execution-operations/mcp-personal-sse-v1.json`))
  assert.equal(profile.profile, "mcp-personal-sse-v1")
  assert.deepEqual(profile.transports, [2, 3])
  assert.equal(profile.presence.server.fresh_required, true)
  assert.equal(profile.http.version, "7.0.0")
  assert.equal(profile.runtime.version, "1.5.0")
  // The original companion publications remain exactly their frozen owner bytes.
  for (const [file, sha] of Object.entries(profile.parents)) {
    if (
      [
        "contract/execution-operations/mcp-private-server-v1.json",
        "contract/execution-operations/mcp-personal-product-v1.json",
        "contract/execution-operations/mcp-icon-v1.json",
        "contract/execution-operations/mcp-availability-v1.json",
      ].includes(file)
    ) {
      assert.equal(sha256(await prePrepareQueryArtifact(file)), sha.sha256)
    }
  }
})

// Historical proof only: validate the complete current successor before supplying its pinned predecessor.
async function prePrepareQueryArtifact(file) {
  const prefix = `contract/vendor/kokoro-platform/${ownerCommit}/`
  const query = JSON.parse(await requiredFile(prefix + "execution-operations/mcp-prepare-receipt-v1.json"))
  if (file !== "contract/execution-operations/mcp-private-server-v1.json") return requiredFile(prefix + file.replace("contract/", ""))
  const pin = query.parents[file]
  const parentBytes = await requiredFile(prefix + pin.path.replace("contract/", ""))
  assert.equal(sha256(parentBytes), pin.sha256)
  const parent = JSON.parse(parentBytes)
  const current = JSON.parse(await requiredFile(prefix + file.replace("contract/", "")))
  assert.deepEqual(current, {
    ...parent,
    version: "1.5.0",
    methods: [...parent.methods, { name: "GetPersonalMcpPrepareReceipt", command: false }],
    prepare_receipt: {
      profile: "contract/execution-operations/mcp-prepare-receipt-v1.json",
      original_operation: "PreparePersonalMcpServer",
      completed_only: true,
      automatic_retries: false,
      new_command_authorized: false,
    },
  })
  return parentBytes
}

// Exact Project content inverse proves the complete f294 owner parent before every old enum/query proof.
async function preProjectContentArtifact(file, supplied) {
  const { fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const { FileDescriptorSetSchema } = await import("@bufbuild/protobuf/wkt")
  const prefix = `contract/vendor/kokoro-platform/${ownerCommit}/`
  const feature = JSON.parse(await requiredFile(prefix + "execution-operations/project-skill-installation-content-v1.json"))
  assert.equal(feature.version, "1.0.0")
  assert.deepEqual(feature.methods, ["InspectProjectSkillInstallationPackage", "GetProjectSkillInstallationPackageDownload"])
  const pin = feature.inputs.find((value) => value.path === file)
  assert.ok(pin)
  const current = supplied ?? (await requiredFile(prefix + file.replace("contract/", "")))
  assert.equal(sha256(current), pin.sha256)
  let parent
  if (file.endsWith(".proto")) {
    const source = current.toString("utf8")
    const marker = "\n// Project exact installation content"
    assert.equal(source.split(marker).length, 2)
    parent = Buffer.from(source.slice(0, source.indexOf(marker)))
  } else {
    const graph = fromBinary(FileDescriptorSetSchema, current)
    const files = graph.file.filter((value) => value.name === "kokoro/platform/v1/platform_runtime.proto")
    assert.equal(files.length, 1)
    const target = files[0]
    const messages = [
      "InspectProjectSkillInstallationPackageRequest",
      "InspectProjectSkillInstallationPackageResponse",
      "GetProjectSkillInstallationPackageDownloadRequest",
      "GetProjectSkillInstallationPackageDownloadResponse",
    ]
    assert.deepEqual(
      target.messageType.slice(-4).map((value) => value.name),
      messages,
    )
    assert.equal(target.service.at(-1).name, "ProductProjectSkillInstallationContentService")
    assert.equal(target.service.filter((value) => value.name === "ProductProjectSkillInstallationContentService").length, 1)
    target.messageType.splice(-4)
    target.service.splice(-1)
    parent = Buffer.from(toBinary(FileDescriptorSetSchema, graph))
  }
  assert.equal(sha256(parent), feature.parents[file])
  return parent
}

test("Project content adds exactly its named service and four messages over the complete f294 parent", async () => {
  for (const file of ["contract/proto/kokoro/platform/v1/platform_runtime.proto", "contract/descriptor/platform-v1.binpb"]) {
    await preProjectContentArtifact(file)
    const raw = await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/${file.replace("contract/", "")}`)
    await assert.rejects(preProjectContentArtifact(file, Buffer.concat([raw, Buffer.from([0])])), /Expected values/)
  }
})

// Exact test-only enum successor inverse; prove the entire 688bc parent before old query proofs.
async function prePrepareOutcomeArtifact(file) {
  const { fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const { FileDescriptorSetSchema } = await import("@bufbuild/protobuf/wkt")
  const prefix = `contract/vendor/kokoro-platform/${ownerCommit}/`
  const feature = JSON.parse(await requiredFile(prefix + "execution-operations/mcp-prepare-rejection-v1.json"))
  assert.equal(feature.parents.commit, "688bc1e3d74c18c54ca85bc72d8e4ce242ac995a")
  const pin = feature.parents.inputs[file]
  const current = await preProjectContentArtifact(file)
  const parent = await requiredFile(prefix + pin.path.replace("contract/", ""))
  assert.equal(sha256(parent), pin.sha256)
  if (file.endsWith(".proto")) {
    const delta = "  PERSONAL_MCP_ERROR_REASON_PREPARE_CONNECTION_REJECTED = 4;\n  PERSONAL_MCP_ERROR_REASON_PREPARE_EXECUTION_FENCED = 5;\n"
    const source = current.toString("utf8")
    assert.equal(source.split(delta).length, 2)
    assert.deepEqual(Buffer.from(source.replace(delta, "")), parent)
  } else {
    const graph = fromBinary(FileDescriptorSetSchema, current)
    const enums = graph.file.flatMap((value) => value.enumType).filter((value) => value.name === "PersonalMcpErrorReason")
    assert.equal(enums.length, 1)
    const exact = [
      { $typeName: "google.protobuf.EnumValueDescriptorProto", name: "PERSONAL_MCP_ERROR_REASON_PREPARE_CONNECTION_REJECTED", number: 4 },
      { $typeName: "google.protobuf.EnumValueDescriptorProto", name: "PERSONAL_MCP_ERROR_REASON_PREPARE_EXECUTION_FENCED", number: 5 },
    ]
    assert.deepEqual(enums[0].value.slice(-2), exact)
    enums[0].value.splice(-2)
    assert.deepEqual(Buffer.from(toBinary(FileDescriptorSetSchema, graph)), parent)
  }
  return parent
}

test("Prepare typed outcomes pin the exact operation scope and preserve their entire query1 parent", async () => {
  const prefix = `contract/vendor/kokoro-platform/${ownerCommit}/`
  const feature = JSON.parse(await requiredFile(prefix + "execution-operations/mcp-prepare-rejection-v1.json"))
  assert.equal(feature.rpc_code, "failed_precondition")
  assert.deepEqual(
    feature.enum_reasons.map((value) => [value.number, value.methods]),
    [
      [4, ["PreparePersonalMcpServer", "GetPersonalMcpPrepareReceipt"]],
      [5, ["GetPersonalMcpPrepareReceipt"]],
    ],
  )
  const { PersonalMcpErrorReason } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  assert.equal(PersonalMcpErrorReason.PREPARE_CONNECTION_REJECTED, 4)
  assert.equal(PersonalMcpErrorReason.PREPARE_EXECUTION_FENCED, 5)
  await prePrepareOutcomeArtifact("contract/proto/kokoro/platform/v1/platform_runtime.proto")
  await prePrepareOutcomeArtifact("contract/descriptor/platform-v1.binpb")
  for (const [file, hash] of Object.entries(feature.preserved)) assert.equal(sha256(await requiredFile(prefix + file.replace("contract/", ""))), hash)
})

test("Prepare query successor retains exact full source/descriptor parent and the unchanged Runtime/SSE inputs", async () => {
  const { fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const { FileDescriptorSetSchema } = await import("@bufbuild/protobuf/wkt")
  const prefix = `contract/vendor/kokoro-platform/${ownerCommit}/`
  const query = JSON.parse(await requiredFile(prefix + "execution-operations/mcp-prepare-receipt-v1.json"))
  assert.equal(query.completed_only, true)
  assert.equal(query.negative_ack, false)
  assert.equal(query.command, false)
  const delta = JSON.parse(await requiredFile(prefix + "descriptor/platform-mcp-prepare-receipt-delta.json"))
  const source = (await prePrepareOutcomeArtifact("contract/proto/kokoro/platform/v1/platform_runtime.proto")).toString("utf8")
  assert.equal(source.split(delta.method).length, 2)
  assert.ok(source.endsWith(delta.suffix))
  assert.equal(
    sha256(source.slice(0, -delta.suffix.length).replace(delta.method, "")),
    query.parents["contract/proto/kokoro/platform/v1/platform_runtime.proto"].sha256,
  )
  const graph = fromBinary(FileDescriptorSetSchema, await prePrepareOutcomeArtifact("contract/descriptor/platform-v1.binpb"))
  let methods = 0,
    messages = 0
  for (const file of graph.file) {
    for (const service of file.service) {
      const before = service.method.length
      service.method = service.method.filter((method) => method.name !== "GetPersonalMcpPrepareReceipt")
      methods += before - service.method.length
    }
    const before = file.messageType.length
    file.messageType = file.messageType.filter(
      (message) => !["GetPersonalMcpPrepareReceiptRequest", "GetPersonalMcpPrepareReceiptResponse"].includes(message.name),
    )
    messages += before - file.messageType.length
  }
  assert.equal(methods, 1)
  assert.equal(messages, 2)
  assert.equal(sha256(toBinary(FileDescriptorSetSchema, graph)), query.parents["contract/descriptor/platform-v1.binpb"].sha256)
  for (const file of [
    "contract/descriptor/mcp-runtime-v1.binpb",
    "contract/execution-operations/mcp-runtime-v1.json",
    "contract/execution-operations/mcp-personal-sse-v1.json",
  ])
    assert.equal(sha256(await requiredFile(prefix + file.replace("contract/", ""))), query.parents[file].sha256)
})

test("Native successor retains the independently pinned unchanged HTTP7 source", async () => {
  const http = JSON.parse(await requiredFile("contract/dependencies/platform-http.json"))
  assert.equal(http.owner.repository_commit, "8cfead647856ef54ec851a3bebe169a3ca14d212")
  assert.equal(http.owner.contract_version, "7.0.0")
  const bytes = await requiredFile(`contract/vendor/kokoro-platform/${http.owner.repository_commit}/openapi/platform-http.openapi.json`)
  assert.equal(sha256(bytes), http.owner.contract_sha256)
  assert.equal(sha256(bytes), "085e1367f69c34edc6b80cbfb448596f36039f9857cee3bd5a407befbc295361")
})
