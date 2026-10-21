import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createServer, request as httpRequest } from "node:http"
import { test } from "node:test"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import { ConnectError, Code } from "@connectrpc/connect"
import { createBffServer } from "../src/bootstrap/server.ts"
import { loadConfig } from "../src/config/runtime.ts"
import { StorageService, UploadPurpose, ScanState } from "../src/generated/storage-connect/kokoro/storage/v3/storage_pb.ts"

const PROJECT = "project_35ce205c-26e7-4532-b94f-de2d0a2c113d"
const BYTES = Buffer.from("project resource\n")
const SHA = createHash("sha256").update(BYTES).digest("hex")
const PATH = `/v1/projects/${PROJECT}/resources/asset-1/content`

// Only controlled peers are created. No configured normal service or database is contacted.
async function fixture() {
  const servers = []
  const facts = { admissions: [], projects: [], legacyFind: 0, rpc: [], objects: [] }
  const state = {
    allowed: true,
    revokeOnObject: false,
    purpose: UploadPurpose.ASSET,
    scan: ScanState.CLEAN,
    assetId: "asset-1",
    referenceAssetId: "asset-1",
    size: BigInt(BYTES.length),
    referenceSize: BigInt(BYTES.length),
    referenceSha: SHA,
    objectBytes: BYTES,
    objectStatus: 200,
    referenceOrigin: null,
    referenceHeaders: {},
    rpcError: null,
    holdEof: false,
    admissionWait: null,
    projectWait: null,
    projectWaitAt: 1,
    rpcWait: null,
    referenceWait: null,
    objectWait: null,
    admissionResult: null,
  }
  const heldResponses = new Set()
  const listen = async (server) => {
    servers.push(server)
    await new Promise((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    return `http://127.0.0.1:${server.address().port}`
  }
  const objectOrigin = await listen(
    createServer(async (request, response) => {
      facts.objects.push({ path: request.url, headers: request.headers })
      if (state.objectWait !== null) await state.objectWait
      if (state.revokeOnObject) state.allowed = false
      response.writeHead(state.objectStatus, {
        "content-type": "text/plain",
        ...(state.holdEof ? {} : { "content-length": state.objectBytes.length }),
        ...(state.objectStatus === 302 ? { location: "http://untrusted.invalid/should-not-fetch" } : {}),
      })
      if (state.holdEof) {
        response.write(state.objectBytes)
        heldResponses.add(response)
      } else response.end(state.objectBytes)
    }),
  )
  const recordRpc = (method, request, context) => {
    facts.rpc.push({ method, request, headers: Object.fromEntries(context.requestHeader.entries()) })
    if (state.rpcError !== null) throw state.rpcError
  }
  const owner = await listen(
    createServer(
      connectNodeAdapter({
        routes(router) {
          router.service(StorageService, {
            async getAsset(request, context) {
              recordRpc("asset", request, context)
              if (state.rpcWait !== null) await state.rpcWait
              return {
                assetId: state.assetId,
                filename: "项目.txt",
                mimeType: "text/plain",
                contentSha256: SHA,
                sizeBytes: state.size,
                uploadPurpose: state.purpose,
                scanState: state.scan,
              }
            },
            async getDownloadReference(request, context) {
              recordRpc("reference", request, context)
              if (state.referenceWait !== null) await state.referenceWait
              return {
                assetId: state.referenceAssetId,
                contentSha256: state.referenceSha,
                sizeBytes: state.referenceSize,
                mimeType: "text/plain",
                scanState: state.scan,
                downloadReference: {
                  url: `${state.referenceOrigin ?? objectOrigin}/object?sig=controlled-peer`,
                  method: "GET",
                  requiredHeaders: state.referenceHeaders,
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
    KOKORO_BFF_SHARED_SECRET: "web-test-secret",
    KOKORO_BFF_POSTGRES_URL: "postgresql://127.0.0.1:1/unreachable?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
    KOKORO_STORAGE_RPC_BASE_URL: owner,
    KOKORO_BFF_STORAGE_SECRET: "storage-test-secret",
    KOKORO_STORAGE_OBJECT_ORIGIN: objectOrigin,
  })
  const bff = await listen(
    createBffServer(config, {
      readiness: async () => {},
      businessStore: {
        services: {
          projects: {
            async find() {
              facts.legacyFind++
              throw Error("resource download must not use the unbounded legacy Project read")
            },
            async findActiveResourceProjectId(scope, ref, signal, deadlineAt) {
              facts.projects.push({ scope, ref, signal, deadlineAt })
              assert.ok(signal instanceof AbortSignal, "required Project cancellation")
              assert.ok(Number.isFinite(deadlineAt) && deadlineAt > performance.now(), "required live absolute Project deadline")
              if (state.projectWait !== null && facts.projects.length === state.projectWaitAt) await state.projectWait
              return state.allowed && scope.tenantId === "tenant-1" && scope.subjectId === "subject-1" && [PROJECT, "project-slug"].includes(ref)
                ? PROJECT
                : null
            },
          },
        },
      },
      sessionAdmission: {
        async verify({ token, signal }) {
          facts.admissions.push({ token, signal })
          if (state.admissionWait !== null) await state.admissionWait
          if (state.admissionResult !== null) return state.admissionResult
          return { ok: true, identity: { namespace: "tenant-1", userId: token === "other" ? "subject-2" : "subject-1" } }
        },
      },
    }),
  )
  return {
    facts,
    state,
    releaseEof() {
      for (const response of heldResponses) response.end()
      heldResponses.clear()
    },
    get(path = PATH, token = "user", headers = {}, signal = AbortSignal.timeout(5000)) {
      return fetch(`${bff}${path}`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "web-test-secret",
          "x-kokoro-request-id": "project-download-http",
          "x-kokoro-tenant-id": "forged-tenant",
          "x-kokoro-subject-id": "forged-subject",
          "x-kokoro-scope-kind": "personal",
          "x-kokoro-scope-id": "forged-project",
          ...headers,
        },
        signal,
      })
    },
    getWithBody(headers, body, requestTarget = PATH) {
      return new Promise((resolve, reject) => {
        const request = httpRequest(
          `${bff}${PATH}`,
          {
            method: "GET",
            path: requestTarget === "absolute-form" ? `${bff}${PATH}` : requestTarget,
            headers: {
              authorization: "Bearer user",
              "x-kokoro-service": "web-bff",
              "x-kokoro-internal-secret": "web-test-secret",
              "x-kokoro-request-id": "project-download-http",
              ...headers,
            },
          },
          (response) => {
            const chunks = []
            response.on("data", (chunk) => chunks.push(chunk))
            response.once("error", reject)
            response.once("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })))
          },
        )
        request.once("error", reject)
        request.setTimeout(5000, () => request.destroy(Error("controlled request did not finish")))
        request.end(body)
      })
    },
    async close() {
      await Promise.all(
        servers.reverse().map(
          (server) =>
            new Promise((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()))
              server.closeAllConnections()
            }),
        ),
      )
    },
  }
}

async function withFixture(run) {
  const current = await fixture()
  try {
    await run(current)
  } finally {
    await current.close()
  }
}

async function errorResponse(response, status) {
  assert.equal(response.status, status)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const body = await response.json()
  assert.ok(typeof body.error?.code === "string" && body.error.code.length > 0)
  assert.ok(typeof body.error?.message === "string")
  assert.equal(body.meta?.request_id, "project-download-http")
  assert.equal(body.data, undefined)
  const serialized = JSON.stringify(body)
  for (const secret of ["controlled-peer", "storage-test-secret", "web-test-secret", "private dependency details"])
    assert.ok(!serialized.includes(secret), secret)
}

test("HTTP project download returns complete bytes after current canonical owner checks and private headers", async () => {
  await withFixture(async ({ get, facts }) => {
    const response = await get()
    assert.equal(response.status, 200, "current server must implement the published project resource download entry")
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), BYTES)
    assert.equal(response.headers.get("content-type"), "text/plain")
    assert.equal(response.headers.get("content-length"), String(BYTES.length))
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("referrer-policy"), "no-referrer")
    assert.equal(response.headers.get("x-content-type-options"), "nosniff")
    assert.equal(response.headers.get("x-request-id"), "project-download-http")
    assert.match(response.headers.get("content-disposition"), /^attachment; filename=/u)
    assert.match(response.headers.get("content-disposition"), /filename\*=UTF-8''%E9%A1%B9%E7%9B%AE\.txt$/u)
    assert.equal(facts.admissions.length, 1)
    assert.equal(facts.projects.length, 2)
    assert.equal(facts.legacyFind, 0)
    assert.deepEqual(
      facts.projects.map((call) => call.ref),
      [PROJECT, PROJECT],
    )
    assert.deepEqual(
      facts.projects.map((call) => call.scope),
      Array(2).fill({ tenantId: "tenant-1", subjectId: "subject-1" }),
    )
    assert.equal(facts.projects[0].deadlineAt, facts.projects[1].deadlineAt, "one absolute deadline across both reads")
    assert.deepEqual(
      facts.rpc.map((call) => call.method),
      ["asset", "reference"],
    )
    for (const { headers } of facts.rpc) {
      for (const [name, value] of Object.entries({
        "x-kokoro-tenant-id": "tenant-1",
        "x-kokoro-subject-id": "subject-1",
        "x-kokoro-scope-kind": "project",
        "x-kokoro-scope-id": PROJECT,
        "x-kokoro-request-id": "project-download-http",
        "x-kokoro-service": "web-bff",
      }))
        assert.equal(headers[name], value, name)
      assert.equal(headers.authorization, undefined)
    }
    assert.equal(facts.objects.length, 1)
    for (const name of ["authorization", "cookie", "x-kokoro-internal-secret", "x-kokoro-subject-id"])
      assert.equal(facts.objects[0].headers[name], undefined, name)
  })
})

test("HTTP project download resolves a slug once and only uses the canonical project for Storage and final recheck", async () => {
  await withFixture(async ({ get, facts }) => {
    const response = await get(PATH.replace(PROJECT, "project-slug"))
    assert.equal(response.status, 200)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), BYTES)
    assert.deepEqual(
      facts.projects.map((call) => call.ref),
      ["project-slug", PROJECT],
    )
    assert.ok(facts.rpc.every((call) => call.headers["x-kokoro-scope-id"] === PROJECT))
  })
})

test("HTTP project download denies another subject or deleted project before any Storage read", async () => {
  await withFixture(async ({ get, facts, state }) => {
    await errorResponse(await get(PATH, "other"), 404)
    state.allowed = false
    await errorResponse(await get(), 404)
    assert.equal(facts.projects.length, 2)
    assert.equal(facts.rpc.length, 0)
    assert.equal(facts.objects.length, 0)
  })
})

test("HTTP project download rechecks the active owner after object verification and withholds bytes after revocation", async () => {
  await withFixture(async ({ get, facts, state }) => {
    state.revokeOnObject = true
    await errorResponse(await get(), 404)
    assert.equal(facts.projects.length, 2)
    assert.deepEqual(
      facts.rpc.map((call) => call.method),
      ["asset", "reference"],
    )
    assert.equal(facts.objects.length, 1)
  })
})

test("HTTP project download rejects query and malformed asset selectors without owner IO", async () => {
  await withFixture(async ({ get, facts }) => {
    for (const path of [`${PATH}?scope_id=forged`, PATH.replace("asset-1", "bad%2Fasset"), PATH.replace("asset-1", "a".repeat(192))])
      await errorResponse(await get(path), 400)
    assert.equal(facts.rpc.length, 0)
    assert.equal(facts.objects.length, 0)
  })
})

test("HTTP project download checks ASSET and CLEAN before requesting a reference", async () => {
  await withFixture(async ({ get, facts, state }) => {
    state.purpose = UploadPurpose.CAPABILITY_PACKAGE
    await errorResponse(await get(), 404)
    state.purpose = UploadPurpose.ASSET
    state.scan = ScanState.PENDING
    await errorResponse(await get(), 404)
    assert.deepEqual(
      facts.rpc.map((call) => call.method),
      ["asset", "asset"],
    )
    assert.equal(facts.objects.length, 0)
  })
})

test("HTTP project download rejects nonempty GET bodies and Transfer-Encoding before Storage IO", async () => {
  await withFixture(async ({ getWithBody, facts }) => {
    await errorResponse(await getWithBody({ "content-length": "1" }, "x"), 400)
    await errorResponse(await getWithBody({ "transfer-encoding": "chunked" }, "x"), 400)
    assert.equal(facts.rpc.length, 0)
    assert.equal(facts.objects.length, 0)
  })
})

test("HTTP project download rejects mismatched IDs, oversized metadata and inconsistent references before object fetch", async () => {
  await withFixture(async ({ get, facts, state }) => {
    state.assetId = "other-asset"
    await errorResponse(await get(), 404)
    state.assetId = "asset-1"
    state.size = 1048577n
    await errorResponse(await get(), 502)
    state.size = BigInt(BYTES.length)
    state.referenceSize = state.size + 1n
    await errorResponse(await get(), 502)
    state.referenceSize = state.size
    state.referenceSha = "a".repeat(64)
    await errorResponse(await get(), 502)
    assert.equal(facts.objects.length, 0)
  })
})

test("HTTP project download refuses foreign origins, extra reference headers and redirects", async () => {
  await withFixture(async ({ get, facts, state }) => {
    state.referenceOrigin = "http://untrusted.invalid"
    await errorResponse(await get(), 502)
    state.referenceOrigin = null
    state.referenceHeaders = { authorization: "must-not-forward" }
    await errorResponse(await get(), 502)
    assert.equal(facts.objects.length, 0)
    state.referenceHeaders = {}
    state.objectStatus = 302
    await errorResponse(await get(), 502)
    assert.equal(facts.objects.length, 1, "redirect target is never fetched")
  })
})

test("HTTP project download never sends partial success for wrong length or SHA-256", async () => {
  await withFixture(async ({ get, state }) => {
    state.objectBytes = Buffer.from("short")
    await errorResponse(await get(), 502)
    state.objectBytes = Buffer.alloc(BYTES.length, 120)
    await errorResponse(await get(), 502)
  })
})

test("HTTP project download waits for real EOF even after all expected bytes have arrived", async () => {
  await withFixture(async ({ get, state, releaseEof, facts }) => {
    state.holdEof = true
    const pending = get()
    let timer
    try {
      const observed = await Promise.race([
        pending.then(() => "early-headers"),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve("still-waiting"), 100)
        }),
      ])
      assert.equal(observed, "still-waiting", "no success headers before the owner object's real EOF")
      assert.equal(facts.objects.length, 1)
      releaseEof()
      const response = await pending
      assert.equal(response.status, 200)
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), BYTES)
      assert.equal(facts.projects.length, 2)
    } finally {
      clearTimeout(timer)
      releaseEof()
      await pending.catch(() => undefined)
    }
  })
})

