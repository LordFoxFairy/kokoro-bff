import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import { mkdtemp, readFile, readdir, rm, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const bytes = Buffer.from("hello")
const sha = createHash("sha256").update(bytes).digest("hex")
const storage = { baseUrl: "http://storage.test", secret: "storage-secret", objectOrigin: "http://objects.test" }
const identity = { namespace: "tenant-1", userId: "subject-1" }

function controllableClock() {
  let now = 0
  let nextId = 1
  const pending = new Map()
  const scheduled = new Map()
  return {
    schedule(callback, milliseconds) {
      const id = nextId++
      pending.set(id, { at: now + milliseconds, callback })
      scheduled.set(milliseconds, (scheduled.get(milliseconds) ?? 0) + 1)
      return id
    },
    clear(id) {
      pending.delete(id)
    },
    scheduledCount(milliseconds) {
      return scheduled.get(milliseconds) ?? 0
    },
    advance(milliseconds) {
      now += milliseconds
      while (true) {
        const due = [...pending].filter(([, timer]) => timer.at <= now).sort((left, right) => left[1].at - right[1].at)[0]
        if (due === undefined) break
        pending.delete(due[0])
        due[1].callback()
      }
    },
  }
}

test("personal download is a versioned binary Product operation with stable errors", async () => {
  const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const operation = source.split("  /v1/library/files/{asset_id}/content:")[1]?.split("  /v1/billing/plans:")[0] ?? ""
  for (const marker of [
    "operationId: downloadLibraryFile",
    "x-kokoro-idempotency: none",
    "x-kokoro-permission: storage.library.read",
    "'*/*':",
    "format: binary",
    "Content-Disposition:",
    "Referrer-Policy:",
    "x-request-id:",
    "'200':",
    "'400':",
    "'401':",
    "'403':",
    "'404':",
    "'429':",
    "'502':",
    "'503':",
  ])
    assert.ok(operation.includes(marker), marker)
})

test("personal Storage download checks ASSET/CLEAN before signing, verifies exact metadata and bytes, and carries admitted scope", async () => {
  const { PersonalFileDownloadClient } = await import("../dist/infrastructure/clients/storage/personal-file-download.js")
  const { createRouterTransport, ConnectError, Code } = await import("@connectrpc/connect")
  const { StorageService, UploadPurpose, ScanState } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  const calls = []
  let asset = {
    assetId: "asset-1",
    filename: "fox.txt",
    mimeType: "text/plain",
    contentSha256: sha,
    sizeBytes: 5n,
    uploadPurpose: UploadPurpose.ASSET,
    scanState: ScanState.CLEAN,
  }
  let reference = {
    assetId: "asset-1",
    contentSha256: sha,
    sizeBytes: 5n,
    mimeType: "text/plain",
    scanState: ScanState.CLEAN,
    downloadReference: {
      url: "http://objects.test/download?sig=secret",
      method: "GET",
      requiredHeaders: {},
      expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) },
    },
  }
  let referenceError = null
  const transport = createRouterTransport((router) =>
    router.service(StorageService, {
      getAsset(req, ctx) {
        calls.push(["asset", req, ctx])
        return asset
      },
      getDownloadReference(req, ctx) {
        calls.push(["reference", req, ctx])
        if (referenceError !== null) throw referenceError
        return reference
      },
    }),
  )
  const fetchCalls = []
  const fetchImpl = async (url, options) => {
    fetchCalls.push({ url, options })
    return new Response(bytes, { status: 200 })
  }
  const client = new PersonalFileDownloadClient(storage, { tenantId: "tenant-1", subjectId: "subject-1", requestId: "request-1" }, transport, fetchImpl)
  assert.deepEqual(await client.download("asset-1", AbortSignal.timeout(5000)), { bytes, mimeType: "text/plain", filename: "fox.txt" })
  assert.deepEqual(
    calls.map(([name]) => name),
    ["asset", "reference"],
  )
  assert.equal(calls[0][1].assetId, "asset-1")
  assert.equal(calls[1][1].contentSha256, sha)
  assert.ok(calls[1][1].command?.commandId)
  assert.ok(calls[1][1].command?.requestDigest)
  for (const [, , ctx] of calls)
    for (const [key, value] of Object.entries({
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "storage-secret",
      "x-kokoro-tenant-id": "tenant-1",
      "x-kokoro-subject-id": "subject-1",
      "x-kokoro-scope-kind": "personal",
      "x-kokoro-scope-id": "subject-1",
      "x-kokoro-request-id": "request-1",
    }))
      assert.equal(ctx.requestHeader.get(key), value)
  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].options.redirect, "manual")
  assert.equal(fetchCalls[0].options.credentials, "omit")
  assert.equal(fetchCalls[0].options.headers?.authorization, undefined)
  assert.equal(fetchCalls[0].options.headers?.cookie, undefined)

  asset = { ...asset, uploadPurpose: UploadPurpose.CAPABILITY_PACKAGE }
  await assert.rejects(client.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 404)
  assert.equal(fetchCalls.length, 1)
  asset = { ...asset, uploadPurpose: UploadPurpose.ASSET, scanState: ScanState.PENDING }
  await assert.rejects(client.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 404)
  asset = { ...asset, scanState: ScanState.CLEAN }
  reference = { ...reference, sizeBytes: 6n }
  await assert.rejects(client.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 502)
  reference = { ...reference, sizeBytes: 5n, downloadReference: { ...reference.downloadReference, url: "http://evil.test/x" } }
  await assert.rejects(client.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 502)
  reference = { ...reference, downloadReference: { ...reference.downloadReference, url: "http://objects.test/x", expiresAt: { seconds: 1n } } }
  await assert.rejects(client.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 502)
  reference = { ...reference, downloadReference: { ...reference.downloadReference, expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) } } }
  const badBytesClient = new PersonalFileDownloadClient(
    storage,
    { tenantId: "tenant-1", subjectId: "subject-1", requestId: "request-2" },
    transport,
    async () => new Response("bad", { status: 200 }),
  )
  await assert.rejects(badBytesClient.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 502)
  const redirectClient = new PersonalFileDownloadClient(
    storage,
    { tenantId: "tenant-1", subjectId: "subject-1", requestId: "request-3" },
    transport,
    async () => new Response(null, { status: 302, headers: { location: "http://evil.test/" } }),
  )
  await assert.rejects(redirectClient.download("asset-1", AbortSignal.timeout(5000)), (error) => error.status === 502)
  referenceError = new ConnectError("object version or digest is unhealthy", Code.FailedPrecondition)
  const fetchesBefore = fetchCalls.length
  await assert.rejects(
    client.download("asset-1", AbortSignal.timeout(5000)),
    (error) => error.status === 502 && error.code === "storage_response_invalid" && !error.message.includes("object version"),
  )
  assert.equal(fetchCalls.length, fetchesBefore, "failed reference must not fetch or expose bytes")
})

