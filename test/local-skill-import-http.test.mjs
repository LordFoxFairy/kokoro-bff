import assert from "node:assert/strict"
import { once } from "node:events"
import test from "node:test"
import { create } from "@bufbuild/protobuf"
import { request as httpRequest } from "node:http"
import { createServer } from "node:http"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import {
  SkillCategoryKeysSchema,
  SkillExamplePromptsSchema,
  SkillIdSchema,
  SkillImportPhase,
  SkillMetadataSchema,
  SkillPackagePhase,
  SkillPackageScanState,
  SkillProductFactsSchema,
  SkillProductRecordSchema,
  SkillSeriesIdSchema,
  SkillSourceRefSchema,
  SkillStatus,
} from "../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import {
  projectLocalImportComplete,
  projectLocalImportFinalize,
  projectLocalImportGet,
} from "../dist/infrastructure/clients/platform/local-skill-import-response.js"
import { createLiveTestBffServer } from "./doubles/server.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
import { createBffComposition } from "../dist/bootstrap/runtime.js"

const config = {
  host: "127.0.0.1",
  port: 0,
  mode: "live",
  domain: "dev.kokoro.localhost",
  tenantId: "tenant",
  iamBaseUrl: null,
  sharedSecret: "secret",
  upstreamSecret: null,
  upstreamTimeoutMs: 100,
  upstreamMaxResponseBytes: 1_048_576,
  schedulerServiceToken: null,
  schedulerTargetUrl: null,
  agentEnabled: false,
  postgresUrl: null,
  redisUrl: null,
  agUi: DEFAULT_AGUI_CONFIG,
  upstreams: {},
  skillDraft: { enabled: false, platformBaseUrl: null, credentialFile: null, timeoutMs: 100 },
  storageObjectOrigin: "https://objects.example",
}
const timestamp = (seconds = Math.floor(Date.now() / 1000) + 300) => ({ seconds: BigInt(seconds), nanos: 0 })
const beginResponse = () => ({
  intentId: { value: "intent-1" },
  skillId: { value: "skill-1" },
  phase: SkillImportPhase.UPLOAD_PENDING,
  uploadId: "upload-1",
  transferReference: {
    url: "https://objects.example/upload-1",
    method: "PUT",
    requiredHeaders: { "content-type": "application/octet-stream" },
    expiresAt: timestamp(),
  },
  expiresAt: timestamp(Math.floor(Date.now() / 1000) + 86400),
  replayed: false,
})
const product = () => create(SkillProductFactsSchema, { stateVersion: 1n, publicationAudience: "owner" })
const skill = () =>
  create(SkillProductRecordSchema, {
    skillId: create(SkillIdSchema, { value: "skill-1" }),
    sourceRef: create(SkillSourceRefSchema, { value: "skill:skill-1" }),
    seriesId: create(SkillSeriesIdSchema, { value: "series-1" }),
    revision: 1n,
    status: SkillStatus.ACTIVE,
    metadata: create(SkillMetadataSchema, {
      displayName: "Tea",
      summary: "",
      tags: [],
      examplePrompts: create(SkillExamplePromptsSchema, { prompts: [] }),
      categoryKeys: create(SkillCategoryKeysSchema, { keys: [] }),
    }),
    packagePhase: SkillPackagePhase.VALIDATED,
    skillUpdatedAt: timestamp(1),
    product: product(),
  })
const installation = () => ({
  installationId: { value: "installation-1" },
  sourceRef: { value: "skill:skill-1" },
  seriesId: { value: "series-1" },
  revision: 1n,
  installed: true,
  enabled: true,
  installedAt: timestamp(1),
  updatedAt: timestamp(2),
  displayName: "Tea",
  summary: "",
  tags: [],
  sourceStatus: SkillStatus.ACTIVE,
  skillUpdatedAt: timestamp(1),
  examplePrompts: create(SkillExamplePromptsSchema, { prompts: [] }),
  categoryKeys: create(SkillCategoryKeysSchema, { keys: [] }),
  product: product(),
})
const currentSkillV2 = () => ({ ...skill(), skillId: { value: "skill-2" }, sourceRef: { value: "skill:skill-2" }, revision: 2n })
const currentInstallationV2 = () => ({ ...installation(), sourceRef: { value: "skill:skill-2" }, revision: 2n })

