import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { create, fromBinary, toBinary } from "@bufbuild/protobuf"
import * as wire from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts"
import { createBffServer } from "../src/bootstrap/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"
import { SkillPackageInspectionConnectClient } from "../src/infrastructure/clients/platform/skill-package-inspection-connect.ts"

const canonicalProject = "project-canonical",
  installationId = "installation-exact"
const headers = { authorization: "Bearer session", "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "secret" }
const stamp = () => ({ $typeName: "google.protobuf.Timestamp", seconds: 1n, nanos: 0 })
const listen = async (server) => {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return `http://127.0.0.1:${server.address().port}`
}
const close = async (server) => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}

/** Actual own binary Native + Storage/BFF HTTP; IAM, Project repository and owner responses are explicit fixture boundaries. */
async function withProjectContent(run) {
  const directory = await mkdtemp(join(tmpdir(), "kokoro-project-content-")),
    credentialFile = join(directory, "projection.json")
  await writeFile(
    credentialFile,
    JSON.stringify({
      version: 1,
      entries: [
        {
          credential_id: "test-projection",
          caller: "kokoro-bff",
          tenant_id: "tenant",
          surfaces: ["projection"],
          secret: "test-projection-credential-".repeat(2),
        },
      ],
    }),
    { mode: 0o600 },
  )
  const bytes = Buffer.from("immutable Project package bytes"),
    digest = createHash("sha256").update(bytes).digest("hex"),
    text = "Original Project body"
  const state = {
    visible: true,
    admitted: true,
    subject: "user",
    sourceRef: "skill:old-version",
    revision: 2n,
    installed: true,
    native: [],
    records: [],
    projectReads: [],
    objectReads: 0,
    genericReads: 0,
    wrongDigest: false,
    unknownWire: false,
    objectBytes: null,
    beforeRecord: null,
    beforeInspect: null,
    beforeDownload: null,
    beforeObject: null,
  }
  const object = createServer((_request, response) => {
    state.objectReads++
    state.beforeObject?.()
    response.writeHead(200, { "content-length": bytes.length })
    response.end(state.objectBytes ?? bytes)
  })
  const objectOrigin = await listen(object)
  const native = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const operation = request.url?.split("/").at(-1)
    state.native.push({
      operation,
      project: request.headers["x-kokoro-project-ref"],
      subject: request.headers["x-kokoro-subject"],
      tenant: request.headers["x-kokoro-tenant"],
    })
    let input, output, schema
    if (operation === "InspectProjectSkillInstallationPackage") {
      input = fromBinary(wire.InspectProjectSkillInstallationPackageRequestSchema, Buffer.concat(chunks))
      await state.beforeInspect?.()
      schema = wire.InspectProjectSkillInstallationPackageResponseSchema
      output = create(schema, {
        sourceRef: { value: state.sourceRef },
        revision: state.revision,
        files: [{ path: "SKILL.md", sizeBytes: BigInt(Buffer.byteLength(text)) }],
        ...(input.filePath === undefined ? {} : { selectedFile: { path: input.filePath, text } }),
      })
    } else if (operation === "GetProjectSkillInstallationPackageDownload") {
      input = fromBinary(wire.GetProjectSkillInstallationPackageDownloadRequestSchema, Buffer.concat(chunks))
      state.beforeDownload?.()
      schema = wire.GetProjectSkillInstallationPackageDownloadResponseSchema
      output = create(schema, {
        sourceRef: { value: state.sourceRef },
        revision: state.revision,
        filename: "old-project.zip",
        contentSha256: state.wrongDigest ? "invalid" : digest,
        sizeBytes: BigInt(bytes.length),
        transferReference: {
          url: `${objectOrigin}/exact-version`,
          method: "GET",
          requiredHeaders: {},
          expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60), nanos: 0 },
        },
      })
    } else {
      response.writeHead(501, { "content-type": "application/json" })
      response.end(JSON.stringify({ code: "unimplemented", message: "No personal/source alias" }))
      return
    }
    assert.equal(input.installationId?.value, installationId)
    response.writeHead(200, { "content-type": "application/proto", "cache-control": "no-store", "x-kokoro-request-id": input.requestId })
    response.end(state.unknownWire ? Buffer.concat([toBinary(schema, output), Buffer.from([0xa0, 0x06, 0x01])]) : toBinary(schema, output))
  })
  const nativeOrigin = await listen(native)
  const installationClient = {
    get: async (input) => {
      state.records.push(input)
      state.beforeRecord?.()
      assert.equal(input.projectRef, canonicalProject)
      return {
        projectRef: canonicalProject,
        installation: {
          installationId: { value: installationId },
          sourceRef: { value: state.sourceRef },
          seriesId: { value: "series" },
          revision: state.revision,
          acquisitionKind: 1,
          installed: state.installed,
          ...(state.installed ? {} : { removedAt: stamp() }),
          enabled: false,
          installedAt: stamp(),
          updatedAt: stamp(),
          displayName: "Old installed revision",
          summary: "Exact Project package",
          tags: [],
          sourceStatus: 2,
          skillUpdatedAt: stamp(),
          examplePrompts: { prompts: [] },
          categoryKeys: { keys: [] },
          product: create(wire.SkillProductFactsSchema, { publicationAudience: "owner", stateVersion: 1n }),
        },
      }
    },
  }
  const store = {
    services: {
      skillShares: {},
      projects: {
        find: async (identity, ref) => {
          state.projectReads.push({ identity, ref })
          assert.deepEqual(identity, { tenantId: "tenant", subjectId: "user" })
          return state.visible && [canonicalProject, "project-alias"].includes(ref) ? { id: canonicalProject } : null
        },
      },
    },
  }
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant",
    iamBaseUrl: null,
    sharedSecret: "secret",
    upstreamSecret: null,
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 1048576,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {},
    storage: { objectOrigin },
    storageObjectOrigin: objectOrigin,
    platformProjection: { baseUrl: nativeOrigin, credentialFile, timeoutMs: 1000 },
    skillDraft: { enabled: false, platformBaseUrl: null, credentialFile: null, timeoutMs: 1000 },
  }
  const server = createBffServer(config, {
    businessStore: store,
    installationClient,
    skillProductClient: {
      download: async () => {
        state.genericReads++
        throw Error("Personal/source grant must not be called")
      },
    },
    sessionAdmission: {
      verify: async () =>
        state.admitted
          ? { ok: true, identity: { namespace: "tenant", userId: state.subject }, platformAdmin: false }
          : { ok: false, status: 401, code: "session_invalid" },
    },
    skillAuthorization: {
      check: async () => {
        throw Error("Read is not a management action")
      },
    },
  })
  const base = await listen(server)
  const client = new SkillPackageInspectionConnectClient(nativeOrigin, credentialFile, 1000)
  try {
    await run({ state, base, client, bytes, digest, text, store })
  } finally {
    await close(server)
    await close(native)
    await close(object)
    await rm(directory, { recursive: true, force: true })
  }
}

