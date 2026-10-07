import { fromBinary, toBinary } from "@bufbuild/protobuf"
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ownerCommit = "e83a2ad3a7c7d333ad0b0b8e7f3d3f64e497bc42"
const vendorRoot = `contract/vendor/kokoro-platform/${ownerCommit}`
const vendor = `contract/vendor/kokoro-platform/${ownerCommit}/proto`
const artifacts = {
  v5: `${vendorRoot}/execution-operations-v5`,
  v6: `${vendorRoot}/execution-operations-v6`,
  v7: `${vendorRoot}/execution-operations-v7`,
  v8: `${vendorRoot}/execution-operations-v8`,
}
const artifactAggregates = {
  v8: "4a5ed2ca1a25673967ac2ee05a43c5f568bdd19c9ff768d8e606fdac94b9542f",
  v5: "3f97b3c98fd8e7ce46e4a8ea73237ddb85e764849d2b15dd28d0a3a58a69e42f",
  v6: "0d728881ba1046dc566131d63de71f6821ec636cf45837b5d937fee9872d5f91",
  v7: "3384a88f31be1fdd3e15bcbceb33e4fd7d62b04dfbfef65fcc35c24ce7afbb72",
}
const artifactProvenanceDigests = {
  v5: "787d8d1e7e4f734ea072c1e7516fd9cb36acb9eab0b87192c873ec0c10eabb43",
  v6: "3288cdad7e3a633c07873f255c52daa6bf6744831f81b3eeeb7340c12c75a312",
  v7: "cd8b08095c7410f7322bc51bd3ba68eeb084e1b0542ab35d8b26751694c65dec",
  v8: "a985f907fc9f2c5d8735c8918f1af6028efa9a3ed0f43b273612c592c2288444",
}
const descriptor = `${vendorRoot}/descriptor/platform-v1.binpb`
const descriptorDigest = "5f0f00f605f6a445b4d80943459b69bf9f489fd7851cc80b6c2700f8f78a8d0e"
const parentDescriptor = `${vendorRoot}/descriptor/platform-v8-parent39.binpb`
const parentDigest = "0467c1c45e8ac27c79cb906e27bfdb679d88739e45bfa38128f0f629bec686d5"
const output = path.join(root, "src/generated/platform-connect")
const manifestPath = path.join(root, "contract/dependencies/platform-connect.json")
const sourceDigests = {
  "kokoro/storage/v2/storage.proto": "02266d53b8bfb7fdd6991b17d59ebb17399d4f189b6a3135fedcb69b6b364276",
  "kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "kokoro/platform/v1/platform_runtime.proto": "c93ae886195d7c676d1bc2a3e99dcaa8013afdd7df304558a8ea0552ec0be7e4",
}
const directories = ["kokoro", "kokoro/common", "kokoro/common/v1", "kokoro/platform", "kokoro/platform/v1"]
const sourceDirectories = [...directories, "kokoro/storage", "kokoro/storage/v2"].sort()
const generationInputs = ["kokoro/common/v1/common.proto", "kokoro/platform/v1/platform_runtime.proto"]
const generatedFiles = ["kokoro/common/v1/common_pb.ts", "kokoro/platform/v1/platform_runtime_pb.ts"]
const versions = {
  "@bufbuild/buf": "1.72.0",
  "@bufbuild/protoc-gen-es": "2.14.0",
  "@bufbuild/protobuf": "2.14.0",
  "@connectrpc/connect": "2.2.0",
}
const configFiles = ["buf.platform.json", "buf.platform.gen.json"]

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

export function assertSourceDigests(sources) {
  assert.deepEqual(Object.keys(sources).sort(), Object.keys(sourceDigests).sort(), "Platform source allowlist drifted")
  for (const [file, digest] of Object.entries(sourceDigests)) assert.equal(sha256(sources[file]), digest, `Platform source digest drifted: ${file}`)
}

export function assertGeneratedTree(tree) {
  assert.deepEqual([...tree.files].sort(), generatedFiles, "Platform generated file allowlist drifted")
  assert.deepEqual([...tree.directories].sort(), directories, "Platform generated directory allowlist drifted")
}

export function assertVendorPins(entries) {
  assert.deepEqual(entries.map((entry) => entry.name).sort(), [ownerCommit], "Platform vendor commit allowlist drifted")
  assert.ok(entries[0]?.isDirectory(), "Platform vendor commit must be a real directory")
}