const headers = {
  authorization: "Bearer current-session",
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "secret",
  "content-type": "application/json",
  "idempotency-key": "local-import-begin-1",
}

async function withServer(options, run, serverConfig = config) {
  const server = createLiveTestBffServer(serverConfig, options)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

test("browser-private local import Begin performs fresh create_draft AND install before owner I/O", async () => {
  const actions = []
  const ownerCalls = []
  await withServer(
    {
      sessionAdmission: new SessionAdmissionDouble({ "current-session": { namespace: "tenant", userId: "user" } }),
      skillAuthorization: {
        check: async (input) => {
          actions.push({ token: input.token, tenantId: input.tenantId, subjectId: input.subjectId, action: input.action })
          return { ok: true }
        },
      },
      localSkillImportClient: {
        begin: async (input) => {
          ownerCalls.push(input)
          return beginResponse()
        },
      },
    },
    async (base) => {
      const response = await fetch(`${base}/browser/v1/skills/local-imports`, {
        method: "POST",
        headers,
        body: JSON.stringify({ filename: "tea.skill", size_bytes: 123, content_sha256: "a".repeat(64) }),
      })
      assert.equal(response.status, 201)
      assert.equal(response.headers.get("cache-control"), "no-store")
    },
  )
  assert.deepEqual(actions, [
    { token: "current-session", tenantId: "tenant", subjectId: "user", action: "create_draft" },
    { token: "current-session", tenantId: "tenant", subjectId: "user", action: "install" },
  ])
  assert.equal(ownerCalls.length, 1)
})

test("browser-private local import denial at either human action prevents owner I/O", async () => {
  for (const deniedAction of ["create_draft", "install"]) {
    const actions = []
    let ownerCalls = 0
    await withServer(
      {
        sessionAdmission: new SessionAdmissionDouble({ "current-session": { namespace: "tenant", userId: "user" } }),
        skillAuthorization: {
          check: async (input) => {
            actions.push(input.action)
            return input.action === deniedAction ? { ok: false, status: 403, code: "skill_forbidden" } : { ok: true }
          },
        },
        localSkillImportClient: { begin: async () => (ownerCalls++, {}) },
      },
      async (base) => {
        const response = await fetch(`${base}/browser/v1/skills/local-imports`, {
          method: "POST",
          headers,
          body: JSON.stringify({ filename: "tea.skill", size_bytes: 123, content_sha256: "a".repeat(64) }),
        })
        assert.equal(response.status, 403)
      },
    )
    assert.deepEqual(actions, deniedAction === "create_draft" ? ["create_draft"] : ["create_draft", "install"])
    assert.equal(ownerCalls, 0)
  }
})

test("same original idempotency key replays the exact owner command after fresh dual admission", async () => {
  const actions = []
  const ownerCalls = []
  await withServer(
    {
      sessionAdmission: new SessionAdmissionDouble({ "current-session": { namespace: "tenant", userId: "user" } }),
      skillAuthorization: { check: async (input) => (actions.push(input.action), { ok: true }) },
      localSkillImportClient: { begin: async (input) => (ownerCalls.push(input), beginResponse()) },
    },
    async (base) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch(`${base}/browser/v1/skills/local-imports`, {
          method: "POST",
          headers,
          body: JSON.stringify({ filename: "tea.skill", size_bytes: 123, content_sha256: "a".repeat(64) }),
        })
        assert.equal(response.status, 201)
      }
    },
  )
  assert.deepEqual(actions, ["create_draft", "install", "create_draft", "install"])
  assert.equal(ownerCalls.length, 2)
  assert.equal(ownerCalls[0].commandId, ownerCalls[1].commandId)
  assert.equal(ownerCalls[0].digest, ownerCalls[1].digest)
  assert.equal(ownerCalls[0].tenant, "tenant")
  assert.equal(ownerCalls[0].subject, "user")
})

