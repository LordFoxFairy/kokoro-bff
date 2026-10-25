import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ownerCommit = "7d8115a4b0dc752687babe7db35d0a936f51c76a"
const vendorRoot = `contract/vendor/kokoro-platform/${ownerCommit}`
const vendorProto = `${vendorRoot}/proto`
const output = "src/generated/platform-connect"
const manifestPath = "contract/dependencies/platform-connect.json"

const sourceDigests = {
  "kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "kokoro/platform/v1/platform_runtime.proto": "e406e4b0d637f2e1a6736741482c71d6a2285ff36a67db12c68284d9e49e52f6",
  "kokoro/storage/v3/storage.proto": "b84a2fb1fd9c6e8c16e15a29cafbc33de670f40f703f3f33ef27652a0237a629",
  "kokoro/platform/v1/mcp_package_admin.proto": "60b6778cbb3024f09184bbfc1e06e124191a6583ad892e48e0bcb3c4d0667b31",
}
const artifactDigests = {
  "execution-operations/mcp-icon-request-vectors-v1.json": "b906cba768889bf09a5bc9455153f6ea39c63c9396c14fa775aef09be9a28435",
  "execution-operations/mcp-icon-v1.json": "a6dd6d0bfe134c3c46b8c5fd442a7a7d1715c22ce6cea272148c50192e04504c",
  "execution-operations/app-skill-binding-v1.json": "c09cc0d07f5604e622042ec5ab7cbf917f8db8d57036a95c464213ec8fc90a11",
  "execution-operations/mcp-personal-product-v1.json": "b996af5f1897fb97c78f1f41e522e6b99af885c8319200a50a6a0865e19b34d0",
  "execution-operations/mcp-availability-v1.json": "44202f4b491d90414775654fdcfa0538fa5e1ce7585713040c8b7a8052d65e63",
  "execution-operations/project-skill-installation-v1.json": "1a0716883ad0c9136af002671afd9319872af8c93c3b7873d1d2149dc564a416",
  "errors/command-receipt-v1.json": "d82a4b30039adc0754fe1bcc43738fc68be2cd3cbef0e710d14089f55bc0ac68",
  "auth/bff-service-auth-v1.json": "4a6db18267a2a61e2b3582ece3a8bfae391db58280f06397125332ccaa97f0ef",
  "execution-operations/skill-installation-update-v1.json": "9b75d679665f42eb48d89e9c6fe99c39f2f019894db4a54de15e9f97622dd194",
  "descriptor/platform-v1.binpb": "81ae8a8c825b87b82b21b7892f7f9bb7a3b70bb3294e4a62d39d72dc34b428a5",
  "execution-operations/custom-api-v1.json": "eca45ebd0f3c31d48cc174256dc23bda22de288ded91aa12198b1a2a37516a38",
  "execution-operations/mcp-private-server-v1.json": "c3246a5d88b79f1358205e67658570bf6ced4b805fb414b3016f816e88dbc92a",
  "provenance.json": "157b21b188b867938a629b2d6bfec817496ba3bcd18ff497ed16c7c3a1810516",
  "execution-operations/skill-acquisition-v1.json": "7c9cf9ed456199d4acd3d25f29154c8f098ed8866554476d37f058add0d78028",
  "openapi/platform-http.openapi.json": "3a187ad6e98b1824cf8d8e50c80218e77c7f14f4eb2a5cfcfe8d4be97c677a08",
  "mcp-package-admin/v1/profile.json": "d4b29dba0a5a6df8a0f36a654fcb81d5e95381568c0f5afd0bd104984366be75",
  "mcp-package-admin/v1/request-vectors.json": "2b12df83a21bec6c033d6a2a6a6db0931c47aa34af2c35abbc9eb7c7d159d62e",
  "descriptor/mcp-package-admin-v1.binpb": "847caf55170d2a0779e78c19a5d4bd61e6de397e6c873794c3e2811ddc4467f5",
  "execution-operations/skill-publication-precondition-v1.json": "9e4434d3786c8a8a40edc75e0733367e731cf2458eeb6f036f85f3256c4b6fcd",
  "execution-operations/skill-publication-precondition-v1.vectors.json": "f995955cf5fb79ba5067b34fd7b46011692bf584aade7b956fb4b423e3b9a055",
  "execution-operations/skill-series-delete-v1.json": "d1d12d52a244cb4abba87ed04d5480e5c6db3a2653d1b2b07be91d6a3576a1c3",
}
// Independently pinned committed publication profile; the existing broad bundle remains unchanged.
const publicationOwnerCommit = "dd8d536a28059cbdbe0674debc47bf28d039fb47"
const publicationVendor = `contract/vendor/kokoro-platform/${publicationOwnerCommit}`
const publicationDigests = {
  "publication-provenance.json": "10f9d0846ad4cd3c5a1b057e86c4a7aa4db523ecd7b4325847962269454349bb",
  "descriptor/mcp-project-publication-v1.binpb": "ddd31dbb7577769c80cb5b8f3ff5fd6bd697455f1e50a2a95c537d365669a152",
  "mcp-project-publication/v1/profile.json": "be466c6bd54eb5abfb288042d53b97595217e6c5b33d7048552048cbb1020b19",
  "mcp-project-publication/v1/request-vectors.json": "ced732040fa1e25193844c97a70fdd8530a96c548ebad19b9df9835478611fc5",
  "proto/kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "proto/kokoro/platform/v1/mcp_project_publication.proto": "d27615eed4df8988ce3fa1dea120a76723b1b23559847ab0cb6cd962320226ba",
}
async function verifyPublication() {
  assert.deepEqual((await tree(path.join(root, publicationVendor))).files, Object.keys(publicationDigests).sort(), "publication allowlist drifted")
  for (const [file, digest] of Object.entries(publicationDigests))
    assert.equal(sha256(await readFile(path.join(root, publicationVendor, file))), digest, `publication artifact drifted: ${file}`)
}