test("Project content Native inspection uses its named RPC and trusted Project transport, never personal alias", async () => {
  await withProjectContent(async ({ client, state, text }) => {
    const result = await client.inspect(
      { operation: "project", projectId: canonicalProject, installationId, requestId: "project-read", tenant: "tenant", subject: "user", filePath: "SKILL.md" },
      new AbortController().signal,
      performance.now() + 1000,
    )
    assert.equal(result.selectedFile?.text, text)
    assert.deepEqual(
      state.native.map((value) => value.operation),
      ["InspectProjectSkillInstallationPackage"],
    )
    assert.equal(state.native[0].project, canonicalProject)
    assert.equal(state.native[0].subject, "user")
    assert.equal(state.native[0].tenant, "tenant")
  })
})

test("Project package GET resolves current Project and exact old installation before and after native content", async () => {
  await withProjectContent(async ({ base, state, text }) => {
    const response = await fetch(`${base}/v1/projects/project-alias/skill-installations/${installationId}/package?file_path=SKILL.md`, { headers })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).data, {
      source_ref: "skill:old-version",
      revision: "2",
      files: [{ path: "SKILL.md", size_bytes: String(Buffer.byteLength(text)) }],
      selected_file: { path: "SKILL.md", text },
    })
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.ok(state.projectReads.length >= 2)
    assert.ok(state.records.length >= 2)
    assert.equal(state.native[0].project, canonicalProject)
    assert.equal(state.genericReads, 0)
  })
})

