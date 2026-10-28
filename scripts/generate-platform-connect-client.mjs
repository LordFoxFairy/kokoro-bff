import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ownerCommit = "94e574c68d6c972078b661fa7d917dab90c71042"
const vendorRoot = `contract/vendor/kokoro-platform/${ownerCommit}`
const vendorProto = `${vendorRoot}/proto`
const output = "src/generated/platform-connect"
const manifestPath = "contract/dependencies/platform-connect.json"

const sourceDigests = {
  "kokoro/common/v1/common.proto": "65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08",
  "kokoro/platform/v1/platform_runtime.proto": "26266d24fc1fcffb581662d5a404a97c485c09e3b2e597bb88df3a9cc482ed36",
  "kokoro/storage/v3/storage.proto": "b84a2fb1fd9c6e8c16e15a29cafbc33de670f40f703f3f33ef27652a0237a629",
  "kokoro/platform/v1/mcp_package_admin.proto": "60b6778cbb3024f09184bbfc1e06e124191a6583ad892e48e0bcb3c4d0667b31",
}
const artifactDigests = {
  "execution-operations/project-skill-installation-content-v1.json": "e69a91b9ec1fdd78fc50a2780f231248057c851d5ac7b2ff0d21a51b25c8e876",
  "execution-operations/mcp-personal-sse-v1.json": "29ea698428bc7be7469d6582746015e9e18ccb8887f035e89626e1791dcef647",
  "execution-operations/mcp-personal-sse-request-vectors-v1.json": "95545d2462ec0e3106545685e386b06a253c37b9fa5306419120aef9a35e9087",
  "descriptor/platform-mcp-personal-sse-source-delta.json": "66bae4f03801373df48e1b5129650fabbaf3e46b2e38e8520e3f7748f91bc24d",
  "descriptor/platform-mcp-personal-sse-parents.json": "47cf12d9986db44873d6e3665a678e910dce510001453c6b0d7c68718900fad2",
  "descriptor/platform-mcp-personal-sse-parent.runtime.request-vectors.json.snapshot": "1217049c5a0833349765ab6d364771264f2dcfda410cb1c63b24abc7dcf2a397",
  "descriptor/platform-mcp-personal-sse-parent.runtime.proto.snapshot": "1c0e942b56c9b711207f9f4e1155c7b5d24ce2632e18adc98cf9884542ab0b17",
  "descriptor/platform-mcp-personal-sse-parent.runtime.profile.json.snapshot": "b8fb5d4682256e531594976004fec62968e1e5492864da53a0b0f4da2b9685a0",
  "descriptor/platform-mcp-personal-sse-parent.runtime.generated.ts.snapshot": "0dad7af6d2d9d6b359f88d37fa113f7f53db9267356126f9f7fe7ff1c499136e",
  "descriptor/platform-mcp-personal-sse-parent.runtime.binpb.snapshot": "d72ae692023b474534c2b0711c7ba70f54e3ca525d2a36576009988897dd7a81",
  "descriptor/platform-mcp-personal-sse-parent.provenance.json.snapshot": "157b21b188b867938a629b2d6bfec817496ba3bcd18ff497ed16c7c3a1810516",
  "descriptor/platform-mcp-personal-sse-parent.private-server.profile.json.snapshot": "c3246a5d88b79f1358205e67658570bf6ced4b805fb414b3016f816e88dbc92a",
  "descriptor/platform-mcp-personal-sse-parent.platform.proto.snapshot": "e406e4b0d637f2e1a6736741482c71d6a2285ff36a67db12c68284d9e49e52f6",
  "descriptor/platform-mcp-personal-sse-parent.platform.generated.ts.snapshot": "e73a4ca8241ec2ee06822a7987957b3433b43ce7e3c761723a465acf9df7817b",
  "descriptor/platform-mcp-personal-sse-parent.platform.binpb.snapshot": "81ae8a8c825b87b82b21b7892f7f9bb7a3b70bb3294e4a62d39d72dc34b428a5",
  "descriptor/platform-mcp-personal-sse-parent.personal-product.profile.json.snapshot": "b996af5f1897fb97c78f1f41e522e6b99af885c8319200a50a6a0865e19b34d0",
  "descriptor/platform-mcp-personal-sse-parent.icon.profile.json.snapshot": "a6dd6d0bfe134c3c46b8c5fd442a7a7d1715c22ce6cea272148c50192e04504c",
  "descriptor/platform-mcp-personal-sse-parent.http.openapi.json.snapshot": "3a187ad6e98b1824cf8d8e50c80218e77c7f14f4eb2a5cfcfe8d4be97c677a08",
  "descriptor/platform-mcp-personal-sse-parent.availability.profile.json.snapshot": "44202f4b491d90414775654fdcfa0538fa5e1ce7585713040c8b7a8052d65e63",
  "execution-operations/mcp-icon-request-vectors-v1.json": "b906cba768889bf09a5bc9455153f6ea39c63c9396c14fa775aef09be9a28435",
  "execution-operations/mcp-icon-v1.json": "a6dd6d0bfe134c3c46b8c5fd442a7a7d1715c22ce6cea272148c50192e04504c",
  "execution-operations/app-skill-binding-v1.json": "c09cc0d07f5604e622042ec5ab7cbf917f8db8d57036a95c464213ec8fc90a11",
  "execution-operations/mcp-personal-product-v1.json": "b996af5f1897fb97c78f1f41e522e6b99af885c8319200a50a6a0865e19b34d0",
  "execution-operations/mcp-availability-v1.json": "44202f4b491d90414775654fdcfa0538fa5e1ce7585713040c8b7a8052d65e63",
  "execution-operations/project-skill-installation-v1.json": "1a0716883ad0c9136af002671afd9319872af8c93c3b7873d1d2149dc564a416",
  "errors/command-receipt-v1.json": "d82a4b30039adc0754fe1bcc43738fc68be2cd3cbef0e710d14089f55bc0ac68",
  "auth/bff-service-auth-v1.json": "4a6db18267a2a61e2b3582ece3a8bfae391db58280f06397125332ccaa97f0ef",
  "execution-operations/skill-installation-update-v1.json": "9b75d679665f42eb48d89e9c6fe99c39f2f019894db4a54de15e9f97622dd194",
  "descriptor/platform-v1.binpb": "6c7dadd8ccad5a5a1b56a4c9cf17acb7a1a3f41390e8e0c011fb120dd943483f",
  "execution-operations/custom-api-v1.json": "eca45ebd0f3c31d48cc174256dc23bda22de288ded91aa12198b1a2a37516a38",
  "execution-operations/mcp-private-server-v1.json": "066505d4a13cb6fd7a5f625b07eaf5f784b215db2a8584041f14da8ffc98eda1",
  "provenance.json": "cd5ebc24ce786b3c57bf0f42ce48abde0d7556e1fb3e44c18187589f41cc5073",
  "execution-operations/skill-acquisition-v1.json": "7c9cf9ed456199d4acd3d25f29154c8f098ed8866554476d37f058add0d78028",
  "openapi/platform-http.openapi.json": "085e1367f69c34edc6b80cbfb448596f36039f9857cee3bd5a407befbc295361",
  "mcp-package-admin/v1/profile.json": "d4b29dba0a5a6df8a0f36a654fcb81d5e95381568c0f5afd0bd104984366be75",
  "mcp-package-admin/v1/request-vectors.json": "2b12df83a21bec6c033d6a2a6a6db0931c47aa34af2c35abbc9eb7c7d159d62e",
  "descriptor/mcp-package-admin-v1.binpb": "847caf55170d2a0779e78c19a5d4bd61e6de397e6c873794c3e2811ddc4467f5",
  "execution-operations/skill-publication-precondition-v1.json": "9e4434d3786c8a8a40edc75e0733367e731cf2458eeb6f036f85f3256c4b6fcd",
  "execution-operations/skill-publication-precondition-v1.vectors.json": "f995955cf5fb79ba5067b34fd7b46011692bf584aade7b956fb4b423e3b9a055",
  "execution-operations/skill-series-delete-v1.json": "d1d12d52a244cb4abba87ed04d5480e5c6db3a2653d1b2b07be91d6a3576a1c3",
  "execution-operations/mcp-prepare-receipt-v1.json": "5f1be186adafbabd5689b2ece19aa8a9734d726bb9770792bae2d9d06213d17c",
  "execution-operations/mcp-prepare-receipt-v1.vectors.json": "68edb0714fecea2bc6657c976cdec4e4a62153e83e2460c640bc9da4a97de3b1",
  "descriptor/platform-mcp-prepare-receipt-parent.platform_runtime.proto.snapshot": "fc454844d272afba4815d2cab471518049ee9edaec514b59bb9d3e3b54e93835",
  "descriptor/platform-mcp-prepare-receipt-parent.platform-v1.binpb.snapshot": "a7c8a73925d004b0b18aef0e1a79813ceb589f7d702e6c6e695394f36bca3db3",
  "descriptor/platform-mcp-prepare-receipt-parent.platform_runtime_pb.ts.snapshot": "08f97b7762285c7d2234bcc707f275cf46eff7c0be3fd588aead4d91ccf89d05",
  "descriptor/platform-mcp-prepare-receipt-parent.mcp-private-server-v1.json.snapshot": "c3246a5d88b79f1358205e67658570bf6ced4b805fb414b3016f816e88dbc92a",
  "descriptor/platform-mcp-prepare-receipt-parent.provenance.json.snapshot": "32988e4ea40eff84dbf2f341a78803f20c6cebbca76192e05588c749420b29aa",
  "descriptor/platform-mcp-prepare-receipt-parent.mcp-runtime-v1.binpb.snapshot": "56388f48b7d2f563a7aa9f56e0b9d15e73b2a453d640b3c8297502354fee6dc2",
  "descriptor/platform-mcp-prepare-receipt-parent.mcp-runtime-v1.json.snapshot": "c35cc7adaeeca98f88449a3d51b08db73071cde6007bbe021030ec5328442b90",
  "descriptor/platform-mcp-prepare-receipt-parent.mcp-personal-sse-v1.json.snapshot": "29ea698428bc7be7469d6582746015e9e18ccb8887f035e89626e1791dcef647",
  "descriptor/mcp-runtime-v1.binpb": "56388f48b7d2f563a7aa9f56e0b9d15e73b2a453d640b3c8297502354fee6dc2",
  "execution-operations/mcp-runtime-v1.json": "c35cc7adaeeca98f88449a3d51b08db73071cde6007bbe021030ec5328442b90",
  "descriptor/platform-mcp-prepare-receipt-parents.json": "77b59d34550b69703bcbf2c02afdf88ba9d86afd0938524a5ca722e9ed586406",
  "descriptor/platform-mcp-prepare-receipt-delta.json": "2edf9b9273e4d05a1aa9a69f0335e13e33b7a8abf24ec2f184892244436c6b4a",
  "execution-operations/mcp-prepare-rejection-v1.json": "20ffcf5184ba4c14266eae73e27e0ca595ba3ba204418eb458e226afe5fae2b9",
  "descriptor/platform-mcp-prepare-rejection-parents.json": "d0fa1865eadd1b976ae9872be046e5ead72410ed6613a34b3fa2703e573129a1",
  "descriptor/platform-mcp-prepare-rejection-parent.platform_runtime.proto.snapshot": "1081183bae7a8377fb9f245fbc31612c88421a801f0c454a2d27702695e88409",
  "descriptor/platform-mcp-prepare-rejection-parent.platform-v1.binpb.snapshot": "89d0f77d7f775231ad0fcb3b0987fbe0f303982c5271fd9cd689633eaafd53d8",
  "descriptor/platform-mcp-prepare-rejection-parent.platform_runtime_pb.ts.snapshot": "2814a928d324a529c3ad6d27c98be9e21d30584c6a0bc22795e40c98ab289fa0",
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

const provenanceCombinedSha256 = "fe6643f9785fd92754d5b044c613ed63e4a44dfed57b0afdaf17b016b1d96e0a"
const ownerGenerated = {
  path: "src/generated/proto/kokoro/platform/v1/platform_runtime_pb.ts",
  sha256: "dfc1410f5cf18d18d449b35b7f92499e7b08c778d8f258b80f4abec0927c9d5d",
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
        {
          path: "contract/execution-operations/project-skill-installation-content-v1.json",
          sha256: artifactDigests["execution-operations/project-skill-installation-content-v1.json"],
        },
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
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.availability.profile.json.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.availability.profile.json.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.http.openapi.json.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.http.openapi.json.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.icon.profile.json.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.icon.profile.json.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.personal-product.profile.json.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.personal-product.profile.json.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.platform.binpb.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.platform.binpb.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.platform.generated.ts.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.platform.generated.ts.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.platform.proto.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.platform.proto.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.private-server.profile.json.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.private-server.profile.json.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.provenance.json.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.provenance.json.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.runtime.binpb.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.runtime.binpb.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.runtime.generated.ts.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.runtime.generated.ts.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.runtime.profile.json.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.runtime.profile.json.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.runtime.proto.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.runtime.proto.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-parent.runtime.request-vectors.json.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parent.runtime.request-vectors.json.snapshot"],
        },
        { path: "contract/descriptor/platform-mcp-personal-sse-parents.json", sha256: artifactDigests["descriptor/platform-mcp-personal-sse-parents.json"] },
        {
          path: "contract/descriptor/platform-mcp-personal-sse-source-delta.json",
          sha256: artifactDigests["descriptor/platform-mcp-personal-sse-source-delta.json"],
        },
        {
          path: "contract/execution-operations/mcp-personal-sse-request-vectors-v1.json",
          sha256: artifactDigests["execution-operations/mcp-personal-sse-request-vectors-v1.json"],
        },
        { path: "contract/execution-operations/mcp-personal-sse-v1.json", sha256: artifactDigests["execution-operations/mcp-personal-sse-v1.json"] },

        { path: "contract/execution-operations/mcp-prepare-receipt-v1.json", sha256: artifactDigests["execution-operations/mcp-prepare-receipt-v1.json"] },
        {
          path: "contract/execution-operations/mcp-prepare-receipt-v1.vectors.json",
          sha256: artifactDigests["execution-operations/mcp-prepare-receipt-v1.vectors.json"],
        },
        {
          path: "contract/descriptor/platform-mcp-prepare-receipt-parent.platform_runtime.proto.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-prepare-receipt-parent.platform_runtime.proto.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-prepare-receipt-parent.platform-v1.binpb.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-prepare-receipt-parent.platform-v1.binpb.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-prepare-receipt-parent.platform_runtime_pb.ts.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-prepare-receipt-parent.platform_runtime_pb.ts.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-prepare-receipt-parent.mcp-private-server-v1.json.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-prepare-receipt-parent.mcp-private-server-v1.json.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-prepare-receipt-parent.provenance.json.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-prepare-receipt-parent.provenance.json.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-prepare-receipt-parent.mcp-runtime-v1.binpb.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-prepare-receipt-parent.mcp-runtime-v1.binpb.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-prepare-receipt-parent.mcp-runtime-v1.json.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-prepare-receipt-parent.mcp-runtime-v1.json.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-prepare-receipt-parent.mcp-personal-sse-v1.json.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-prepare-receipt-parent.mcp-personal-sse-v1.json.snapshot"],
        },
        { path: "contract/descriptor/mcp-runtime-v1.binpb", sha256: artifactDigests["descriptor/mcp-runtime-v1.binpb"] },
        { path: "contract/execution-operations/mcp-runtime-v1.json", sha256: artifactDigests["execution-operations/mcp-runtime-v1.json"] },
        {
          path: "contract/descriptor/platform-mcp-prepare-receipt-parents.json",
          sha256: artifactDigests["descriptor/platform-mcp-prepare-receipt-parents.json"],
        },
        { path: "contract/descriptor/platform-mcp-prepare-receipt-delta.json", sha256: artifactDigests["descriptor/platform-mcp-prepare-receipt-delta.json"] },
        { path: "contract/execution-operations/mcp-prepare-rejection-v1.json", sha256: artifactDigests["execution-operations/mcp-prepare-rejection-v1.json"] },
        {
          path: "contract/descriptor/platform-mcp-prepare-rejection-parents.json",
          sha256: artifactDigests["descriptor/platform-mcp-prepare-rejection-parents.json"],
        },
        {
          path: "contract/descriptor/platform-mcp-prepare-rejection-parent.platform_runtime.proto.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-prepare-rejection-parent.platform_runtime.proto.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-prepare-rejection-parent.platform-v1.binpb.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-prepare-rejection-parent.platform-v1.binpb.snapshot"],
        },
        {
          path: "contract/descriptor/platform-mcp-prepare-rejection-parent.platform_runtime_pb.ts.snapshot",
          sha256: artifactDigests["descriptor/platform-mcp-prepare-rejection-parent.platform_runtime_pb.ts.snapshot"],
        },
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
      base_commit: "7d8115a4b0dc752687babe7db35d0a936f51c76a",
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