test("all four browser-private routes preserve exact method, body and fresh read/write admission", async () => {
  const actions = []
  const client = {
    begin: async () => beginResponse(),
    complete: async () => ({
      intentId: { value: "intent-1" },
      skillId: { value: "skill-1" },
      phase: SkillImportPhase.UPLOADED,
      uploadProof: { uploadId: "upload-1", assetId: "asset-1", sourceVersionId: "v1", contentSha256: "a".repeat(64), sizeBytes: 123n },
      scanState: SkillPackageScanState.CLEAN,
      expiresAt: timestamp(Math.floor(Date.now() / 1000) + 86400),
      replayed: false,
    }),
    finalize: async () => ({ intentId: { value: "intent-1" }, phase: SkillImportPhase.COMPLETED, replayed: false }),
    get: async () => ({
      intentId: { value: "intent-1" },
      skillId: { value: "skill-1" },
      phase: SkillImportPhase.UPLOADED,
      expiresAt: timestamp(Math.floor(Date.now() / 1000) + 86400),
      uploadProof: { uploadId: "upload-1", assetId: "asset-1", sourceVersionId: "v1", contentSha256: "a".repeat(64), sizeBytes: 123n },
    }),
  }
  await withServer(
    {
      sessionAdmission: new SessionAdmissionDouble({ "current-session": { namespace: "tenant", userId: "user" } }),
      skillAuthorization: { check: async (i) => (actions.push(i.action), { ok: true }) },
      localSkillImportClient: client,
    },
    async (base) => {
      const complete = await fetch(`${base}/browser/v1/skills/local-imports/intent-1/complete`, {
        method: "POST",
        headers,
        body: JSON.stringify({ upload_id: "upload-1", source_version_id: "v1", size_bytes: 123, content_sha256: "a".repeat(64) }),
      })
      assert.equal(complete.status, 200)
      assert.equal((await complete.json()).data.phase, "uploaded")
      const finalize = await fetch(`${base}/browser/v1/skills/local-imports/intent-1/finalize`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: "",
      })
      assert.equal(finalize.status, 502)
      assert.equal((await finalize.json()).error.code, "local_skill_import_response_invalid")
      const get = await fetch(`${base}/browser/v1/skills/local-imports/intent-1`, {
        headers: { authorization: headers.authorization, "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "secret" },
      })
      assert.equal(get.status, 200)
      assert.equal((await get.json()).data.phase, "uploaded")
    },
  )
  assert.deepEqual(actions, ["create_draft", "install", "create_draft", "install"])
})

test("production composition registers all four local-import owner methods only with the complete Platform credential set", async () => {
  const complete = {
    ...config,
    iamBaseUrl: "https://iam.example",
    skillDraft: {
      enabled: true,
      platformBaseUrl: "https://platform.example",
      credentialFile: "/credentials/catalog.json",
      timeoutMs: 100,
    },
    platformProjection: {
      baseUrl: "https://platform.example",
      credentialFile: "/credentials/projection.json",
      timeoutMs: 100,
    },
  }
  const options = {
    businessStore: null,
    readiness: async () => undefined,
    sessionAdmission: new SessionAdmissionDouble(),
    skillAuthorization: { check: async () => ({ ok: true }) },
  }
  const active = createBffComposition(complete, options)
  assert.ok(active.localSkillImportClient)
  assert.deepEqual(
    ["begin", "complete", "finalize", "get"].map((method) => typeof active.localSkillImportClient[method]),
    ["function", "function", "function", "function"],
  )
  await active.close()

  for (const [name, candidate] of [
    ["platform base URL", { ...complete, skillDraft: { ...complete.skillDraft, platformBaseUrl: null } }],
    ["catalog credential", { ...complete, skillDraft: { ...complete.skillDraft, credentialFile: null } }],
    ["projection credential", { ...complete, platformProjection: { ...complete.platformProjection, credentialFile: null } }],
    ["IAM URL", { ...complete, iamBaseUrl: null }],
  ]) {
    const inactive = createBffComposition(candidate, options)
    assert.equal(inactive.localSkillImportClient, undefined, name)
    await inactive.close()
    await withServer(
      {
        sessionAdmission: new SessionAdmissionDouble({ "current-session": { namespace: "tenant", userId: "user" } }),
        skillAuthorization: { check: async () => ({ ok: true }) },
      },
      async (base) => {
        const response = await fetch(`${base}/browser/v1/skills/local-imports`, {
          method: "POST",
          headers,
          body: JSON.stringify({ filename: "tea.skill", size_bytes: 123, content_sha256: "a".repeat(64) }),
        })
        assert.equal(response.status, 404, name)
      },
      candidate,
    )
  }
})