test("HTTP project download keeps service credential failure a sanitized dependency 503", async () => {
  await withFixture(async ({ get, state, facts }) => {
    for (const code of [Code.Unauthenticated, Code.PermissionDenied, Code.Unavailable]) {
      state.rpcError = new ConnectError("private dependency details", code)
      await errorResponse(await get(), 503)
    }
    assert.deepEqual(
      facts.rpc.map((call) => call.method),
      ["asset", "asset", "asset"],
      "503 must come from the exercised Storage peer",
    )
    assert.equal(facts.projects.length, 3)
    assert.equal(facts.objects.length, 0)
  })
})

test("HTTP project download claims raw, decoded and absolute-form aliases without generic fallback", async () => {
  await withFixture(async ({ getWithBody, facts }) => {
    for (const target of [
      "absolute-form",
      PATH.replace("/projects/", "//projects/"),
      PATH + "/",
      PATH.replace("/v1/", "/v1/self/"),
      PATH.replace("resources", "%72esources"),
      PATH.replace("asset-1", "bad%ZZ"),
      PATH.replace("asset-1", "bad%2Fasset"),
      PATH.replace("asset-1", ""),
      PATH.replace(PROJECT, ""),
      PATH.replace("asset-1", "asset%253Aone"),
      PATH.replace("asset-1", "%2E%2E"),
      PATH.replace("asset-1", "asset%3aone"),
    ])
      await errorResponse(await getWithBody({}, undefined, target), 400)
    assert.equal(facts.admissions.length, 0)
    assert.equal(facts.projects.length, 0)
    assert.equal(facts.rpc.length, 0)
  })
})

