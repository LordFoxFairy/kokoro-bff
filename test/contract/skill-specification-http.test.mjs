import assert from "node:assert/strict"
import test from "node:test"
import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { create } from "@bufbuild/protobuf"
import { TimestampSchema } from "@bufbuild/protobuf/wkt"
import { Code, ConnectError } from "@connectrpc/connect"
import { SkillDownloadHandles } from "../../src/application/skill-download-handles.ts"
import { createBffServer } from "../../src/bootstrap/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../../src/config/runtime.ts"
import { SkillInstallationChange, SkillProductFactsSchema } from "../../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts"

const website = "/skill.v1.SkillOptionalService/"
const headers = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
  authorization: "Bearer human",
  "x-request-id": "spec-request",
}
const publicSkill = {
  id: "stable-series",
  name: "Skill",
  description: "Description",
  owner_type: "personal",
  creator_info: { user_id: "human", name: "Creator" },
  created_at: 1750000000,
  updated_at: 1750000001,
}
const detail = {
  id: "stable-series",
  name: "Skill",
  version: "version-one",
  defaultEnable: false,
  defaultAdd: false,
}
const hub = {
  skills: [
    {
      skillId: "stable-series",
      originalName: "original",
      displayName: "Skill",
      currentVersion: {
        versionUid: "version-one",
        archiveSize: "3",
        fileCount: 1,
        current: true,
      },
    },
  ],
  tagOptions: { values: [{ tag: "coding", displayName: "Coding" }] },
}
async function fixture(
  source,
  admission = async () => ({
    ok: true,
    identity: { namespace: "tenant", userId: "human" },
    platformAdmin: false,
  }),
  configOverride = {},
  options = {},
) {
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "bff.test",
    tenantId: "tenant",
    iamBaseUrl: null,
    sharedSecret: "test-secret",
    upstreamSecret: null,
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 1048576,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {
      system: null,
      capability: null,
      scheduler: null,
      agents: null,
      billing: null,
      music: null,
    },
    ...configOverride,
  }
  const server = createBffServer(config, {
    businessStore: null,
    sessionAdmission: { verify: admission },
    skillSpecificationSource: source,
    ...options,
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    async request(path, input, extra = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        headers: {
          ...headers,
          ...(input === undefined ? {} : { "content-type": "application/json" }),
          ...extra.headers,
        },
        ...(input === undefined
          ? {}
          : {
              method: "POST",
              body: typeof input === "string" ? input : JSON.stringify(input),
            }),
        ...extra,
      })
      return {
        status: response.status,
        headers: response.headers,
        body: response.headers.get("content-type") === "application/zip" ? Buffer.from(await response.arrayBuffer()) : await response.json(),
      }
    },
    async close() {
      server.closeAllConnections()
      await server.shutdown()
    },
  }
}

test("R357 public skill.list uses original ok/request_id/data, immutable identity and stopped installations without writes", async () => {
  const calls = []
  const app = await fixture({
    async read(operation, input, context) {
      calls.push({ operation, input, context })
      return [publicSkill]
    },
  })
  try {
    const result = await app.request("/v1/skill.list?project_id=project")
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, {
      ok: true,
      request_id: "spec-request",
      data: [publicSkill],
    })
    assert.equal(result.headers.get("cache-control"), "no-store")
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].input, { project_id: "project" })
    assert.equal(calls[0].context.identity.userId, "human")
  } finally {
    await app.close()
  }
})
for (const [name, input, body] of [
  ["ListSkills", {}, { userAddedSkills: [detail], officialSkills: [] }],
  ["ListHubSkills", { pageSize: 1 }, { ...hub, nextPageToken: "opaque" }],
]) {
  test(`R357 website ${name} keeps camelCase/raw envelope and absent false fields`, async () => {
    const calls = []
    const app = await fixture({
      async read(operation, input) {
        calls.push({ operation, input })
        return body
      },
    })
    try {
      const result = await app.request(website + name, input)
      assert.equal(result.status, 200)
      assert.deepEqual(result.body, body)
      assert.deepEqual(calls[0].input, input)
      assert.equal(result.headers.get("cache-control"), "no-store")
    } finally {
      await app.close()
    }
  })
}
test("R357 observed website inputs reject duplicate keys/null/unknown members and wrong methods before owner", async () => {
  let calls = 0
  const app = await fixture({
    async read() {
      calls++
      return hub
    },
  })
  try {
    for (const body of ['{"pageSize":1,"pageSize":2}', { pageSize: null }, { shuffle: null }, { pageSize: 1, source_kind: "personal" }]) {
      const r = await app.request(website + "ListHubSkills", body)
      assert.equal(r.status, 400)
    }
    assert.equal(calls, 0)
    assert.equal((await app.request(website + "ListSkills")).status, 405)
  } finally {
    await app.close()
  }
})
test("R357 skill.list rejects unknown/duplicate query and never enables or imports", async () => {
  let calls = 0
  const app = await fixture({
    async read() {
      calls++
      return []
    },
  })
  try {
    for (const suffix of ["?project_id=a&project_id=b", "?source_kind=personal", "?project_id="])
      assert.equal((await app.request("/v1/skill.list" + suffix)).status, 400)
    assert.equal(calls, 0)
  } finally {
    await app.close()
  }
})
test("R357 unpublished owner dependency fails closed503, never falls back to previous projection", async () => {
  const app = await fixture(null)
  try {
    const r = await app.request("/v1/skill.list")
    assert.equal(r.status, 503)
    assert.deepEqual(r.body, {
      ok: false,
      request_id: "spec-request",
      error: {
        code: "Unavailable",
        message: "Skills dependency is unavailable",
      },
    })
  } finally {
    await app.close()
  }
})
test("R357 private read methods require fresh current human/tenant; scope is not admission", async () => {
  let calls = 0
  const app = await fixture(
    {
      async read() {
        calls++
        return hub
      },
    },
    async () => ({ ok: false, status: 401, code: "session_invalid" }),
  )
  try {
    const r = await app.request(website + "ListHubSkills", {})
    assert.equal(r.status, 401)
    assert.equal(calls, 0)
  } finally {
    await app.close()
  }
})
test("R357 corresponding obsolete REST reads are404, not compatibility aliases", async () => {
  const app = await fixture({
    async read() {
      throw Error("old alias must not call new owner")
    },
  })
  try {
    for (const path of ["/v1/skills", "/v1/skills/pool", "/v1/skills/catalog", "/v1/skills/stable-series", "/v1/skills/stable-series/download"])
      assert.equal((await app.request(path)).status, 404)
  } finally {
    await app.close()
  }
})

test("R357 Hub forwards observed tag/query/includeOfficialSkills before owner pagination without inventing cursor", async () => {
  const calls = []
  const app = await fixture({
    async read(operation, input) {
      calls.push(input)
      return hub
    },
  })
  try {
    const input = {
      query: "excel",
      pageSize: 9,
      tag: "SKILL_HUB_TAG_CODING",
      includeOfficialSkills: true,
    }
    assert.equal((await app.request(website + "ListHubSkills", input)).status, 200)
    assert.deepEqual(calls, [input])
    assert.equal((await app.request(website + "ListHubSkills", { cursor: "opaque" })).status, 400)
  } finally {
    await app.close()
  }
})
for (const name of ["GetSkill", "DownloadSkill"])
  test(`R357 ${name} issues same-origin opaque bytes resource bound to exact version, actual filename and expiry`, async () => {
    const operation = name === "GetSkill" ? website + name : "/skill.v1.SkillService/DownloadSkill"
    const binding = {
      tenantId: "tenant",
      subjectId: "human",
      qualifier: { kind: "catalog_current", seriesId: "stable-series" },
      sourceRef: "skill:version-one",
      revision: "1",
      filename: "original.zip",
      sizeBytes: 3,
      contentSha256: "a".repeat(64),
      expiresAt: Date.now() + 300000,
      transfer: {
        url: "http://private-store.invalid/secret",
        method: "GET",
        requiredHeaders: {},
        expiresAt: Date.now() + 300000,
      },
    }
    const app = await fixture({
      async prepareDownload() {
        return { skill: detail, binding }
      },
    })
    try {
      const r = await app.request(operation, { skillId: "stable-series" })
      assert.equal(r.status, 200)
      assert.deepEqual(r.body.skill, detail)
      assert.match(r.body.downloadInfo.downloadUrl, /^\/api\/skill-downloads\/[\w-]{43}$/)
      assert.equal(r.body.downloadInfo.filename, "original.zip")
      assert.ok(Date.parse(r.body.downloadInfo.expiresAt) > Date.now())
      assert.ok(Date.parse(r.body.downloadInfo.expiresAt) <= Date.now() + 60000)
      assert.equal(JSON.stringify(r.body).includes("private-store"), false)
    } finally {
      await app.close()
    }
  })
