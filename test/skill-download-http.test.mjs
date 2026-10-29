import assert from "node:assert/strict"
import test from "node:test"
import { createServer, request as nodeRequest } from "node:http"
import { once } from "node:events"
import { createHash } from "node:crypto"
import { z } from "zod"
import { SKILL_DOWNLOAD_POLICY } from "../src/http/routes/skill-download.policy.ts"
import { Code, ConnectError } from "@connectrpc/connect"
import { exactSkillDownloadRoute, skillDownloadHandleRoute } from "../src/http/routes/skill-download.ts"
import { SkillDownloadHandles } from "../src/application/skill-download-handles.ts"
import { ExactSkillDownloadService, exactInstallationRecord } from "../src/application/exact-skill-download.ts"

test("Package proxy verifies all bytes then re-admits exact revision and session before disclosure", async () => {
  const bytes = Buffer.from("immutable-package"),
    hash = createHash("sha256").update(bytes).digest("hex")
  let changed = false,
    readmitted = 0,
    calls = 0,
    revoked = false,
    bytesSent = false
  const object = createServer((_req, res) => {
    bytesSent = true
    res.writeHead(200, { "content-type": "application/zip", "content-length": bytes.length })
    res.end(bytes)
  })
  object.listen(0, "127.0.0.1")
  await once(object, "listening")
  const origin = `http://127.0.0.1:${object.address().port}`
  const handles = new SkillDownloadHandles()
  const entry = handles.issue({
    tenantId: "tenant",
    subjectId: "user",
    qualifier: { kind: "catalog_current", seriesId: "series" },
    sourceRef: "skill:s",
    revision: "1",
    filename: "skill.zip",
    sizeBytes: bytes.length,
    contentSha256: hash,
    expiresAt: Date.now() + 60000,
    transfer: { url: `${origin}/object`, method: "GET", requiredHeaders: {}, expiresAt: Date.now() + 60000 },
  })
  const composition = {
    skillDownloadHandles: handles,
    sessionAdmission: {
      async verify() {
        readmitted++
        return revoked && bytesSent
          ? { ok: false, status: 401, code: "session_authentication_required" }
          : { ok: true, identity: { namespace: "tenant", userId: "user" }, platformAdmin: false }
      },
    },
    skillSpecificationSource: {
      async confirmDownload(binding) {
        calls++
        assert.equal(binding.sourceRef, "skill:s")
        if (changed && calls % 2 === 0) throw new ConnectError("Exact revision changed", Code.NotFound)
      },
    },
  }
  const config = { tenantId: "tenant", sharedSecret: "test", storageObjectOrigin: origin }
  const journeys = []
  const proxy = createServer((request, response) => {
    journeys.push(skillDownloadHandleRoute(request, response, config, composition, "request", ["skill-downloads", entry.handle]))
  })
  proxy.listen(0, "127.0.0.1")
  await once(proxy, "listening")
  try {
    const url = `http://127.0.0.1:${proxy.address().port}/skill-downloads/${entry.handle}`,
      headers = { authorization: "Bearer human", "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test" }
    let response = await fetch(url, { headers })
    assert.equal(response.status, 200)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
    await journeys[0]
    assert.equal(readmitted, 2)
    changed = true
    bytesSent = false
    response = await fetch(url, { headers })
    assert.equal(response.status, 404)
    await response.arrayBuffer()
    await journeys[1]
    assert.equal(readmitted, 3)
    changed = false
    revoked = true
    bytesSent = false
    response = await fetch(url, { headers })
    assert.equal(response.status, 401)
    await response.arrayBuffer()
    await journeys[2]
    assert.equal(readmitted, 5)
    assert.equal(calls, 6)
  } finally {
    object.closeAllConnections()
    proxy.closeAllConnections()
    await Promise.all([new Promise((resolve) => object.close(resolve)), new Promise((resolve) => proxy.close(resolve))])
  }
})