const provenanceCombinedSha256 = "bba02331dc06e30fddeeded02a40d5d5730671b86ab6bcc94b5e272ba7c1224e"
const ownerGenerated = {
  path: "src/generated/proto/kokoro/platform/v1/platform_runtime_pb.ts",
  sha256: "e73a4ca8241ec2ee06822a7987957b3433b43ce7e3c761723a465acf9df7817b",
}
const generatedFiles = [
  "command-receipt-errors.ts",
  "kokoro/common/v1/common_pb.ts",
  "kokoro/platform/v1/mcp_package_admin_pb.ts",
  "kokoro/platform/v1/mcp_project_publication_pb.ts",
  "kokoro/platform/v1/platform_runtime_pb.ts",
  "kokoro/storage/v3/storage_pb.ts",
]
const generatedDirectories = ["kokoro", "kokoro/common", "kokoro/common/v1", "kokoro/platform", "kokoro/platform/v1", "kokoro/storage", "kokoro/storage/v3"]
const configFiles = ["buf.platform.json", "buf.platform.gen.json"]

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function assertGeneratedTree(tree) {
  assert.deepEqual(tree.files, generatedFiles, "Platform generated file allowlist drifted")
  assert.deepEqual(tree.directories, generatedDirectories, "Platform generated directory allowlist drifted")
}

function assertSourceDigests(sources) {
  assert.deepEqual(Object.keys(sources).sort(), Object.keys(sourceDigests).sort(), "Platform source allowlist drifted")
  for (const [file, digest] of Object.entries(sourceDigests)) {
    assert.equal(sha256(sources[file]), digest, `Platform source digest drifted: ${file}`)
  }
}

function assertArtifactDigests(artifacts) {
  assert.deepEqual(Object.keys(artifacts).sort(), Object.keys(artifactDigests).sort(), "Platform artifact allowlist drifted")
  for (const [file, digest] of Object.entries(artifactDigests)) {
    assert.equal(sha256(artifacts[file]), digest, `Platform artifact digest drifted: ${file}`)
  }
  assert.equal(JSON.parse(artifacts["provenance.json"].toString("utf8")).combinedSha256, provenanceCombinedSha256, "Platform provenance drifted")
}

