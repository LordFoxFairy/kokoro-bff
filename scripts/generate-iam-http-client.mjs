import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const output = path.join(root, "src/generated/iam-http")
const manifestPath = path.join(root, "contract/dependencies/iam-http.json")
const configPath = path.join(root, "openapi-ts.iam.config.ts")
const lockfilePath = path.join(root, "pnpm-lock.yaml")
const ownerCommit = "b720b6dc095b883237682102ca0a87ed6451a968"
const vendorPath = path.join(root, `contract/vendor/kokoro-iam/${ownerCommit}/iam.internal.v1.json`)
const ownerDigest = "cddfec4cd3439d98f399254911232c447582a97e9b1d4c109139e68baaf030b9"
const generatedFiles = [
  "client.gen.ts",
  "client/client.gen.ts",
  "client/index.ts",
  "client/types.gen.ts",
  "client/utils.gen.ts",
  "core/auth.gen.ts",
  "core/bodySerializer.gen.ts",
  "core/params.gen.ts",
  "core/pathSerializer.gen.ts",
  "core/queryKeySerializer.gen.ts",
  "core/serverSentEvents.gen.ts",
  "core/types.gen.ts",
  "core/utils.gen.ts",
  "sdk.gen.ts",
  "types.gen.ts",
  "zod.gen.ts",
]
const generatedDirectories = ["client", "core"]

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export function replaceExactInSource(source, from, to, expectedCount, label) {
  const count = source.split(from).length - 1
  assert.equal(count, expectedCount, `${label}: expected ${expectedCount} generator matches, found ${count}`)
  return source.replaceAll(from, to)
}

async function normalizeFile(directory, relativePath, replacements) {
  const filePath = path.join(directory, relativePath)
  let source = await readFile(filePath, "utf8")
  for (const [from, to, expectedCount, label] of replacements) {
    source = replaceExactInSource(source, from, to, expectedCount, `${relativePath} ${label}`)
  }
  await writeFile(filePath, source)
}

