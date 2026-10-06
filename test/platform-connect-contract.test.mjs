import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"

const ownerCommit = "c94909f1c593f2b7ffd5f325786739da744ff31f"
const sources = {
  "kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "kokoro/platform/v1/platform_runtime.proto": "e5fd71e436f8d0ad271ae4ccfbcc323dbb691aafeacca04e29297e8f0a068db0",
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

test("Platform consumer pins exact owner Proto bytes and inactive V7 to V6 to V5 proof", async () => {
  const manifest = JSON.parse(await requiredFile("contract/dependencies/platform-connect.json"))
  assert.equal(manifest.owner.repository_commit, ownerCommit)
  assert.equal(manifest.owner.package_name, "kokoro.platform.v1")
  assert.equal(manifest.owner.repository_path, "apps/kokoro-capability")
  assert.deepEqual(manifest.execution_artifact, {
    path: `contract/vendor/kokoro-platform/${ownerCommit}/execution-operations-v7`,
    artifact_version: "7.0.0",
    status: "inactive",
    routable: false,
    provenance_path: `contract/vendor/kokoro-platform/${ownerCommit}/execution-operations-v7/provenance.json`,
    aggregate_sha256: "3384a88f31be1fdd3e15bcbceb33e4fd7d62b04dfbfef65fcc35c24ce7afbb72",
  })
  assert.deepEqual(
    manifest.execution_proof_chain.map(({ artifact_version, aggregate_sha256, inherits_version, inherits_aggregate_sha256 }) => ({
      artifact_version,
      aggregate_sha256,
      ...(inherits_version === undefined ? {} : { inherits_version, inherits_aggregate_sha256 }),
    })),
    [
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
    sha256: "0467c1c45e8ac27c79cb906e27bfdb679d88739e45bfa38128f0f629bec686d5",
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
  const files = ["kokoro/common/v1/common_pb.ts", "kokoro/platform/v1/platform_runtime_pb.ts"]
  const directories = ["kokoro", "kokoro/common", "kokoro/common/v1", "kokoro/platform", "kokoro/platform/v1"]
  assert.doesNotThrow(() => assertGeneratedTree({ files, directories }))
  assert.throws(() => assertGeneratedTree({ files: files.slice(1), directories }), /file allowlist/)
  assert.throws(() => assertGeneratedTree({ files: [...files, "manual.ts"], directories }), /file allowlist/)
  assert.throws(() => assertGeneratedTree({ files, directories: [...directories, "extra"] }), /directory allowlist/)
  const vendorEntry = { name: ownerCommit, isDirectory: () => true }
  assert.doesNotThrow(() => assertVendorPins([vendorEntry]))
  assert.throws(() => assertVendorPins([vendorEntry, { name: "5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0", isDirectory: () => true }]), /commit allowlist/)
  assert.throws(() => assertVendorPins([{ name: ownerCommit, isDirectory: () => false }]), /real directory/)
  const vendorInputs = ["descriptor", "execution-operations-v5", "execution-operations-v6", "execution-operations-v7", "proto"].map((name) => ({
    name,
    isDirectory: () => true,
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
  assert.doesNotThrow(() => assertProofChain(manifest, v6, v7))
  assert.throws(() => assertProofChain(manifest, { ...v6, inherits: { ...v6.inherits, aggregateSha256: "0".repeat(64) } }, v7), /v6 proof drifted/)
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