export function assertVendorLayout(entries) {
  assert.deepEqual(
    entries.map((entry) => entry.name).sort(),
    ["descriptor", "execution-operations-v5", "execution-operations-v6", "execution-operations-v7", "execution-operations-v8", "proto"],
    "Platform vendor layout allowlist drifted",
  )
  assert.ok(
    entries.every((entry) => entry.isDirectory()),
    "Platform vendor inputs must be real directories",
  )
}

async function tree(directory, prefix = "") {
  const result = { files: [], directories: [] }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      result.directories.push(relative)
      const child = await tree(path.join(directory, entry.name), relative)
      result.files.push(...child.files)
      result.directories.push(...child.directories)
    } else {
      assert.ok(entry.isFile(), `Platform artifact contains unsupported entry: ${relative}`)
      result.files.push(relative)
    }
  }
  return { files: result.files.sort(), directories: result.directories.sort() }
}

export function assertExecutionArtifact(provenance, files, expectedAggregate = artifactAggregates.v5) {
  assert.equal(provenance.aggregateSha256, expectedAggregate, "Platform artifact aggregate pin drifted")
  assert.deepEqual(Object.keys(files).sort(), provenance.files.map((entry) => entry.path).sort(), "Platform artifact file allowlist drifted")
  const records = []
  for (const entry of provenance.files) {
    const bytes = files[entry.path]
    assert.ok(bytes, `Platform artifact file missing: ${entry.path}`)
    assert.equal(bytes.length, entry.bytes, `Platform artifact byte length drifted: ${entry.path}`)
    assert.equal(sha256(bytes), entry.sha256, `Platform artifact digest drifted: ${entry.path}`)
    records.push(`${entry.path}\0${entry.bytes}\0${entry.sha256}\n`)
  }
  assert.equal(sha256(Buffer.from(records.join(""))), expectedAggregate, "Platform artifact aggregate drifted")
}

export async function verifyExecutionArtifactDirectory(directory, expectedAggregate = artifactAggregates.v5) {
  const provenanceBytes = await readFile(path.join(directory, "provenance.json"))
  const version = Object.keys(artifactAggregates).find((key) => artifactAggregates[key] === expectedAggregate)
  assert.ok(version, "Platform artifact aggregate not registered")
  assert.equal(sha256(provenanceBytes), artifactProvenanceDigests[version], "Platform provenance bytes drifted")
  const provenance = JSON.parse(provenanceBytes.toString("utf8"))
  const actual = await tree(directory)
  const expectedFiles = ["provenance.json", ...provenance.files.map((entry) => entry.path)].sort()
  const expectedDirectories = [
    ...new Set(
      provenance.files.flatMap((entry) => {
        const parts = entry.path.split("/").slice(0, -1)
        return parts.map((_, index) => parts.slice(0, index + 1).join("/"))
      }),
    ),
  ].sort()
  assert.deepEqual(actual.files, expectedFiles, "Platform artifact filesystem allowlist drifted")
  assert.deepEqual(actual.directories, expectedDirectories, "Platform artifact directory allowlist drifted")
  const files = Object.fromEntries(await Promise.all(provenance.files.map(async (entry) => [entry.path, await readFile(path.join(directory, entry.path))])))
  assertExecutionArtifact(provenance, files, expectedAggregate)
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))
  return { files, manifest }
}

