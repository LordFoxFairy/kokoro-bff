import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ownerCommit = "5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0"
const vendor = `contract/vendor/kokoro-platform/${ownerCommit}/proto`
const artifact = `contract/vendor/kokoro-platform/${ownerCommit}/execution-operations-v3`
const artifactAggregate = "324e749da1bc66c1ff03de74e7299716f798f5f5bb5fa19556033b79fa09ff8d"
const output = path.join(root, "src/generated/platform-connect")
const manifestPath = path.join(root, "contract/dependencies/platform-connect.json")
const sourceDigests = {
  "kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "kokoro/platform/v1/platform_runtime.proto": "282bf886ea9648f7ce5208abd36ab47d879b2002a036d90aada2af59e74b4020",
}
const directories = ["kokoro", "kokoro/common", "kokoro/common/v1", "kokoro/platform", "kokoro/platform/v1"]
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

export function assertExecutionArtifact(provenance, files) {
  assert.equal(provenance.aggregateSha256, artifactAggregate, "Platform artifact aggregate pin drifted")
  assert.deepEqual(Object.keys(files).sort(), provenance.files.map((entry) => entry.path).sort(), "Platform artifact file allowlist drifted")
  const records = []
  for (const entry of provenance.files) {
    const bytes = files[entry.path]
    assert.ok(bytes, `Platform artifact file missing: ${entry.path}`)
    assert.equal(bytes.length, entry.bytes, `Platform artifact byte length drifted: ${entry.path}`)
    assert.equal(sha256(bytes), entry.sha256, `Platform artifact digest drifted: ${entry.path}`)
    records.push(`${entry.path}\0${entry.bytes}\0${entry.sha256}\n`)
  }
  assert.equal(sha256(Buffer.from(records.join(""))), artifactAggregate, "Platform artifact aggregate drifted")
}

export async function verifyExecutionArtifactDirectory(directory) {
  const provenance = JSON.parse(await readFile(path.join(directory, "provenance.json"), "utf8"))
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
  assertExecutionArtifact(
    provenance,
    Object.fromEntries(await Promise.all(provenance.files.map(async (entry) => [entry.path, await readFile(path.join(directory, entry.path))]))),
  )
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))
  assert.deepEqual(
    {
      artifact: manifest.artifact,
      artifactVersion: manifest.artifactVersion,
      status: manifest.status,
      routable: manifest.routable,
    },
    {
      artifact: "platform-execution-operations",
      artifactVersion: "3.0.0",
      status: "inactive",
      routable: false,
    },
  )
}

async function verifyExecutionArtifact() {
  await verifyExecutionArtifactDirectory(path.join(root, artifact))
}

async function verifyInputs() {
  await verifyExecutionArtifact()
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
  assert.deepEqual(sources.directories, directories, "Platform source directory allowlist drifted")
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
  await run(path.join(root, "node_modules/.bin/buf"), ["generate", "--config", configFiles[0], "--template", configFiles[1], "--output", directory])
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
      path: artifact,
      artifact_version: "3.0.0",
      status: "inactive",
      routable: false,
      provenance_path: `${artifact}/provenance.json`,
      aggregate_sha256: artifactAggregate,
    },
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
      verified_on: "2026-09-28",
      approach:
        "Reuse the published owner's exact Buf/Protobuf-ES/Connect versions; no floating upgrade. Protobuf-ES v2 emits service descriptors consumed by Connect createClient.",
      alternatives:
        "Handwritten DTO/RPC serializers duplicate the owner contract; copying owner runtime/generated files lacks an independent reproducible consumer generation chain.",
      licenses: "Buf, Protobuf-ES and Connect-ES: Apache-2.0",
      supply_chain: "Exact package versions and lock integrity; local generation without remote plugins; only @bufbuild/buf install build is newly allowed.",
      performance: "No network calls or application startup added. Runtime performance is unmeasured; this slice validates descriptor serialization only.",
      failure_semantics:
        "Generation rejects source/config/package/tree/digest drift. Artifact/source drift fails closed. No retry, authentication or production adapter is implemented.",
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
    console.log(`PASS Platform Connect ${mode.slice(2)} (${generatedFiles.length} files, two byte-identical generations; inactive v3 artifact; no activation)`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
