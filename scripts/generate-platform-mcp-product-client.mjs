import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ownerCommit = "8a9d1e5180d8ba11ea59267975e5305f0c6e81a8"
const vendorRoot = `contract/vendor/kokoro-platform-mcp-product/${ownerCommit}`
const vendorProto = `${vendorRoot}/proto`
const output = "src/generated/platform-mcp-product-connect"
const manifestPath = "contract/dependencies/platform-mcp-product-connect.json"
const config = "buf.platform-mcp-product.json"
const template = "buf.platform-mcp-product.gen.json"
const protoInputs = ["kokoro/common/v1/common.proto", "kokoro/platform/v1/platform_runtime.proto", "kokoro/storage/v3/storage.proto"]
const generatedFiles = ["kokoro/common/v1/common_pb.ts", "kokoro/platform/v1/platform_runtime_pb.ts", "kokoro/storage/v3/storage_pb.ts"]
const pins = {
  "proto/kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "proto/kokoro/platform/v1/platform_runtime.proto": "5f372f114057acf07493108f6a03106409472bf306f54875bcd6bb38b7f7bd19",
  "proto/kokoro/storage/v3/storage.proto": "1021e603065978871c51519ddba5b23c9b97f16b781a08bd98e019b3342bf5f9",
  "descriptor/platform-v1.binpb": "22da07a0103f5bbcc3d5a28a25189ffdb26ab30b244c5547318ecfaac808f615",
  "execution-operations/mcp-provider-presentation-v1.json": "ff527e4650fbb2f3e9c2cf869d5cfded29cc539284003687ff56cca0c41cac04",
  "execution-operations/mcp-personal-oauth-v1.json": "409e950a4aa083160e5ee50bb8ca4f45d0e55990cb45d6a8862b2a2b597e4168",
  "provenance.json": "dac5c5a45e0339e6fc0578d3eec5aa1c74217b0360c7514ed080beb12710a23e",
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex")

async function tree(directory, prefix = "") {
  const result = { files: [], directories: [] }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      result.directories.push(relative)
      const nested = await tree(path.join(directory, entry.name), relative)
      result.files.push(...nested.files)
      result.directories.push(...nested.directories)
    } else if (entry.isFile()) result.files.push(relative)
    else throw new Error(`unsupported entry: ${relative}`)
  }
  return { files: result.files.sort(), directories: result.directories.sort() }
}