export function assertProofChain(v5, v6, v7, v8) {
  assert.deepEqual(
    v8,
    {
      artifact: "platform-execution-operations",
      artifactVersion: "8.0.0",
      status: "inactive",
      routable: false,
      packageName: "kokoro.platform.v1",
      inherits: { version: "7.0.0", aggregateSha256: artifactAggregates.v7 },
      counts: { rpc: 43, command: 20, proof: 24 },
      profile: "personal-mcp-read-v1",
    },
    "Platform v8 proof drifted",
  )
  assert.deepEqual(
    {
      artifact: v5.artifact,
      artifactVersion: v5.artifactVersion,
      status: v5.status,
      routable: v5.routable,
    },
    {
      artifact: "platform-execution-operations",
      artifactVersion: "5.0.1",
      status: "inactive",
      routable: false,
    },
  )
  assert.equal(v5.inventories.operations, 39, "Platform operation inventory drifted")
  assert.equal(v5.inventories.readBindings, 1, "Platform Get read binding inventory drifted")
  assert.equal(v5.inventories.bindings, 24, "Platform request binding inventory drifted")
  assert.equal(v5.inventories.commandIdentities, 20, "Platform command identity inventory drifted")
  assert.equal(v5.inventories.productCommands, 3, "Platform product command inventory drifted")
  assert.equal(v5.inventories.safeFields, 9, "Platform safe projection inventory drifted")
  assert.equal(v5.baseArtifact.aggregateSha256, "902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79", "Platform v4 base artifact pin drifted")
  assert.deepEqual(
    {
      artifact: v6.artifact,
      artifactVersion: v6.artifactVersion,
      status: v6.status,
      routable: v6.routable,
      inherits: v6.inherits,
      counts: v6.counts,
    },
    {
      artifact: "platform-execution-operations",
      artifactVersion: "6.0.0",
      status: "inactive",
      routable: false,
      inherits: { version: "5.0.1", aggregateSha256: artifactAggregates.v5 },
      counts: { rpc: 39, command: 20, proof: 24 },
    },
    "Platform v6 proof drifted",
  )
  assert.deepEqual(
    v6.sourcePins,
    [
      { path: "contract/proto/kokoro/platform/v1/platform_runtime.proto", sha256: "2e1c0d19b986b43f05efd5ab8c2e9800d7b9f6785e93e25780006ae19007b502" },
      { path: "contract/descriptor/platform-v1.binpb", sha256: "ae2683134d6b780a003c9c485177fbab06632ecbfaeeb548f96fc440f2b2048c" },
      { path: "contract/provenance.json", sha256: "1f04cc50707d075893ff0e95e5c25f5a686d1206be26f67ce86ffe3f38bb696c" },
      { path: "src/generated/proto/kokoro/platform/v1/platform_runtime_pb.ts", sha256: "a8e5124e38f8bff1aa3838f9bec0e0e1f70f894b30161675b0f5f6b6308d1c7f" },
      { path: "contract/openapi/platform-http.openapi.json", sha256: "4b42dd161c972b3447cfea3a6f80a949bbdb573c46213dbf8ef4c3ecb58e72da" },
    ],
    "Platform v6 source pins drifted",
  )
  assert.deepEqual(
    {
      artifact: v7.artifact,
      artifactVersion: v7.artifactVersion,
      status: v7.status,
      routable: v7.routable,
      inherits: v7.inherits,
      counts: v7.counts,
      profile: v7.profile,
    },
    {
      artifact: "platform-execution-operations",
      artifactVersion: "7.0.0",
      status: "inactive",
      routable: false,
      inherits: { version: "6.0.0", aggregateSha256: artifactAggregates.v6 },
      counts: { rpc: 39, command: 20, proof: 24 },
      profile: "zip-v2",
    },
    "Platform v7 proof drifted",
  )
}

function assertV5Product(files) {
  const product = JSON.parse(files["product-installation-v1.json"].toString("utf8"))
  assert.equal(product.productVersion, "product-personal-installation/1.0.0")
  assert.equal(product.requests.length, 5)
  assert.equal(product.safeProjection.fields.length, 9)
}