test("R357 prepare refuses different stable identity/tenant/subject without disclosing transport", async () => {
  const app = await fixture({
    async prepareDownload() {
      return { skill: { ...detail, id: "another" }, binding: {} }
    },
  })
  try {
    const r = await app.request(website + "GetSkill", {
      skillId: "stable-series",
    })
    assert.equal(r.status, 502)
    assert.equal(JSON.stringify(r.body).includes("another"), false)
  } finally {
    await app.close()
  }
})
test("R357 byte handle missing or lost after restart is410, not latest/version fallback", async () => {
  const app = await fixture({
    async confirmDownload() {
      throw Error("must not resolve missing handle")
    },
  })
  try {
    assert.equal((await app.request("/skill-downloads/" + "x".repeat(43))).status, 410)
  } finally {
    await app.close()
  }
})

test("R357 opaque handle remains tenant/subject/version bound, expires and is capacity bounded without rewriting old references", () => {
  let now = 1000
  const store = new SkillDownloadHandles(100, 1, () => now)
  const binding = {
    tenantId: "tenant",
    subjectId: "human",
    qualifier: { kind: "catalog_current", seriesId: "stable" },
    sourceRef: "skill:old-installed",
    revision: "1",
    filename: "archive.zip",
    sizeBytes: 3,
    contentSha256: "a".repeat(64),
    expiresAt: 5000,
    transfer: {
      url: "http://store.invalid/key",
      method: "GET",
      requiredHeaders: {},
      expiresAt: 5000,
    },
  }
  const handle = store.issue(binding)
  binding.sourceRef = "skill:newest"
  binding.transfer.url = "http://other.invalid/key"
  assert.equal(store.resolve(handle.handle, "tenant", "human").binding.sourceRef, "skill:old-installed")
  assert.equal(store.resolve(handle.handle, "tenant", "human").binding.transfer.url, "http://store.invalid/key")
  assert.throws(() => store.resolve(handle.handle, "other", "human"), /forbidden/)
  assert.throws(() => store.resolve(handle.handle, "tenant", "other"), /forbidden/)
  const replacement = store.issue(binding)
  assert.notEqual(replacement.handle, handle.handle)
  assert.throws(() => store.resolve(handle.handle, "tenant", "human"), /expired/)
  assert.equal(store.resolve(replacement.handle, "tenant", "human").binding.sourceRef, "skill:newest")
  now = 1100
  assert.throws(() => store.resolve(handle.handle, "tenant", "human"), /expired/)
  assert.ok(store.issue(binding))
  store.clear()
  assert.throws(() => store.resolve(handle.handle, "tenant", "human"), /expired/)
})
async function bytesFixture(confirm, admission, filename = "原始技能.zip") {
  const bytes = Buffer.from("actual verified ZIP bytes")
  let objects = 0
  const object = createServer((request, response) => {
    objects++
    response.writeHead(200, { "content-length": bytes.length })
    response.end(bytes)
  })
  await new Promise((resolve) => object.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${object.address().port}`
  const binding = {
    tenantId: "tenant",
    subjectId: "human",
    qualifier: { kind: "catalog_current", seriesId: "stable-series" },
    sourceRef: "skill:version-one",
    revision: "1",
    filename,
    sizeBytes: bytes.length,
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
    expiresAt: Date.now() + 300000,
    transfer: {
      url: origin + "/bytes",
      method: "GET",
      requiredHeaders: {},
      expiresAt: Date.now() + 300000,
    },
  }
  const app = await fixture(
    {
      async prepareDownload() {
        return { skill: detail, binding }
      },
      async confirmDownload(...args) {
        await confirm(...args)
      },
    },
    admission,
    { storageObjectOrigin: origin },
  )
  const metadata = await app.request("/skill.v1.SkillService/DownloadSkill", {
    skillId: "stable-series",
  })
  assert.equal(metadata.status, 200)
  return {
    ...app,
    bytes,
    binding,
    path: metadata.body.downloadInfo.downloadUrl.slice(4),
    objects: () => objects,
    async close() {
      await app.close()
      object.closeAllConnections()
      await new Promise((resolve) => object.close(resolve))
    },
  }
}
test("R357 handle serves real hash/size verified bytes, requalifies exact version twice and reads current human again", async () => {
  const calls = []
  const app = await bytesFixture(async (binding) => {
    calls.push(binding.sourceRef)
  })
  try {
    const result = await app.request(app.path)
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, app.bytes)
    assert.deepEqual(calls, ["skill:version-one", "skill:version-one"])
    assert.equal(app.objects(), 1)
    assert.match(result.headers.get("content-disposition"), /filename\*=UTF-8''%E5/)
    assert.equal(result.headers.get("cache-control"), "no-store")
  } finally {
    await app.close()
  }
})
test("R357 handle revocation before object read is403 and performs zero object I/O", async () => {
  const app = await bytesFixture(async () => {
    throw new ConnectError("secret owner message", Code.PermissionDenied)
  })
  try {
    const r = await app.request(app.path)
    assert.equal(r.status, 403)
    assert.equal(app.objects(), 0)
    assert.equal(JSON.stringify(r.body).includes("secret"), false)
  } finally {
    await app.close()
  }
})
test("R357 handle current qualification loss after spool never publishes bytes", async () => {
  let calls = 0
  const app = await bytesFixture(async () => {
    if (++calls === 2) throw new ConnectError("hidden", Code.NotFound)
  })
  try {
    const r = await app.request(app.path)
    assert.equal(r.status, 404)
    assert.notEqual(r.headers.get("content-type"), "application/zip")
    assert.equal(app.objects(), 1)
  } finally {
    await app.close()
  }
})
test("R357 changed current human after spool denies without publishing bytes", async () => {
  let admissions = 0
  const app = await bytesFixture(
    async () => {},
    async () => ({
      ok: true,
      identity: {
        namespace: "tenant",
        userId: ++admissions > 2 ? "other" : "human",
      },
      platformAdmin: false,
    }),
  )
  try {
    const r = await app.request(app.path)
    assert.equal(r.status, 403)
    assert.notEqual(r.headers.get("content-type"), "application/zip")
  } finally {
    await app.close()
  }
})
test("R357 metadata invalid response remains502; never synthesizes absent actor/name/false/count", async () => {
  const app = await fixture({
    async read() {
      return {
        skills: [{ skillId: "stable-series", verified: null }],
        tagOptions: {},
      }
    },
  })
  try {
    assert.equal((await app.request(website + "ListHubSkills", {})).status, 502)
  } finally {
    await app.close()
  }
})

test("T-K03.19 SetSkillInstallationEnabled uses only owner-issued installation identity and preserves owner idempotency semantics", async () => {
  const calls = []
  const installation = {
    installationId: { value: "installation-stable" },
    acquisitionKind: 1,
    sourceRef: { value: "skill:version-one" },
    seriesId: { value: "stable-series" },
    revision: 1n,
    installed: true,
    enabled: false,
    installedAt: { seconds: 1n, nanos: 0 },
    updatedAt: { seconds: 2n, nanos: 0 },
    displayName: "清单整理助手",
    summary: "",
    tags: [],
    sourceStatus: 2,
    skillUpdatedAt: { seconds: 2n, nanos: 0 },
    examplePrompts: { prompts: [] },
    categoryKeys: { keys: [] },
    product: create(SkillProductFactsSchema, {
      publicationAudience: "owner",
      stateVersion: 1n,
    }),
  }
  const client = {
    async setEnabled(input) {
      calls.push(input)
      if (calls.length === 3) throw new ConnectError("same key drift", Code.AlreadyExists)
      return {
        installation: { ...installation, enabled: input.enabled },
        change: input.enabled ? SkillInstallationChange.ENABLED : SkillInstallationChange.DISABLED,
        eventId: "event-1",
        replayed: calls.length === 2,
      }
    },
  }
  const app = await fixture(
    {
      async read() {
        return { userAddedSkills: [], officialSkills: [] }
      },
    },
    undefined,
    {},
    { installationClient: client },
  )
  try {
    const command = website + "SetSkillInstallationEnabled"
    const commandHeaders = {
      ...headers,
      "content-type": "application/json",
      "idempotency-key": "same-key",
    }
    const first = await app.request(command, { installationId: "installation-stable", enabled: false }, { headers: commandHeaders })
    const replay = await app.request(command, { installationId: "installation-stable", enabled: false }, { headers: commandHeaders })
    const drift = await app.request(command, { installationId: "installation-stable", enabled: true }, { headers: commandHeaders })
    assert.equal(first.status, 200)
    assert.equal(replay.status, 200)
    assert.equal(replay.body.data.replayed, true)
    assert.equal(drift.status, 409)
    assert.equal(calls[0].installationId, "installation-stable")
    assert.equal(calls[0].commandId, calls[1].commandId)
    assert.notEqual(calls[1].digest, calls[2].digest)
    assert.equal(
      calls.some((call) => JSON.stringify(call).includes("清单整理助手")),
      false,
    )
    const displayName = await app.request(
      command,
      { installationId: "清单整理助手", enabled: false },
      {
        headers: {
          ...headers,
          "content-type": "application/json",
          "idempotency-key": "display-name",
        },
      },
    )
    assert.equal(displayName.status, 400)
    assert.equal(calls.length, 3)
    assert.equal((await app.request("/v1/self/skills/%E6%B8%85%E5%8D%95%E6%95%B4%E7%90%86%E5%8A%A9%E6%89%8B/disable?scope=official", {})).status, 404)
  } finally {
    await app.close()
  }
})

test("R357 active public contract declares original skill.list and distinct observed website/bytes resources, deletes aliases and preserves effective commands", async () => {
  const { readFile } = await import("node:fs/promises")
  const { load } = await import("js-yaml")
  const document = load(await readFile(new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"))
  assert.equal(document.info.version, "22.1.0")
  assert.equal(document.paths["/v1/skill.list"].get.operationId, "listSkills")
  for (const path of [website + "ListSkills", website + "ListHubSkills", website + "GetSkill", "/skill.v1.SkillService/DownloadSkill"]) {
    assert.equal(document.paths[path].post["x-kokoro-visibility"], "browser-private")
    assert.equal(document.paths[path].post["x-kokoro-idempotency"], "none")
  }
  for (const path of ["/v1/skills", "/v1/skills/pool", "/v1/skills/catalog", "/v1/skills/{skill_id}", "/v1/skills/{skill_id}/download"])
    assert.equal(document.paths[path]?.get, undefined)
  assert.ok(document.paths["/v1/skills/drafts"].post)
  assert.ok(document.paths["/v1/admin/skills/{skill_id}/publish"].post)
  assert.ok(document.paths["/v1/skill-installations"].post)
  assert.ok(document.paths["/skill-downloads/{handle}"].get)
  assert.equal(document.components.schemas.SpecificationPublicSkill.properties.created_at.format, "int64")
  assert.deepEqual(document.components.schemas.SpecificationPublicSkill.properties.owner_type.enum, [
    "personal",
    "official",
    "team",
    "project",
    "app",
    "hub",
    "device",
    "unknown",
  ])
  assert.deepEqual(Object.keys(document.components.schemas.SpecificationHubRequest.properties), [
    "pageSize",
    "shuffle",
    "includeOfficialSkills",
    "tag",
    "query",
    "pageToken",
    "excludeTop",
  ])
})

test("R357 active contract rejects observed-field/type/error/alias/auth/cache drift without historical version restoration", async () => {
  const { readFile } = await import("node:fs/promises")
  const { load, dump } = await import("js-yaml")
  const { inspectCurrentSkillsSpecificationContract } = await import("../../scripts/verify-skill-product-contract.mjs")
  const raw = await readFile(new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  assert.deepEqual(inspectCurrentSkillsSpecificationContract(raw), [])
  for (const change of [
    (d) => (d.paths["/v1/skill.list"].get.security = []),
    (d) =>
      d.paths["/v1/skill.list"].get.parameters.push({
        name: "tenant",
        in: "query",
      }),
    (d) => (d.components.schemas.SpecificationPublicSkill.properties.created_at.type = "string"),
    (d) => d.components.schemas.SpecificationPublicSkill.properties.owner_type.enum.pop(),
    (d) => d.components.schemas.SpecificationPublicSkill.properties.owner_type.enum.push("forged"),
    (d) =>
      (d.components.schemas.SpecificationHubRequest.properties.cursor = {
        type: "string",
      }),
    (d) => (d.components.schemas.SpecificationHubRequest.properties.includeOfficialSkills.type = "string"),
    (d) => (d.components.schemas.SpecificationDownloadInfo.properties.downloadInfo.properties.expiresAt.type = "integer"),
    (d) => (d.components.schemas.SpecificationPublicError.properties.error.properties.retryable = { type: "boolean" }),
    (d) => delete d.paths["/v1/skill-installations"].post,
    (d) => delete d.paths["/skill.v1.SkillOptionalService/GetSkill"].post.responses["200"].headers["Cache-Control"],
    (d) => (d.paths["/v1/skills"] = { get: d.paths["/v1/skill.list"].get }),
  ]) {
    const candidate = load(raw)
    change(candidate)
    assert.notDeepEqual(inspectCurrentSkillsSpecificationContract(dump(candidate, { lineWidth: -1, noRefs: true })), [])
  }
})
test("R357 disconnected projection cannot commit a late result or issue a late download handle", async () => {
  let finish, entered
  const called = new Promise((resolve) => (entered = resolve))
  let ownerSignal
  const app = await fixture({
    async read(_operation, _input, _context, signal) {
      ownerSignal = signal
      entered()
      return await new Promise((resolve) => (finish = resolve))
    },
  })
  const controller = new AbortController()
  try {
    const pending = app.request(website + "ListHubSkills", {}, { signal: controller.signal })
    await called
    controller.abort()
    await assert.rejects(pending, { name: "AbortError" })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(ownerSignal.aborted, true)
    finish(hub)
    await new Promise((resolve) => setTimeout(resolve, 20))
  } finally {
    await app.close()
  }
})

test("R357 adapter sees only freshly admitted human bearer in request context, never in response or handle facts", async () => {
  let token
  const app = await fixture({
    async read(_operation, _input, context) {
      token = context.humanBearer
      return [publicSkill]
    },
  })
  try {
    const r = await app.request("/v1/skill.list")
    assert.equal(r.status, 200)
    assert.equal(token, "human")
    assert.equal(Object.hasOwn(r.body, "humanBearer"), false)
  } finally {
    await app.close()
  }
})

test("R357 owner adapter cannot mutate the trusted tenant/subject admission snapshot", async () => {
  const app = await fixture({
    async read(_operation, _input, context) {
      assert.throws(() => {
        context.identity.userId = "other"
      }, TypeError)
      assert.throws(() => {
        context.identity.namespace = "other"
      }, TypeError)
      return [publicSkill]
    },
  })
  try {
    assert.equal((await app.request("/v1/skill.list")).status, 200)
  } finally {
    await app.close()
  }
})
test("R357 malformed download owner envelope is502 with fixed error, not transport data or implicit fallback", async () => {
  const app = await fixture({
    async prepareDownload() {
      return null
    },
  })
  try {
    const r = await app.request(website + "GetSkill", {
      skillId: "stable-series",
    })
    assert.equal(r.status, 502)
    assert.equal(r.body.error.code, "InvalidResponse")
  } finally {
    await app.close()
  }
})

test("R357 observed next page sends original pageToken/excludeTop and original filter to owner without client-side page filtering", async () => {
  const calls = []
  const app = await fixture({
    async read(operation, input) {
      calls.push(input)
      return hub
    },
  })
  try {
    const input = {
      pageSize: 9,
      pageToken: "opaque-original-page",
      excludeTop: true,
      includeOfficialSkills: true,
    }
    assert.equal((await app.request(website + "ListHubSkills", input)).status, 200)
    assert.deepEqual(calls, [input])
    for (const invalid of [{ pageToken: null }, { excludeTop: null }, { excludeTop: "true" }])
      assert.equal((await app.request(website + "ListHubSkills", invalid)).status, 400)
    assert.equal(calls.length, 1)
  } finally {
    await app.close()
  }
})

test("R357 formal current-publication adapter uses actual generated binary request for stable series, product purpose and one trusted deadline", async () => {
  const { SkillProductConnectClient } = await import("../../src/infrastructure/clients/platform/skill-product-connect.ts")
  const p = await import("../../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts")
  const { create, fromBinary, toBinary } = await import("@bufbuild/protobuf")
  assert.equal(typeof SkillProductConnectClient.prototype.current, "function", "formal adapter pending: current is not a legacy version-id fallback")
  let received
  const owner = createServer(async (request, response) => {
    const chunks = []
    for await (const part of request) chunks.push(part)
    received = {
      path: request.url,
      body: fromBinary(p.GetCurrentSkillRequestSchema, Buffer.concat(chunks)),
      headers: request.headers,
    }
    const result = create(p.GetCurrentSkillResponseSchema, {
      publication: {
        seriesId: { value: "stable-series" },
        currentVersion: {
          skillId: { value: "exact-version" },
          seriesId: { value: "stable-series" },
        },
        current: true,
        audience: "public",
        stateVersion: 3n,
      },
    })
    response.writeHead(200, {
      "content-type": "application/proto",
      "cache-control": "no-store",
      "x-kokoro-request-id": "current-request",
    })
    response.end(toBinary(p.GetCurrentSkillResponseSchema, result))
  })
  await new Promise((resolve) => owner.listen(0, "127.0.0.1", resolve))
  const controller = new AbortController()
  let minted = 0
  const token = {
    async get(tenant, signal, deadline) {
      assert.equal(tenant, "tenant")
      assert.equal(signal, controller.signal)
      assert.ok(deadline > performance.now())
      minted++
      return "formal-read-workload"
    },
  }
  const client = new SkillProductConnectClient(`http://127.0.0.1:${owner.address().port}`, token, token, 1000)
  try {
    const result = await client.current(
      {
        requestId: "current-request",
        tenant: "tenant",
        subject: "human",
        seriesId: "stable-series",
      },
      controller.signal,
      performance.now() + 1000,
    )
    assert.equal(result.publication.currentVersion.skillId.value, "exact-version")
    assert.equal(received.path, "/kokoro.platform.v1.ProductSkillReadService/GetCurrentSkill")
    assert.equal(received.body.seriesId.value, "stable-series")
    assert.equal(received.body.purpose, "product")
    assert.equal(received.headers["x-kokoro-subject"], "human")
    assert.equal(minted, 1)
  } finally {
    owner.closeAllConnections()
    await new Promise((resolve) => owner.close(resolve))
  }
})