test("download route emits only fully validated bytes with safe headers and JSON errors", async () => {
  const { personalFileDownloadRoute } = await import("../dist/http/routes/personal-file-download.js")
  const invoke = async (url, download = async () => ({ bytes, mimeType: "text/plain", filename: "x/é\r\n.txt" })) => {
    const request = new EventEmitter()
    request.url = url
    request.headers = {}
    const response = new EventEmitter()
    response.headers = {}
    response.setHeader = (key, value) => {
      response.headers[key.toLowerCase()] = value
    }
    response.writeHead = (status, headers) => {
      response.status = status
      response.headers = { ...response.headers, ...headers }
    }
    response.end = (body) => {
      response.body = body
      response.writableEnded = true
    }
    await personalFileDownloadRoute(request, response, { storage }, { requestId: "req-1", identity }, "asset-1", () => ({ download }))
    return response
  }
  const result = await invoke("/v1/library/files/asset-1/content")
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, bytes)
  assert.equal(result.headers["x-request-id"], "req-1")
  assert.equal(result.headers["cache-control"], "no-store")
  assert.equal(result.headers["referrer-policy"], "no-referrer")
  assert.equal(result.headers["x-content-type-options"], "nosniff")
  assert.equal(result.headers["content-length"], 5)
  assert.match(result.headers["content-disposition"], /^attachment; filename="[^"]+"; filename\*=UTF-8''/u)
  assert.doesNotMatch(result.headers["content-disposition"], /\r|\n|\//u)
  const special = await invoke("/v1/library/files/asset-1/content", async () => ({ bytes, mimeType: "text/plain", filename: "a'()*.txt" }))
  assert.match(special.headers["content-disposition"], /filename\*=UTF-8''a%27%28%29%2A\.txt$/u)
  const invalid = await invoke("/v1/library/files/asset-1/content?subject_id=evil")
  assert.equal(invalid.status, 400)
  assert.equal(JSON.parse(invalid.body).error.code, "invalid_library_file")
  assert.equal(invalid.headers["referrer-policy"], "no-referrer")
  assert.equal(invalid.headers["x-content-type-options"], "nosniff")
  const fault = await invoke("/v1/library/files/asset-1/content", async () => {
    throw new Error("signed-secret-url")
  })
  assert.equal(fault.status, 503)
  assert.equal(JSON.parse(fault.body).error.code, "storage_unavailable")
  assert.ok(!String(fault.body).includes("signed-secret-url"))
})

