import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ownerCommit = "263a28f1e55745bd1829a61f68228d775751adbc"
const vendor = `contract/vendor/kokoro-platform/${ownerCommit}/proto`
const artifact = `contract/vendor/kokoro-platform/${ownerCommit}/execution-operations-v4`
const artifactAggregate = "902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79"
const output = path.join(root, "src/generated/platform-connect")
const manifestPath = path.join(root, "contract/dependencies/platform-connect.json")
const sourceDigests = {
  "kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "kokoro/platform/v1/platform_runtime.proto": "8ccab4aee4efdfd8210f2e5f02ae8ec85c2c470e90451915209406e16621289a",
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

export function assertVendorPins(entries) {
  assert.deepEqual(entries.map((entry) => entry.name).sort(), [ownerCommit], "Platform vendor commit allowlist drifted")
  assert.ok(entries[0]?.isDirectory(), "Platform vendor commit must be a real directory")
}

export function assertVendorLayout(entries) {
  assert.deepEqual(entries.map((entry) => entry.name).sort(), ["execution-operations-v4", "proto"], "Platform vendor layout allowlist drifted")
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
  const files = Object.fromEntries(await Promise.all(provenance.files.map(async (entry) => [entry.path, await readFile(path.join(directory, entry.path))])))
  assertExecutionArtifact(provenance, files)
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
      artifactVersion: "4.0.0",
      status: "inactive",
      routable: false,
    },
  )
  assert.equal(manifest.bindingVersion, "3.0.0", "Platform command binding version drifted")
  assert.equal(manifest.inventories.readBindings, 1, "Platform Get read binding inventory drifted")
  assert.equal(manifest.inventories.bindings, 24, "Platform request binding inventory drifted")
  assert.equal(manifest.inventories.commandIdentities, 17, "Platform command identity inventory drifted")
  assert.deepEqual(manifest.inventories.operations, { tenantExecution: 24, workloadOnly: 9, globalReserved: 1 }, "Platform operation inventory drifted")
  assert.equal(manifest.inventories.positiveVectors.length, 55, "Platform positive vector inventory drifted")
  assert.equal(manifest.inventories.negativeVectors.length, 142, "Platform negative vector inventory drifted")
  assertGetReadBinding(files)
}

export function assertGetReadBinding(files) {
  const bindings = JSON.parse(files["request-bindings.json"].toString("utf8"))
  const catalog = JSON.parse(files["operation-catalog.json"].toString("utf8"))
  const read = bindings.readBinding
  assert.equal(bindings.artifactVersion, "4.0.0", "Platform read binding artifact version drifted")
  assert.equal(bindings.bindingVersion, "3.0.0", "Platform request binding version drifted")
  assert.equal(bindings.bindings.length, 24, "Platform request bindings drifted")
  assert.equal(read.version, "1.0.0", "Platform Get read binding version drifted")
  assert.equal(read.fqMethod, "kokoro.platform.v1.SkillCatalogService/GetSkillPackageUpload", "Platform Get read method drifted")
  assert.equal(read.operation, "skill.get_package_upload", "Platform Get read operation drifted")
  assert.equal(read.proof, "forbidden", "Platform Get must not carry proof")
  assert.equal(read.command, "forbidden", "Platform Get must not carry command identity")
  assert.deepEqual(
    read.requestFields.map(({ name, tag, type }) => [name, tag, type]),
    [
      ["request_id", 1, "string"],
      ["skill_id", 2, "SkillId"],
      ["product_context", 3, "ProductCatalogContext"],
    ],
    "Platform Get request descriptor drifted",
  )
  assert.deepEqual(
    read.responseFields.map(({ name, tag, type }) => [name, tag, type]),
    [
      ["skill_id", 1, "SkillId"],
      ["attempt_id", 2, "optional string"],
      ["attempt_epoch", 3, "uint64"],
      ["phase", 4, "SkillPackagePhase"],
      ["upload_id", 5, "optional string"],
    ],
    "Platform Get response descriptor drifted",
  )
  const operation = catalog.operations.filter(({ fqMethod }) => fqMethod === read.fqMethod)
  assert.equal(operation.length, 1, "Platform Get operation catalog drifted")
  assert.deepEqual(
    { class: operation[0].class, operation: operation[0].operation, proof: operation[0].proof, idempotency: operation[0].idempotency },
    { class: "workload-only", operation: read.operation, proof: "forbidden", idempotency: "none" },
    "Platform Get catalog semantics drifted",
  )
  assert.equal(read.vectors.length, 7, "Platform Get read vectors drifted")
  assert.deepEqual(
    read.vectors.map(({ name }) => name),
    ["valid", "unknown-request", "unknown-context", "missing-context", "invalid-skill-id", "owner-kind", "subject-mismatch"],
    "Platform Get read vector names drifted",
  )
}

async function verifyExecutionArtifact() {
  await verifyExecutionArtifactDirectory(path.join(root, artifact))
}

async function verifyInputs() {
  await verifyExecutionArtifact()
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
      artifact_version: "4.0.0",
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
        "Generation rejects source/config/package/tree/digest drift. Artifact/source drift and Get read binding drift fail closed; runtime adapter admits current user before Platform Connect.",
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
    console.log(`PASS Platform Connect ${mode.slice(2)} (${generatedFiles.length} files, two byte-identical generations; inactive v4 artifact; no activation)`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
