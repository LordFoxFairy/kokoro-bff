import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { getTextEncoding } from "@bufbuild/protobuf/wire"
import { configureBffProtobufTextEncoding } from "../dist/infrastructure/protobuf-text-encoding.js"

configureBffProtobufTextEncoding()

const ownerCommit = "84262b664275229c62370d49f51ad5e276116148"
const sources = {
  "kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "kokoro/platform/v1/platform_runtime.proto": "41fdcc2a782a779c38df861f99d89b1d20966486d29ed64647d1ecf149926bd6",
  "kokoro/storage/v3/storage.proto": "1021e603065978871c51519ddba5b23c9b97f16b781a08bd98e019b3342bf5f9",
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

test("Platform consumer pins exact owner Proto bytes and active V10 through historical V5 proof", async () => {
  const manifest = JSON.parse(await requiredFile("contract/dependencies/platform-connect.json"))
  assert.equal(manifest.owner.repository_commit, ownerCommit)
  assert.equal(manifest.owner.package_name, "kokoro.platform.v1")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-capability")
  assert.deepEqual(manifest.execution_artifact, {
    path: `contract/vendor/kokoro-platform/${ownerCommit}/execution-operations-v10`,
    artifact_version: "10.0.0",
    status: "active",
    routable: true,
    provenance_path: `contract/vendor/kokoro-platform/${ownerCommit}/execution-operations-v10/provenance.json`,
    aggregate_sha256: "dddb0d194af44dbf0b83a0a0443d774f3dee63f8cb03c364ad529c4c230fb85b",
  })
  assert.deepEqual(
    manifest.execution_proof_chain.map(({ artifact_version, aggregate_sha256, inherits_version, inherits_aggregate_sha256 }) => ({
      artifact_version,
      aggregate_sha256,
      ...(inherits_version === undefined ? {} : { inherits_version, inherits_aggregate_sha256 }),
    })),
    [
      {
        artifact_version: "10.0.0",
        aggregate_sha256: "dddb0d194af44dbf0b83a0a0443d774f3dee63f8cb03c364ad529c4c230fb85b",
        inherits_version: "9.0.0",
        inherits_aggregate_sha256: "19c1466ab398c6dbb43130f3977fe776532e41e00e2487476d465f22fc936073",
      },
      {
        artifact_version: "9.0.0",
        aggregate_sha256: "19c1466ab398c6dbb43130f3977fe776532e41e00e2487476d465f22fc936073",
        inherits_version: "8.0.0",
        inherits_aggregate_sha256: "4a5ed2ca1a25673967ac2ee05a43c5f568bdd19c9ff768d8e606fdac94b9542f",
      },
      {
        artifact_version: "8.0.0",
        aggregate_sha256: "4a5ed2ca1a25673967ac2ee05a43c5f568bdd19c9ff768d8e606fdac94b9542f",
        inherits_version: "7.0.0",
        inherits_aggregate_sha256: "3384a88f31be1fdd3e15bcbceb33e4fd7d62b04dfbfef65fcc35c24ce7afbb72",
      },
      {
        artifact_version: "7.0.0",
        aggregate_sha256: "3384a88f31be1fdd3e15bcbceb33e4fd7d62b04dfbfef65fcc35c24ce7afbb72",
        inherits_version: "6.0.0",
        inherits_aggregate_sha256: "0d728881ba1046dc566131d63de71f6821ec636cf45837b5d937fee9872d5f91",
      },
      {
        artifact_version: "6.0.0",
        aggregate_sha256: "0d728881ba1046dc566131d63de71f6821ec636cf45837b5d937fee9872d5f91",
        inherits_version: "5.0.1",
        inherits_aggregate_sha256: "3f97b3c98fd8e7ce46e4a8ea73237ddb85e764849d2b15dd28d0a3a58a69e42f",
      },
      { artifact_version: "5.0.1", aggregate_sha256: "3f97b3c98fd8e7ce46e4a8ea73237ddb85e764849d2b15dd28d0a3a58a69e42f" },
    ],
  )
  assert.deepEqual(manifest.descriptor, {
    path: `contract/vendor/kokoro-platform/${ownerCommit}/descriptor/platform-v1.binpb`,
    sha256: "fc5d3893a05284a5f52d8de40b82f6e2bbd859608994d84dac20dff43a4a6fd2",
  })
  assert.deepEqual(
    manifest.owner.sources,
    Object.entries(sources).map(([file, digest]) => ({
      path: `contract/proto/${file}`,
      sha256: digest,
    })),
  )
  for (const [file, bytes] of Object.entries(await sourceBytes())) assert.equal(sha256(bytes), sources[file])
  assert.equal(manifest.lockfile_sha256, sha256(await readFile(new URL("pnpm-lock.yaml", root))))
  for (const file of manifest.generated) assert.equal(sha256(await requiredFile(`src/generated/platform-connect/${file.path}`)), file.sha256)
})

test("Platform generator rejects source, proof-chain and generated tree drift", async () => {
  const { assertSourceDigests, assertGeneratedTree, assertVendorPins, assertVendorLayout, assertExecutionArtifact, assertProofChain } = await generator()
  const bytes = await sourceBytes()
  assert.doesNotThrow(() => assertSourceDigests(bytes))
  for (const file of Object.keys(sources)) {
    assert.throws(
      () =>
        assertSourceDigests({
          ...bytes,
          [file]: Buffer.concat([bytes[file], Buffer.from("\n")]),
        }),
      /digest/,
    )
    const missing = { ...bytes }
    delete missing[file]
    assert.throws(() => assertSourceDigests(missing), /source allowlist/)
  }
  assert.throws(
    () =>
      assertSourceDigests({
        ...bytes,
        "kokoro/storage/v1/storage.proto": Buffer.from(""),
      }),
    /source allowlist/,
  )
  const files = ["kokoro/common/v1/common_pb.ts", "kokoro/platform/v1/platform_runtime_pb.ts", "kokoro/storage/v3/storage_pb.ts"]
  const directories = ["kokoro", "kokoro/common", "kokoro/common/v1", "kokoro/platform", "kokoro/platform/v1", "kokoro/storage", "kokoro/storage/v3"]
  assert.doesNotThrow(() => assertGeneratedTree({ files, directories }))
  assert.throws(() => assertGeneratedTree({ files: files.slice(1), directories }), /file allowlist/)
  assert.throws(() => assertGeneratedTree({ files: [...files, "manual.ts"], directories }), /file allowlist/)
  assert.throws(() => assertGeneratedTree({ files, directories: [...directories, "extra"] }), /directory allowlist/)
  const vendorEntry = { name: ownerCommit, isDirectory: () => true }
  assert.doesNotThrow(() => assertVendorPins([vendorEntry]))
  assert.throws(() => assertVendorPins([vendorEntry, { name: "5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0", isDirectory: () => true }]), /commit allowlist/)
  assert.throws(() => assertVendorPins([{ name: ownerCommit, isDirectory: () => false }]), /real directory/)
  const vendorInputs = [
    "descriptor",
    "execution-operations",
    "execution-operations-v10",
    "execution-operations-v5",
    "execution-operations-v6",
    "execution-operations-v7",
    "execution-operations-v8",
    "execution-operations-v9",
    "openapi",
    "proto",
    "provenance.json",
  ].map((name) => ({
    name,
    isDirectory: () => name !== "provenance.json",
    isFile: () => name === "provenance.json",
  }))
  assert.doesNotThrow(() => assertVendorLayout(vendorInputs))
  assert.throws(() => assertVendorLayout([...vendorInputs, { name: "execution-operations-v3", isDirectory: () => true }]), /layout allowlist/)
  assert.throws(
    () => assertVendorLayout(vendorInputs.map((entry) => (entry.name === "proto" ? { name: "proto", isDirectory: () => false } : entry))),
    /real directories/,
  )

  const artifactRoot = `contract/vendor/kokoro-platform/${ownerCommit}/execution-operations-v5/`
  const provenance = JSON.parse(await requiredFile(`${artifactRoot}provenance.json`))
  const artifactFiles = Object.fromEntries(
    await Promise.all(provenance.files.map(async (entry) => [entry.path, await requiredFile(`${artifactRoot}${entry.path}`)])),
  )
  assert.doesNotThrow(() => assertExecutionArtifact(provenance, artifactFiles))
  assert.throws(() => assertExecutionArtifact(provenance, { ...artifactFiles, [provenance.files[0].path]: Buffer.from("tampered") }), /byte length drifted/)
  assert.throws(() => assertExecutionArtifact({ ...provenance, aggregateSha256: "0".repeat(64) }, artifactFiles), /aggregate pin drifted/)
  assert.throws(() => assertExecutionArtifact(provenance, { ...artifactFiles, "unexpected.json": Buffer.from("{}") }), /file allowlist drifted/)
  const manifest = JSON.parse(artifactFiles["manifest.json"])
  assert.equal(manifest.baseArtifact.aggregateSha256, "902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79")
  const v6 = JSON.parse(await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/execution-operations-v6/manifest.json`))
  const v7 = JSON.parse(await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/execution-operations-v7/manifest.json`))
  const v8 = JSON.parse(await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/execution-operations-v8/manifest.json`))
  assert.doesNotThrow(() => assertProofChain(manifest, v6, v7, v8))
  assert.throws(() => assertProofChain(manifest, { ...v6, inherits: { ...v6.inherits, aggregateSha256: "0".repeat(64) } }, v7, v8), /v6 proof drifted/)
})

test("production artifact directory enumeration rejects undeclared filesystem entries", async (t) => {
  const { verifyExecutionArtifactDirectory } = await generator()
  const source = new URL(`contract/vendor/kokoro-platform/${ownerCommit}/execution-operations-v5`, root)
  for (const kind of ["file", "directory", "symlink"]) {
    await t.test(kind, async () => {
      const temporary = await mkdtemp(path.join(tmpdir(), "bff-platform-artifact-"))
      t.after(() => rm(temporary, { recursive: true, force: true }))
      const artifact = path.join(temporary, "artifact")
      await cp(source, artifact, { recursive: true })
      if (kind === "file") await writeFile(path.join(artifact, "unexpected.json"), "{}")
      if (kind === "directory") {
        await mkdir(path.join(artifact, "unexpected"))
        await writeFile(path.join(artifact, "unexpected", "nested.json"), "{}")
      }
      if (kind === "symlink") await symlink(path.join(artifact, "manifest.json"), path.join(artifact, "unexpected-link.json"))
      await assert.rejects(() => verifyExecutionArtifactDirectory(artifact), /unsupported entry|allowlist drifted/)
    })
  }
})

test("all pinned consumer manifests track the same lockfile without replacing existing owners", async () => {
  const digest = sha256(await readFile(new URL("pnpm-lock.yaml", root)))
  for (const name of ["agent-http", "platform-http", "iam-http", "scheduler", "platform-connect"]) {
    const manifest = JSON.parse(await requiredFile(`contract/dependencies/${name}.json`))
    assert.equal(manifest.lockfile_sha256, digest, `${name} lockfile pin`)
  }
})

test("generated Platform descriptor preserves CreateDraft wire tags, bytes, Product context and uint64", async () => {
  await requiredFile("src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts")
  const { create, toBinary, fromBinary } = await import("@bufbuild/protobuf")
  const { AuthorizeMcpToolResponseSchema, CreateSkillDraftRequestSchema, CreateSkillDraftResponseSchema, SkillCatalogService, SkillStatus } =
    await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  assert.equal(SkillCatalogService.typeName, "kokoro.platform.v1.SkillCatalogService")
  assert.equal(SkillCatalogService.method.createSkillDraft.name, "CreateSkillDraft")
  assert.equal(SkillCatalogService.method.createSkillDraft.methodKind, "unary")
  assert.deepEqual(
    AuthorizeMcpToolResponseSchema.fields.map((field) => [field.name, field.number]),
    [
      ["invocation_grant", 1],
      ["connector_id", 2],
      ["tool_ref", 3],
      ["typed_arguments_digest", 4],
      ["expires_at_unix_seconds", 5],
      ["audit_ref", 6],
      ["connection_id", 7],
      ["server_id", 8],
    ],
    "current Proto source must include the V6 MCP authorization identity tags without adding BFF MCP behavior",
  )
  assert.deepEqual(
    CreateSkillDraftRequestSchema.fields.map((f) => [f.name, f.number]),
    [
      ["request_id", 1],
      ["command", 2],
      ["owner_scope", 3],
      ["metadata", 4],
      ["product_context", 5],
      ["creation_provenance", 6],
    ],
  )
  const request = create(CreateSkillDraftRequestSchema, {
    requestId: "request-1",
    command: { commandId: "command-1", requestDigest: "a".repeat(64) },
    ownerScope: { kind: "user", id: "user-1" },
    metadata: {
      displayName: "Draft 🦊",
      summary: "",
      tags: ["z", "a"],
      metadataJson: new Uint8Array([0, 255, 123, 125]),
    },
    productContext: {
      subjectId: "user-1",
      ownerScope: { kind: "user", id: "user-1" },
    },
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
        return {
          skillId: { value: "skill-1" },
          seriesId: { value: "series-1" },
          revision: 1n,
          status: SkillStatus.DRAFT,
          replayed: false,
        }
      },
    }),
  )
  const client = createClient(SkillCatalogService, transport)
  const response = await client.createSkillDraft({
    requestId: "request-1",
    productContext: {
      subjectId: "user-1",
      ownerScope: { kind: "user", id: "user-1" },
    },
    ownerScope: { kind: "user", id: "user-1" },
    metadata: {
      displayName: "Draft",
      metadataJson: new TextEncoder().encode("{}"),
    },
  })
  assert.equal(response.revision, 1n)
  assert.equal(response.status, SkillStatus.DRAFT)
  assert.equal(calls, 1)
})

test("CreateDraft preserves catalog nonblank identifiers without weakening Product identifiers", async () => {
  const { projectCreateSkillDraft } = await import("../dist/infrastructure/clients/platform/create-skill-draft-projector.js")
  const input = {
    command_digest_version: "3.0.0",
    fq_method: "kokoro.platform.v1.SkillCatalogService/CreateSkillDraft",
    tenant_ref: "tenant / east",
    request: {
      owner_scope: { kind: "organization", id: "catalog owner / east" },
      product_context: { subject_id: "user-1", owner_scope: { kind: "organization", id: "organization-1" } },
      metadata: { display_name: "Draft" },
    },
  }
  const projected = projectCreateSkillDraft(JSON.stringify(input)).projection
  assert.equal(projected.tenant_ref, "tenant / east")
  assert.equal(projected.command.owner_scope.id, "catalog owner / east")
  assert.throws(
    () =>
      projectCreateSkillDraft(
        JSON.stringify({
          ...input,
          request: {
            ...input.request,
            product_context: { ...input.request.product_context, owner_scope: { kind: "organization", id: "product owner / east" } },
          },
        }),
      ),
    /projection schema string domain/,
  )
})

test("independent JCS rejects values outside the plain dense JSON domain", async () => {
  const { canonicalizeJcs } = await import("../dist/infrastructure/clients/platform/jcs.js")
  const sparse = Array(1)
  assert.throws(() => canonicalizeJcs(sparse), /array element 0 is absent or undefined/)
  assert.throws(() => canonicalizeJcs([undefined]), /array element 0 is absent or undefined/)
  assert.throws(() => canonicalizeJcs(new Date(0)), /plain JSON/)
})

test("Platform generated Product installation exposes fixed metadata tags", async () => {
  const source = await requiredFile("src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts")
  const text = source.toString("utf8")
  assert.match(text, /displayName/u)
  assert.match(text, /summary/u)
  assert.match(text, /sourceStatus/u)
})

test("R345 generated and compiled Product installation add only required Skill update Timestamp tag14", async () => {
  const { fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const { FileDescriptorProtoSchema, FileDescriptorSetSchema } = await import("@bufbuild/protobuf/wkt")
  const generated = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const fields = generated.ProductSkillInstallationSchema.fields
  const installed = fields.find((field) => field.name === "installed_at")
  const updated = fields.find((field) => field.name === "updated_at")
  const skillUpdated = fields.find((field) => field.name === "skill_updated_at")
  assert.equal(installed?.number, 7)
  assert.equal(updated?.number, 8, "tag8 remains the installation record update instant")
  assert.equal(updated?.message?.typeName, "google.protobuf.Timestamp")
  assert.equal(skillUpdated?.number, 14)
  assert.equal(skillUpdated?.message?.typeName, "google.protobuf.Timestamp")
  assert.equal(skillUpdated?.oneof, undefined)

  const prefix = `contract/vendor/kokoro-platform/${ownerCommit}/descriptor`
  const currentBytes = await requiredFile(`${prefix}/platform-v1.binpb`)
  assert.equal(sha256(currentBytes), "fc5d3893a05284a5f52d8de40b82f6e2bbd859608994d84dac20dff43a4a6fd2")
  const current = fromBinary(FileDescriptorSetSchema, await requiredFile(`${prefix}/platform-skill-example-prompts-parent.binpb`))
  const compiledParentBytes = await requiredFile(`${prefix}/platform-skill-updated-at-parent.binpb`)
  assert.equal(sha256(compiledParentBytes), "2e1a811bf347b5d9cd3577ac6c762ee9d31f40dea2ac326a06b83bc61de9a8d5")
  const compiledParent = fromBinary(FileDescriptorSetSchema, compiledParentBytes)
  const platform = current.file.find((file) => file.package === "kokoro.platform.v1")
  const installation = platform.messageType.find((message) => message.name === "ProductSkillInstallation")
  const compiledUpdated = installation.field.find((field) => field.name === "updated_at")
  const compiledSkillUpdated = installation.field.find((field) => field.name === "skill_updated_at")
  assert.deepEqual(
    [compiledUpdated.number, compiledUpdated.type, compiledUpdated.typeName, compiledUpdated.proto3Optional, compiledUpdated.oneofIndex],
    [8, 11, ".google.protobuf.Timestamp", false, 0],
  )
  assert.deepEqual(
    [
      compiledSkillUpdated.number,
      compiledSkillUpdated.type,
      compiledSkillUpdated.typeName,
      compiledSkillUpdated.proto3Optional,
      compiledSkillUpdated.oneofIndex,
    ],
    [14, 11, ".google.protobuf.Timestamp", false, 0],
  )
  installation.field = installation.field.filter((field) => field.name !== "skill_updated_at")
  assert.deepEqual(current, compiledParent, "stripping only tag14 must restore the complete compiled parent graph")

  const generatedParentBytes = await requiredFile(`${prefix}/platform-skill-updated-at-parent-generated.binpb`)
  assert.equal(sha256(generatedParentBytes), "bf466c1288cb9bbd84e05a5122aa018b9a135377426099c3e158450a0f8f9b03")
  const generatedParent = fromBinary(FileDescriptorProtoSchema, generatedParentBytes)
  const generatedFile = fromBinary(FileDescriptorProtoSchema, await requiredFile(`${prefix}/platform-skill-example-prompts-parent-generated.binpb`))
  const generatedInstallation = generatedFile.messageType.find((message) => message.name === "ProductSkillInstallation")
  generatedInstallation.field = generatedInstallation.field.filter((field) => field.name !== "skill_updated_at")
  assert.deepEqual(generatedFile, generatedParent, "stripping only tag14 must restore the complete generated parent graph")
})

// R319: fixed machine consumption only; no BFF route, identity or runtime activation.
test("R319 consumer fixes the complete V8 owner and preserves the historical parent39 pin", async () => {
  const manifest = JSON.parse(await requiredFile("contract/dependencies/platform-connect.json"))
  assert.equal(manifest.owner.repository_commit, ownerCommit)
  assert.equal(manifest.status, "generated")
  assert.deepEqual(
    manifest.execution_proof_chain.slice(2).map((entry) => entry.artifact_version),
    ["8.0.0", "7.0.0", "6.0.0", "5.0.1"],
  )
  assert.equal(
    manifest.descriptor_parents.find((entry) => entry.path.endsWith("/platform-v9-parent43.binpb")).sha256,
    "5f0f00f605f6a445b4d80943459b69bf9f489fd7851cc80b6c2700f8f78a8d0e",
  )
  const prefix = `contract/vendor/kokoro-platform/${ownerCommit}`
  assert.equal(
    sha256(await requiredFile(`${prefix}/descriptor/platform-v8-parent39.binpb`)),
    "0467c1c45e8ac27c79cb906e27bfdb679d88739e45bfa38128f0f629bec686d5",
  )
  assert.deepEqual(
    manifest.generated.map((entry) => entry.path),
    ["kokoro/common/v1/common_pb.ts", "kokoro/platform/v1/platform_runtime_pb.ts", "kokoro/storage/v3/storage_pb.ts"],
  )
})

test("R319 historical V8 descriptor contains four personal unary reads and eleven messages without commands or proof", async () => {
  const { fromBinary } = await import("@bufbuild/protobuf")
  const { FileDescriptorSetSchema } = await import("@bufbuild/protobuf/wkt")
  const manifest = JSON.parse(await requiredFile("contract/dependencies/platform-connect.json"))
  const descriptor = fromBinary(
    FileDescriptorSetSchema,
    await requiredFile(manifest.descriptor_parents.find((entry) => entry.path.endsWith("/platform-v9-parent43.binpb")).path),
  )
  const file = descriptor.file.find((entry) => entry.package === "kokoro.platform.v1")
  assert.ok(file)
  assert.equal(file.service.flatMap((service) => service.method).length, 43)
  const service = file.service.find((entry) => entry.name === "ProductMcpPersonalService")
  assert.ok(service, "published personal MCP service required")
  const methods = ["ListPersonalMcpConnectors", "GetPersonalMcpConnector", "ListPersonalMcpConnections", "GetPersonalMcpConnection"]
  assert.deepEqual(
    service.method.map((method) => method.name),
    methods,
  )
  for (const method of service.method) {
    assert.equal(method.clientStreaming, false)
    assert.equal(method.serverStreaming, false)
    assert.equal(method.inputType, `.kokoro.platform.v1.${method.name}Request`)
    assert.equal(method.outputType, `.kokoro.platform.v1.${method.name}Response`)
  }
  const expected = {
    ListPersonalMcpConnectorsRequest: [
      ["request_id", 1],
      ["status", 2],
      ["page", 3],
    ],
    GetPersonalMcpConnectorRequest: [
      ["request_id", 1],
      ["connector_id", 2],
    ],
    ListPersonalMcpConnectionsRequest: [
      ["request_id", 1],
      ["connector_id", 2],
      ["page", 3],
    ],
    GetPersonalMcpConnectionRequest: [
      ["request_id", 1],
      ["connection_id", 2],
    ],
    ListPersonalMcpConnectorsResponse: [
      ["connectors", 1],
      ["page", 2],
    ],
    GetPersonalMcpConnectorResponse: [["connector", 1]],
    ListPersonalMcpConnectionsResponse: [
      ["connections", 1],
      ["page", 2],
    ],
    GetPersonalMcpConnectionResponse: [["connection", 1]],
    PersonalMcpPageRequest: [
      ["limit", 1],
      ["cursor", 2],
    ],
    PersonalMcpConnector: [
      ["connector_id", 1],
      ["connector_type", 2],
      ["provider_key", 3],
      ["status", 4],
      ["approved_scopes", 5],
    ],
    PersonalMcpConnection: [
      ["connection_id", 1],
      ["connector_id", 2],
      ["server_id", 3],
      ["allowed_selectors", 4],
      ["policy_digest", 5],
      ["status", 6],
    ],
  }
  for (const [name, fields] of Object.entries(expected)) {
    const message = file.messageType.find((entry) => entry.name === name)
    assert.ok(message, name)
    assert.deepEqual(
      message.field.map((field) => [field.name, field.number]),
      fields,
    )
    if (methods.some((method) => name === `${method}Request`)) {
      assert.ok(message.reservedName.includes("execution_proof"))
      assert.ok(message.reservedName.includes("command"))
      assert.ok(message.reservedRange.some((range) => range.start === 100 && range.end === 101))
    }
  }
  const page = file.messageType.find((entry) => entry.name === "PersonalMcpPageRequest")
  assert.ok(page.field.every((field) => field.proto3Optional))
  assert.equal(
    file.messageType.find((entry) => entry.name === "ListPersonalMcpConnectorsRequest").field.find((field) => field.name === "status").proto3Optional,
    true,
  )
  const parent = fromBinary(FileDescriptorSetSchema, await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/descriptor/platform-v8-parent39.binpb`))
  file.service = file.service.filter((entry) => entry.name !== "ProductMcpPersonalService")
  file.messageType = file.messageType.filter((entry) => !Object.hasOwn(expected, entry.name))
  assert.deepEqual(descriptor, parent, "removing only V8 additions preserves every parent39 descriptor fact")
})