test("live Product HTTP re-admits every download and never returns another subject's bytes", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ConnectError, Code } = await import("@connectrpc/connect")
  const { StorageService, UploadPurpose, ScanState } = await import("../dist/generated/storage-connect/kokoro/storage/v2/storage_pb.js")
  const { createBffServer } = await import("../dist/bootstrap/server.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const servers = []
  const calls = []
  let admissions = 0
  let objectGets = 0
  const listen = async (server) => {
    servers.push(server)
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    return `http://127.0.0.1:${server.address().port}`
  }
  try {
    const objectOrigin = await listen(
      createServer((_request, response) => {
        objectGets++
        response.writeHead(200, { "content-type": "text/plain", "content-length": bytes.length })
        response.end(bytes)
      }),
    )
    const owner = await listen(
      createServer(
        connectNodeAdapter({
          routes(router) {
            router.service(StorageService, {
              getAsset(req, ctx) {
                const subject = ctx.requestHeader.get("x-kokoro-subject-id")
                calls.push(["asset", subject, ctx.requestHeader.get("x-kokoro-scope-id"), ctx.requestHeader.get("x-kokoro-scope-kind")])
                if (subject !== "subject-1" || req.assetId !== "asset-1") throw new ConnectError("private", Code.NotFound)
                return {
                  assetId: "asset-1",
                  filename: "fox.txt",
                  mimeType: "text/plain",
                  contentSha256: sha,
                  sizeBytes: 5n,
                  uploadPurpose: UploadPurpose.ASSET,
                  scanState: ScanState.CLEAN,
                }
              },
              getDownloadReference(req, ctx) {
                calls.push([
                  "reference",
                  ctx.requestHeader.get("x-kokoro-subject-id"),
                  ctx.requestHeader.get("x-kokoro-scope-id"),
                  ctx.requestHeader.get("x-kokoro-scope-kind"),
                ])
                assert.equal(req.contentSha256, sha)
                return {
                  assetId: "asset-1",
                  contentSha256: sha,
                  sizeBytes: 5n,
                  mimeType: "text/plain",
                  scanState: ScanState.CLEAN,
                  downloadReference: {
                    url: `${objectOrigin}/file?sig=private`,
                    method: "GET",
                    requiredHeaders: {},
                    expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60) },
                  },
                }
              },
            })
          },
        }),
      ),
    )
    const config = loadConfig({
      KOKORO_TENANT_ID: "tenant-1",
      KOKORO_BFF_SHARED_SECRET: "web-secret",
      KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/app?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
      KOKORO_STORAGE_RPC_BASE_URL: owner,
      KOKORO_BFF_STORAGE_SECRET: "storage-secret",
      KOKORO_STORAGE_OBJECT_ORIGIN: objectOrigin,
    })
    const bff = await listen(
      createBffServer(config, {
        readiness: async () => {},
        businessStore: null,
        sessionAdmission: {
          async verify({ token }) {
            admissions++
            return { ok: true, identity: { namespace: "tenant-1", userId: token === "other" ? "subject-2" : "subject-1" } }
          },
        },
      }),
    )
    const get = async (token = "user", path = "/v1/library/files/asset-1/content") =>
      fetch(`${bff}${path}`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "web-secret",
          "x-kokoro-request-id": "download-http",
          "x-kokoro-subject-id": "forged",
          "x-kokoro-scope-id": "forged",
        },
      })
    const own = await get()
    assert.equal(own.status, 200)
    assert.deepEqual(Buffer.from(await own.arrayBuffer()), bytes)
    assert.equal(own.headers.get("x-request-id"), "download-http")
    assert.equal(own.headers.get("cache-control"), "no-store")
    const other = await get("other")
    assert.equal(other.status, 404)
    assert.equal((await other.json()).error.code, "library_file_not_found")
    const invalid = await get("user", "/v1/library/files/asset-1/content?subject_id=other")
    assert.equal(invalid.status, 400)
    assert.equal((await invalid.json()).error.code, "invalid_library_file")
    assert.equal(admissions, 3)
    assert.equal(objectGets, 1)
    assert.deepEqual(calls, [
      ["asset", "subject-1", "subject-1", "personal"],
      ["reference", "subject-1", "subject-1", "personal"],
      ["asset", "subject-2", "subject-2", "personal"],
    ])
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  }
})