test("R357 malformed qualified handle facts fail502 before any successful metadata ACK", async () => {
  const valid = {
    tenantId: "tenant",
    subjectId: "human",
    qualifier: { kind: "catalog_current", seriesId: "stable-series" },
    sourceRef: "skill:version-one",
    revision: "1",
    filename: "real.zip",
    sizeBytes: 3,
    contentSha256: "a".repeat(64),
    expiresAt: Date.now() + 300000,
    transfer: {
      url: "http://store.invalid/blob",
      method: "GET",
      requiredHeaders: {},
      expiresAt: Date.now() + 300000,
    },
  }
  for (const change of [
    (b) => (b.revision = 4),
    (b) => delete b.transfer,
    (b) => (b.transfer.method = "PUT"),
    (b) => (b.transfer.requiredHeaders = { authorization: "hidden" }),
  ]) {
    const binding = structuredClone(valid)
    change(binding)
    const app = await fixture({
      async prepareDownload() {
        return { skill: detail, binding }
      },
    })
    try {
      const r = await app.request(website + "GetSkill", {
        skillId: "stable-series",
      })
      assert.equal(r.status, 502)
      assert.equal(JSON.stringify(r.body).includes("hidden"), false)
    } finally {
      await app.close()
    }
  }
})

test("R357 cancelled metadata never issues a handle from late owner results", async (t) => {
  let finish, entered
  const called = new Promise((resolve) => (entered = resolve))
  const spy = t.mock.method(SkillDownloadHandles.prototype, "issue")
  const app = await fixture({
    async prepareDownload() {
      entered()
      return await new Promise((resolve) => (finish = resolve))
    },
  })
  const controller = new AbortController()
  try {
    const pending = app.request(website + "GetSkill", { skillId: "stable-series" }, { signal: controller.signal })
    await called
    controller.abort()
    await assert.rejects(pending, { name: "AbortError" })
    await new Promise((resolve) => setTimeout(resolve, 20))
    finish({ skill: detail, binding: {} })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(spy.mock.calls.length, 0)
  } finally {
    await app.close()
  }
})
test("R357 raw read body budget rejects oversized JSON413 without owner I/O or sensitive echo", async () => {
  let calls = 0
  const app = await fixture({
    async read() {
      calls++
      return hub
    },
  })
  try {
    const r = await app.request(website + "ListHubSkills", {
      query: "sensitive".repeat(9000),
    })
    assert.equal(r.status, 413)
    assert.equal(calls, 0)
    assert.equal(JSON.stringify(r.body).includes("sensitive"), false)
  } finally {
    await app.close()
  }
})