export function assertPublishedDescriptors(currentBytes, parentBytes, files) {
  assert.equal(sha256(currentBytes), descriptorDigest, "Platform descriptor digest drifted")
  assert.equal(sha256(parentBytes), parentDigest, "Platform parent descriptor digest drifted")
  const current = fromBinary(FileDescriptorSetSchema, currentBytes)
  const parent = fromBinary(FileDescriptorSetSchema, parentBytes)
  const currentFile = current.file.find((file) => file.package === "kokoro.platform.v1")
  const parentFile = parent.file.find((file) => file.package === "kokoro.platform.v1")
  assert.ok(currentFile && parentFile, "Platform descriptor file missing")
  assert.equal(currentFile.service.flatMap((service) => service.method).length, 43)
  const methods = ["ListPersonalMcpConnectors", "GetPersonalMcpConnector", "ListPersonalMcpConnections", "GetPersonalMcpConnection"]
  const service = currentFile.service.find((entry) => entry.name === "ProductMcpPersonalService")
  assert.deepEqual(
    service?.method.map((method) => method.name),
    methods,
    "Platform personal methods drifted",
  )
  for (const method of service.method) {
    assert.equal(method.clientStreaming, false)
    assert.equal(method.serverStreaming, false)
  }
  const additions = [
    ...methods.flatMap((method) => [`${method}Request`, `${method}Response`]),
    "PersonalMcpPageRequest",
    "PersonalMcpConnector",
    "PersonalMcpConnection",
  ]
  assert.equal(currentFile.messageType.filter((message) => additions.includes(message.name)).length, 11)
  const catalog = JSON.parse(files["operation-catalog.json"].toString("utf8"))
  assert.deepEqual(
    catalog.operations.filter((entry) => entry.fqMethod === "kokoro.platform.v1.SkillCatalogService/GetSkillPackageUpload"),
    [
      {
        class: "workload-only",
        fqMethod: "kokoro.platform.v1.SkillCatalogService/GetSkillPackageUpload",
        operation: "skill.get_package_upload",
        proof: "forbidden",
        permission: "platform:skill-catalog.manage",
        idempotency: "none",
      },
    ],
    "Platform Get catalog semantics drifted",
  )
  for (const file of [parentFile, currentFile]) {
    const method = file.service.find((entry) => entry.name === "SkillCatalogService")?.method.find((entry) => entry.name === "GetSkillPackageUpload")
    assert.ok(method && !method.clientStreaming && !method.serverStreaming, "Platform Get method drifted")
    assert.equal(method.inputType, ".kokoro.platform.v1.GetSkillPackageUploadRequest")
    assert.equal(method.outputType, ".kokoro.platform.v1.GetSkillPackageUploadResponse")
    const request = file.messageType.find((entry) => entry.name === "GetSkillPackageUploadRequest")
    assert.deepEqual(
      request?.field.map((field) => [field.name, field.number, field.type, field.typeName]),
      [
        ["request_id", 1, 9, ""],
        ["skill_id", 2, 11, ".kokoro.platform.v1.SkillId"],
        ["product_context", 3, 11, ".kokoro.platform.v1.ProductCatalogContext"],
      ],
      "Platform Get request descriptor drifted",
    )
    const response = file.messageType.find((entry) => entry.name === "GetSkillPackageUploadResponse")
    assert.deepEqual(
      response?.field.map((field) => [field.name, field.number, field.type, field.proto3Optional]),
      [
        ["skill_id", 1, 11, false],
        ["attempt_id", 2, 9, true],
        ["attempt_epoch", 3, 4, false],
        ["phase", 4, 14, false],
        ["upload_id", 5, 9, true],
      ],
      "Platform Get response descriptor drifted",
    )
  }
  currentFile.service = currentFile.service.filter((entry) => entry.name !== "ProductMcpPersonalService")
  currentFile.messageType = currentFile.messageType.filter((entry) => !additions.includes(entry.name))
  assert.deepEqual(
    Buffer.from(toBinary(FileDescriptorSetSchema, current)),
    Buffer.from(toBinary(FileDescriptorSetSchema, parent)),
    "Platform parent39 structure drifted",
  )
}

async function verifyExecutionArtifacts() {
  const v5 = await verifyExecutionArtifactDirectory(path.join(root, artifacts.v5), artifactAggregates.v5)
  const v6 = await verifyExecutionArtifactDirectory(path.join(root, artifacts.v6), artifactAggregates.v6)
  const v7 = await verifyExecutionArtifactDirectory(path.join(root, artifacts.v7), artifactAggregates.v7)
  const v8 = await verifyExecutionArtifactDirectory(path.join(root, artifacts.v8), artifactAggregates.v8)
  assertProofChain(v5.manifest, v6.manifest, v7.manifest, v8.manifest)
  const personalVectors = JSON.parse(v8.files["vectors/personal-mcp-read.json"].toString("utf8")).vectors
  assert.equal(personalVectors.length, 190)
  assert.equal(new Set(personalVectors.map((entry) => entry.id)).size, 190)
  assertPublishedDescriptors(await readFile(path.join(root, descriptor)), await readFile(path.join(root, parentDescriptor)), v5.files)
  const descriptorTree = await tree(path.join(root, vendorRoot, "descriptor"))
  assert.deepEqual(descriptorTree, { files: ["platform-v1.binpb", "platform-v8-parent39.binpb"], directories: [] }, "Platform descriptor tree drifted")
  assertV5Product(v5.files)
  const profile = JSON.parse(v7.files["zip-profile-v2.json"].toString("utf8"))
  assert.deepEqual(profile.manifestKeys, ["schema_version", "entry"], "Platform V2 manifest key set drifted")
  assert.equal(profile.manifestSchemaVersion, 2, "Platform V2 manifest schema drifted")
  assert.equal(profile.manifestEntry, "SKILL.md", "Platform V2 entry drifted")
  assert.equal(profile.manifestIdentity, "zip-v2:sha256:<64 lowercase hex SHA256 of raw decompressed manifest bytes>")
  const vectors = JSON.parse(v7.files["vectors/zip-v2.json"].toString("utf8")).vectors
  assert.match(vectors.find(({ name }) => name === "valid-v2")?.manifestIdentity ?? "", /^zip-v2:sha256:[a-f0-9]{64}$/u)
  assert.equal(vectors.find(({ name }) => name === "legacy-v1-rejected")?.expectedReason, "package_manifest_invalid")
  assert.equal(sha256(await readFile(path.join(root, descriptor))), descriptorDigest, "Platform descriptor digest drifted")
}

