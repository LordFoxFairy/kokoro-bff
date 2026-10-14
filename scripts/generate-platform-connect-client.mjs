import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ownerCommit = "8201c7ce60643ae27a633b3c15b471b0db493c38"
const vendorRoot = `contract/vendor/kokoro-platform/${ownerCommit}`
const vendorProto = `${vendorRoot}/proto`
const output = "src/generated/platform-connect"
const manifestPath = "contract/dependencies/platform-connect.json"

const sourceDigests = {
  "kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "kokoro/platform/v1/platform_runtime.proto": "cbbc358da911392dfbb394cdfa08a77b69ce0a470ed253b423abf735ee0e6b1d",
  "kokoro/storage/v3/storage.proto": "1021e603065978871c51519ddba5b23c9b97f16b781a08bd98e019b3342bf5f9",
}
const artifactDigests = {
  "descriptor/platform-v1.binpb": "29eb1087c72badc9d8b50a37a875eaff2ade3de7ce947dbaead697178afbac5e",
  "execution-operations/mcp-private-server-v1.json": "6e5266d4c227f13ccfe61efdcb6b08b6bafab40e855ec12624b9a27f83d3e3ca",
  "provenance.json": "e732dfd134a82457101442e44901ecbf9db146cc44b339b9cf02a420dad47f8d",
}
const provenanceCombinedSha256 = "1a1a897aa4e91981a773ef0474d7828da89122cfdb0fa41e682cda44f8030d3c"
const ownerGenerated = {
  path: "src/generated/proto/kokoro/platform/v1/platform_runtime_pb.ts",
  sha256: "9c30195b8a56f93689ef23beec8dda4c07d3e4b723e074807dfedef9bec7c58a",
}
const generatedFiles = ["kokoro/common/v1/common_pb.ts", "kokoro/platform/v1/platform_runtime_pb.ts", "kokoro/storage/v3/storage_pb.ts"]
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
  assertSourceDigests(await readSources())
  assertArtifactDigests(await readArtifacts())
  assertVendorLayout(await tree(path.join(root, vendorRoot)))
}

async function generate(directory) {
  await run(path.join(root, "node_modules/.bin/buf"), ["generate", "--template", "buf.platform.gen.json", "--output", directory, vendorProto])
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
        { path: "contract/execution-operations/mcp-private-server-v1.json", sha256: artifactDigests["execution-operations/mcp-private-server-v1.json"] },
        { path: "contract/descriptor/platform-v1.binpb", sha256: artifactDigests["descriptor/platform-v1.binpb"] },
      ],
      provenance: {
        path: "contract/provenance.json",
        sha256: artifactDigests["provenance.json"],
        combined_sha256: provenanceCombinedSha256,
      },
      generated: ownerGenerated,
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