async function specificationServiceFixture() {
  const { SkillSpecificationService } = await import("../../src/application/skill-specification.ts")
  const p = await import("../../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts")
  const { create } = await import("@bufbuild/protobuf")
  const product = {
    creatorRef: { kind: "user", id: "actual-creator" },
    publisher: {
      publisher: {
        case: "iam",
        value: { kind: "user", id: "actual-publisher" },
      },
    },
    sourceKind: "personal",
    presentationKind: "first_party",
    publicationAudience: "catalog",
    stateVersion: 2n,
  }
  const record = create(p.SkillProductRecordSchema, {
    skillId: { value: "current-version" },
    seriesId: { value: "stable-series" },
    sourceRef: { value: "skill:current-version" },
    revision: 2n,
    status: p.SkillStatus.ACTIVE,
    metadata: {
      displayName: "Current",
      summary: "Current description",
      tags: ["real-tag"],
      categoryKeys: { keys: ["programming"] },
      examplePrompts: { prompts: ["Real prompt"] },
    },
    packagePhase: p.SkillPackagePhase.VALIDATED,
    skillUpdatedAt: { seconds: 1750000001n },
    createdAt: { seconds: 1750000000n },
    ownerScope: { kind: "user", id: "actual-owner" },
    product,
    originalName: "real-original",
    fileCount: 1,
    archiveSize: 3n,
  })
  const installation = create(p.ProductSkillInstallationSchema, {
    installationId: { value: "installation" },
    sourceRef: { value: "skill:old-version" },
    seriesId: { value: "stable-series" },
    revision: 1n,
    installed: true,
    enabled: false,
    installedAt: { seconds: 1750000010n },
    updatedAt: { seconds: 1750000011n },
    skillUpdatedAt: { seconds: 1749999999n },
    displayName: "Old exact",
    summary: "Old description",
    sourceStatus: p.SkillStatus.ACTIVE,
    examplePrompts: { prompts: ["Old prompt"] },
    categoryKeys: { keys: ["programming"] },
    product,
  })
  Object.assign(installation, {
    acquisitionKind: 2,
    skillCreatedAt: create(TimestampSchema, { seconds: 1749999990n }),
    sourceOwnerScope: create(p.OwnerScopeSchema, {
      kind: "project",
      id: "source-project",
    }),
  })
  const calls = []
  let changed = false
  const deps = {
    product: {
      async current(input, signal, deadline) {
        calls.push({ kind: "current", input, signal, deadline })
        return create(p.GetCurrentSkillResponseSchema, {
          publication: {
            seriesId: { value: input.seriesId },
            currentVersion: changed
              ? {
                  ...record,
                  skillId: { value: "replacement" },
                  sourceRef: { value: "skill:replacement" },
                }
              : record,
            current: true,
            audience: "catalog",
            stateVersion: 1n,
            publishedAt: { seconds: 1750000002n },
          },
        })
      },
      async download(input, signal, deadline) {
        calls.push({ kind: "download", input, signal, deadline })
        return create(p.GetSkillPackageDownloadResponseSchema, {
          sourceRef: { value: input.sourceRef },
          revision: 2n,
          filename: "actual.zip",
          sizeBytes: 3n,
          contentSha256: "a".repeat(64),
          transferReference: {
            url: "http://objects.test/exact-current?versionId=original",
            method: "GET",
            requiredHeaders: {},
            expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 240) },
          },
        })
      },
    },
    installations: {
      async list(input, signal) {
        calls.push({ kind: "installed", input, signal })
        return { installations: [installation] }
      },
    },
    projection: {
      async read(operation, tenant, subject, requestId, input, signal) {
        calls.push({ kind: "projection", operation, input, signal })
        return {
          ok: true,
          status: 200,
          data: {
            skills: [
              {
                series_id: "stable-series",
                source_ref: "skill:current-version",
                name: "Current",
                description: "Current description",
                content_hash: "sha256:" + "a".repeat(64),
                scope: "personal",
                revision: "2",
                enabled: false,
                installed: true,
                acquisition_kind: "unknown",
                skill_updated_at: "2025-06-15T15:06:41.000Z",
                example_prompts: ["Real prompt"],
                category_keys: ["programming"],
                product: {
                  creator_ref: { kind: "user", id: "actual-creator" },
                  publisher: {
                    kind: "iam",
                    iam: { kind: "user", id: "actual-publisher" },
                  },
                  source_kind: "personal",
                  publication_audience: "catalog",
                  state_version: "2",
                  presentation_kind: "first_party",
                },
                created_at: "2025-06-15T15:06:40.000Z",
                updated_at: "2025-06-15T15:06:41.000Z",
                owner_scope: { kind: "user", id: "actual-owner" },
              },
            ],
            next_cursor: "original-owner-cursor",
          },
        }
      },
    },
    profiles: {
      async resolve(tenant, bearer, requestId, refs, signal) {
        calls.push({ kind: "profiles", refs, bearer, signal })
        return new Map(
          refs.map((ref) => [
            JSON.stringify([ref.kind, ref.id]),
            {
              ...ref,
              status: "found",
              display_name: ref.id === "actual-creator" ? "Real Creator" : "Real Publisher",
              image_url: null,
            },
          ]),
        )
      },
    },
    usage: async (tenant, refs) => new Map(refs.map((ref) => [ref, { status: "available", successfulRunCount: "7" }])),
    objectOrigin: "http://objects.test",
  }
  const { PlatformSkillSpecificationFacade } = await import("../../src/infrastructure/clients/platform/skill-specification-facade.ts")
  deps.owner = new PlatformSkillSpecificationFacade({
    product: deps.product,
    installations: deps.installations,
    projection: deps.projection,
  })
  const context = Object.freeze({
    requestId: "aggregate-request",
    identity: Object.freeze({ namespace: "tenant", userId: "human" }),
    humanBearer: "actual-human",
  })
  return {
    service: new SkillSpecificationService(deps),
    calls,
    deps,
    installation,
    context,
    signal: new AbortController().signal,
    deadline: performance.now() + 10000,
    change() {
      changed = true
    },
  }
}

test("S2 public skill.list admits the eight declared values without changing its item fields", async () => {
  const values = ["personal", "official", "team", "project", "app", "hub", "device", "unknown"]
  // Device is only a wire fixture here, not a fabricated discovery producer.
  const app = await fixture({
    async read() {
      return values.map((owner_type) => ({ ...publicSkill, owner_type }))
    },
  })
  try {
    const response = await app.request("/v1/skill.list")
    assert.equal(response.status, 200)
    assert.deepEqual(
      response.body.data.map((item) => item.owner_type),
      values,
    )
    assert.deepEqual(Object.keys(response.body.data[0]).sort(), Object.keys(publicSkill).sort())
  } finally {
    await app.close()
  }
})