test("complete production composition dispatches all four private routes through machine-authenticated owner RPC", async () => {
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { SkillCatalogService } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const calls = []
  const owner = createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(SkillCatalogService, {
          beginLocalSkillImport(request, context) {
            calls.push(["begin", request, Object.fromEntries(context.requestHeader)])
            return beginResponse()
          },
          completeLocalSkillImport(request, context) {
            calls.push(["complete", request, Object.fromEntries(context.requestHeader)])
            return {
              intentId: request.intentId,
              skillId: { value: "skill-1" },
              phase: SkillImportPhase.UPLOADED,
              uploadProof: {
                uploadId: request.uploadId,
                assetId: "asset-1",
                sourceVersionId: request.sourceVersionId,
                contentSha256: request.contentSha256,
                sizeBytes: request.sizeBytes,
              },
              scanState: SkillPackageScanState.CLEAN,
              expiresAt: timestamp(Math.floor(Date.now() / 1000) + 86400),
              replayed: false,
            }
          },
          finalizeLocalSkillImport(request, context) {
            calls.push(["finalize", request, Object.fromEntries(context.requestHeader)])
            return { intentId: request.intentId, phase: SkillImportPhase.COMPLETED, skill: skill(), installation: installation(), replayed: false }
          },
          getLocalSkillImport(request, context) {
            calls.push(["get", request, Object.fromEntries(context.requestHeader)])
            return {
              intentId: request.intentId,
              skillId: { value: "series-1" },
              phase: SkillImportPhase.COMPLETED,
              expiresAt: timestamp(Math.floor(Date.now() / 1000) + 86400),
              uploadProof: { uploadId: "upload-1", assetId: "asset-1", sourceVersionId: "v1", contentSha256: "a".repeat(64), sizeBytes: 123n },
              skill: skill(),
              installation: installation(),
            }
          },
        })
      },
    }),
  )
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  const iam = createServer(async (req, res) => {
    let body = ""
    for await (const chunk of req) body += chunk
    const scope = new URLSearchParams(body).get("scope")
    res.writeHead(200, { "content-type": "application/json" })
    res.end(
      JSON.stringify({
        access_token: scope === "platform:projection.read" ? "projection-machine" : "catalog-machine",
        token_type: "Bearer",
        scope,
        expires_in: 60,
      }),
    )
  })
  iam.listen(0, "127.0.0.1")
  await once(iam, "listening")
  const dir = await mkdtemp(join(tmpdir(), "kokoro-local-import-"))
  const credential = (scope) => [
    {
      tenantId: "tenant",
      generation: 1,
      credentialRefVersion: "v1",
      clientId: scope,
      clientSecret: "secret",
      resource: "https://kokoro.dev/resources/platform-internal",
      scope,
    },
  ]
  const catalog = join(dir, "catalog.json"),
    projection = join(dir, "projection.json")
  await writeFile(catalog, JSON.stringify(credential("platform:skill-catalog.manage")))
  await chmod(catalog, 0o600)
  await writeFile(projection, JSON.stringify(credential("platform:projection.read")))
  await chmod(projection, 0o600)
  const live = {
    ...config,
    iamBaseUrl: `http://127.0.0.1:${iam.address().port}`,
    skillDraft: { enabled: true, platformBaseUrl: `http://127.0.0.1:${owner.address().port}`, credentialFile: catalog, timeoutMs: 1000 },
    platformProjection: { baseUrl: `http://127.0.0.1:${owner.address().port}`, credentialFile: projection, timeoutMs: 1000 },
  }
  try {
    await withServer(
      {
        sessionAdmission: new SessionAdmissionDouble({ "current-session": { namespace: "tenant", userId: "user" } }),
        skillAuthorization: { check: async () => ({ ok: true }) },
      },
      async (base) => {
        const requests = [
          ["POST", `${base}/browser/v1/skills/local-imports`, { filename: "tea.skill", size_bytes: 123, content_sha256: "a".repeat(64) }],
          [
            "POST",
            `${base}/browser/v1/skills/local-imports/intent-1/complete`,
            { upload_id: "upload-1", source_version_id: "v1", size_bytes: 123, content_sha256: "a".repeat(64) },
          ],
          ["POST", `${base}/browser/v1/skills/local-imports/intent-1/finalize`, null],
          ["GET", `${base}/browser/v1/skills/local-imports/intent-1`, null],
        ]
        for (const [method, url, body] of requests) {
          const requestHeaders =
            method === "GET" ? { authorization: headers.authorization, "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "secret" } : headers
          const response = await fetch(url, { method, headers: requestHeaders, body: body === null ? undefined : JSON.stringify(body) })
          assert.ok(response.ok, `${method} ${url}: ${response.status}`)
        }
      },
      live,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
    await Promise.all([new Promise((r) => owner.close(r)), new Promise((r) => iam.close(r))])
  }
  assert.deepEqual(
    calls.map(([name]) => name),
    ["begin", "complete", "finalize", "get"],
  )
  for (const [name, request, headers] of calls) {
    assert.equal(headers["x-tenant-ref"], "tenant")
    assert.equal(headers["x-kokoro-subject"], "user")
    assert.equal(headers.authorization, name === "get" ? "Bearer projection-machine" : "Bearer catalog-machine")
    assert.equal(request.productContext.subjectId, "user")
  }
})