test("R319 V8 pins the complete 190-vector corpus and exact inheritance without claiming semantic execution", async () => {
  const manifest = JSON.parse(await requiredFile("contract/dependencies/platform-connect.json"))
  const historical = manifest.execution_proof_chain.find((entry) => entry.artifact_version === "8.0.0")
  assert.equal(historical.artifact_version, "8.0.0")
  assert.equal(historical.aggregate_sha256, "4a5ed2ca1a25673967ac2ee05a43c5f568bdd19c9ff768d8e606fdac94b9542f")
  const base = `${historical.path}/`
  const provenance = JSON.parse(await requiredFile(`${base}provenance.json`))
  const files = Object.fromEntries(await Promise.all(provenance.files.map(async (entry) => [entry.path, await requiredFile(`${base}${entry.path}`)])))
  const { assertExecutionArtifact } = await generator()
  assert.doesNotThrow(() => assertExecutionArtifact(provenance, files, historical.aggregate_sha256))
  const artifact = JSON.parse(files["manifest.json"])
  assert.deepEqual(artifact.counts, { rpc: 43, command: 20, proof: 24 })
  assert.deepEqual(artifact.inherits, { version: "7.0.0", aggregateSha256: "3384a88f31be1fdd3e15bcbceb33e4fd7d62b04dfbfef65fcc35c24ce7afbb72" })
  assert.equal(artifact.status, "inactive")
  assert.equal(artifact.routable, false)
  const corpus = JSON.parse(files["vectors/personal-mcp-read.json"])
  assert.equal(corpus.vectors.length, 190)
  assert.equal(new Set(corpus.vectors.map((entry) => entry.id)).size, 190)
})