test("S2 installation acquisition decides public classification without rewriting website ownership or source provenance", async () => {
  for (const [acquisition, kind, source, expected, website] of [
    [3, "project", "official", "hub", "official"],
    [1, "project", "official", "unknown", "official"],
    [2, "user", "personal", "personal", "personal"],
    [2, "user", "official", "official", "official"],
    [2, "organization", "personal", "team", "team"],
    [2, "project", "personal", "project", "project"],
    [2, "app", "personal", "app", "app"],
    [2, "future_owner", "personal", "unknown", undefined],
  ]) {
    const app = await specificationServiceFixture()
    app.installation.acquisitionKind = acquisition
    app.installation.sourceOwnerScope.kind = kind
    app.installation.product.sourceKind = source
    app.deps.projection.read = async () => ({
      ok: true,
      status: 200,
      data: { skills: [] },
    })
    const data = await app.service.read("skill.list", {}, app.context, app.signal, app.deadline)
    assert.equal(data[0].owner_type, expected, `${acquisition}/${kind}/${source}`)
    const list = await app.service.read("ListSkills", {}, app.context, app.signal, app.deadline)
    assert.equal(list.userAddedSkills[0].ownerType, website)
    assert.equal(app.installation.product.sourceKind, source)
    assert.equal(app.installation.sourceOwnerScope.kind, kind)
    assert.equal(app.installation.enabled, false)
    assert.equal(
      app.calls.some((call) => call.kind === "current"),
      false,
    )
  }
})

test("S2 missing or unsupported owner acquisition fails closed rather than becoming public unknown", async () => {
  for (const acquisition of [0, 4, -1, undefined]) {
    const app = await specificationServiceFixture()
    app.installation.acquisitionKind = acquisition
    await assert.rejects(app.service.read("skill.list", {}, app.context, app.signal, app.deadline), /skill_installation_response_invalid/)
    assert.equal(
      app.calls.some((call) => call.kind === "profiles" || call.kind === "current"),
      false,
    )
  }
})

test("R357 formal aggregation lists stopped exact installations, resolves actual creator distinct from publisher and never substitutes current timestamps", async () => {
  const app = await specificationServiceFixture()
  const data = await app.service.read("skill.list", {}, app.context, app.signal, app.deadline)
  assert.equal(data[0].id, "stable-series")
  assert.equal(data[0].name, "Old exact")
  assert.equal(data[0].updated_at, 1749999999)
  assert.deepEqual(data[0].creator_info, {
    user_id: "actual-creator",
    name: "Real Creator",
  })
  assert.equal(data[0].created_at, 1749999990, "exact source creation time, not installation/current time")
  assert.equal(data[0].owner_type, "project")
  assert.equal(
    app.calls.some((call) => call.kind === "current"),
    false,
  )
  assert.equal(app.calls.find((call) => call.kind === "installed").input.installed, true)
  assert.equal(Object.hasOwn(app.calls.find((call) => call.kind === "installed").input, "enabled"), false)
})
test("R357 formal Hub aggregation binds true stable/current/exact publication and owner-side query/tag/page cursor before pagination", async () => {
  const app = await specificationServiceFixture()
  const data = await app.service.read(
    "ListHubSkills",
    {
      pageSize: 9,
      query: "excel",
      tag: "SKILL_HUB_TAG_CODING",
      pageToken: "owner-token",
      excludeTop: true,
      includeOfficialSkills: true,
    },
    app.context,
    app.signal,
    app.deadline,
  )
  assert.equal(data.skills[0].skillId, "stable-series")
  assert.equal(data.skills[0].currentVersion.versionUid, "current-version")
  assert.equal(data.skills[0].currentVersion.archiveSize, "3")
  assert.equal(data.skills[0].usageCount, "7")
  assert.equal(data.nextPageToken, "original-owner-cursor")
  assert.equal(Object.hasOwn(data.skills[0], "verified"), false)
  assert.equal(Object.hasOwn(data.skills[0], "syncStatus"), false)
  assert.deepEqual(app.calls.find((call) => call.kind === "projection").input, {
    query: {
      limit: 9,
      query: "excel",
      category_key: "programming",
      cursor: "owner-token",
      include_official_skills: true,
    },
  })
  assert.equal(app.calls.find((call) => call.kind === "current").input.seriesId, "stable-series")
})
test("R357 formal Hub returns an empty category page without querying usage", async () => {
  const app = await specificationServiceFixture()
  app.deps.projection.read = async () => ({
    ok: true,
    status: 200,
    data: { skills: [], next_cursor: null },
  })
  app.deps.usage = async () => assert.fail("an empty catalog page must not query usage")

  const data = await app.service.read(
    "ListHubSkills",
    { pageSize: 30, tag: "SKILL_HUB_TAG_DATA", includeOfficialSkills: true },
    app.context,
    app.signal,
    app.deadline,
  )

  assert.deepEqual(data.skills, [])
  assert.equal(data.nextPageToken, undefined)
})
test("R357 formal download aggregation binds original exact version and rejects current-version rotation instead of rebasing handle", async () => {
  const app = await specificationServiceFixture()
  const value = await app.service.prepareDownload("DownloadSkill", "stable-series", app.context, app.signal, app.deadline)
  assert.equal(value.skill.id, "stable-series")
  assert.equal(value.binding.sourceRef, "skill:current-version")
  assert.equal(value.binding.filename, "actual.zip")
  assert.equal(app.calls.find((call) => call.kind === "download").input.sourceRef, "skill:current-version")
  await app.service.confirmDownload(value.binding, app.context, app.signal, app.deadline)
  app.change()
  await assert.rejects(
    app.service.confirmDownload(value.binding, app.context, app.signal, app.deadline),
    (error) => error instanceof ConnectError && error.code === Code.NotFound,
  )
})
test("R357 production composition uses the formal Skills aggregation rather than permanent pending503 when all existing dependencies are configured", async () => {
  const { createBffComposition } = await import("../../src/bootstrap/runtime.ts")
  const { SkillSpecificationService } = await import("../../src/application/skill-specification.ts")
  const config = {
    upstreams: { agents: null },
    iamBaseUrl: "http://iam.test",
    upstreamTimeoutMs: 1000,
    platformProjection: {
      baseUrl: "http://platform.test",
      credentialFile: "/unused-test-credential",
      timeoutMs: 1000,
    },
    agUi: DEFAULT_AGUI_CONFIG,
    postgresUrl: null,
    redisUrl: null,
  }
  const composition = createBffComposition(config, {
    businessStore: null,
    sessionAdmission: { async verify() {} },
    skillProductClient: {},
    installationClient: {},
  })
  try {
    assert.ok(composition.skillSpecificationSource instanceof SkillSpecificationService)
  } finally {
    await composition.close()
  }
})

test("R357 successor project list admits canonical current Project before owner and rechecks exact subject permission before disclosure", async () => {
  const app = await specificationServiceFixture()
  const projects = []
  app.deps.projects = {
    async find(scope, id) {
      projects.push({ scope, id })
      return { id: "canonical-project" }
    },
  }
  const data = await app.service.read("skill.list", { project_id: "project-slug" }, app.context, app.signal, app.deadline)
  assert.equal(data[0].created_at, 1749999990)
  assert.equal(data[0].owner_type, "project")
  assert.equal(data[0].name, "Old exact")
  assert.deepEqual(projects, [
    { scope: { tenantId: "tenant", subjectId: "human" }, id: "project-slug" },
    {
      scope: { tenantId: "tenant", subjectId: "human" },
      id: "canonical-project",
    },
  ])
  assert.deepEqual(
    app.calls.filter((c) => c.kind === "installed").map((c) => c.input.projectRef),
    [undefined, "canonical-project"],
  )
  assert.equal(
    app.calls.some((c) => c.kind === "current"),
    false,
  )
})
test("project skill.list unions independently paged personal and project installs, with the whole exact project revision winning", async () => {
  const app = await specificationServiceFixture()
  app.deps.projects = { find: async () => ({ id: "canonical-project" }) }
  const personal = structuredClone(app.installation)
  personal.installationId.value = "personal-shared"
  personal.sourceRef.value = "skill:personal-newer"
  personal.revision = 9n
  personal.acquisitionKind = 3
  personal.displayName = "Personal newer"
  personal.summary = "Personal description"
  personal.skillCreatedAt.seconds = 1750000020n
  personal.skillUpdatedAt.seconds = 1750000030n
  personal.product.creatorRef.id = "personal-creator"
  const personalOnly = structuredClone(personal)
  personalOnly.installationId.value = "personal-only"
  personalOnly.seriesId.value = "personal-only-series"
  const projectOnly = structuredClone(app.installation)
  projectOnly.installationId.value = "project-only"
  projectOnly.seriesId.value = "project-only-series"
  const reads = []
  app.deps.installations.list = async (input) => {
    reads.push(input)
    return {
      installations:
        input.projectRef === undefined ? [input.cursor === undefined ? personal : personalOnly] : [input.cursor === undefined ? app.installation : projectOnly],
      ...(input.cursor === undefined ? { page: { nextCursor: "same-scope-local-cursor" } } : {}),
    }
  }
  const http = await fixture(app.service)
  try {
    const result = await http.request("/v1/skill.list?project_id=project-slug")
    assert.equal(result.status, 200)
    assert.equal(result.headers.get("cache-control"), "no-store")
    assert.equal(result.body.ok, true)
    assert.equal(result.body.request_id, "spec-request")
    assert.deepEqual(
      result.body.data.map((item) => item.id),
      ["stable-series", "personal-only-series", "project-only-series"],
    )
    assert.deepEqual(result.body.data[0], {
      id: "stable-series",
      name: "Old exact",
      description: "Old description",
      owner_type: "project",
      creator_info: { user_id: "actual-creator", name: "Real Creator" },
      created_at: 1749999990,
      updated_at: 1749999999,
    })
    assert.equal(result.body.data[1].name, "Personal newer")
    assert.equal(result.body.data[1].owner_type, "hub")
    assert.deepEqual(
      reads.map((input) => [input.projectRef, input.cursor]),
      [
        [undefined, undefined],
        [undefined, "same-scope-local-cursor"],
        ["canonical-project", undefined],
        ["canonical-project", "same-scope-local-cursor"],
      ],
    )
    assert.ok(reads.every((input) => input.tenant === "tenant" && input.subject === "human" && input.installed === true && !Object.hasOwn(input, "enabled")))
    assert.equal(app.installation.enabled, false)
    assert.equal(personalOnly.enabled, false)
    assert.equal(
      app.calls.some((call) => call.kind === "current" || call.kind === "projection"),
      false,
    )
  } finally {
    await http.close()
  }
})