test("incomplete production composition keeps the private namespace unregistered as 404", async () => {
  await withServer(
    {
      sessionAdmission: new SessionAdmissionDouble({ "current-session": { namespace: "tenant", userId: "user" } }),
      skillAuthorization: { check: async () => ({ ok: true }) },
    },
    async (base) => {
      const response = await fetch(`${base}/browser/v1/skills/local-imports`, {
        method: "POST",
        headers,
        body: JSON.stringify({ filename: "tea.skill", size_bytes: 123, content_sha256: "a".repeat(64) }),
      })
      assert.equal(response.status, 404)
    },
  )
})

test("Complete rejects an owner response bound to another path intent before emitting success", async () => {
  await withServer(
    {
      sessionAdmission: new SessionAdmissionDouble({ "current-session": { namespace: "tenant", userId: "user" } }),
      skillAuthorization: { check: async () => ({ ok: true }) },
      localSkillImportClient: {
        complete: async () => ({
          intentId: { value: "intent-other" },
          skillId: { value: "skill-1" },
          phase: SkillImportPhase.UPLOADED,
          uploadProof: { uploadId: "upload-1", assetId: "asset-1", sourceVersionId: "v1", contentSha256: "a".repeat(64), sizeBytes: 123n },
          scanState: SkillPackageScanState.CLEAN,
          expiresAt: timestamp(Math.floor(Date.now() / 1000) + 86_400),
          replayed: false,
        }),
      },
    },
    async (base) => {
      const response = await fetch(`${base}/browser/v1/skills/local-imports/intent-1/complete`, {
        method: "POST",
        headers,
        body: JSON.stringify({ upload_id: "upload-1", source_version_id: "v1", size_bytes: 123, content_sha256: "a".repeat(64) }),
      })
      assert.equal(response.status, 502)
      assert.equal((await response.json()).error.code, "local_skill_import_response_invalid")
    },
  )
})

test("Complete projection rejects upload proof binding and uint64/source-version boundary drift independently", () => {
  const base = {
    intentId: { value: "intent-1" },
    skillId: { value: "skill-1" },
    phase: SkillImportPhase.UPLOADED,
    scanState: SkillPackageScanState.CLEAN,
    expiresAt: timestamp(2),
    replayed: false,
  }
  for (const uploadProof of [
    { uploadId: "upload-other", assetId: "asset-1", sourceVersionId: "v1", contentSha256: "a".repeat(64), sizeBytes: 123n },
    { uploadId: "upload-1", assetId: "asset-1", sourceVersionId: "", contentSha256: "a".repeat(64), sizeBytes: 123n },
    { uploadId: "upload-1", assetId: "asset-1", sourceVersionId: "v1", contentSha256: "a".repeat(64), sizeBytes: 18_446_744_073_709_551_616n },
  ])
    assert.throws(
      () =>
        projectLocalImportComplete({ ...base, uploadProof }, { intentId: "intent-1", uploadId: "upload-1", sizeBytes: 123n, contentSha256: "a".repeat(64) }),
      /local_skill_import_response_invalid/,
    )
})

test("Finalize success projects the complete skill and installation and binds its path intent", () => {
  const response = { intentId: { value: "intent-1" }, phase: SkillImportPhase.COMPLETED, skill: skill(), installation: installation(), replayed: true }
  const projected = projectLocalImportFinalize(response, "intent-1")
  assert.equal(projected.intent_id, "intent-1")
  assert.equal(projected.phase, "completed")
  assert.equal(projected.skill.skill_id, "skill-1")
  assert.equal(projected.installation.installation_id, "installation-1")
  assert.equal(projected.replayed, true)
  assert.throws(() => projectLocalImportFinalize(response, "intent-other"), /local_skill_import_response_invalid/)
})