test("HTTP project download consumes the Web producer's component-encoded colon asset selector without losing exact Storage identity", async () => {
  await withFixture(async ({ get, facts, state }) => {
    const assetId = "asset:e3e8e785-0271-47f5-9fc8-e7b601907671"
    state.assetId = assetId
    state.referenceAssetId = assetId
    const response = await get(PATH.replace("asset-1", encodeURIComponent(assetId)))
    assert.equal(response.status, 200)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), BYTES)
    assert.equal(response.headers.get("content-length"), String(BYTES.length))
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(facts.projects.length, 2)
    assert.deepEqual(
      facts.rpc.map((call) => call.request.assetId),
      [assetId, assetId],
    )
    assert.deepEqual(
      facts.rpc.map((call) => call.headers["x-kokoro-scope-id"]),
      [PROJECT, PROJECT],
    )
    assert.equal(facts.objects.length, 1)
  })
})

test("HTTP project download preserves current admission errors and bounded Retry-After without Project IO", async () => {
  await withFixture(async ({ get, facts, state }) => {
    for (const status of [401, 403, 429, 503]) {
      state.admissionResult = { ok: false, status, code: `admission_${status}`, retryAfter: "7" }
      const response = await get()
      await errorResponse(response, status)
      assert.equal(response.headers.get("retry-after"), status === 429 ? "7" : null)
    }
    state.admissionResult = { ok: false, status: 429, code: "rate_limited", retryAfter: "private dependency details" }
    const response = await get()
    await errorResponse(response, 429)
    assert.equal(response.headers.get("retry-after"), null)
    assert.equal(facts.projects.length, 0)
    assert.equal(facts.rpc.length, 0)
  })
})