test("an empty project keeps personal installs while either owner failure never returns a partial union", async () => {
  for (const failedScope of [null, "personal", "project"]) {
    const app = await specificationServiceFixture()
    app.deps.projects = { find: async () => ({ id: "canonical-project" }) }
    const reads = []
    app.deps.installations.list = async (input) => {
      const scope = input.projectRef === undefined ? "personal" : "project"
      reads.push(scope)
      if (scope === failedScope) throw new ConnectError("owner unavailable", Code.Unavailable)
      return { installations: scope === "personal" ? [app.installation] : [] }
    }
    const read = () => app.service.read("skill.list", { project_id: "project" }, app.context, app.signal, app.deadline)
    if (failedScope === null)
      assert.deepEqual(
        (await read()).map((item) => item.name),
        ["Old exact"],
      )
    else await assert.rejects(read(), (error) => error instanceof ConnectError && error.code === Code.Unavailable)
    assert.deepEqual(reads, failedScope === "personal" ? ["personal"] : ["personal", "project"])
  }
})

test("project skill.list retains the 1000 unique-item limit after combining individually bounded scopes", async () => {
  const app = await specificationServiceFixture()
  app.deps.projects = { find: async () => ({ id: "canonical-project" }) }
  app.deps.installations.list = async (input) => {
    const scope = input.projectRef === undefined ? "personal" : "project"
    const offset = Number(input.cursor ?? 0)
    const count = scope === "personal" ? 501 : 500
    return {
      installations: Array.from({ length: Math.min(100, count - offset) }, (_, index) => ({
        ...app.installation,
        installationId: { value: `${scope}-installation-${offset + index}` },
        seriesId: { value: `${scope}-series-${offset + index}` },
      })),
      ...(offset + 100 < count ? { page: { nextCursor: String(offset + 100) } } : {}),
    }
  }
  await assert.rejects(
    app.service.read("skill.list", { project_id: "project" }, app.context, app.signal, app.deadline),
    (error) => error instanceof ConnectError && error.code === Code.ResourceExhausted,
  )
  assert.equal(
    app.calls.some((call) => call.kind === "profiles"),
    false,
  )
})

test("same-scope duplicate series remain an invalid owner result rather than applying cross-scope precedence", async () => {
  const app = await specificationServiceFixture()
  app.deps.installations.list = async () => ({
    installations: [
      app.installation,
      {
        ...app.installation,
        installationId: { value: "different-installation" },
        sourceRef: { value: "skill:other-version" },
      },
    ],
  })
  await assert.rejects(app.service.read("skill.list", {}, app.context, app.signal, app.deadline), /skill_response_invalid/)
})

test("R357 successor project missing/deleted/revoked or changed canonical identity is closed without replacing exact installations", async () => {
  for (const result of [null, { id: "different-project" }]) {
    const app = await specificationServiceFixture()
    let count = 0
    app.deps.projects = {
      async find() {
        count++
        return count === 1 ? { id: "canonical-project" } : result
      },
    }
    await assert.rejects(
      app.service.read("skill.list", { project_id: "project-slug" }, app.context, app.signal, app.deadline),
      (e) => e instanceof ConnectError && e.code === Code.NotFound,
    )
    assert.equal(
      app.calls.some((c) => c.kind === "current"),
      false,
    )
  }
  const app = await specificationServiceFixture()
  app.deps.projects = {
    async find() {
      return null
    },
  }
  await assert.rejects(
    app.service.read("skill.list", { project_id: "not-owned" }, app.context, app.signal, app.deadline),
    (e) => e instanceof ConnectError && e.code === Code.NotFound,
  )
  assert.equal(app.calls.length, 0)
})
test("R357 successor Hub sends official exclusion and initial shuffle to owner, then cursor-bound continuation without shuffle", async () => {
  const app = await specificationServiceFixture()
  const first = await app.service.read(
    "ListHubSkills",
    {
      pageSize: 1,
      includeOfficialSkills: false,
      shuffle: true,
      query: "literal%_",
    },
    app.context,
    app.signal,
    app.deadline,
  )
  assert.equal(first.skills.length, 1)
  assert.deepEqual(app.calls.find((c) => c.kind === "projection").input.query, {
    limit: 1,
    include_official_skills: false,
    shuffle: true,
    query: "literal%_",
  })
  app.calls.length = 0
  await app.service.read(
    "ListHubSkills",
    {
      pageSize: 1,
      includeOfficialSkills: false,
      pageToken: first.nextPageToken,
      excludeTop: true,
      query: "literal%_",
    },
    app.context,
    app.signal,
    app.deadline,
  )
  assert.deepEqual(app.calls.find((c) => c.kind === "projection").input.query, {
    limit: 1,
    include_official_skills: false,
    cursor: "original-owner-cursor",
    query: "literal%_",
  })
  app.calls.length = 0
  await assert.rejects(
    app.service.read("ListHubSkills", { pageToken: "cursor", shuffle: false }, app.context, app.signal, app.deadline),
    (e) => e instanceof ConnectError && e.code === Code.InvalidArgument,
  )
  assert.equal(app.calls.length, 0)
})