const downloadPath = `/browser/v1/projects/project-alias/skill-installations/${installationId}/download`
async function issue(base) {
  const response = await fetch(`${base}${downloadPath}`, { method: "POST", headers })
  assert.equal(response.status, 200, await response.clone().text())
  return (await response.json()).data
}

test("Project exact download uses only named Project grant, verifies actual Storage bytes and retains canonical qualifier", async () => {
  await withProjectContent(async ({ base, state, bytes }) => {
    const data = await issue(base)
    assert.equal(data.source_ref, "skill:old-version")
    assert.equal(data.revision, "2")
    assert.equal(data.download_info.filename, "old-project.zip")
    const response = await fetch(`${base}${data.download_info.download_url}`, { headers })
    assert.equal(response.status, 200, await response.clone().text())
    assert.equal(response.headers.get("content-type"), "application/zip")
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
    assert.equal(state.objectReads, 1)
    assert.equal(state.genericReads, 0)
    assert.ok(state.native.length >= 3)
    assert.ok(state.native.every((value) => value.operation === "GetProjectSkillInstallationPackageDownload" && value.project === canonicalProject))
  })
})

test("Project handle denies membership revoked during Storage spool before sending any ZIP body", async () => {
  await withProjectContent(async ({ base, state }) => {
    const data = await issue(base)
    state.beforeObject = () => {
      state.visible = false
    }
    const response = await fetch(`${base}${data.download_info.download_url}`, { headers })
    assert.equal(response.status, 404)
    assert.notEqual(response.headers.get("content-type"), "application/zip")
    assert.equal(state.objectReads, 1)
    assert.equal(state.genericReads, 0)
  })
})

test("Project package GET denies pin changed during owner read instead of returning stale original body", async () => {
  await withProjectContent(async ({ base, state }) => {
    state.beforeInspect = () => {
      state.revision = 3n
    }
    const response = await fetch(`${base}/v1/projects/project-alias/skill-installations/${installationId}/package?file_path=SKILL.md`, { headers })
    assert.notEqual(response.status, 200)
    assert.equal(state.native.length, 1)
  })
})

test("Project download issue denies changed installation during grant before issuing a handle", async () => {
  await withProjectContent(async ({ base, state }) => {
    state.beforeDownload = () => {
      state.installed = false
    }
    const response = await fetch(`${base}${downloadPath}`, { method: "POST", headers })
    assert.equal(response.status, 404)
    assert.equal(state.objectReads, 0)
    assert.equal(state.native.length, 1)
  })
})

for (const change of ["revoke", "pin", "remove"])
  test(`Project handle rejects ${change} after issue without Storage fetch`, async () => {
    await withProjectContent(async ({ base, state }) => {
      const data = await issue(base)
      if (change === "revoke") state.visible = false
      else if (change === "pin") state.revision = 3n
      else state.installed = false
      const response = await fetch(`${base}${data.download_info.download_url}`, { headers })
      assert.equal(response.status, 404)
      assert.equal(state.objectReads, 0)
    })
  })

test("Project handle is bound to original subject; changing the current Session does not leak bytes", async () => {
  await withProjectContent(async ({ base, state }) => {
    const data = await issue(base)
    state.subject = "other"
    const response = await fetch(`${base}${data.download_info.download_url}`, { headers })
    assert.equal(response.status, 403)
    assert.equal(state.objectReads, 0)
  })
})

test("Project grant rejects malformed digest before handle or object access", async () => {
  await withProjectContent(async ({ base, state }) => {
    state.wrongDigest = true
    const response = await fetch(`${base}${downloadPath}`, { method: "POST", headers })
    assert.equal(response.status, 502)
    assert.equal(state.native.length, 1)
    assert.equal(state.objectReads, 0)
  })
})