test("R319 production verification rejects V8 inheritance, corpus and descriptor/Get catalog drift", async () => {
  const { assertProofChain, assertPublishedDescriptors, assertExecutionArtifact } = await generator()
  const prefix = `contract/vendor/kokoro-platform/${ownerCommit}`
  const manifests = await Promise.all(
    [5, 6, 7, 8].map(async (version) => JSON.parse(await requiredFile(`${prefix}/execution-operations-v${version}/manifest.json`))),
  )
  assert.throws(() => assertProofChain(...manifests.slice(0, 3), { ...manifests[3], counts: { rpc: 43, command: 21, proof: 24 } }), /v8 proof drifted/)
  assert.throws(
    () => assertProofChain(...manifests.slice(0, 3), { ...manifests[3], inherits: { ...manifests[3].inherits, aggregateSha256: "0".repeat(64) } }),
    /v8 proof drifted/,
  )
  const current = await requiredFile(`${prefix}/descriptor/platform-v9-parent43.binpb`)
  const parent = await requiredFile(`${prefix}/descriptor/platform-v8-parent39.binpb`)
  const catalog = await requiredFile(`${prefix}/execution-operations-v5/operation-catalog.json`)
  assert.doesNotThrow(() => assertPublishedDescriptors(current, parent, { "operation-catalog.json": catalog }))
  assert.throws(
    () => assertPublishedDescriptors(Buffer.concat([current, Buffer.from([0])]), parent, { "operation-catalog.json": catalog }),
    /descriptor digest drifted/,
  )
  assert.throws(
    () => assertPublishedDescriptors(current, Buffer.concat([parent, Buffer.from([0])]), { "operation-catalog.json": catalog }),
    /parent descriptor digest drifted/,
  )
  const changed = JSON.parse(catalog)
  changed.operations.find((operation) => operation.operation === "skill.get_package_upload").proof = "required"
  assert.throws(
    () => assertPublishedDescriptors(current, parent, { "operation-catalog.json": Buffer.from(JSON.stringify(changed)) }),
    /Get catalog semantics drifted/,
  )
  const artifact = `${prefix}/execution-operations-v8/`
  const provenance = JSON.parse(await requiredFile(`${artifact}provenance.json`))
  const files = Object.fromEntries(await Promise.all(provenance.files.map(async (entry) => [entry.path, await requiredFile(`${artifact}${entry.path}`)])))
  const vectors = JSON.parse(files["vectors/personal-mcp-read.json"])
  vectors.vectors.pop()
  assert.throws(
    () => assertExecutionArtifact(provenance, { ...files, "vectors/personal-mcp-read.json": Buffer.from(JSON.stringify(vectors)) }, provenance.aggregateSha256),
    /byte length drifted|digest drifted/,
  )
})