test("R357 successor native binary installation client sends canonical project only as trusted metadata, never request body or write headers", async () => {
  const { SkillInstallationConnectClient } = await import("../../src/infrastructure/clients/platform/skill-installation-connect.ts")
  const p = await import("../../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts")
  const { create, fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const sample = await specificationServiceFixture()
  sample.installation.acquisitionKind = p.SkillAcquisitionKind.HUB
  const requests = []
  const owner = createServer(async (req, res) => {
    const chunks = []
    for await (const b of req) chunks.push(b)
    const project = req.url === "/kokoro.platform.v1.ProductProjectSkillInstallationService/ListProjectSkillInstallations"
    requests.push({
      headers: req.headers,
      body: fromBinary(project ? p.ListProjectSkillInstallationsRequestSchema : p.ListPersonalSkillInstallationsRequestSchema, Buffer.concat(chunks)),
      project,
    })
    res.writeHead(200, {
      "content-type": "application/proto",
      "cache-control": "no-store",
    })
    const schema = project ? p.ListProjectSkillInstallationsResponseSchema : p.ListPersonalSkillInstallationsResponseSchema
    res.end(
      toBinary(
        schema,
        create(schema, {
          installations: [sample.installation],
          ...(project ? { projectRef: "canonical-project" } : {}),
        }),
      ),
    )
  })
  await new Promise((r) => owner.listen(0, "127.0.0.1", r))
  try {
    const client = new SkillInstallationConnectClient(
      `http://127.0.0.1:${owner.address().port}`,
      { get: async () => "write-token" },
      { get: async () => "projection-token" },
      1000,
    )
    const input = {
      requestId: "native-project",
      tenant: "tenant",
      subject: "human",
      installed: true,
      limit: 1,
    }
    const { PlatformSkillSpecificationFacade } = await import("../../src/infrastructure/clients/platform/skill-specification-facade.ts")
    const facade = new PlatformSkillSpecificationFacade({
      product: sample.deps.product,
      projection: sample.deps.projection,
      installations: client,
    })
    const page = await facade.listInstallations({ ...input, projectRef: "canonical-project" }, new AbortController().signal)
    assert.equal(page.items[0].acquisition_kind, "hub")
    await client.list(input)
    assert.equal(requests[0].project, true)
    assert.equal(requests[1].project, false)
    assert.equal(requests[0].headers["x-kokoro-project-ref"], "canonical-project")
    assert.equal(requests[0].headers["x-kokoro-subject"], "human")
    assert.equal(requests[0].headers.authorization, "Bearer projection-token")
    assert.equal(requests[1].headers["x-kokoro-project-ref"], undefined)
    assert.equal(requests[0].body.installed, true)
    assert.equal(requests[0].body.enabled, undefined)
    sample.installation.acquisitionKind = p.SkillAcquisitionKind.UNSPECIFIED
    await assert.rejects(facade.listInstallations(input, new AbortController().signal), /skill_installation_response_invalid/)
    assert.equal(Object.hasOwn(requests[0].body, "projectId"), false)
    assert.equal(Object.hasOwn(requests[0].body, "projectRef"), false)
    assert.deepEqual(
      p.ProductSkillInstallationSchema.fields.filter((f) => f.number >= 19).map((f) => [f.name, f.number]),
      [
        ["skill_created_at", 19],
        ["source_owner_scope", 20],
        ["acquisition_kind", 21],
      ],
    )
  } finally {
    owner.closeAllConnections()
    await new Promise((r) => owner.close(r))
  }
})
test("R357 successor exact-source missing/malformed facts close specification reads instead of guessing installation time or current owner", async () => {
  for (const patch of [
    { skillCreatedAt: undefined },
    { sourceOwnerScope: undefined },
    { sourceOwnerScope: { kind: "project", id: "" } },
    { skillCreatedAt: { seconds: 1750000020n, nanos: 0 } },
  ]) {
    const app = await specificationServiceFixture()
    Object.assign(app.installation, patch)
    await assert.rejects(app.service.read("skill.list", {}, app.context, app.signal, app.deadline), /skill_installation_response_invalid/)
    assert.equal(
      app.calls.some((c) => c.kind === "current"),
      false,
    )
  }
})
test("R357 successor cancelled project authorization never issues an installation request after late find", async () => {
  const app = await specificationServiceFixture()
  const controller = new AbortController()
  let complete, entered
  const pending = new Promise((r) => (entered = r))
  app.deps.projects = {
    async find() {
      entered()
      return await new Promise((r) => (complete = r))
    },
  }
  const result = app.service.read("skill.list", { project_id: "slug" }, app.context, controller.signal, app.deadline)
  await pending
  controller.abort()
  complete({ id: "canonical-project" })
  await assert.rejects(result, { name: "AbortError" })
  assert.equal(app.calls.length, 0)
})

test("R357 successor project owner dependency failure stays stable503 without private error disclosure", async () => {
  const app = await specificationServiceFixture()
  app.deps.projects = {
    async find() {
      throw new Error("private database payload")
    },
  }
  await assert.rejects(
    app.service.read("skill.list", { project_id: "slug" }, app.context, app.signal, app.deadline),
    (error) => error instanceof ConnectError && error.code === Code.Unavailable && !error.message.includes("private"),
  )
  assert.equal(app.calls.length, 0)
})

function downloadBinding(subjectId = "human") {
  return {
    tenantId: "tenant",
    subjectId,
    qualifier: { kind: "catalog_current", seriesId: "stable-series" },
    sourceRef: "skill:version-one",
    revision: "1",
    filename: "original.zip",
    sizeBytes: 3,
    contentSha256: "a".repeat(64),
    expiresAt: 5000,
    transfer: {
      url: "http://store.invalid/key",
      method: "GET",
      requiredHeaders: {},
      expiresAt: 5000,
    },
  }
}
test("R357 handle identical qualification reuse never extends TTL or crosses tenant/subject", () => {
  let now = 1000
  const store = new SkillDownloadHandles(100, 3, () => now)
  const binding = downloadBinding()
  const first = store.issue(binding)
  now = 1050
  assert.equal(store.issue(structuredClone(binding)), first)
  assert.equal(first.expiresAt, 1100)
  const other = store.issue(downloadBinding("other"))
  assert.notEqual(other.handle, first.handle)
  assert.throws(() => store.resolve(first.handle, "tenant", "other"), /forbidden/)
  assert.equal(store.issue({ ...binding, tenantId: "other-tenant" }).binding.tenantId, "other-tenant")
  now = 1100
  assert.throws(() => store.resolve(first.handle, "tenant", "human"), /expired/)
  const reapplied = store.issue(binding)
  assert.notEqual(reapplied.handle, first.handle)
  assert.equal(reapplied.expiresAt, 1200)
})
test("R357 bounded handles evict oldest only after validation, reclaim expiry, and reapply exact facts", () => {
  let now = 1000
  const store = new SkillDownloadHandles(100, 2, () => now)
  const first = store.issue(downloadBinding("first"))
  now = 1050
  const second = store.issue(downloadBinding("second"))
  assert.throws(() => store.issue({ ...downloadBinding("bad"), filename: "../bad.zip" }), /response_invalid/)
  assert.equal(store.resolve(first.handle, "tenant", "first"), first)
  const third = store.issue(downloadBinding("third"))
  assert.throws(() => store.resolve(first.handle, "tenant", "first"), /expired/)
  assert.equal(store.resolve(second.handle, "tenant", "second"), second)
  assert.throws(() => store.resolve(third.handle, "tenant", "first"), /forbidden/)
  now = 1150
  const reapplied = store.issue(downloadBinding("first"))
  assert.notEqual(reapplied.handle, first.handle)
  assert.equal(reapplied.binding.sourceRef, "skill:version-one")
  assert.throws(() => store.resolve(second.handle, "tenant", "second"), /expired/)
  assert.throws(() => store.resolve(third.handle, "tenant", "third"), /expired/)
})
test("R357 over128 cross-subject previews retain normal GetSkill and DownloadSkill, evicted metadata can be reapplied", async () => {
  let subject = "human-0"
  const expiresAt = Date.now() + 300000
  const app = await fixture(
    {
      async prepareDownload() {
        return {
          skill: detail,
          binding: {
            ...downloadBinding(subject),
            expiresAt,
            transfer: { ...downloadBinding().transfer, expiresAt },
          },
        }
      },
    },
    async () => ({
      ok: true,
      identity: { namespace: "tenant", userId: subject },
      platformAdmin: false,
    }),
  )
  try {
    const first = await app.request(website + "GetSkill", {
      skillId: "stable-series",
    })
    assert.equal(first.status, 200)
    const oldPath = first.body.downloadInfo.downloadUrl.slice(4)
    for (let i = 1; i <= 129; i++) {
      subject = `human-${i}`
      const result = await app.request(website + "GetSkill", {
        skillId: "stable-series",
      })
      assert.equal(result.status, 200, `preview ${i}`)
    }
    subject = "human-0"
    const gone = await app.request(oldPath)
    assert.equal(gone.status, 410)
    assert.equal(gone.body.error.code, "Gone")
    const reapplied = await app.request("/skill.v1.SkillService/DownloadSkill", { skillId: "stable-series" })
    assert.equal(reapplied.status, 200)
    assert.notEqual(reapplied.body.downloadInfo.downloadUrl.slice(4), oldPath)
    assert.equal(reapplied.body.skill.version, "version-one")
    assert.equal((await app.request(oldPath)).status, 410)
  } finally {
    await app.close()
  }
})
for (const [name, filename, encoded] of [
  ["quote", 'my"skill.zip', "my%22skill.zip"],
  ["semicolon", "my;skill.zip", "my%3Bskill.zip"],
  ["unicode", "技能.zip", "%E6%8A%80%E8%83%BD.zip"],
])
  test(`R357 actual byte header ${name} uses fixed skill.zip fallback and exact RFC5987 filename`, async () => {
    const app = await bytesFixture(async () => {}, undefined, filename)
    try {
      const result = await app.request(app.path)
      assert.equal(result.status, 200)
      assert.equal(result.headers.get("content-disposition"), `attachment; filename="skill.zip"; filename*=UTF-8''${encoded}`)
      assert.deepEqual(result.body, app.bytes)
    } finally {
      await app.close()
    }
  })

test("R357 reuse requires every exact qualification fact, never mutates or rebinds old handles", () => {
  const variations = [
    (b) => ({ ...b, tenantId: "other" }),
    (b) => ({ ...b, subjectId: "other" }),
    (b) => ({
      ...b,
      qualifier: { kind: "catalog_current", seriesId: "other-series" },
    }),
    (b) => ({ ...b, sourceRef: "skill:other-version" }),
    (b) => ({ ...b, filename: "other.zip" }),
    (b) => ({ ...b, sizeBytes: 4 }),
    (b) => ({ ...b, contentSha256: "b".repeat(64) }),
    (b) => ({ ...b, expiresAt: 4000 }),
    (b) => ({
      ...b,
      transfer: { ...b.transfer, url: "http://store.invalid/other" },
    }),
    (b) => ({ ...b, transfer: { ...b.transfer, expiresAt: 4000 } }),
  ]
  for (const variation of variations) {
    const store = new SkillDownloadHandles(100, 1, () => 1000)
    const original = downloadBinding()
    const first = store.issue(original)
    const changed = variation(original)
    const next = store.issue(changed)
    assert.notEqual(next.handle, first.handle)
    assert.deepEqual(first.binding, original)
    assert.deepEqual(next.binding, changed)
    assert.throws(() => store.resolve(first.handle, "tenant", "human"), /expired/)
  }
})

const sharedSummary = {
  skill_id: "version-old",
  series_id: "stable-series",
  revision: "2",
  display_name: "Old name",
  description: "Old description",
  tags: [],
  example_prompts: ["Old example"],
  category_keys: ["apps"],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  owner_type: "personal",
  source_kind: "personal",
}
test("shared revision summary serves exact old revision through the admitted public route", async () => {
  let reads = 0,
    summaries = 0
  const share = {
    shareId: "shared-old",
    tenantId: "tenant",
    creatorSubjectId: "creator",
    resourceKind: "skill_revision",
    sourceRef: "skill:version-old",
    url: "http://web.test/skills/shared/shared-old",
    createdAt: new Date("2026-01-01"),
    expiresAt: null,
    revokedAt: null,
  }
  const app = await fixture(
    {
      revisionSummary: async (sourceRef, context) => {
        summaries++
        assert.equal(sourceRef, share.sourceRef)
        assert.equal(context.identity.userId, "human")
        return sharedSummary
      },
    },
    undefined,
    {},
    {
      businessStore: {
        services: {
          skillShares: {
            findActive: async () => {
              reads++
              return share
            },
          },
        },
        close: async () => {},
      },
    },
  )
  try {
    const result = await app.request("/v1/skill-shares/shared-old/skill")
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, {
      data: {
        share_id: share.shareId,
        source_ref: share.sourceRef,
        skill: sharedSummary,
      },
    })
    assert.equal(reads, 2)
    assert.equal(summaries, 1)
    assert.equal(result.headers.get("cache-control"), "no-store")
  } finally {
    await app.close()
  }
})