test("Get presence accepts completed after installation removal and rejects dirty non-completed projections", () => {
  const uploadProof = { uploadId: "upload-1", assetId: "asset-1", sourceVersionId: "v1", contentSha256: "a".repeat(64), sizeBytes: 123n }
  const common = { intentId: { value: "intent-1" }, skillId: { value: "series-1" }, expiresAt: timestamp(2) }
  assert.doesNotThrow(() => projectLocalImportGet({ ...common, phase: SkillImportPhase.COMPLETED, uploadProof, skill: skill() }, "intent-1"))
  for (const value of [
    { ...common, phase: SkillImportPhase.UPLOADED, uploadProof, skill: skill() },
    { ...common, phase: SkillImportPhase.REJECTED, uploadProof, skill: skill(), rejectionCode: "scan_rejected" },
    { ...common, phase: SkillImportPhase.UPLOAD_PENDING, uploadProof },
    { ...common, phase: SkillImportPhase.UPLOADED },
    { ...common, phase: SkillImportPhase.REJECTED, uploadProof },
    { ...common, phase: SkillImportPhase.COMPLETED, uploadProof },
  ])
    assert.throws(() => projectLocalImportGet(value, "intent-1"), /local_skill_import_response_invalid/)
  assert.throws(() => projectLocalImportGet({ ...common, phase: SkillImportPhase.UPLOAD_PENDING }, "intent-other"), /local_skill_import_response_invalid/)
})

test("Finalize rejects independently valid skill and installation snapshots with mismatched exact identity", async (t) => {
  const mismatches = [
    ["installation_source_ref_alias", skill(), { ...installation(), sourceRef: { value: "skill:skill-other" } }],
    ["installation_series_id", skill(), { ...installation(), seriesId: { value: "series-other" } }],
    ["installation_revision", skill(), { ...installation(), revision: 2n }],
    ["skill_source_ref_alias", { ...skill(), sourceRef: { value: "skill:skill-other" } }, installation()],
    ["skill_series_id", { ...skill(), seriesId: { value: "series-other" } }, installation()],
    ["skill_revision", { ...skill(), revision: 2n }, installation()],
  ]
  for (const [field, mismatchedSkill, mismatchedInstallation] of mismatches) {
    await t.test(field, () =>
      withServer(
        {
          sessionAdmission: new SessionAdmissionDouble({ "current-session": { namespace: "tenant", userId: "user" } }),
          skillAuthorization: { check: async () => ({ ok: true }) },
          localSkillImportClient: {
            finalize: async () => ({
              intentId: { value: "intent-1" },
              phase: SkillImportPhase.COMPLETED,
              skill: mismatchedSkill,
              installation: mismatchedInstallation,
              replayed: false,
            }),
          },
        },
        async (base) => {
          const response = await fetch(`${base}/browser/v1/skills/local-imports/intent-1/finalize`, {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: "",
          })
          assert.equal(response.status, 502)
          assert.equal((await response.json()).error.code, "local_skill_import_response_invalid")
        },
      ),
    )
  }
})