test("R340 generated consumer exposes both personal package inspection services", async () => {
  const generated = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  for (const [service, method] of [
    ["ProductSkillPackageInspectionService", "InspectPersonalSkillPackage"],
    ["ProductSkillInstallationPackageInspectionService", "InspectPersonalSkillInstallationPackage"],
  ]) {
    assert.ok(generated[service], `${service} must be formally generated`)
    assert.equal(generated[service].methods[0].name, method)
    assert.equal(generated[service].methods[0].methodKind, "unary")
  }
})

test("formal complete 87-input publication is closed, byte-pinned and rejects omitted, extra and altered inputs", async () => {
  const manifest = JSON.parse(await requiredFile("contract/dependencies/platform-connect.json"))
  assert.equal(manifest.published_inputs.path_algorithm, "owner-repository-relative-including-contract")
  assert.equal(manifest.published_inputs.aggregate_sha256, "9c5fe8036b0246b26b0411e9caa31595059d82fedfcd28efaabfdf6bb7e011c1")
  assert.equal(manifest.published_inputs.files.length, 87)
  const files = Object.fromEntries(
    await Promise.all(
      manifest.published_inputs.files.map(async (pin) => {
        const file = pin.path.replace(/^contract\//u, "").replace(/^execution-operations\/v(10|[5-9])\//u, "execution-operations-v$1/")
        const bytes = await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/${file}`)
        assert.equal(bytes.length, pin.bytes)
        assert.equal(sha256(bytes), pin.sha256)
        return [pin.path, bytes]
      }),
    ),
  )
  const { assertPublicationInputs } = await generator()
  assert.doesNotThrow(() => assertPublicationInputs(files))
  for (const [file, bytes] of Object.entries(files)) {
    const missing = { ...files }
    delete missing[file]
    assert.throws(() => assertPublicationInputs(missing), /allowlist drifted/)
    assert.throws(() => assertPublicationInputs({ ...files, [file]: Buffer.concat([bytes, Buffer.from([0])]) }), /byte length drifted/)
    const changed = Buffer.from(bytes)
    changed[0] ^= 1
    assert.throws(() => assertPublicationInputs({ ...files, [file]: changed }), /digest drifted/)
  }
  assert.throws(() => assertPublicationInputs({ ...files, "contract/extra.json": Buffer.from("{}") }), /allowlist drifted/)
})

test("R340 historical V9 retains 43/20/24, all 128 vectors and exact inactive V8 inheritance", async () => {
  const prefix = `contract/vendor/kokoro-platform/${ownerCommit}/execution-operations-v9`
  const provenance = JSON.parse(await requiredFile(`${prefix}/provenance.json`))
  const files = Object.fromEntries(await Promise.all(provenance.files.map(async (pin) => [pin.path, await requiredFile(`${prefix}/${pin.path}`)])))
  const { assertExecutionArtifact, assertV9Proof } = await generator()
  assert.equal(provenance.aggregateSha256, "19c1466ab398c6dbb43130f3977fe776532e41e00e2487476d465f22fc936073")
  assert.doesNotThrow(() => assertExecutionArtifact(provenance, files, provenance.aggregateSha256))
  const manifest = JSON.parse(files["manifest.json"])
  assert.doesNotThrow(() => assertV9Proof(manifest))
  assert.throws(() => assertV9Proof({ ...manifest, counts: { rpc: 45, command: 20, proof: 24 } }), /historical v9 proof drifted/)
  assert.throws(() => assertV9Proof({ ...manifest, inherits: { ...manifest.inherits, aggregateSha256: "0".repeat(64) } }), /historical v9 proof drifted/)
  assert.throws(() => assertV9Proof({ ...manifest, routable: true }), /historical v9 proof drifted/)
  const vectors = JSON.parse(files["vectors/global-mcp-registration.json"])
  assert.equal(vectors.vectors.length, 128)
  assert.equal(new Set(vectors.vectors.map((vector) => vector.id)).size, 128)
  vectors.vectors.pop()
  assert.throws(
    () =>
      assertExecutionArtifact(
        provenance,
        { ...files, "vectors/global-mcp-registration.json": Buffer.from(JSON.stringify(vectors)) },
        provenance.aggregateSha256,
      ),
    /byte length drifted|digest drifted/,
  )
})

test("formal current issued graph preserves whole generated/compiled bytes and historical inspection negative controls", async () => {
  const { fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const { FileDescriptorSetSchema, FileDescriptorProtoSchema } = await import("@bufbuild/protobuf/wkt")
  const { assertDescriptorCensus, assertDescriptorPairs, assertGeneratedDescriptor, assertInspectionDescriptors } = await generator()
  const prefix = `contract/vendor/kokoro-platform/${ownerCommit}/descriptor`
  const currentBytes = await requiredFile(`${prefix}/platform-v1.binpb`)
  const current = fromBinary(FileDescriptorSetSchema, currentBytes)
  const historical = fromBinary(FileDescriptorSetSchema, await requiredFile(`${prefix}/platform-v9-parent43.binpb`))
  assert.doesNotThrow(() => assertDescriptorCensus(historical, [43, 20, 24]))
  const manifest = JSON.parse(await requiredFile("contract/dependencies/platform-connect.json"))
  const parents = Object.fromEntries(await Promise.all(manifest.descriptor_parents.map(async (pin) => [path.basename(pin.path), await requiredFile(pin.path)])))
  assert.doesNotThrow(() => assertDescriptorPairs(parents))
  for (const file of Object.keys(parents).filter((file) =>
    /^(platform-v9-parent43|platform-installation-tags-parent|platform-package-read-parent|platform-skill-updated-at-parent|platform-skill-example-prompts-parent|platform-skill-github-asset-parent|platform-skill-personal-query-parent)(-generated)?\.binpb$/u.test(
      file,
    ),
  )) {
    assert.throws(() => assertDescriptorPairs({ ...parents, [file]: Buffer.concat([parents[file], Buffer.from([0])]) }), /parent bytes drifted/)
  }
  const { file_kokoro_platform_v1_platform_runtime } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  assert.doesNotThrow(() => assertGeneratedDescriptor(file_kokoro_platform_v1_platform_runtime.proto, currentBytes))
  const changedGenerated = fromBinary(FileDescriptorProtoSchema, toBinary(FileDescriptorProtoSchema, file_kokoro_platform_v1_platform_runtime.proto))
  changedGenerated.messageType.find((message) => message.name === "SkillPackageSelectedText").field[1].number = 30
  assert.throws(() => assertGeneratedDescriptor(changedGenerated, currentBytes), /whole graph drifted/)
  const inspectionBytes = await requiredFile(`${prefix}/platform-skill-personal-query-parent.binpb`)
  assert.doesNotThrow(() => assertInspectionDescriptors(fromBinary(FileDescriptorSetSchema, inspectionBytes)))
  const clone = () => fromBinary(FileDescriptorSetSchema, inspectionBytes)
  for (const mutate of [
    (file) => {
      file.messageType.find((message) => message.name === "InspectPersonalSkillPackageRequest").reservedName.pop()
    },
    (file) => {
      file.messageType.find((message) => message.name === "InspectPersonalSkillInstallationPackageRequest").field[2].proto3Optional = false
    },
    (file) => {
      file.messageType.find((message) => message.name === "InspectPersonalSkillPackageResponse").field[2].label = 1
    },
    (file) => {
      file.service.find((service) => service.name === "ProductSkillPackageInspectionService").method[0].serverStreaming = true
    },
    (file) => {
      file.service.find((service) => service.name === "ProductSkillInstallationPackageInspectionService").method[0].outputType =
        ".kokoro.platform.v1.InspectPersonalSkillPackageResponse"
    },
  ]) {
    const changed = clone()
    mutate(changed.file.find((file) => file.package === "kokoro.platform.v1"))
    assert.throws(() => assertInspectionDescriptors(changed), /inspection.*drifted/)
  }
  const currentFile = current.file.find((file) => file.package === "kokoro.platform.v1")
  assert.deepEqual(
    currentFile.service.find((service) => service.name === "ProductSkillReadService").method.map((method) => method.name),
    ["GetCurrentSkill", "InspectSkillPackage", "GetSkillPackageDownload", "GetSkillCoverReference"],
  )
})

test("BFF initializes one strict BOM-preserving Protobuf codec before composing clients", async () => {
  const codec = getTextEncoding()
  configureBffProtobufTextEncoding()
  assert.equal(getTextEncoding(), codec)
  const text = new Uint8Array([0xef, 0xbb, 0xbf, 0x61])
  assert.equal(codec.decodeUtf8(text, false), "\uFEFFa")
  assert.equal(codec.decodeUtf8(text, true), "\uFEFFa")
  assert.throws(() => codec.decodeUtf8(new Uint8Array([0xff]), true), TypeError)
  assert.equal(codec.decodeUtf8(new Uint8Array([0xff]), false), "\uFFFD")
  const server = await requiredFile("src/bootstrap/server.ts")
  assert.match(
    server.toString("utf8"),
    /export function createBffServer\([^]*?\{\n  configureBffProtobufTextEncoding\(\)\n  const composition = createBffComposition/u,
  )
})

test("R340 inspection wire preserves absent versus explicit empty file, distinct identities, uint64 and original UTF-8 text", async () => {
  const { create, fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const generated = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  for (const [requestName, responseName, id] of [
    ["InspectPersonalSkillPackageRequest", "InspectPersonalSkillPackageResponse", "skillId"],
    ["InspectPersonalSkillInstallationPackageRequest", "InspectPersonalSkillInstallationPackageResponse", "installationId"],
  ]) {
    const requestSchema = generated[`${requestName}Schema`]
    const responseSchema = generated[`${responseName}Schema`]
    assert.deepEqual(
      requestSchema.fields.map((field) => field.name),
      ["request_id", id === "skillId" ? "skill_id" : "installation_id", "file_path"],
    )
    const absent = create(requestSchema, { requestId: "inspection-1", [id]: { value: "owned-resource" } })
    const empty = create(requestSchema, { requestId: "inspection-1", [id]: { value: "owned-resource" }, filePath: "" })
    const selected = create(requestSchema, { requestId: "inspection-1", [id]: { value: "owned-resource" }, filePath: "docs/说明.md" })
    assert.equal(fromBinary(requestSchema, toBinary(requestSchema, absent)).filePath, undefined)
    assert.equal(fromBinary(requestSchema, toBinary(requestSchema, empty)).filePath, "")
    assert.notDeepEqual(toBinary(requestSchema, absent), toBinary(requestSchema, empty))
    assert.deepEqual(fromBinary(requestSchema, toBinary(requestSchema, selected)), selected)
    const originalText = "\uFEFF# 技能 🦊\r\n\r\n<raw>&正文\n"
    const response = create(responseSchema, {
      sourceRef: { value: "source-1" },
      revision: 18446744073709551615n,
      files: [{ path: "SKILL.md", sizeBytes: 9007199254740993n }],
      selectedFile: { path: "SKILL.md", text: originalText },
    })
    assert.deepEqual(fromBinary(responseSchema, toBinary(responseSchema, response)), response)
    const directoryOnly = create(responseSchema, { files: [{ path: "SKILL.md", sizeBytes: 1n }] })
    assert.equal(fromBinary(responseSchema, toBinary(responseSchema, directoryOnly)).selectedFile, undefined)
    const emptyFile = create(responseSchema, { files: [{ path: "SKILL.md", sizeBytes: 0n }], selectedFile: { path: "SKILL.md", text: "" } })
    const decodedEmptyFile = fromBinary(responseSchema, toBinary(responseSchema, emptyFile))
    assert.deepEqual(decodedEmptyFile, emptyFile)
    assert.equal(decodedEmptyFile.selectedFile.text, "")
    assert.notEqual(decodedEmptyFile.selectedFile, undefined)
  }
  const installation = create(generated.ProductSkillInstallationSchema, { tags: ["媒体", "内容", "自动化"] })
  assert.deepEqual(fromBinary(generated.ProductSkillInstallationSchema, toBinary(generated.ProductSkillInstallationSchema, installation)).tags, [
    "媒体",
    "内容",
    "自动化",
  ])
  assert.equal(generated.ProductSkillInstallationSchema.fields.find((field) => field.name === "tags").number, 13)
})

test("P4 query6 strips only the approved field and source_kind5 remains parent bound", async () => {
  const { fromBinary, toBinary } = await import("@bufbuild/protobuf"),
    { FileDescriptorSetSchema } = await import("@bufbuild/protobuf/wkt")
  const { stripDescriptorLineage } = await generator()
  const active = fromBinary(FileDescriptorSetSchema, await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/descriptor/platform-v1.binpb`))
  const witness = fromBinary(
    FileDescriptorSetSchema,
    await requiredFile(`contract/vendor/kokoro-platform/${ownerCommit}/descriptor/platform-skill-personal-query-parent.binpb`),
  )
  const request = witness.file
    .find((file) => file.package === "kokoro.platform.v1")
    .messageType.find((message) => message.name === "ListPersonalSkillInstallationsRequest")
  const actualQuery = active.file
    .find((file) => file.package === "kokoro.platform.v1")
    .messageType.find((message) => message.name === request.name)
    .field.find((field) => field.number === 6)
  request.field.push(actualQuery)
  request.oneofDecl.push(
    active.file.find((file) => file.package === "kokoro.platform.v1").messageType.find((message) => message.name === request.name).oneofDecl[
      actualQuery.oneofIndex
    ],
  )
  const bytes = toBinary(FileDescriptorSetSchema, witness)
  for (const mutate of [
    (field) => (field.number = 7),
    (field) => (field.type = 4),
    (field) => (field.proto3Optional = false),
    (field) => (field.oneofIndex = 0),
    (field) => (field.name = "query_alias"),
  ]) {
    const set = fromBinary(FileDescriptorSetSchema, bytes),
      file = set.file.find((file) => file.package === "kokoro.platform.v1"),
      request = file.messageType.find((message) => message.name === "ListPersonalSkillInstallationsRequest")
    mutate(request.field.find((field) => field.number === 6))
    assert.throws(() => stripDescriptorLineage(set), /personal optional query tag6 drifted/)
  }
  const changed = fromBinary(FileDescriptorSetSchema, bytes)
  changed.file
    .find((file) => file.package === "kokoro.platform.v1")
    .messageType.find((message) => message.name === "ListPersonalSkillInstallationsRequest")
    .field.find((field) => field.number === 5).name = "source_alias"
  assert.throws(() => stripDescriptorLineage(changed), /whole parent graph drifted/)
})