test("Project byte spool rejects digest mismatch instead of sending unverified ZIP bytes", async () => {
  await withProjectContent(async ({ base, state, bytes }) => {
    const data = await issue(base)
    state.objectBytes = Buffer.alloc(bytes.length, 0)
    const response = await fetch(`${base}${data.download_info.download_url}`, { headers })
    assert.equal(response.status, 502)
    assert.notEqual(response.headers.get("content-type"), "application/zip")
    assert.equal(state.objectReads, 1)
  })
})

test("Project inspection rejects unknown owner wire and membership lost during installation read", async () => {
  await withProjectContent(async ({ base, state }) => {
    state.unknownWire = true
    let response = await fetch(`${base}/v1/projects/${canonicalProject}/skill-installations/${installationId}/package`, { headers })
    assert.equal(response.status, 502)
    state.unknownWire = false
    state.beforeRecord = () => {
      state.visible = false
    }
    response = await fetch(`${base}/v1/projects/${canonicalProject}/skill-installations/${installationId}/package`, { headers })
    assert.equal(response.status, 404)
    assert.equal(state.native.length, 1)
  })
})

test("Project content requests retain strict path, query, method, body and command-header boundaries", async () => {
  await withProjectContent(async ({ base, state }) => {
    const packagePath = `/v1/projects/${canonicalProject}/skill-installations/${installationId}/package`
    for (const suffix of ["?file_path=../secret", "?file_path=SKILL.md&file_path=SKILL.md", "?other=1"]) {
      const response = await fetch(`${base}${packagePath}${suffix}`, { headers })
      assert.equal(response.status, 400)
    }
    for (const init of [
      { method: "GET", headers: { ...headers, "idempotency-key": "not-a-command" } },
      { method: "POST", headers, body: "x" },
    ]) {
      const response = await fetch(`${base}${downloadPath}`, init)
      assert.equal(response.status, init.method === "GET" ? 405 : 400)
    }
    assert.equal(state.native.length, 0)
    assert.equal(state.objectReads, 0)
  })
})

for (const stage of ["inspect", "download"])
  test(`Project ${stage} denies current Session revocation without using personal scope`, async () => {
    await withProjectContent(async ({ base, state }) => {
      state.admitted = false
      const response = await fetch(
        `${base}${stage === "inspect" ? `/v1/projects/${canonicalProject}/skill-installations/${installationId}/package` : downloadPath}`,
        { headers, ...(stage === "download" ? { method: "POST" } : {}) },
      )
      assert.equal(response.status, 401)
      assert.equal(state.native.length, 0)
      assert.equal(state.records.length, 0)
    })
  })

test("Project Native read obeys caller cancellation and does not retry or cross to personal RPC", async () => {
  await withProjectContent(async ({ client, state }) => {
    const controller = new AbortController()
    let release, entered
    const waiting = new Promise((resolve) => {
      entered = resolve
    })
    const held = new Promise((resolve) => {
      release = resolve
    })
    state.beforeInspect = () => {
      entered()
      return held
    }
    const pending = client.inspect(
      { operation: "project", projectId: canonicalProject, installationId, requestId: "cancelled-project-read", tenant: "tenant", subject: "user" },
      controller.signal,
      performance.now() + 1000,
    )
    await waiting
    controller.abort()
    await assert.rejects(pending)
    release()
    assert.equal(state.native.length, 1)
    assert.equal(state.native[0].operation, "InspectProjectSkillInstallationPackage")
  })
})

test("Project handle that expires during final Project qualification never emits ZIP bytes", async (t) => {
  await withProjectContent(async ({ base, state }) => {
    const data = await issue(base)
    const expiresAt = Date.parse(data.download_info.expires_at)
    let expired = false
    // Hold expiry until the final post-spool owner qualification, after the original route's earlier TTL check.
    state.beforeDownload = () => {
      if (state.objectReads === 1 && state.native.filter((value) => value.operation === "GetProjectSkillInstallationPackageDownload").length >= 5) {
        t.mock.method(Date, "now", () => expiresAt + 1)
        expired = true
      }
    }
    const response = await fetch(`${base}${data.download_info.download_url}`, { headers })
    assert.equal(expired, true)
    assert.equal(response.status, 410)
    assert.notEqual(response.headers.get("content-type"), "application/zip")
    assert.equal(state.objectReads, 1)
  })
})