export async function assertMcpProductInputs() {
  const actual = (await tree(path.join(root, vendorRoot))).files
  assert.deepEqual(actual, Object.keys(pins).sort(), "MCP product vendor allowlist drifted")
  for (const [file, digest] of Object.entries(pins))
    assert.equal(sha256(await readFile(path.join(root, vendorRoot, file))), digest, `MCP product pin drifted: ${file}`)
  const profile = JSON.parse(await readFile(path.join(root, vendorRoot, "execution-operations/mcp-provider-presentation-v1.json"), "utf8"))
  assert.deepEqual(profile.fields, [
    { message: "PersonalMcpProvider", name: "cover_image_url", number: 12 },
    { message: "PersonalMcpProvider", name: "updated_at", number: 13 },
    { message: "McpProviderAdminRecord", name: "cover_image_url", number: 19 },
    { message: "McpProviderAdminInput", name: "cover_image_url", number: 15 },
  ])
  assert.equal(
    profile.semantics.coverImageUrl,
    "optional public HTTPS artwork selected by an administrator; not a Storage credential, secret, or browser-side provider-key mapping",
  )
  assert.equal(profile.semantics.updatedAt, "canonical committed provider metadata timestamp; absence remains unknown and must not be fabricated")
  const source = await readFile(path.join(root, vendorRoot, "proto/kokoro/platform/v1/platform_runtime.proto"), "utf8")
  assert.match(source, /optional string cover_image_url = 12;/u)
  assert.match(source, /optional string updated_at = 13;/u)
  assert.match(source, /optional string cover_image_url = 19;/u)
  assert.match(source, /optional string cover_image_url = 15;/u)
  assert.match(source, /optional kokoro\.platform\.v1\.McpServerId connection_server_id = 14;/u)
  const oauth = JSON.parse(await readFile(path.join(root, vendorRoot, "execution-operations/mcp-personal-oauth-v1.json"), "utf8"))
  assert.equal(oauth.profile, "mcp-personal-oauth-v1")
  assert.deepEqual(
    oauth.methods.map((entry) => entry.method),
    [
      "BeginPersonalMcpConnectorAuthorization",
      "CompletePersonalMcpConnectorAuthorization",
      "ReconnectPersonalMcpConnectorAuthorization",
      "CreatePersonalMcpConnection",
    ],
  )
  assert.equal(oauth.callback.state, "opaque single-use correlation state; Platform stores only a hash")
  assert.equal(oauth.callback.code, "provider callback input only; never stored in request receipts or logs")
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`))))
  })
}

async function generate(directory) {
  await run(path.join(root, "node_modules/.bin/buf"), [
    "generate",
    "--config",
    config,
    "--template",
    template,
    "--output",
    directory,
    ...protoInputs.flatMap((file) => ["--path", `${vendorProto}/${file}`]),
  ])
  assert.deepEqual((await tree(directory)).files, generatedFiles, "MCP product generated file allowlist drifted")
  await run(process.execPath, [path.join(root, "node_modules/prettier/bin/prettier.cjs"), "--no-semi", "--print-width", "160", "--write", directory])
}

async function manifestFor(directory) {
  return {
    schema_version: 1,
    status: "generated",
    owner: { repository_path: "apps/kokoro-capability", repository_commit: ownerCommit, package_name: "kokoro.platform.v1" },
    profiles: [
      { path: `${vendorRoot}/execution-operations/mcp-provider-presentation-v1.json`, version: "1.0.0" },
      { path: `${vendorRoot}/execution-operations/mcp-personal-oauth-v1.json`, version: "1.0.0" },
    ],
    inputs: await Promise.all(Object.entries(pins).map(async ([file, sha256]) => ({ path: `${vendorRoot}/${file}`, sha256 }))),
    generator: { buf: "1.72.0", protobuf_es: "2.14.0", config, template },
    generated: await Promise.all(generatedFiles.map(async (file) => ({ path: file, sha256: sha256(await readFile(path.join(directory, file))) }))),
  }
}

async function main() {
  const mode = process.argv[2]
  assert.ok(mode === "--write" || mode === "--check", "expected --write or --check")
  await assertMcpProductInputs()
  const temporary = await mkdtemp(path.join(tmpdir(), "kokoro-mcp-product-connect-"))
  try {
    await writeFile(path.join(temporary, "package.json"), '{"type":"module"}\n')
    await symlink(path.join(root, "node_modules"), path.join(temporary, "node_modules"), "dir")
    const first = path.join(temporary, "first")
    const second = path.join(temporary, "second")
    await generate(first)
    await generate(second)
    for (const file of generatedFiles)
      assert.deepEqual(await readFile(path.join(first, file)), await readFile(path.join(second, file)), `non-deterministic generation: ${file}`)
    const manifest = await manifestFor(first)
    if (mode === "--write") {
      await rm(path.join(root, output), { recursive: true, force: true })
      await cp(first, path.join(root, output), { recursive: true })
      await writeFile(path.join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`)
    } else {
      assert.deepEqual((await tree(path.join(root, output))).files, generatedFiles, "MCP product generated tree drifted")
      for (const file of generatedFiles)
        assert.deepEqual(await readFile(path.join(root, output, file)), await readFile(path.join(first, file)), `MCP product generated drifted: ${file}`)
      assert.deepEqual(JSON.parse(await readFile(path.join(root, manifestPath), "utf8")), manifest, "MCP product dependency manifest drifted")
    }
    console.log(`PASS MCP product Connect ${mode.slice(2)}`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