test("HTTP project download distinguishes scoped absence, malformed owner response and service authentication errors", async () => {
  await withFixture(async ({ get, facts, state }) => {
    for (const [code, status] of [
      [Code.NotFound, 404],
      [Code.Unauthenticated, 503],
      [Code.PermissionDenied, 503],
      [Code.FailedPrecondition, 502],
      [Code.Unavailable, 503],
    ]) {
      state.rpcError = new ConnectError("private dependency details", code)
      await errorResponse(await get(), status)
    }
    assert.equal(facts.rpc.length, 5)
    assert.equal(facts.objects.length, 0)
    assert.equal(facts.projects.length, 5)
  })
})

async function waitFor(check) {
  const deadline = performance.now() + 2000
  while (!check()) {
    assert.ok(performance.now() < deadline, "controlled dependency must be reached")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

for (const stage of ["admission", "first-project", "asset-rpc", "reference-rpc", "fetch", "eof", "final-project"])
  test(`HTTP project download fences a non-cooperative ${stage} after client disconnect`, async () => {
    await withFixture(async ({ get, facts, state, releaseEof }) => {
      let release
      const held = new Promise((resolve) => {
        release = resolve
      })
      if (stage === "admission") state.admissionWait = held
      if (["first-project", "final-project"].includes(stage)) {
        state.projectWait = held
        state.projectWaitAt = stage === "first-project" ? 1 : 2
      }
      if (stage === "asset-rpc") state.rpcWait = held
      if (stage === "reference-rpc") state.referenceWait = held
      if (stage === "fetch") state.objectWait = held
      if (stage === "eof") state.holdEof = true
      const controller = new AbortController()
      const pending = get(PATH, "user", {}, controller.signal)
      const rejection = assert.rejects(pending)
      try {
        await waitFor(() =>
          stage === "admission"
            ? facts.admissions.length === 1
            : stage === "first-project"
              ? facts.projects.length === 1
              : stage === "asset-rpc"
                ? facts.rpc.length === 1
                : stage === "reference-rpc"
                  ? facts.rpc.length === 2
                  : ["fetch", "eof"].includes(stage)
                    ? facts.objects.length === 1
                    : facts.projects.length === 2,
        )
        controller.abort()
        await rejection
        await waitFor(() => facts.admissions[0].signal.aborted)
        const counts = [facts.projects.length, facts.rpc.length, facts.objects.length]
        release()
        releaseEof()
        await new Promise((resolve) => setTimeout(resolve, 30))
        assert.deepEqual(
          [facts.projects.length, facts.rpc.length, facts.objects.length],
          counts,
          "late success cannot start another owner read, object fetch or final check",
        )
      } finally {
        controller.abort()
        release()
        releaseEof()
        await rejection
      }
    })
  })

test("HTTP project download has one real 20 second entry budget across admission and non-cooperative EOF", async () => {
  await withFixture(async ({ get, facts, state, releaseEof }) => {
    let release
    state.admissionWait = new Promise((resolve) => {
      release = resolve
    })
    state.holdEof = true
    const started = performance.now(),
      pending = get(PATH, "user", {}, AbortSignal.timeout(25000))
    let timer
    try {
      await waitFor(() => facts.admissions.length === 1)
      timer = setTimeout(release, 1000)
      const response = await pending
      const elapsed = performance.now() - started
      await errorResponse(response, 503)
      assert.ok(elapsed >= 19500 && elapsed < 20800, `one entry deadline, actual ${elapsed}ms`)
      assert.equal(facts.projects.length, 1, "expired bytes never trigger the final owner read")
      assert.equal(facts.rpc.length, 2)
      assert.equal(facts.objects.length, 1)
      assert.ok(facts.admissions[0].signal.aborted)
      releaseEof()
      await new Promise(setImmediate)
      assert.equal(facts.projects.length, 1)
    } finally {
      clearTimeout(timer)
      release()
      releaseEof()
    }
  })
})