test("shared summary never calls series current or prepares a download", async () => {
  const { SkillSpecificationService } = await import("../../src/application/skill-specification.ts")
  let current = 0
  const service = new SkillSpecificationService({
    owner: {
      revision: async () => ({
        skill: {
          skill_id: "version-old",
          source_ref: "skill:version-old",
          series_id: "stable-series",
          revision: "2",
          status: "active",
          package_phase: "valid",
          name: "Old name",
          summary: "Old description",
          tags: [],
          example_prompts: ["Old example"],
          category_keys: ["apps"],
          skill_updated_at: sharedSummary.updated_at,
          product: { source_kind: "personal" },
        },
        record: { ownerKind: "user" },
        createdAt: sharedSummary.created_at,
      }),
      current: async () => {
        current++
        throw new Error("new revision must not substitute old")
      },
    },
    profiles: { resolve: async () => new Map() },
    objectOrigin: null,
  })
  const result = await service.revisionSummary(
    "skill:version-old",
    {
      identity: { namespace: "tenant", userId: "human" },
      requestId: "shared",
      humanBearer: "human",
    },
    new AbortController().signal,
    performance.now() + 1000,
  )
  assert.deepEqual(result, sharedSummary)
  assert.equal(current, 0)
})

for (const scenario of ["revoked", "expired", "changed-source", "other-tenant", "bad-source", "extra-field", "bad-cover", "iam-failure", "query", "key"])
  test(`shared summary fail-closes ${scenario} without replacing revision`, async () => {
    let reads = 0,
      summaries = 0
    const share = {
      shareId: "shared-old",
      tenantId: "tenant",
      creatorSubjectId: "creator",
      resourceKind: "skill_revision",
      sourceRef: "skill:version-old",
      url: "http://web.test/skills/shared/shared-old",
      createdAt: new Date("2026-01-01"),
      expiresAt: null,
      revokedAt: null,
    }
    const source = {
      revisionSummary: async () => {
        summaries++
        if (scenario === "iam-failure") throw new Error("publisher_profile_unavailable")
        return {
          ...sharedSummary,
          ...(scenario === "bad-source" ? { skill_id: "new-version" } : {}),
          ...(scenario === "extra-field" ? { package_asset_ref: "private" } : {}),
          ...(scenario === "bad-cover" ? { cover_image: "/api/v1/skills/stable-series/cover" } : {}),
        }
      },
    }
    const app = await fixture(
      source,
      undefined,
      {},
      {
        businessStore: {
          services: {
            skillShares: {
              findActive: async () => {
                reads++
                return {
                  ...share,
                  ...(scenario === "other-tenant" ? { tenantId: "other" } : {}),
                  ...(reads === 2 && scenario === "revoked" ? { revokedAt: new Date() } : {}),
                  ...(reads === 2 && scenario === "expired" ? { expiresAt: new Date(0) } : {}),
                  ...(reads === 2 && scenario === "changed-source" ? { sourceRef: "skill:new-version" } : {}),
                }
              },
            },
          },
          close: async () => {},
        },
      },
    )
    try {
      const result = await app.request(
        `/v1/skill-shares/shared-old/skill${scenario === "query" ? "?extra=1" : ""}`,
        undefined,
        scenario === "key" ? { headers: { "idempotency-key": "forbidden" } } : {},
      )
      assert.equal(
        result.status,
        scenario === "key"
          ? 403
          : scenario === "query"
            ? 400
            : scenario === "iam-failure"
              ? 503
              : ["bad-source", "extra-field", "bad-cover"].includes(scenario)
                ? 502
                : 404,
      )
      if (["query", "key", "other-tenant"].includes(scenario)) assert.equal(summaries, 0)
    } finally {
      await app.close()
    }
  })

test("shared summary exact metadata checks active/phase and obtains only formal found IAM author", async () => {
  const { SkillSpecificationService } = await import("../../src/application/skill-specification.ts")
  const context = {
    identity: { namespace: "tenant", userId: "human" },
    requestId: "shared",
    humanBearer: "human",
  }
  for (const status of ["found", "missing", "throw"]) {
    const service = new SkillSpecificationService({
      owner: {
        revision: async () => ({
          skill: {
            skill_id: "version-old",
            source_ref: "skill:version-old",
            series_id: "stable-series",
            revision: "2",
            status: "active",
            package_phase: "valid",
            name: "Old name",
            summary: "Old description",
            tags: [],
            example_prompts: [],
            category_keys: [],
            skill_updated_at: sharedSummary.updated_at,
            product: {
              source_kind: "third_party",
              creator_ref: { kind: "user", id: "creator" },
            },
          },
          record: { ownerKind: "user" },
          createdAt: sharedSummary.created_at,
        }),
      },
      profiles: {
        resolve: async (tenant, bearer, requestId, refs) => {
          assert.equal(tenant, "tenant")
          assert.equal(bearer, "human")
          assert.deepEqual(refs, [{ kind: "user", id: "creator" }])
          if (status === "throw") throw new Error("publisher_profile_unavailable")
          return new Map([
            [
              JSON.stringify(["user", "creator"]),
              {
                status,
                ...(status === "found" ? { display_name: "Real creator" } : {}),
              },
            ],
          ])
        },
      },
      objectOrigin: null,
    })
    const read = () => service.revisionSummary("skill:version-old", context, new AbortController().signal, performance.now() + 1000)
    if (status === "throw") await assert.rejects(read, /publisher_profile_unavailable/)
    else {
      const result = await read()
      assert.equal(result.source_kind, "third_party")
      if (status === "found")
        assert.deepEqual(result.author, {
          user_id: "creator",
          display_name: "Real creator",
        })
      else assert.equal(Object.hasOwn(result, "author"), false)
    }
  }
})

test("shared summary disconnect cancels exact metadata and prevents a late second share read", async () => {
  let finish,
    entered,
    ownerSignal,
    reads = 0
  const called = new Promise((resolve) => (entered = resolve))
  const share = {
    shareId: "shared-old",
    tenantId: "tenant",
    creatorSubjectId: "creator",
    resourceKind: "skill_revision",
    sourceRef: "skill:version-old",
    url: "http://web.test/skills/shared/shared-old",
    createdAt: new Date("2026-01-01"),
    expiresAt: null,
    revokedAt: null,
  }
  const app = await fixture(
    {
      revisionSummary: async (_ref, _ctx, signal) => {
        ownerSignal = signal
        entered()
        return await new Promise((resolve) => (finish = resolve))
      },
    },
    undefined,
    {},
    {
      businessStore: {
        services: {
          skillShares: {
            findActive: async () => {
              reads++
              return share
            },
          },
        },
        close: async () => {},
      },
    },
  )
  const controller = new AbortController()
  try {
    const pending = app.request("/v1/skill-shares/shared-old/skill", undefined, { signal: controller.signal })
    await called
    controller.abort()
    await assert.rejects(pending, { name: "AbortError" })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(ownerSignal.aborted, true)
    finish(sharedSummary)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(reads, 1)
  } finally {
    await app.close()
  }
})

test("deleted series are not public availability even while their exact installation remains retained", async () => {
  const app = await specificationServiceFixture()
  app.installation.sourceStatus = 7
  const result = await app.service.read("skill.list", {}, app.context, app.signal, app.deadline)
  assert.deepEqual(result, [])
  assert.equal(app.installation.installed, true)
  assert.equal(
    app.calls.some((call) => call.kind === "profiles" || call.kind === "current"),
    false,
  )
})