function assertVendorLayout(tree) {
  assert.deepEqual(
    tree,
    {
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
      files: [...Object.keys(artifactDigests), ...Object.keys(sourceDigests).map((file) => `proto/${file}`)].sort(),
    },
    "Platform vendor must contain only current v1 inputs",
  )
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`))))
  })
}

async function tree(directory, prefix = "") {
  const files = []
  const directories = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      directories.push(relative)
      const nested = await tree(path.join(directory, entry.name), relative)
      files.push(...nested.files)
      directories.push(...nested.directories)
    } else {
      assert.ok(entry.isFile(), `unsupported Platform vendor entry: ${relative}`)
      files.push(relative)
    }
  }
  return { directories: directories.sort(), files: files.sort() }
}

async function readSources() {
  return Object.fromEntries(await Promise.all(Object.keys(sourceDigests).map(async (file) => [file, await readFile(path.join(root, vendorProto, file))])))
}

async function readArtifacts() {
  return Object.fromEntries(await Promise.all(Object.keys(artifactDigests).map(async (file) => [file, await readFile(path.join(root, vendorRoot, file))])))
}

async function verifyInputs() {
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, "buf.platform.json"), "utf8")),
    {
      version: "v2",
      modules: [{ path: vendorProto }],
    },
    "Platform Buf module must use the current pinned owner source",
  )
  assertSourceDigests(await readSources())
  assertArtifactDigests(await readArtifacts())
  assertVendorLayout(await tree(path.join(root, vendorRoot)))
}

async function generate(directory) {
  await run(path.join(root, "node_modules/.bin/buf"), ["generate", "--template", "buf.platform.gen.json", "--output", directory, vendorProto])
  await run(path.join(root, "node_modules/.bin/buf"), [
    "generate",
    "--config",
    JSON.stringify({ version: "v2", modules: [{ path: `${publicationVendor}/proto` }] }),
    "--template",
    "buf.platform.gen.json",
    "--output",
    directory,
    `${publicationVendor}/proto`,
    "--path",
    `${publicationVendor}/proto/kokoro/platform/v1/mcp_project_publication.proto`,
  ])
  const receipt = JSON.parse(await readFile(path.join(root, vendorRoot, "errors/command-receipt-v1.json"), "utf8"))
  assert.equal(receipt.profile, "platform-command-receipt-errors")
  assert.equal(receipt.version, "1.0.0")
  assert.equal(receipt.header, "x-kokoro-error-code")
  assert.equal(receipt.automatic_retries, false)
  assert.equal(receipt.new_command_authorized, false)
  await writeFile(
    path.join(directory, "command-receipt-errors.ts"),
    `// Generated from the pinned Platform receipt error profile; do not edit.\nexport const PLATFORM_COMMAND_RECEIPT_ERRORS = ${JSON.stringify(receipt.failures)} as const;\n`,
  )
  assertGeneratedTree(await tree(directory))
  await run(process.execPath, [path.join(root, "node_modules/prettier/bin/prettier.cjs"), "--no-semi", "--print-width", "160", "--write", directory])
}