async function normalizeGeneratorCompatibility(directory) {
  await normalizeFile(directory, "client/client.gen.ts", [
    [
      `    const resolvedOpts = opts as typeof opts &
      ResolvedRequestOptions<TResponseStyle, ThrowOnError, Url>;`,
      `    const { serializedBody, ...requestOptions } = opts
    const resolvedOpts = {
      ...requestOptions,
      ...(serializedBody === undefined ? {} : { serializedBody }),
    } as ResolvedRequestOptions<TResponseStyle, ThrowOnError, Url>`,
      1,
      "optional serializedBody",
    ],
    [
      `    const { opts, url } = await beforeRequest(options);
    return createSseClient({
      ...opts,
      body: opts.body as BodyInit | null | undefined,`,
      `    const { opts, url } = await beforeRequest(options)
    const { body, ...sseOptions } = opts
    return createSseClient({
      ...sseOptions,
      ...(body === undefined ? {} : { body: body as BodyInit | null }),`,
      1,
      "optional SSE request body",
    ],
  ])
  await normalizeFile(directory, "client/utils.gen.ts", [
    [
      "            allowReserved: options.allowReserved,",
      "            ...(options.allowReserved === undefined ? {} : { allowReserved: options.allowReserved }),",
      3,
      "optional query allowReserved",
    ],
    ["    path: options.path,", "    ...(options.path === undefined ? {} : { path: options.path }),", 1, "optional URL path"],
    ["    query: options.query,", "    ...(options.query === undefined ? {} : { query: options.query }),", 1, "optional URL query"],
  ])
  await normalizeFile(directory, "core/params.gen.ts", [
    [
      `        map.set(config.key, {
          in: config.in,
          map: config.map,
        });`,
      `        map.set(config.key, {
          in: config.in,
          ...(config.map === undefined ? {} : { map: config.map }),
        });`,
      1,
      "optional parameter map",
    ],
  ])
  await normalizeFile(directory, "core/pathSerializer.gen.ts", [
    [
      `        allowReserved,
        name,`,
      `        ...(allowReserved === undefined ? {} : { allowReserved }),
        name,`,
      1,
      "optional array path allowReserved",
    ],
    [
      `        allowReserved,
        name:`,
      `        ...(allowReserved === undefined ? {} : { allowReserved }),
        name:`,
      1,
      "optional object path allowReserved",
    ],
  ])
  await normalizeFile(directory, "core/serverSentEvents.gen.ts", [
    [
      "          body: options.serializedBody,",
      "          ...(options.serializedBody === undefined ? {} : { body: options.serializedBody }),",
      1,
      "optional request body",
    ],
    ["                event: eventName,", "                ...(eventName === undefined ? {} : { event: eventName }),", 1, "optional event name"],
    ["                id: lastEventId,", "                ...(lastEventId === undefined ? {} : { id: lastEventId }),", 1, "optional event id"],
  ])
  await normalizeFile(directory, "client/types.gen.ts", [
    ["  // eslint-disable-next-line @typescript-eslint/no-unused-vars\n", "", 1, "unused generic suppression"],
  ])
  await normalizeFile(directory, "core/types.gen.ts", [
    ["// eslint-disable-next-line @typescript-eslint/no-empty-object-type\n", "", 1, "empty interface suppression"],
  ])
  await normalizeFile(directory, "zod.gen.ts", [
    [
      `        details: z.array(z.unknown())
    })
});`,
      `        details: z.array(z.unknown())
    }).strict()
}).strict();`,
      1,
      "strict IAM error envelope",
    ],
    [
      `        client_id: z.string().min(1)
    })
});`,
      `        client_id: z.string().min(1)
    }).strict()
}).strict();`,
      1,
      "strict IAM admission response",
    ],
  ])
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options })
    child.once("error", reject)
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`))))
  })
}

async function generatedTree(directory, prefix = "") {
  const files = []
  const directories = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      directories.push(relativePath)
      const nested = await generatedTree(path.join(directory, entry.name), relativePath)
      files.push(...nested.files)
      directories.push(...nested.directories)
    } else {
      assert.ok(entry.isFile(), `generated output contains unsupported entry: ${relativePath}`)
      files.push(relativePath)
    }
  }
  return { files: files.sort(), directories: directories.sort() }
}

export function assertGeneratedAllowlist(files, directories, label) {
  assert.deepEqual(files.slice().sort(), generatedFiles.slice().sort(), `${label} file allowlist drifted`)
  assert.deepEqual(directories.slice().sort(), generatedDirectories.slice().sort(), `${label} directory allowlist drifted`)
}

async function generate(directory) {
  const cli = path.join(root, "node_modules/@hey-api/openapi-ts/bin/run.js")
  await run(process.execPath, [cli, "--silent", "-f", configPath], { env: { ...process.env, IAM_HTTP_CLIENT_OUTPUT: directory } })
  const tree = await generatedTree(directory)
  assertGeneratedAllowlist(tree.files, tree.directories, "generated")
  await normalizeGeneratorCompatibility(directory)
  const prettier = path.join(root, "node_modules/prettier/bin/prettier.cjs")
  await run(process.execPath, [prettier, "--no-semi", "--print-width", "160", "--write", directory])
}

async function manifestFor(directory) {
  const [vendor, config, lockfile, packageDocument, nodeVersion] = await Promise.all([
    readFile(vendorPath),
    readFile(configPath),
    readFile(lockfilePath),
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, ".node-version"), "utf8"),
  ])
  const packageJson = JSON.parse(packageDocument)
  assert.equal(sha256(vendor), ownerDigest, "vendored IAM contract digest drifted")
  assert.equal(nodeVersion, "22.22.2\n", ".node-version must pin Node 22.22.2")
  assert.equal(packageJson.packageManager, "pnpm@11.25.0")
  assert.equal(packageJson.devDependencies["@hey-api/openapi-ts"], "0.99.0")
  assert.equal(packageJson.devDependencies.prettier, "3.9.6")
  assert.equal(packageJson.devDependencies.typescript, "5.9.3")
  assert.equal(packageJson.dependencies.zod, "4.5.4")
  return {
    schema_version: 1,
    status: "generated",
    owner: {
      repository_path: "apps/kokoro-iam",
      repository_commit: ownerCommit,
      contract_version: "0.5.0",
      contract_path: "contract/openapi/iam.internal.v1.json",
      contract_sha256: ownerDigest,
    },
    generator: {
      package: "@hey-api/openapi-ts",
      version: "0.99.0",
      config_path: "openapi-ts.iam.config.ts",
      config_sha256: sha256(config),
    },
    runtime: { node: "22.22.2", pnpm: "11.25.0", zod: "4.5.4" },
    lockfile_sha256: sha256(lockfile),
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
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "kokoro-iam-http-"))
  const temporaryOutput = path.join(temporaryRoot, "generated")
  const repeatedOutput = path.join(temporaryRoot, "generated-again")
  try {
    await generate(temporaryOutput)
    const expectedManifest = await manifestFor(temporaryOutput)
    if (mode === "--write") {
      await rm(output, { recursive: true, force: true })
      await cp(temporaryOutput, output, { recursive: true })
      await writeFile(manifestPath, `${JSON.stringify(expectedManifest, null, 2)}\n`)
      console.log(`WROTE IAM HTTP client (${generatedFiles.length} files)`)
      return
    }
    await generate(repeatedOutput)
    const repeatedTree = await generatedTree(repeatedOutput)
    assertGeneratedAllowlist(repeatedTree.files, repeatedTree.directories, "repeated generated")
    for (const file of generatedFiles) {
      assert.deepEqual(
        await readFile(path.join(repeatedOutput, file)),
        await readFile(path.join(temporaryOutput, file)),
        `non-deterministic generation: ${file}`,
      )
    }
    const committedTree = await generatedTree(output)
    assertGeneratedAllowlist(committedTree.files, committedTree.directories, "committed generated")
    for (const file of generatedFiles) {
      assert.deepEqual(await readFile(path.join(output, file)), await readFile(path.join(temporaryOutput, file)), file)
    }
    assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), expectedManifest, "IAM HTTP dependency manifest drifted")
    console.log(`PASS IAM HTTP client drift check (${generatedFiles.length} files, two byte-identical generations)`)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href
if (invokedPath === import.meta.url) await main()