async function verifyInputs() {
  await verifyExecutionArtifacts()
  assertVendorPins(await readdir(path.join(root, "contract/vendor/kokoro-platform"), { withFileTypes: true }))
  assertVendorLayout(await readdir(path.join(root, "contract/vendor/kokoro-platform", ownerCommit), { withFileTypes: true }))
  assert.equal(process.versions.node, "22.22.2", "Platform consumer generation requires pinned Node 22.22.2")
  assert.equal(await readFile(path.join(root, ".node-version"), "utf8"), "22.22.2\n")
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
  assert.equal(packageJson.packageManager, "pnpm@11.25.0")
  for (const [name, version] of Object.entries({
    ...versions,
    prettier: "3.9.6",
    typescript: "5.9.3",
  })) {
    assert.equal(packageJson.dependencies[name] ?? packageJson.devDependencies[name], version, `${name} manifest version`)
    const installed = JSON.parse(await readFile(path.join(root, "node_modules", name, "package.json"), "utf8"))
    assert.equal(installed.version, version, `${name} installed version`)
  }
  const sources = await tree(path.join(root, vendor))
  assert.deepEqual(sources.directories, sourceDirectories, "Platform source directory allowlist drifted")
  assertSourceDigests(Object.fromEntries(await Promise.all(sources.files.map(async (file) => [file, await readFile(path.join(root, vendor, file))]))))
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, configFiles[0]), "utf8")),
    { version: "v2", modules: [{ path: vendor }] },
    "Buf input config drifted",
  )
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, configFiles[1]), "utf8")),
    {
      version: "v2",
      plugins: [
        {
          local: "node_modules/.bin/protoc-gen-es",
          out: ".",
          opt: ["target=ts", "import_extension=js"],
        },
      ],
    },
    "Buf generator config drifted",
  )
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    })
    child.once("error", reject)
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`))))
  })
}

async function generate(directory) {
  await run(path.join(root, "node_modules/.bin/buf"), [
    "generate",
    "--config",
    configFiles[0],
    "--template",
    configFiles[1],
    "--output",
    directory,
    ...generationInputs.flatMap((file) => ["--path", `${vendor}/${file}`]),
  ])
  assertGeneratedTree(await tree(directory))
  await run(process.execPath, [path.join(root, "node_modules/prettier/bin/prettier.cjs"), "--no-semi", "--print-width", "160", "--write", directory])
}

async function manifestFor(directory) {
  return {
    schema_version: 1,
    status: "generated-not-activated",
    owner: {
      repository_path: "apps/kokoro-capability",
      repository_commit: ownerCommit,
      package_name: "kokoro.platform.v1",
      sources: Object.entries(sourceDigests).map(([file, digest]) => ({
        path: `contract/proto/${file}`,
        sha256: digest,
      })),
    },
    execution_artifact: {
      path: artifacts.v8,
      artifact_version: "8.0.0",
      status: "inactive",
      routable: false,
      provenance_path: `${artifacts.v8}/provenance.json`,
      aggregate_sha256: artifactAggregates.v8,
    },
    execution_proof_chain: [
      {
        path: artifacts.v8,
        artifact_version: "8.0.0",
        aggregate_sha256: artifactAggregates.v8,
        inherits_version: "7.0.0",
        inherits_aggregate_sha256: artifactAggregates.v7,
      },
      {
        path: artifacts.v7,
        artifact_version: "7.0.0",
        aggregate_sha256: artifactAggregates.v7,
        inherits_version: "6.0.0",
        inherits_aggregate_sha256: artifactAggregates.v6,
      },
      {
        path: artifacts.v6,
        artifact_version: "6.0.0",
        aggregate_sha256: artifactAggregates.v6,
        inherits_version: "5.0.1",
        inherits_aggregate_sha256: artifactAggregates.v5,
      },
      {
        path: artifacts.v5,
        artifact_version: "5.0.1",
        aggregate_sha256: artifactAggregates.v5,
      },
    ],
    descriptor: {
      path: descriptor,
      sha256: descriptorDigest,
    },
    parent_descriptor: { path: parentDescriptor, sha256: parentDigest },
    generator: {
      packages: versions,
      configs: await Promise.all(
        configFiles.map(async (file) => ({
          path: file,
          sha256: sha256(await readFile(path.join(root, file))),
        })),
      ),
      script_sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
      formatting: {
        package: "prettier",
        version: "3.9.6",
        semi: false,
        print_width: 160,
      },
    },
    dependency_decision: {
      verified_on: "2026-10-05",
      approach:
        "Reuse the published owner's exact Buf/Protobuf-ES/Connect versions; no floating upgrade. Protobuf-ES v2 emits service descriptors consumed by Connect createClient.",
      alternatives:
        "Handwritten DTO/RPC serializers duplicate the owner contract; copying owner runtime/generated files lacks an independent reproducible consumer generation chain.",
      licenses: "Buf, Protobuf-ES and Connect-ES: Apache-2.0",
      supply_chain: "Exact package versions and lock integrity; local generation without remote plugins; only @bufbuild/buf install build is newly allowed.",
      performance: "No network calls or application startup added. Runtime performance is unmeasured; this slice validates descriptor serialization only.",
      failure_semantics:
        "Generation rejects source/config/package/tree/digest drift. The fixed V8 to V7 to V6 to V5 proof chain, descriptor, current Proto source and Get read binding fail closed; runtime adapter admits current user before Platform Connect.",
      exit_path: "Regenerate from the pinned owner Proto with a reviewed compatible generator; generated wire types remain isolated from business code.",
      sources: ["https://connectrpc.com/docs/node/getting-started/", "https://github.com/bufbuild/protobuf-es/releases/tag/v2.14.0"],
    },
    runtime: { node: "22.22.2", pnpm: "11.25.0", typescript: "5.9.3" },
    lockfile_sha256: sha256(await readFile(path.join(root, "pnpm-lock.yaml"))),
    build_policy_sha256: sha256(await readFile(path.join(root, "pnpm-workspace.yaml"))),
    generated: await Promise.all(
      generatedFiles.map(async (file) => ({
        path: file,
        sha256: sha256(await readFile(path.join(directory, file))),
      })),
    ),
  }
}

async function main() {
  const mode = process.argv[2]
  assert.ok(mode === "--write" || mode === "--check", "expected --write or --check")
  await verifyInputs()
  const temporary = await mkdtemp(path.join(tmpdir(), "kokoro-platform-connect-"))
  try {
    const first = path.join(temporary, "first")
    const second = path.join(temporary, "second")
    await generate(first)
    await generate(second)
    for (const file of generatedFiles)
      assert.deepEqual(await readFile(path.join(first, file)), await readFile(path.join(second, file)), `non-deterministic generation: ${file}`)
    const manifest = await manifestFor(first)
    if (mode === "--write") {
      await rm(output, { recursive: true, force: true })
      await cp(first, output, { recursive: true })
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    } else {
      assertGeneratedTree(await tree(output))
      for (const file of generatedFiles)
        assert.deepEqual(await readFile(path.join(output, file)), await readFile(path.join(first, file)), `generated file drifted: ${file}`)
      assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), manifest, "Platform dependency manifest drifted")
    }
    console.log(
      `PASS Platform Connect ${mode.slice(2)} (${generatedFiles.length} files, two byte-identical generations; fixed v8.0.0 -> v7.0.0 -> v6.0.0 -> v5.0.1 proof; consumer activation remains gated)`,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
