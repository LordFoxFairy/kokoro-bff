import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ownerCommit = "b95365f968432b59e22fa764e074f1899f82c5d3"
const vendorRoot = `contract/vendor/kokoro-platform-provider-admin/${ownerCommit}`
const vendorProto = `${vendorRoot}/proto`
const output = "src/generated/platform-provider-admin-connect"
const manifestPath = "contract/dependencies/platform-provider-admin-connect.json"
const config = "buf.platform-provider-admin.json"
const template = "buf.platform-provider-admin.gen.json"
const protoInputs = [
  "kokoro/common/v1/common.proto",
  "kokoro/platform/v1/platform_runtime.proto",
  "kokoro/storage/v3/storage.proto",
]
const generatedFiles = [
  "kokoro/common/v1/common_pb.ts",
  "kokoro/platform/v1/platform_runtime_pb.ts",
  "kokoro/storage/v3/storage_pb.ts",
]
const pinnedFiles = {
  "proto/kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "proto/kokoro/platform/v1/platform_runtime.proto": "2cc4627c133d0818dcffa220ad1b9feaeb08be6f1aa8553d8648b8bd1edc640a",
  "proto/kokoro/storage/v3/storage.proto": "1021e603065978871c51519ddba5b23c9b97f16b781a08bd98e019b3342bf5f9",
  "descriptor/platform-v1.binpb": "67e48b3d96bc5a92d65821469132482a7c56010f1d9e3e8252c7dd4e0c9eea7b",
  "execution-operations/mcp-provider-admin-v1.json": "093f633e73f1c207b80cc587b9e32129ba64ac8ec95077f61cdb0d1a0478b999",
  "provenance.json": "91aa811a2ab3d986767989198e9781f798d7a91bd69445a985b45884341b6f2c",
}

function sha256(value) { return createHash("sha256").update(value).digest("hex") }

async function tree(directory, prefix = "") {
  const result = { files: [], directories: [] }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      result.directories.push(relative)
      const child = await tree(path.join(directory, entry.name), relative)
      result.files.push(...child.files)
      result.directories.push(...child.directories)
    } else if (entry.isFile()) result.files.push(relative)
    else throw new Error(`unsupported entry: ${relative}`)
  }
  return { files: result.files.sort(), directories: result.directories.sort() }
}

async function verifyInputs() {
  const expected = Object.keys(pinnedFiles).sort()
  const actual = (await tree(path.join(root, vendorRoot))).files
  assert.deepEqual(actual, expected, "provider admin vendor file allowlist drifted")
  for (const [file, digest] of Object.entries(pinnedFiles))
    assert.equal(sha256(await readFile(path.join(root, vendorRoot, file))), digest, `provider admin pin drifted: ${file}`)
  const profile = JSON.parse(await readFile(path.join(root, vendorRoot, "execution-operations/mcp-provider-admin-v1.json"), "utf8"))
  assert.equal(profile.service, "kokoro.platform.v1.McpProviderAdminService", "provider admin service drifted")
  assert.deepEqual(profile.methods.map((entry) => entry.method), [
    "ListMcpProviderAdminRecords", "GetMcpProviderAdminRecord", "CreateMcpProviderAdminRecord", "UpdateMcpProviderAdminRecord", "SetMcpProviderAdminRecordEnabled", "RemoveMcpProviderAdminRecord",
  ], "provider admin method order drifted")
  assert.equal(profile.identity.humanAdmission, "fresh platform-admin decision before every read and command replay", "provider admin human admission drifted")
  assert.equal(profile.identity.humanBearerForwarding, false, "provider admin bearer boundary drifted")
  assert.deepEqual(JSON.parse(await readFile(path.join(root, config), "utf8")), { version: "v2", modules: [{ path: vendorProto }] }, "provider admin Buf input drifted")
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`)))
  })
}

async function generate(directory) {
  await run(path.join(root, "node_modules/.bin/buf"), ["generate", "--config", config, "--template", template, "--output", directory, ...protoInputs.flatMap((file) => ["--path", `${vendorProto}/${file}`])])
  assert.deepEqual((await tree(directory)).files, generatedFiles, "provider admin generated file allowlist drifted")
  await run(process.execPath, [path.join(root, "node_modules/prettier/bin/prettier.cjs"), "--no-semi", "--print-width", "160", "--write", directory])
  const generated = await readFile(path.join(directory, "kokoro/platform/v1/platform_runtime_pb.ts"), "utf8")
  assert.match(generated, /McpProviderAdminService/u, "provider admin generated service missing")
}

async function manifestFor(directory) {
  return {
    schema_version: 1,
    status: "generated",
    owner: { repository_path: "apps/kokoro-capability", repository_commit: ownerCommit, package_name: "kokoro.platform.v1" },
    profile: { path: `${vendorRoot}/execution-operations/mcp-provider-admin-v1.json`, version: "1.0.0" },
    inputs: await Promise.all(Object.entries(pinnedFiles).map(async ([file, sha256]) => ({ path: `${vendorRoot}/${file}`, sha256 }))),
    generator: { buf: "1.72.0", protobuf_es: "2.14.0", config, template },
    generated: await Promise.all(generatedFiles.map(async (file) => ({ path: file, sha256: sha256(await readFile(path.join(directory, file))) }))),
  }
}

async function main() {
  const mode = process.argv[2]
  assert.ok(mode === "--write" || mode === "--check", "expected --write or --check")
  await verifyInputs()
  const temporary = await mkdtemp(path.join(tmpdir(), "kokoro-provider-admin-connect-"))
  try {
    await writeFile(path.join(temporary, "package.json"), '{"type":"module"}\n')
    await symlink(path.join(root, "node_modules"), path.join(temporary, "node_modules"), "dir")
    const first = path.join(temporary, "first")
    const second = path.join(temporary, "second")
    await generate(first)
    await generate(second)
    for (const file of generatedFiles) assert.deepEqual(await readFile(path.join(first, file)), await readFile(path.join(second, file)), `non-deterministic generation: ${file}`)
    const manifest = await manifestFor(first)
    if (mode === "--write") {
      await rm(path.join(root, output), { recursive: true, force: true })
      await cp(first, path.join(root, output), { recursive: true })
      await writeFile(path.join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`)
    } else {
      assert.deepEqual((await tree(path.join(root, output))).files, generatedFiles, "provider admin generated tree drifted")
      for (const file of generatedFiles) assert.deepEqual(await readFile(path.join(root, output, file)), await readFile(path.join(first, file)), `provider admin generated drifted: ${file}`)
      assert.deepEqual(JSON.parse(await readFile(path.join(root, manifestPath), "utf8")), manifest, "provider admin dependency manifest drifted")
    }
    console.log(`PASS provider-admin Connect ${mode.slice(2)}`)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