test("Exact prepare accepts real empty POST and rejects payload or encoded slash before owner", async () => {
  let prepared = 0
  const handles = new SkillDownloadHandles()
  const composition = {
    skillDownloadHandles: handles,
    sessionAdmission: {
      async verify() {
        return { ok: true, identity: { namespace: "tenant", userId: "user" }, platformAdmin: false }
      },
    },
    exactSkillDownloadSource: {
      async prepare(qualifier) {
        prepared++
        return handles.issue({
          tenantId: "tenant",
          subjectId: "user",
          qualifier,
          sourceRef: "skill:version",
          revision: "1",
          filename: "skill.zip",
          sizeBytes: 3,
          contentSha256: "a".repeat(64),
          expiresAt: Date.now() + 60000,
          transfer: { url: "http://objects.test/blob", method: "GET", requiredHeaders: {}, expiresAt: Date.now() + 60000 },
        })
      },
    },
  }
  const config = { tenantId: "tenant", sharedSecret: "test" }
  const server = createServer((request, response) => {
    let path
    try {
      path = new URL(request.url, "http://bff").pathname.split("/").filter(Boolean).map(decodeURIComponent)
    } catch {
      response.writeHead(400).end()
      return
    }
    void exactSkillDownloadRoute(request, response, config, composition, "request", path)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const base = `http://127.0.0.1:${server.address().port}`,
    headers = { authorization: "Bearer human", "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test" }
  try {
    let response = await fetch(`${base}/browser/v1/skill-installations/install-1/download`, { method: "POST", headers })
    assert.equal(response.status, 200)
    assert.equal(prepared, 1)
    response = await fetch(`${base}/browser/v1/skill-installations/install-1/download`, {
      method: "POST",
      headers: { ...headers, "content-length": "0" },
      body: Buffer.alloc(0),
    })
    assert.equal(response.status, 200)
    assert.equal(prepared, 2)
    response = await fetch(`${base}/browser/v1/skill-installations/install-1/download`, {
      method: "POST",
      headers: { ...headers, "content-type": "text/plain" },
      body: "x",
    })
    assert.equal(response.status, 400)
    response = await fetch(`${base}/browser/v1/skill-installations/%252F/download`, { method: "POST", headers })
    assert.equal(response.status, 400)
    const chunkedStatus = await new Promise((resolve, reject) => {
      const outgoing = nodeRequest(
        `${base}/browser/v1/skill-installations/install-1/download`,
        {
          method: "POST",
          headers: { ...headers, "transfer-encoding": "chunked" },
        },
        (incoming) => {
          incoming.resume()
          incoming.once("end", () => resolve(incoming.statusCode))
        },
      )
      outgoing.once("error", reject)
      outgoing.end()
    })
    assert.equal(chunkedStatus, 400)
    assert.equal(prepared, 2)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("Exact prepare wrong methods return the complete private 405 envelope before admission or owner I/O", async () => {
  let admissions = 0,
    owners = 0
  const composition = {
    sessionAdmission: {
      async verify() {
        admissions++
        throw new Error("unexpected admission")
      },
    },
    exactSkillDownloadSource: {
      async prepare() {
        owners++
        throw new Error("unexpected owner")
      },
    },
  }
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://bff").pathname.split("/").filter(Boolean).map(decodeURIComponent)
    void exactSkillDownloadRoute(request, response, { tenantId: "tenant", sharedSecret: "test" }, composition, "request-exact-405", path)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    for (const path of [
      "/browser/v1/skill-installations/install-1/download",
      "/browser/v1/skills/version-1/download",
      "/browser/v1/skill-shares/share-1/download",
    ]) {
      const response = await fetch(`${base}${path}`)
      assert.equal(response.status, 405)
      assert.equal(response.headers.get("allow"), "POST")
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.equal(response.headers.get("x-request-id"), "request-exact-405")
      assert.deepEqual(await response.json(), {
        error: { code: "MethodNotAllowed", message: "Request method is invalid", retryable: false },
      })
    }
    assert.equal(admissions, 0)
    assert.equal(owners, 0)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("Exact installation HTTP rejects mismatched fresh owner ID before download and maps its closed failures", async () => {
  let downloads = 0
  const handles = new SkillDownloadHandles()
  const service = new ExactSkillDownloadService({
    handles,
    objectOrigin: "http://objects.test",
    installation: async (id) => exactInstallationRecord(id, { installation_id: "other", source_ref: "skill:version", revision: "1", installed: true }),
    managed: async () => null,
    share: async () => null,
    download: async () => {
      downloads++
      throw new Error("unexpected")
    },
  })
  const composition = {
    skillDownloadHandles: handles,
    sessionAdmission: {
      async verify() {
        return { ok: true, identity: { namespace: "tenant", userId: "user" }, platformAdmin: false }
      },
    },
    exactSkillDownloadSource: service,
  }
  const config = { tenantId: "tenant", sharedSecret: "test" }
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://bff").pathname.split("/").filter(Boolean).map(decodeURIComponent)
    void exactSkillDownloadRoute(request, response, config, composition, "request", path)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const headers = { authorization: "Bearer human", "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test" }
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/browser/v1/skill-installations/install-1/download`, { method: "POST", headers })
    assert.equal(response.status, 502)
    assert.equal((await response.json()).error.code, "skill_response_invalid")
    assert.equal(downloads, 0)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("Exact download policy maps application authorization and deadline failures without changing generic Skill routes", async () => {
  for (const [error, status, code] of [
    [new ConnectError("login", Code.Unauthenticated), 401, "session_authentication_required"],
    [new ConnectError("denied", Code.PermissionDenied), 403, "skill_download_forbidden"],
    [new ConnectError("missing", Code.NotFound), 404, "skill_not_found"],
    [new ConnectError("rate", Code.ResourceExhausted), 429, "skill_rate_limited"],
    [new ConnectError("late", Code.DeadlineExceeded), 504, "skill_deadline_exceeded"],
  ]) {
    const composition = {
      skillDownloadHandles: new SkillDownloadHandles(),
      sessionAdmission: {
        async verify() {
          return { ok: true, identity: { namespace: "tenant", userId: "user" }, platformAdmin: false }
        },
      },
      exactSkillDownloadSource: {
        async prepare() {
          throw error
        },
      },
    }
    const config = { tenantId: "tenant", sharedSecret: "test" }
    const server = createServer((request, response) => {
      const path = new URL(request.url, "http://bff").pathname.split("/").filter(Boolean).map(decodeURIComponent)
      void exactSkillDownloadRoute(request, response, config, composition, "request", path)
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/browser/v1/skills/version-1/download`, {
        method: "POST",
        headers: { authorization: "Bearer human", "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test" },
      })
      assert.equal(response.status, status)
      assert.equal((await response.json()).error.code, code)
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

test("published opaque-byte contract matches actual bare failures and FailedPrecondition 503, never metadata 412", async () => {
  const bytes = Buffer.from("exact-byte-contract"),
    digest = createHash("sha256").update(bytes).digest("hex")
  let objectReads = 0,
    cause = null,
    sessionFailure = null
  const object = createServer((_request, response) => {
    objectReads++
    response.writeHead(200, { "content-length": bytes.length })
    response.end(bytes)
  })
  object.listen(0, "127.0.0.1")
  await once(object, "listening")
  const origin = `http://127.0.0.1:${object.address().port}`
  const handles = new SkillDownloadHandles()
  const entry = handles.issue({
    tenantId: "tenant",
    subjectId: "user",
    qualifier: { kind: "catalog_current", seriesId: "series" },
    sourceRef: "skill:exact",
    revision: "1",
    filename: "exact Skill.zip",
    sizeBytes: bytes.length,
    contentSha256: digest,
    expiresAt: Date.now() + 60_000,
    transfer: { url: `${origin}/object`, method: "GET", requiredHeaders: {}, expiresAt: Date.now() + 60_000 },
  })
  const config = { tenantId: "tenant", sharedSecret: "test", storageObjectOrigin: origin }
  const composition = {
    skillDownloadHandles: handles,
    sessionAdmission: { verify: async () => sessionFailure ?? { ok: true, identity: { namespace: "tenant", userId: "user" }, platformAdmin: false } },
    skillSpecificationSource: {
      confirmDownload: async () => {
        if (cause) throw cause
      },
    },
  }
  const pending = []
  const proxy = createServer((request, response) => {
    // The real bootstrap owns this common header, including method rejection.
    response.setHeader("x-request-id", "byte-contract")
    const path = new URL(request.url, "http://bff.local").pathname.split("/").filter(Boolean)
    pending.push(skillDownloadHandleRoute(request, response, config, composition, "byte-contract", path))
  })
  proxy.listen(0, "127.0.0.1")
  await once(proxy, "listening")
  const base = `http://127.0.0.1:${proxy.address().port}`,
    path = `/skill-downloads/${entry.handle}`
  const headers = { authorization: "Bearer human", "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test" }
  const policy = SKILL_DOWNLOAD_POLICY.byte_operation
  const checkError = async (response, status, code, retryable) => {
    assert.equal(response.status, status)
    const text = await response.text(),
      body = JSON.parse(text)
    assert.equal(body.error.code, code)
    assert.equal(Object.hasOwn(body.error, "retryable"), retryable !== undefined)
    if (retryable !== undefined) assert.equal(body.error.retryable, retryable)
    assert.equal(response.headers.get("content-type"), policy.errorFraming.contentType)
    assert.equal(response.headers.get("content-length"), String(Buffer.byteLength(text)))
    assert.equal(response.headers.get("content-disposition"), null)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("x-request-id"), "byte-contract")
    const row = policy.responses.errors.find((value) => value.status === status)
    assert.ok(row)
    assert.equal(z.fromJSONSchema(row.schema).safeParse(body).success, true)
    assert.equal(z.fromJSONSchema(row.schema).safeParse({ ...body, extra: true }).success, false)
    assert.equal(
      policy.responses.errors.find((value) => value.status === 412),
      undefined,
    )
  }
  try {
    const cases = [
      [Code.FailedPrecondition, 503, "skill_dependency_unavailable", true],
      [Code.PermissionDenied, 403, "PermissionDenied", undefined],
      [Code.Unauthenticated, 401, "Unauthenticated", undefined],
      [Code.NotFound, 404, "NotFound", undefined],
      [Code.InvalidArgument, 400, "invalid_skill_request", false],
      [Code.ResourceExhausted, 429, "skill_rate_limited", true],
      [Code.DeadlineExceeded, 504, "skill_deadline_exceeded", true],
      [Code.Unavailable, 503, "skill_dependency_unavailable", true],
    ]
    for (const [nativeCode, status, code, retryable] of cases) {
      cause = new ConnectError("Private owner explanation must not leak", nativeCode)
      await checkError(await fetch(base + path, { headers }), status, code, retryable)
    }
    cause = new Error("skill_response_invalid")
    await checkError(await fetch(base + path, { headers }), 502, "skill_response_invalid", false)
    cause = null
    await checkError(await fetch(`${base}/skill-downloads/missing`, { headers }), 410, "Gone", undefined)
    await checkError(await fetch(base + path, { method: "POST", headers }), 405, "MethodNotAllowed", undefined)
    for (const [status, code] of [
      [401, "session_invalid"],
      [403, "session_forbidden"],
      [429, "session_rate_limited"],
      [503, "iam_admission_unavailable"],
    ]) {
      sessionFailure = { ok: false, status, code, ...(status === 429 ? { retryAfter: "5" } : {}) }
      const response = await fetch(base + path, { headers })
      if (status === 429) assert.equal(response.headers.get("retry-after"), "5")
      await checkError(response, status, code, undefined)
    }
    assert.equal(objectReads, 0, "rejected qualification and admission never reach Storage")
    sessionFailure = null
    const response = await fetch(base + path, { headers })
    assert.equal(response.status, 200)
    assert.equal(z.fromJSONSchema(policy.responses[200].headers).safeParse(Object.fromEntries(response.headers)).success, true)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
    assert.equal(objectReads, 1)
    await Promise.all(pending)
  } finally {
    proxy.closeAllConnections()
    object.closeAllConnections()
    await Promise.all([new Promise((resolve) => proxy.close(resolve)), new Promise((resolve) => object.close(resolve))])
  }
})