test("bounded GET transfer rejects unsafe references, oversized bytes and cancellation before public success", async () => {
  const { readPersonalFileBytes } = await import("../dist/infrastructure/clients/storage/personal-file-download-transfer.js")
  const valid = { url: "http://objects.test/file?sig=private", method: "GET", requiredHeaders: {}, expiresAt: Date.now() + 60_000 }
  const signal = AbortSignal.timeout(5000)
  const neverFetch = async () => {
    throw new Error("must not fetch")
  }
  for (const reference of [
    { ...valid, method: "PUT" },
    { ...valid, requiredHeaders: { authorization: "Bearer secret" } },
    { ...valid, url: "http://objects.test@evil.test/file" },
    { ...valid, url: "http://objects.test/file#fragment" },
    { ...valid, expiresAt: Date.now() - 1 },
  ])
    await assert.rejects(readPersonalFileBytes(reference, 5, sha, storage.objectOrigin, signal, neverFetch), (error) => error.status === 502)

  await assert.rejects(
    readPersonalFileBytes(valid, 5, sha, storage.objectOrigin, signal, async () => new Response("hello!", { status: 200 })),
    (error) => error.status === 502,
  )
  await assert.rejects(
    readPersonalFileBytes(valid, 5, sha, storage.objectOrigin, signal, async () => new Response("other", { status: 200 })),
    (error) => error.status === 502,
  )
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(
    readPersonalFileBytes(valid, 5, sha, storage.objectOrigin, cancelled.signal, async (_url, options) => {
      assert.equal(options.signal.aborted, true)
      throw new DOMException("cancelled", "AbortError")
    }),
    (error) => error.status === 503,
  )
})

