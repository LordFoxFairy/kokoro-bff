import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test, { afterEach } from "node:test"
const roots = new Set()
const TENANT = "tenant-product-local"
const entry = (secret = "bff-projection-secret-000000000000") => ({
  credential_id: "projection",
  secret,
  caller: "kokoro-bff",
  surfaces: ["projection"],
  tenant_id: TENANT,
})
async function fixture(contents) {
  const directory = await mkdtemp(path.join(tmpdir(), "platform-skills-auth-"))
  roots.add(directory)
  const file = path.join(directory, "credentials.json")
  await writeFile(file, JSON.stringify(contents), { mode: 0o600 })
  return file
}
afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })))
  roots.clear()
})

test("production Skills factories use independent direct catalog/admin credentials, never IAM minting", async (t) => {
  const { createServer } = await import("node:http")
  const { once } = await import("node:events")
  const { Code, ConnectError } = await import("@connectrpc/connect")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { createBffComposition } = await import("../dist/bootstrap/runtime.js")
  const requests = []
  const peer = createServer((request, response) => {
    requests.push({ path: request.url, credential: request.headers.authorization })
    request.resume()
    response.writeHead(403, { "content-type": "application/json" })
    response.end(JSON.stringify({ code: "permission_denied", message: "fixture denial" }))
  })
  peer.listen(0, "127.0.0.1")
  await once(peer, "listening")
  t.after(() => new Promise((resolve) => peer.close(resolve)))
  const base = `http://127.0.0.1:${peer.address().port}`
  const catalog = { ...entry("catalog-direct-fixture-00000000000"), credential_id: "catalog", surfaces: ["catalog"] }
  const admin = { ...entry("admin-direct-fixture-0000000000000"), credential_id: "admin", surfaces: ["skills_admin"] }
  const config = loadConfig({
    KOKORO_BFF_SHARED_SECRET: "fixture-secret",
    KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
    KOKORO_PLATFORM_BASE_URL: base,
    KOKORO_IAM_BASE_URL: base,
    KOKORO_BFF_PLATFORM_CATALOG_SERVICE_CREDENTIAL_FILE: await fixture({ version: 1, entries: [catalog] }),
    KOKORO_BFF_PLATFORM_SKILLS_ADMIN_SERVICE_CREDENTIAL_FILE: await fixture({ version: 1, entries: [admin] }),
    KOKORO_PLATFORM_PROJECTION_CREDENTIAL_FILE: await fixture({ version: 1, entries: [entry()] }),
  })
  const runtime = createBffComposition(config, { businessStore: null })
  t.after(() => runtime.close())
  assert.ok(runtime.skillDraftClient, "catalog factory is configured without OAuth")
  assert.ok(runtime.skillProductClient)
  assert.ok(runtime.installationClient)
  assert.ok(runtime.localSkillImportClient)
  assert.ok(runtime.skillAdminClient, "admin factory is configured without OAuth")
  const context = { requestId: "fixture-request", tenant: TENANT, subject: "user" }
  const signal = AbortSignal.timeout(1000)
  const deadline = performance.now() + 1000
  for (const call of [
    () => runtime.skillDraftClient.getPackageUpload({ ...context, user: "user", skillId: "skill" }, signal, deadline),
    () => runtime.skillProductClient.getPackageUpload({ ...context, skillId: "skill" }, signal, deadline),
    () =>
      runtime.installationClient.setEnabled(
        { ...context, installationId: "installation", enabled: false, commandId: "command", digest: "a".repeat(64) },
        signal,
      ),
    () =>
      runtime.localSkillImportClient.begin(
        { ...context, commandId: "command", digest: "a".repeat(64), filename: "skill.zip", sizeBytes: 1, contentSha256: "a".repeat(64) },
        signal,
        deadline,
      ),
    () => runtime.skillAdminClient.list(context, {}, signal, deadline),
  ])
    await assert.rejects(call(), (error) => error instanceof ConnectError && error.code === Code.PermissionDenied)
  assert.equal(requests.length, 5)
  assert.equal(requests.filter((request) => request.path.includes("oauth") || request.path.includes("introspect")).length, 0)
  assert.deepEqual(
    requests.map((request) => request.credential),
    [...Array(4).fill(`Bearer ${catalog.secret}`), `Bearer ${admin.secret}`],
  )
})