async function manifestFor(directory) {
  return {
    schema_version: 1,
    status: "generated",
    owner: {
      repository_path: "apps/kokoro-capability",
      repository_commit: ownerCommit,
      package_name: "kokoro.platform.v1",
      sources: Object.entries(sourceDigests).map(([file, digest]) => ({ path: `contract/proto/${file}`, sha256: digest })),
      artifacts: [
        { path: "contract/execution-operations/mcp-icon-v1.json", sha256: artifactDigests["execution-operations/mcp-icon-v1.json"] },
        {
          path: "contract/execution-operations/mcp-icon-request-vectors-v1.json",
          sha256: artifactDigests["execution-operations/mcp-icon-request-vectors-v1.json"],
        },
        { path: "contract/execution-operations/app-skill-binding-v1.json", sha256: artifactDigests["execution-operations/app-skill-binding-v1.json"] },
        { path: "contract/execution-operations/skill-series-delete-v1.json", sha256: artifactDigests["execution-operations/skill-series-delete-v1.json"] },
        {
          path: "contract/execution-operations/skill-publication-precondition-v1.json",
          sha256: artifactDigests["execution-operations/skill-publication-precondition-v1.json"],
        },
        {
          path: "contract/execution-operations/skill-publication-precondition-v1.vectors.json",
          sha256: artifactDigests["execution-operations/skill-publication-precondition-v1.vectors.json"],
        },
        { path: "contract/errors/command-receipt-v1.json", sha256: artifactDigests["errors/command-receipt-v1.json"] },
        { path: "contract/auth/bff-service-auth-v1.json", sha256: artifactDigests["auth/bff-service-auth-v1.json"] },
        {
          path: "contract/execution-operations/skill-installation-update-v1.json",
          sha256: artifactDigests["execution-operations/skill-installation-update-v1.json"],
        },
        { path: "contract/execution-operations/custom-api-v1.json", sha256: artifactDigests["execution-operations/custom-api-v1.json"] },
        { path: "contract/execution-operations/mcp-private-server-v1.json", sha256: artifactDigests["execution-operations/mcp-private-server-v1.json"] },
        { path: "contract/descriptor/platform-v1.binpb", sha256: artifactDigests["descriptor/platform-v1.binpb"] },
        { path: "contract/execution-operations/skill-acquisition-v1.json", sha256: artifactDigests["execution-operations/skill-acquisition-v1.json"] },
        {
          path: "contract/execution-operations/project-skill-installation-v1.json",
          sha256: artifactDigests["execution-operations/project-skill-installation-v1.json"],
        },
        { path: "contract/openapi/platform-http.openapi.json", sha256: artifactDigests["openapi/platform-http.openapi.json"] },
        { path: "contract/mcp-package-admin/v1/profile.json", sha256: artifactDigests["mcp-package-admin/v1/profile.json"] },
        { path: "contract/mcp-package-admin/v1/request-vectors.json", sha256: artifactDigests["mcp-package-admin/v1/request-vectors.json"] },
        { path: "contract/descriptor/mcp-package-admin-v1.binpb", sha256: artifactDigests["descriptor/mcp-package-admin-v1.binpb"] },
        { path: "contract/execution-operations/mcp-personal-product-v1.json", sha256: artifactDigests["execution-operations/mcp-personal-product-v1.json"] },
        { path: "contract/execution-operations/mcp-availability-v1.json", sha256: artifactDigests["execution-operations/mcp-availability-v1.json"] },
      ],
      provenance: {
        path: "contract/provenance.json",
        sha256: artifactDigests["provenance.json"],
        combined_sha256: provenanceCombinedSha256,
      },
      generated: ownerGenerated,
    },
    publication: {
      status: "published-owner-contract",
      repository_path: "apps/kokoro-capability",
      repository_commit: publicationOwnerCommit,
      base_commit: ownerCommit,
      profile: "mcp-project-publication-v1",
      version: "1.0.0",
      runtime_binding_implemented: false,
      vendor: publicationVendor,
      inputs: publicationDigests,
      owner_generated_sha256: "a12957ded3c52e7276cee93d2cbe5788fbd0a1b92a518882991ab3421dd0fb1d",
    },
    generator: {
      packages: { "@bufbuild/buf": "1.72.0", "@bufbuild/protobuf": "2.14.0", "@connectrpc/connect": "2.2.0", "protoc-gen-es": "2.14.0" },
      configs: await Promise.all(configFiles.map(async (file) => ({ path: file, sha256: sha256(await readFile(path.join(root, file))) }))),
      script_sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    },
    generated: await Promise.all(generatedFiles.map(async (file) => ({ path: file, sha256: sha256(await readFile(path.join(directory, file))) }))),
    lockfile_sha256: sha256(await readFile(path.join(root, "pnpm-lock.yaml"))),
  }
}

async function main() {
  const mode = process.argv[2]
  assert.ok(mode === "--write" || mode === "--check", "expected --write or --check")
  await verifyInputs()
  await verifyPublication()
  const temporary = await mkdtemp(path.join(tmpdir(), "kokoro-platform-connect-"))
  try {
    await writeFile(path.join(temporary, "package.json"), '{"type":"module"}\n')
    await symlink(path.join(root, "node_modules"), path.join(temporary, "node_modules"), "dir")
    const first = path.join(temporary, "first")
    const second = path.join(temporary, "second")
    await generate(first)
    await generate(second)
    for (const file of generatedFiles) {
      assert.deepEqual(await readFile(path.join(first, file)), await readFile(path.join(second, file)), `non-deterministic generation: ${file}`)
    }
    const manifest = await manifestFor(first)
    if (mode === "--write") {
      await rm(path.join(root, output), { recursive: true, force: true })
      await cp(first, path.join(root, output), { recursive: true })
      await writeFile(path.join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`)
    } else {
      assertGeneratedTree(await tree(path.join(root, output)))
      for (const file of generatedFiles) {
        assert.deepEqual(await readFile(path.join(root, output, file)), await readFile(path.join(first, file)), `generated file drifted: ${file}`)
      }
      assert.deepEqual(JSON.parse(await readFile(path.join(root, manifestPath), "utf8")), manifest, "Platform dependency manifest drifted")
    }
    console.log(`PASS Platform Connect ${mode.slice(2)} (${generatedFiles.length} files, current v1 owner contract)`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export {
  artifactDigests,
  assertArtifactDigests,
  assertGeneratedTree,
  assertSourceDigests,
  assertVendorLayout,
  ownerCommit,
  ownerGenerated,
  provenanceCombinedSha256,
  sourceDigests,
}

if (process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