test("Artifact transfer spools and verifies complete original bytes before release, cleaning bad bytes and cancellation", async () => {
  const { spoolVerifiedArtifact } = await import("../dist/infrastructure/clients/storage/artifact-download-transfer.js")
  const root = await mkdtemp(join(tmpdir(), "bff-artifact-transfer-test-"))
  const reference = { url: "http://objects.test/original?sig=secret", method: "GET", requiredHeaders: {}, expiresAt: Date.now() + 60_000 }
  try {
    const fetches = []
    const fetcher = async (url, options) => {
      fetches.push({ url, options })
      return new Response(bytes, { status: 200, headers: { "content-length": "5" } })
    }
    const spool = await spoolVerifiedArtifact(reference, 5, sha, "http://objects.test", AbortSignal.timeout(5000), fetcher, root)
    assert.deepEqual(await readFile(spool.path), bytes)
    assert.equal(spool.size, 5)
    assert.equal(fetches[0].options.redirect, "manual")
    assert.equal(fetches[0].options.credentials, "omit")
    assert.equal(fetches[0].options.headers, undefined)
    await spool.cleanup()
    assert.deepEqual(await readdir(root), [])
    await assert.rejects(
      spoolVerifiedArtifact(reference, 5, sha, "http://objects.test", AbortSignal.timeout(5000), async () => new Response("bad!!", { status: 200 }), root),
      (error) => error.status === 502,
    )
    assert.deepEqual(await readdir(root), [])
    await assert.rejects(
      spoolVerifiedArtifact(reference, 5, sha, "http://objects.test", AbortSignal.timeout(5000), async () => new Response("too long", { status: 200 }), root),
      (error) => error.status === 502,
    )
    assert.deepEqual(await readdir(root), [])
    await assert.rejects(
      spoolVerifiedArtifact({ ...reference, url: "http://evil.test/x" }, 5, sha, "http://objects.test", AbortSignal.timeout(5000), fetcher, root),
      (error) => error.status === 502,
    )
    assert.equal(fetches.length, 1)
    await assert.rejects(
      spoolVerifiedArtifact(reference, 1_073_741_825, sha, "http://objects.test", AbortSignal.timeout(5000), fetcher, root),
      (error) => error.status === 502,
    )
    assert.equal(fetches.length, 1)
    const abort = new AbortController()
    abort.abort()
    await assert.rejects(
      spoolVerifiedArtifact(reference, 5, sha, "http://objects.test", abort.signal, async () => new Response(bytes, { status: 200 }), root),
      (error) => error.status === 503,
    )
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("Artifact spool admits at most two concurrent requests and releases slots on failed bytes, cleanup and abort", async () => {
  const { spoolVerifiedArtifact } = await import("../dist/infrastructure/clients/storage/artifact-download-transfer.js")
  const root = await mkdtemp(join(tmpdir(), "bff-artifact-admission-test-"))
  const reference = { url: "http://objects.test/original?sig=secret", method: "GET", requiredHeaders: {}, expiresAt: Date.now() + 60_000 }
  const fetchGood = async () => new Response(bytes, { status: 200 })
  const gates = []
  const heldFetch = async () => new Promise((resolve) => gates.push(resolve))
  const first = spoolVerifiedArtifact(reference, 5, sha, "http://objects.test", AbortSignal.timeout(5000), heldFetch, root)
  const second = spoolVerifiedArtifact(reference, 5, sha, "http://objects.test", AbortSignal.timeout(5000), heldFetch, root)
  const firstOutcome = first.then(
    (value) => ({ value }),
    (error) => ({ error }),
  )
  const secondOutcome = second.then(
    (value) => ({ value }),
    (error) => ({ error }),
  )
  let secondSpool = null
  let fourthSpool = null
  try {
    assert.equal(gates.length, 2)
    const third = await spoolVerifiedArtifact(reference, 5, sha, "http://objects.test", AbortSignal.timeout(5000), fetchGood, root).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await third.value?.cleanup()
    gates[0](new Response("bad!!", { status: 200 }))
    gates[1](new Response(bytes, { status: 200 }))
    const firstResult = await firstOutcome
    const secondResult = await secondOutcome
    secondSpool = secondResult.value ?? null
    assert.equal(firstResult.error?.status, 502)
    assert.equal(third.error?.status, 503)
    assert.equal(third.error?.code, "artifact_download_busy")
    assert.ok(secondSpool)
    fourthSpool = await spoolVerifiedArtifact(reference, 5, sha, "http://objects.test", AbortSignal.timeout(5000), fetchGood, root)
    await assert.rejects(
      spoolVerifiedArtifact(reference, 5, sha, "http://objects.test", AbortSignal.timeout(5000), fetchGood, root),
      (error) => error.status === 503 && error.code === "artifact_download_busy",
    )
    await fourthSpool.cleanup()
    fourthSpool = null
    await secondSpool.cleanup()
    secondSpool = null
    const abort = new AbortController()
    const aborted = spoolVerifiedArtifact(
      reference,
      5,
      sha,
      "http://objects.test",
      abort.signal,
      async (_url, options) =>
        new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })),
      root,
    )
    abort.abort()
    await assert.rejects(aborted, (error) => error.status === 503)
    const afterAbort = await spoolVerifiedArtifact(reference, 5, sha, "http://objects.test", AbortSignal.timeout(5000), fetchGood, root)
    await afterAbort.cleanup()
    assert.deepEqual(await readdir(root), [])
  } finally {
    for (const release of gates) release(new Response(bytes, { status: 200 }))
    const settled = await Promise.all([firstOutcome, secondOutcome])
    await Promise.all(settled.map((outcome) => outcome.value?.cleanup()))
    await fourthSpool?.cleanup()
    await secondSpool?.cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test("Artifact spool has independent total and persisted-byte idle budgets, then releases its slot", async () => {
  const { spoolVerifiedArtifact } = await import("../dist/infrastructure/clients/storage/artifact-download-transfer.js")
  const root = await mkdtemp(join(tmpdir(), "bff-artifact-deadline-test-"))
  const reference = { url: "http://objects.test/original?sig=secret", method: "GET", requiredHeaders: {}, expiresAt: Date.now() + 60_000 }
  const stalled = () => new Response(new ReadableStream({ start() {} }), { status: 200 })
  try {
    const idleClock = controllableClock()
    const idleAttempt = spoolVerifiedArtifact(reference, 5, sha, storage.objectOrigin, new AbortController().signal, async () => stalled(), root, {
      totalMs: 7 * 60_000,
      idleMs: 45_000,
      clock: idleClock,
    })
    idleClock.advance(45_000)
    await assert.rejects(idleAttempt, (error) => error.status === 503 && error.code === "storage_unavailable")
    assert.deepEqual(await readdir(root), [])
    const totalClock = controllableClock()
    const totalAttempt = spoolVerifiedArtifact(reference, 5, sha, storage.objectOrigin, new AbortController().signal, async () => stalled(), root, {
      totalMs: 7 * 60_000,
      idleMs: 8 * 60_000,
      clock: totalClock,
    })
    totalClock.advance(7 * 60_000)
    await assert.rejects(totalAttempt, (error) => error.status === 503 && error.code === "storage_unavailable")
    assert.deepEqual(await readdir(root), [])
    const progressClock = controllableClock()
    let controller
    const progressStream = new ReadableStream({
      start(value) {
        controller = value
      },
    })
    const tenBytes = Buffer.concat([bytes, bytes])
    const tenSha = createHash("sha256").update(tenBytes).digest("hex")
    const progressAttempt = spoolVerifiedArtifact(
      reference,
      10,
      tenSha,
      storage.objectOrigin,
      new AbortController().signal,
      async () => new Response(progressStream, { status: 200 }),
      root,
      { totalMs: 7 * 60_000, idleMs: 45_000, clock: progressClock },
    )
    progressClock.advance(40_000)
    controller.enqueue(bytes)
    for (let attempt = 0; attempt < 100 && progressClock.scheduledCount(45_000) < 2; attempt++) await new Promise((resolve) => setImmediate(resolve))
    assert.equal(progressClock.scheduledCount(45_000), 2, "idle resets only after the first chunk is persisted")
    progressClock.advance(40_000)
    controller.enqueue(bytes)
    controller.close()
    const progressed = await progressAttempt
    await progressed.cleanup()
    assert.deepEqual(await readdir(root), [])
    const success = await spoolVerifiedArtifact(
      reference,
      5,
      sha,
      storage.objectOrigin,
      new AbortController().signal,
      async () => new Response(bytes, { status: 200 }),
      root,
    )
    await success.cleanup()
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("Artifact spool releases a slot even when rejecting an object whose body cancel never settles", async () => {
  const { spoolVerifiedArtifact } = await import("../dist/infrastructure/clients/storage/artifact-download-transfer.js")
  const root = await mkdtemp(join(tmpdir(), "bff-artifact-stuck-cancel-test-"))
  const reference = { url: "http://objects.test/original?sig=secret", method: "GET", requiredHeaders: {}, expiresAt: Date.now() + 60_000 }
  const neverCancels = () => new ReadableStream({ cancel: () => new Promise(() => {}) })
  const settleWithin = async (promise) => {
    let timer
    try {
      return await Promise.race([
        promise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve("timed-out"), 1_000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    for (const fetcher of [
      async () => new Response(neverCancels(), { status: 404 }),
      async () => new Response(neverCancels(), { status: 200, headers: { "content-length": "6" } }),
    ]) {
      const result = await settleWithin(
        spoolVerifiedArtifact(reference, 5, sha, storage.objectOrigin, new AbortController().signal, fetcher, root).then(
          () => ({ status: "unexpected-success" }),
          (error) => ({ status: error.status, code: error.code }),
        ),
      )
      assert.deepEqual(result, { status: 502, code: "storage_response_invalid" })
      assert.deepEqual(await readdir(root), [])
    }
    const success = await settleWithin(
      spoolVerifiedArtifact(reference, 5, sha, storage.objectOrigin, new AbortController().signal, async () => new Response(bytes, { status: 200 }), root),
    )
    assert.notEqual(success, "timed-out")
    await success.cleanup()
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("Artifact route preserves its 120-second admission budget and a pre-header JSON error", async () => {
  const { createServer } = await import("node:http")
  const { once } = await import("node:events")
  const { libraryArtifactDownloadRoute } = await import("../dist/http/routes/library-artifact-download.js")
  const clock = controllableClock()
  let admissionStarted
  const started = new Promise((resolve) => {
    admissionStarted = resolve
  })
  const repository = { findCandidate: async () => ({}) }
  const clientFactory = () => ({
    get: (_association, signal) => {
      admissionStarted()
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }))
    },
    downloadReference: async () => {
      throw new Error("unreachable")
    },
  })
  const server = createServer((request, response) => {
    void libraryArtifactDownloadRoute(
      request,
      response,
      { storage },
      { requestId: "req-admission", identity },
      repository,
      "conversation-1",
      "artifact-1",
      clientFactory,
      async () => {
        throw new Error("spool must not start")
      },
      { admissionMs: 120_000, outboundTotalMs: 28 * 60_000, outboundIdleMs: 25_000, clock },
    )
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const responsePromise = fetch(`http://127.0.0.1:${server.address().port}/v1/library/artifacts/conversation-1/artifact-1/content`)
    await started
    clock.advance(120_000)
    const response = await responsePromise
    assert.equal(response.status, 503)
    assert.equal(response.headers.get("x-request-id"), "req-admission")
    assert.equal((await response.json()).error.code, "storage_unavailable")
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test("Artifact admission timeout wins over a late missing association", async () => {
  const { createServer } = await import("node:http")
  const { once } = await import("node:events")
  const { libraryArtifactDownloadRoute } = await import("../dist/http/routes/library-artifact-download.js")
  const clock = controllableClock()
  let queryStarted
  let returnMissing
  const started = new Promise((resolve) => {
    queryStarted = resolve
  })
  const pendingQuery = new Promise((resolve) => {
    returnMissing = resolve
  })
  const repository = {
    findCandidate: () => {
      queryStarted()
      return pendingQuery
    },
  }
  const server = createServer((request, response) => {
    void libraryArtifactDownloadRoute(
      request,
      response,
      { storage },
      { requestId: "req-late-404", identity },
      repository,
      "conversation-1",
      "artifact-1",
      () => {
        throw new Error("Storage must not run")
      },
      async () => {
        throw new Error("spool must not run")
      },
      { admissionMs: 120_000, outboundTotalMs: 28 * 60_000, outboundIdleMs: 25_000, clock },
    )
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const responsePromise = fetch(`http://127.0.0.1:${server.address().port}/v1/library/artifacts/conversation-1/artifact-1/content`)
    await started
    clock.advance(120_000)
    returnMissing(null)
    const response = await responsePromise
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, "storage_unavailable")
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test("Artifact route streams verified bytes after the admission clock ends and cleans the spool once", async () => {
  const { createServer } = await import("node:http")
  const { once } = await import("node:events")
  const { libraryArtifactDownloadRoute } = await import("../dist/http/routes/library-artifact-download.js")
  const root = await mkdtemp(join(tmpdir(), "bff-artifact-success-test-"))
  const path = join(root, "content")
  await writeFile(path, bytes)
  const clock = controllableClock()
  let cleanups = 0
  const item = {
    kind: "artifact",
    conversation_id: "conversation-1",
    artifact_id: "artifact-1",
    asset_id: "asset-1",
    artifact_kind: "code",
    title: "test",
    filename: "test.txt",
    mime_type: "text/plain",
    size_bytes: "5",
    content_sha256: sha,
    source_run_id: "run-1",
    delivered_at: "2026-09-28T00:00:00Z",
  }
  const server = createServer((request, response) => {
    void libraryArtifactDownloadRoute(
      request,
      response,
      { storage },
      { requestId: "req-success", identity },
      { findCandidate: async () => ({}) },
      "conversation-1",
      "artifact-1",
      () => ({ get: async () => item, downloadReference: async () => ({}) }),
      async () => {
        clock.advance(120_000)
        return {
          path,
          size: 5,
          cleanup: async () => {
            cleanups++
          },
        }
      },
      { admissionMs: 120_000, outboundTotalMs: 28 * 60_000, outboundIdleMs: 25_000, clock },
    )
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/library/artifacts/conversation-1/artifact-1/content`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-disposition"), "attachment; filename=\"test.txt\"; filename*=UTF-8''test.txt")
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "hello")
    for (let attempt = 0; attempt < 100 && cleanups === 0; attempt++) await new Promise((resolve) => setImmediate(resolve))
    assert.equal(cleanups, 1)
  } finally {
    server.closeAllConnections()
    server.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("Artifact outbound total and idle clocks count completed writes, not queued file reads", async () => {
  const { libraryArtifactDownloadRoute } = await import("../dist/http/routes/library-artifact-download.js")
  const root = await mkdtemp(join(tmpdir(), "bff-artifact-outbound-clock-test-"))
  const path = join(root, "content")
  await writeFile(path, Buffer.alloc(128 * 1024))
  const item = {
    kind: "artifact",
    conversation_id: "conversation-1",
    artifact_id: "artifact-1",
    asset_id: "asset-1",
    artifact_kind: "code",
    title: "test",
    filename: "test.bin",
    mime_type: "application/octet-stream",
    size_bytes: String(128 * 1024),
    content_sha256: sha,
    source_run_id: "run-1",
    delivered_at: "2026-09-28T00:00:00Z",
  }
  const run = async (idleMs, totalMs, advanceMs, finishWrite) => {
    const clock = controllableClock()
    const request = new EventEmitter()
    request.url = "/v1/library/artifacts/conversation-1/artifact-1/content"
    request.headers = {}
    const response = new EventEmitter()
    response.headersSent = false
    response.destroyed = false
    response.writableFinished = false
    response.setHeader = () => {}
    response.writeHead = () => {
      response.headersSent = true
    }
    response.destroy = () => {
      response.destroyed = true
      response.emit("close")
    }
    response.end = (callback) => {
      response.writableFinished = true
      callback?.()
    }
    const writes = []
    let firstWrite
    const first = new Promise((resolve) => {
      firstWrite = resolve
    })
    response.write = (_chunk, callback) => {
      writes.push(callback)
      firstWrite()
      return false
    }
    let cleanups = 0
    const route = libraryArtifactDownloadRoute(
      request,
      response,
      { storage },
      { requestId: "req-clock", identity },
      { findCandidate: async () => ({}) },
      "conversation-1",
      "artifact-1",
      () => ({ get: async () => item, downloadReference: async () => ({}) }),
      async () => ({
        path,
        size: 128 * 1024,
        cleanup: async () => {
          cleanups++
        },
      }),
      { admissionMs: 120_000, outboundTotalMs: totalMs, outboundIdleMs: idleMs, clock },
    )
    await first
    if (finishWrite) {
      writes.shift()()
      for (let attempt = 0; attempt < 100 && writes.length === 0; attempt++) await new Promise((resolve) => setImmediate(resolve))
      assert.equal(writes.length, 1)
    }
    clock.advance(advanceMs)
    if (finishWrite) writes.shift()()
    let timer
    const outcome = await Promise.race([
      route.then(() => "settled"),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("timed-out"), 1_000)
      }),
    ])
    clearTimeout(timer)
    return { outcome, response, cleanups }
  }
  try {
    const progressed = await run(25_000, 28 * 60_000, 20_000, true)
    assert.equal(progressed.outcome, "settled")
    assert.equal(progressed.response.destroyed, false)
    assert.equal(progressed.response.writableFinished, true)
    assert.equal(progressed.cleanups, 1)
    const idle = await run(25_000, 28 * 60_000, 25_000, false)
    assert.equal(idle.outcome, "settled")
    assert.equal(idle.response.destroyed, true)
    assert.equal(idle.response.writableFinished, false)
    assert.equal(idle.cleanups, 1)
    const total = await run(29 * 60_000, 28 * 60_000, 28 * 60_000, false)
    assert.equal(total.outcome, "settled")
    assert.equal(total.response.destroyed, true)
    assert.equal(total.cleanups, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("Artifact route ends a stalled consumer socket after headers without reporting success", async () => {
  const { createServer, request: httpRequest } = await import("node:http")
  const { once } = await import("node:events")
  const { libraryArtifactDownloadRoute } = await import("../dist/http/routes/library-artifact-download.js")
  const root = await mkdtemp(join(tmpdir(), "bff-artifact-socket-test-"))
  const path = join(root, "content")
  await writeFile(path, "")
  await truncate(path, 64 * 1024 * 1024)
  let cleanups = 0
  const item = {
    kind: "artifact",
    conversation_id: "conversation-1",
    artifact_id: "artifact-1",
    asset_id: "asset-1",
    artifact_kind: "code",
    title: "test",
    filename: "test.bin",
    mime_type: "application/octet-stream",
    size_bytes: String(64 * 1024 * 1024),
    content_sha256: sha,
    source_run_id: "run-1",
    delivered_at: "2026-09-28T00:00:00Z",
  }
  const repository = { findCandidate: async () => ({}) }
  const clientFactory = () => ({ get: async () => item, downloadReference: async () => ({}) })
  const spooler = async () => ({
    path,
    size: 64 * 1024 * 1024,
    cleanup: async () => {
      cleanups++
    },
  })
  const context = { requestId: "req-artifact", identity }
  const server = createServer((request, response) => {
    void libraryArtifactDownloadRoute(request, response, { storage }, context, repository, "conversation-1", "artifact-1", clientFactory, spooler, {
      admissionMs: 120_000,
      outboundTotalMs: 5_000,
      outboundIdleMs: 500,
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const port = server.address().port
  const openDownload = () =>
    new Promise((resolve, reject) => {
      const request = httpRequest({ host: "127.0.0.1", port, path: "/v1/library/artifacts/conversation-1/artifact-1/content" }, resolve)
      request.once("error", reject)
      request.end()
    })
  const waitForClose = (response) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 3_000)
      const close = () => {
        clearTimeout(timer)
        resolve(true)
      }
      response.once("close", close)
      response.once("error", close)
    })
  try {
    const response = await openDownload()
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers["content-length"], String(64 * 1024 * 1024))
    response.pause()
    const cleanupDeadline = Date.now() + 4_000
    while (cleanups === 0 && Date.now() < cleanupDeadline) await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(cleanups, 1)
    const closedPromise = waitForClose(response)
    response.resume()
    const closed = await closedPromise
    response.destroy()
    assert.equal(closed, true)
    assert.equal(response.complete, false)
    assert.equal(cleanups, 1)
  } finally {
    server.closeAllConnections()
    server.close()
    await rm(root, { recursive: true, force: true })
  }
})