test("Get binds completed top-level skill identity and optional installation to one exact snapshot", async (t) => {
  const uploadProof = { uploadId: "upload-1", assetId: "asset-1", sourceVersionId: "v1", contentSha256: "a".repeat(64), sizeBytes: 123n }
  const variants = [
    ["top_level_series_id", { skillId: { value: "series-other" }, skill: skill() }],
    [
      "installation_source_ref_alias",
      { skillId: { value: "series-1" }, skill: skill(), installation: { ...installation(), sourceRef: { value: "skill:skill-other" } } },
    ],
    ["installation_series_id", { skillId: { value: "series-1" }, skill: skill(), installation: { ...installation(), seriesId: { value: "series-other" } } }],
    ["installation_revision", { skillId: { value: "series-1" }, skill: skill(), installation: { ...installation(), revision: 2n } }],
    [
      "skill_source_ref_alias",
      { skillId: { value: "series-1" }, skill: { ...skill(), sourceRef: { value: "skill:skill-other" } }, installation: installation() },
    ],
    ["skill_series_id", { skillId: { value: "series-1" }, skill: { ...skill(), seriesId: { value: "series-other" } }, installation: installation() }],
    ["skill_revision", { skillId: { value: "series-1" }, skill: { ...skill(), revision: 2n }, installation: installation() }],
  ]
  assert.doesNotThrow(() =>
    projectLocalImportGet(
      {
        intentId: { value: "intent-1" },
        skillId: { value: "series-1" },
        phase: SkillImportPhase.COMPLETED,
        expiresAt: timestamp(2),
        uploadProof,
        skill: skill(),
      },
      "intent-1",
    ),
  )
  for (const [field, variant] of variants) {
    await t.test(field, () =>
      withServer(
        {
          sessionAdmission: new SessionAdmissionDouble({ "current-session": { namespace: "tenant", userId: "user" } }),
          skillAuthorization: { check: async () => ({ ok: true }) },
          localSkillImportClient: {
            get: async () => ({
              intentId: { value: "intent-1" },
              phase: SkillImportPhase.COMPLETED,
              expiresAt: timestamp(2),
              uploadProof,
              ...variant,
            }),
          },
        },
        async (base) => {
          const response = await fetch(`${base}/browser/v1/skills/local-imports/intent-1`, {
            headers: { authorization: headers.authorization, "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "secret" },
          })
          assert.equal(response.status, 502)
          assert.equal((await response.json()).error.code, "local_skill_import_response_invalid")
        },
      ),
    )
  }
})

test("Get accepts a current revision whose exact skill id changed while the stable series anchor remains", async (t) => {
  const uploadProof = { uploadId: "upload-1", assetId: "asset-1", sourceVersionId: "v1", contentSha256: "a".repeat(64), sizeBytes: 123n }
  for (const [name, currentInstallation] of [
    ["removed_installation", undefined],
    ["matching_revision_two_installation", currentInstallationV2()],
  ]) {
    await t.test(name, () =>
      withServer(
        {
          sessionAdmission: new SessionAdmissionDouble({ "current-session": { namespace: "tenant", userId: "user" } }),
          skillAuthorization: { check: async () => ({ ok: true }) },
          localSkillImportClient: {
            get: async () => ({
              intentId: { value: "intent-1" },
              skillId: { value: "series-1" },
              phase: SkillImportPhase.COMPLETED,
              expiresAt: timestamp(2),
              uploadProof,
              skill: currentSkillV2(),
              ...(currentInstallation === undefined ? {} : { installation: currentInstallation }),
            }),
          },
        },
        async (base) => {
          const response = await fetch(`${base}/browser/v1/skills/local-imports/intent-1`, {
            headers: { authorization: headers.authorization, "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "secret" },
          })
          assert.equal(response.status, 200)
          const payload = await response.json()
          assert.equal(payload.data.skill.skill_id, "skill-2")
          assert.equal(payload.data.skill.series_id, "series-1")
          assert.equal(payload.data.skill.revision, "2")
          assert.equal(payload.data.installation?.revision, currentInstallation === undefined ? undefined : "2")
        },
      ),
    )
  }
})

test("Begin body streaming is fenced by the real ten-second absolute request budget", { timeout: 15_000 }, async () => {
  await withServer(
    {
      sessionAdmission: new SessionAdmissionDouble({ "current-session": { namespace: "tenant", userId: "user" } }),
      skillAuthorization: { check: async () => ({ ok: true }) },
      localSkillImportClient: { begin: async () => beginResponse() },
    },
    async (base) => {
      const started = performance.now()
      const outcome = await new Promise((resolve) => {
        const request = httpRequest(`${base}/browser/v1/skills/local-imports`, { method: "POST", headers }, (response) => {
          response.resume()
          response.once("end", () => resolve({ status: response.statusCode, elapsed: performance.now() - started }))
        })
        request.on("error", () => resolve({ status: 0, elapsed: performance.now() - started }))
        request.write('{"filename":"tea.skill",')
        setTimeout(() => {
          request.destroy()
          resolve({ status: 0, elapsed: performance.now() - started })
        }, 11_000).unref()
      })
      assert.equal(outcome.status, 503)
      assert.ok(outcome.elapsed < 10_750, `body deadline response took ${outcome.elapsed}ms`)
    },
  )
})
