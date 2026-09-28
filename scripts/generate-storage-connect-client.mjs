import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ownerCommit = "094847da9f4f03e5f3dbda06658430c74bc32f54"
const vendor = `contract/vendor/kokoro-storage/${ownerCommit}/proto`
const output = path.join(root, "src/generated/storage-connect")
const manifestPath = path.join(root, "contract/dependencies/storage-connect.json")
const sourceDigests = {
  "kokoro/common/v1/common.proto": "4604725ec7d5896c9d74b53c6f06d19b20ee758d5ab9e1cb90177ede95bba9fd",
  "kokoro/storage/v2/storage.proto": "e6a599c447d19f9d97b097751156ef8e84f2ce34ffe38c67f4f83dcdc22a4def",
}
const directories = ["kokoro", "kokoro/common", "kokoro/common/v1", "kokoro/storage", "kokoro/storage/v2"]
const generatedFiles = ["kokoro/common/v1/common_pb.ts", "kokoro/storage/v2/storage_pb.ts"]
const versions = {
  "@bufbuild/buf": "1.72.0",
  "@bufbuild/protoc-gen-es": "2.14.0",
  "@bufbuild/protobuf": "2.14.0",
  "@connectrpc/connect": "2.2.0",
  "@connectrpc/connect-node": "2.2.0",
}
const configFiles = ["buf.storage.json", "buf.storage.gen.json"]

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

export function assertSourceDigests(sources) {
  assert.deepEqual(Object.keys(sources).sort(), Object.keys(sourceDigests).sort(), "Storage source allowlist drifted")
  for (const [file, digest] of Object.entries(sourceDigests)) assert.equal(sha256(sources[file]), digest, `Storage source digest drifted: ${file}`)
}

export function assertGeneratedTree(tree) {
  assert.deepEqual([...tree.files].sort(), generatedFiles, "Storage generated file allowlist drifted")
  assert.deepEqual([...tree.directories].sort(), directories, "Storage generated directory allowlist drifted")
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
      assert.ok(entry.isFile(), `Storage artifact contains unsupported entry: ${relative}`)
      result.files.push(relative)
    }
  }
  return { files: result.files.sort(), directories: result.directories.sort() }
}

async function verifyInputs() {
  assert.equal(process.versions.node, "22.22.2", "Storage consumer generation requires pinned Node 22.22.2")
  assert.equal(await readFile(path.join(root, ".node-version"), "utf8"), "22.22.2\n")
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
  assert.equal(packageJson.packageManager, "pnpm@11.25.0")
  for (const [name, version] of Object.entries({ ...versions, prettier: "3.9.6", typescript: "5.9.3" })) {
    assert.equal(packageJson.dependencies[name] ?? packageJson.devDependencies[name], version, `${name} manifest version`)
    const installed = JSON.parse(await readFile(path.join(root, "node_modules", name, "package.json"), "utf8"))
    assert.equal(installed.version, version, `${name} installed version`)
  }
  const sources = await tree(path.join(root, vendor))
  assert.deepEqual(sources.directories, directories, "Storage source directory allowlist drifted")
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
      plugins: [{ local: "node_modules/.bin/protoc-gen-es", out: ".", opt: ["target=ts", "import_extension=js"] }],
    },
    "Buf generator config drifted",
  )
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}` },
    })
    child.once("error", reject)
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`))))
  })
}

async function generate(directory) {
  await run(path.join(root, "node_modules/.bin/buf"), ["generate", "--config", configFiles[0], "--template", configFiles[1], "--output", directory])
  assertGeneratedTree(await tree(directory))
  await run(process.execPath, [path.join(root, "node_modules/prettier/bin/prettier.cjs"), "--no-semi", "--print-width", "160", "--write", directory])
}

async function manifestFor(directory) {
  return {
    schema_version: 1,
    status: "generated",
    owner: {
      repository_path: "apps/kokoro-storage",
      repository_commit: ownerCommit,
      package_name: "kokoro.storage.v2",
      sources: Object.entries(sourceDigests).map(([file, digest]) => ({ path: `contract/proto/${file}`, sha256: digest })),
    },
    execution_artifact: null,
    generator: {
      packages: versions,
      configs: await Promise.all(configFiles.map(async (file) => ({ path: file, sha256: sha256(await readFile(path.join(root, file))) }))),
      script_sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
      formatting: { package: "prettier", version: "3.9.6", semi: false, print_width: 160 },
    },
    dependency_decision: {
      verified_on: "2026-09-28",
      approach:
        "Reuse the published owner's exact Buf/Protobuf-ES/Connect versions; no floating upgrade. Protobuf-ES v2 emits service descriptors consumed by Connect createClient.",
      alternatives:
        "Handwritten DTO/RPC serializers duplicate the owner contract; copying owner runtime/generated files lacks an independent reproducible consumer generation chain.",
      licenses: "Buf, Protobuf-ES and Connect-ES: Apache-2.0",
      supply_chain: "Exact package versions and lock integrity; local generation without remote plugins; the existing Buf build allowance is unchanged.",
      performance: "Connect Node HTTP/1.1 transport bounds RPC messages and deadlines; runtime performance is unmeasured.",
      failure_semantics:
        "Generation rejects source/config/package/tree/digest drift. No automatic mutation retries; BFF project-resource adapter consumes only upload operations.",
      exit_path: "Regenerate from the pinned owner Proto with a reviewed compatible generator; generated wire types remain isolated from business code.",
      sources: ["https://connectrpc.com/docs/node/using-clients/", "https://github.com/bufbuild/protobuf-es/releases/tag/v2.14.0"],
    },
    runtime: { node: "22.22.2", pnpm: "11.25.0", typescript: "5.9.3" },
    lockfile_sha256: sha256(await readFile(path.join(root, "pnpm-lock.yaml"))),
    build_policy_sha256: sha256(await readFile(path.join(root, "pnpm-workspace.yaml"))),
    generated: await Promise.all(generatedFiles.map(async (file) => ({ path: file, sha256: sha256(await readFile(path.join(directory, file))) }))),
  }
}

async function main() {
  const mode = process.argv[2]
  assert.ok(mode === "--write" || mode === "--check", "expected --write or --check")
  await verifyInputs()
  const temporary = await mkdtemp(path.join(tmpdir(), "kokoro-storage-connect-"))
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
      assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), manifest, "Storage dependency manifest drifted")
    }
    console.log(`PASS Storage Connect ${mode.slice(2)} (${generatedFiles.length} files, two byte-identical generations; source pin only)`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
