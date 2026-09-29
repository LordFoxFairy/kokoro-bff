import assert from "node:assert/strict"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { Code, ConnectError } from "@connectrpc/connect"

import { createLiveTestBffServer } from "./doubles/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"

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
  upstreamMaxResponseBytes: 1048576,
  schedulerServiceToken: null,
  schedulerTargetUrl: null,
  agentEnabled: false,
  postgresUrl: null,
  redisUrl: null,
  agUi: DEFAULT_AGUI_CONFIG,
  upstreams: {},
  storageObjectOrigin: "http://127.0.0.1:39190",
  skillDraft: { enabled: false, platformBaseUrl: null, credentialFile: null, timeoutMs: 100 },
}
const headers = {
  authorization: "Bearer session",
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "secret",
  "content-type": "application/json",
  "idempotency-key": "begin-1",
}
const input = { filename: "sample.zip", mime_type: "application/zip", size_bytes: 143, content_sha256: "a".repeat(64) }
const result = () => ({
  skillId: { value: "skill-1" },
  attemptId: "attempt-1",
  attemptEpoch: 1n,
  uploadId: "upload-1",
  replayed: false,
  transferReference: {
    url: "http://127.0.0.1:39190/bucket/opaque?X-Amz-Signature=secret",
    method: "PUT",
    requiredHeaders: { "content-type": "application/zip" },
    expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 300), nanos: 0 },
  },
})
async function withServer(client, run, admission = { verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "user" } }) }, override = {}) {
  const server = createLiveTestBffServer({ ...config, ...override }, { sessionAdmission: admission, skillDraftClient: client })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}
const post = (base, body = input, other = {}) =>
  fetch(`${base}/v1/skills/skill-1/package-upload`, { method: "POST", headers: { ...headers, ...other }, body: JSON.stringify(body) })

test("Begin digest projector matches every pinned owner v4 projection vector", async () => {
  const { projectBeginSkillPackage } = await import("../dist/infrastructure/clients/platform/begin-skill-package-projector.js")
  const source = new URL(
    "../contract/vendor/kokoro-platform/263a28f1e55745bd1829a61f68228d775751adbc/execution-operations-v4/vectors/command-projection.json",
    import.meta.url,
  )
  const vectors = JSON.parse(await readFile(source, "utf8")).vectors.filter((vector) => vector.operation === "skill.begin_package_upload")
  assert.equal(vectors.length, 14)
  for (const vector of vectors) {
    const raw = Buffer.from(vector.rawBase64, "base64")
    if (vector.expectedError !== "none") {
      assert.throws(() => projectBeginSkillPackage(raw), { message: vector.expectedError }, vector.name)
      continue
    }
    const projected = projectBeginSkillPackage(raw)
    assert.deepEqual(projected.projection, vector.projection, vector.name)
    assert.equal(Buffer.from(projected.canonical).toString("base64"), vector.canonicalBase64, vector.name)
    assert.equal(projected.sha256, vector.sha256, vector.name)
  }
})

test("Begin POST routes beside Get and returns strict current signed PUT reference", async () => {
  const calls = []
  await withServer(
    {
      beginPackageUpload: async (command) => {
        calls.push(command)
        return result()
      },
    },
    async (base) => {
      const response = await post(base)
      assert.equal(response.status, 201)
      const body = await response.json()
      assert.deepEqual(Object.keys(body), ["data"])
      assert.deepEqual(Object.keys(body.data), ["skill_id", "attempt_id", "attempt_epoch", "upload_id", "transfer_reference", "replayed"])
      assert.equal(body.data.attempt_epoch, "1")
      assert.equal(body.data.transfer_reference.url, result().transferReference.url)
      assert.equal(body.data.transfer_reference.method, "PUT")
      assert.deepEqual(body.data.transfer_reference.required_headers, { "content-type": "application/zip" })
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.ok(response.headers.get("x-request-id"))
    },
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].tenant, "tenant")
  assert.equal(calls[0].user, "user")
  assert.equal(calls[0].skillId, "skill-1")
  assert.match(calls[0].digest, /^[a-f0-9]{64}$/u)
})

test("Begin is default closed and current IAM revocation prevents same-key Platform replay", async () => {
  let calls = 0
  let admits = 0
  const admission = {
    verify: async () => (++admits <= 2 ? { ok: true, identity: { namespace: "tenant", userId: "user" } } : { ok: false, status: 401, code: "session_invalid" }),
  }
  await withServer(
    {
      beginPackageUpload: async () => {
        calls++
        return { ...result(), replayed: calls > 1 }
      },
    },
    async (base) => {
      assert.equal((await post(base)).status, 201)
      assert.equal((await post(base)).status, 201)
      const revoked = await post(base)
      assert.equal(revoked.status, 401)
      assert.equal((await revoked.json()).error.code, "session_invalid")
    },
    admission,
  )
  assert.equal(calls, 2)
  await withServer(null, async (base) => {
    const closed = await post(base)
    assert.equal(closed.status, 503)
  })
})

test("Begin rejects invalid input before Platform including UTF-8 byte bound", async () => {
  let calls = 0
  await withServer(
    {
      beginPackageUpload: async () => {
        calls++
        return result()
      },
    },
    async (base) => {
      const valid = await post(base, { ...input, filename: "é".repeat(127) + "x" })
      assert.equal(valid.status, 201)
      for (const body of [
        { ...input, filename: "é".repeat(128) },
        { ...input, filename: ".." },
        { ...input, filename: "a/b" },
        { ...input, mime_type: "text/plain" },
        { ...input, size_bytes: 0 },
        { ...input, content_sha256: "A".repeat(64) },
        { ...input, replaces_attempt_id: null },
        { ...input, owner_id: "foreign" },
      ]) {
        const invalid = await post(base, body)
        assert.equal(invalid.status, 400, JSON.stringify(body))
      }
      const missing = await post(base, input, { "idempotency-key": "" })
      assert.equal(missing.status, 400)
      const duplicate = await fetch(`${base}/v1/skills/skill-1/package-upload`, {
        method: "POST",
        headers,
        body: `{"filename":"sample.zip","filename":"other.zip","mime_type":"application/zip","size_bytes":143,"content_sha256":"${"a".repeat(64)}"}`,
      })
      assert.equal(duplicate.status, 400)
    },
  )
  assert.equal(calls, 1)
})

test("Begin rejects invalid transfer references without leaking signed query", async () => {
  for (const transfer of [
    { url: "http://evil.local/b?sig=private" },
    { url: "http://user:pass@127.0.0.1:39190/b?sig=private" },
    { url: "http://127.0.0.1:39190/b#fragment" },
    { method: "GET" },
    { requiredHeaders: { "content-type": "application/zip", authorization: "Bearer secret" } },
    { requiredHeaders: { "content-type": "text/plain" } },
    { requiredHeaders: undefined },
    { url: "http://127.0.0.1:39190/b\n?sig=private" },
    { expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) - 1), nanos: 0 } },
    { expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 1000), nanos: 0 } },
    { expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 300), nanos: 0.5 } },
  ])
    await withServer({ beginPackageUpload: async () => ({ ...result(), transferReference: { ...result().transferReference, ...transfer } }) }, async (base) => {
      const response = await post(base)
      assert.equal(response.status, 502)
      const body = await response.json()
      assert.equal(body.error.code, "skill_response_invalid")
      assert.equal(JSON.stringify(body).includes("private"), false)
    })
})

test("Begin accepts a configured HTTPS origin but rejects non-loopback HTTP even when configured", async () => {
  await withServer(
    {
      beginPackageUpload: async () => ({
        ...result(),
        transferReference: { ...result().transferReference, url: "https://objects.example.test/bucket/key?signature=opaque" },
      }),
    },
    async (base) => {
      const response = await post(base)
      assert.equal(response.status, 201)
      assert.equal((await response.json()).data.transfer_reference.url, "https://objects.example.test/bucket/key?signature=opaque")
    },
    undefined,
    { storageObjectOrigin: "https://objects.example.test" },
  )
  await withServer(
    {
      beginPackageUpload: async () => ({
        ...result(),
        transferReference: { ...result().transferReference, url: "http://objects.example.test/bucket/key?signature=opaque" },
      }),
    },
    async (base) => {
      const response = await post(base)
      assert.equal(response.status, 502)
    },
    undefined,
    { storageObjectOrigin: "http://objects.example.test" },
  )
})

test("Begin command ID is stable per trusted operation, tenant, user, skill and key while the digest binds the body", async () => {
  const commands = []
  await withServer(
    {
      beginPackageUpload: async (command) => {
        commands.push(command)
        return { ...result(), replayed: commands.length > 1 }
      },
    },
    async (base) => {
      assert.equal((await post(base)).status, 201)
      assert.equal((await post(base)).status, 201)
      assert.equal((await post(base, { ...input, filename: "other.zip" })).status, 201)
      assert.equal((await post(base, input, { "idempotency-key": "begin-2" })).status, 201)
    },
  )
  assert.equal(commands.length, 4)
  assert.equal(commands[0].commandId, commands[1].commandId)
  assert.equal(commands[0].digest, commands[1].digest)
  assert.equal(commands[0].commandId, commands[2].commandId)
  assert.notEqual(commands[0].digest, commands[2].digest)
  assert.notEqual(commands[0].commandId, commands[3].commandId)
  assert.equal(commands[0].digest, commands[3].digest)
  await withServer(
    {
      beginPackageUpload: async (command) => {
        commands.push(command)
        return result()
      },
    },
    async (base) => {
      assert.equal((await post(base)).status, 201)
    },
    { verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "other-user" } }) },
  )
  assert.notEqual(commands[0].commandId, commands[4].commandId)
  assert.notEqual(commands[0].digest, commands[4].digest)
})

test("Begin same-key different body receives owner conflict; stale replace receives owner precondition", async () => {
  const byCommand = new Map()
  await withServer(
    {
      beginPackageUpload: async (command) => {
        const prior = byCommand.get(command.commandId)
        if (prior !== undefined && prior !== command.digest) throw new ConnectError("private digest mismatch", Code.AlreadyExists)
        byCommand.set(command.commandId, command.digest)
        if (command.replacesAttemptId === "old-attempt") throw new ConnectError("private stale attempt", Code.FailedPrecondition)
        return { ...result(), replayed: prior !== undefined }
      },
    },
    async (base) => {
      assert.equal((await post(base)).status, 201)
      assert.equal((await post(base)).status, 201)
      const conflict = await post(base, { ...input, content_sha256: "b".repeat(64) })
      assert.equal(conflict.status, 409)
      assert.equal((await conflict.json()).error.code, "skill_idempotency_conflict")
      const stale = await post(base, { ...input, replaces_attempt_id: "old-attempt" }, { "idempotency-key": "replacement-1" })
      assert.equal(stale.status, 412)
      assert.equal((await stale.json()).error.code, "skill_precondition_failed")
    },
  )
})

test("Begin rejects foreign tenant and invalid owner response; replace ID reaches owner exactly", async () => {
  let calls = 0
  await withServer(
    {
      beginPackageUpload: async () => {
        calls++
        return result()
      },
    },
    async (base) => {
      const response = await post(base)
      assert.equal(response.status, 403)
      assert.equal((await response.json()).error.code, "product_tenant_forbidden")
    },
    { verify: async () => ({ ok: true, identity: { namespace: "foreign", userId: "user" } }) },
  )
  assert.equal(calls, 0)
  await withServer({ beginPackageUpload: async () => ({ ...result(), skillId: { value: "foreign-skill" } }) }, async (base) => {
    const response = await post(base)
    assert.equal(response.status, 502)
    assert.equal((await response.json()).error.code, "skill_response_invalid")
  })
  await withServer(
    {
      beginPackageUpload: async (command) => {
        assert.equal(command.replacesAttemptId, "attempt-1")
        return result()
      },
    },
    async (base) => {
      assert.equal((await post(base, { ...input, replaces_attempt_id: "attempt-1" })).status, 201)
    },
  )
})

test("Begin rejects query aliases, malformed IDs and duplicate keys before Platform", async () => {
  const { request: httpRequest } = await import("node:http")
  let calls = 0
  await withServer(
    {
      beginPackageUpload: async () => {
        calls++
        return result()
      },
    },
    async (base) => {
      for (const path of ["/v1/skills/skill-1/package-upload?x=1", "/v1/skills/bad%20id/package-upload", "/v1/skills/%73kill-1/package-upload"]) {
        const response = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(input) })
        assert.equal(response.status, 400)
        assert.equal((await response.json()).error.code, "invalid_skill_request")
      }
      const response = await new Promise((resolve, reject) => {
        const req = httpRequest(
          `${base}/v1/skills/skill-1/package-upload`,
          { method: "POST", headers: { ...headers, "idempotency-key": ["begin-1", "begin-2"] } },
          (received) => {
            const chunks = []
            received.on("data", (chunk) => chunks.push(chunk))
            received.once("end", () => resolve({ status: received.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }))
          },
        )
        req.once("error", reject)
        req.end(JSON.stringify(input))
      })
      assert.equal(response.status, 400)
      assert.equal(response.body.error.code, "invalid_idempotency_key")
    },
  )
  assert.equal(calls, 0)
})

test("Begin client disconnect aborts the in-flight owner stage", async () => {
  const { request: httpRequest } = await import("node:http")
  let reachedResolve
  const reached = new Promise((resolve) => {
    reachedResolve = resolve
  })
  let abortedResolve
  const aborted = new Promise((resolve) => {
    abortedResolve = resolve
  })
  await withServer(
    {
      beginPackageUpload: async (_command, signal) => {
        reachedResolve()
        await new Promise((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              abortedResolve()
              resolve()
            },
            { once: true },
          ),
        )
        throw signal.reason
      },
    },
    async (base) => {
      const url = new URL("/v1/skills/skill-1/package-upload", base)
      const req = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers })
      req.on("error", () => {})
      req.end(JSON.stringify(input))
      await reached
      req.destroy()
      await aborted
    },
  )
})

test("Begin maps owner conflict, precondition, absence, timeout and rate limit to status-specific errors", async () => {
  for (const [code, status, expected] of [
    [Code.NotFound, 404, "skill_not_found"],
    [Code.PermissionDenied, 404, "skill_not_found"],
    [Code.AlreadyExists, 409, "skill_idempotency_conflict"],
    [Code.Aborted, 409, "skill_command_in_progress"],
    [Code.FailedPrecondition, 412, "skill_precondition_failed"],
    [Code.ResourceExhausted, 429, "skill_rate_limited"],
    [Code.DeadlineExceeded, 503, "skill_dependency_unavailable"],
    [Code.Canceled, 503, "skill_dependency_unavailable"],
    [Code.Unavailable, 503, "skill_dependency_unavailable"],
    [Code.InvalidArgument, 502, "skill_response_invalid"],
  ])
    await withServer(
      {
        beginPackageUpload: async () => {
          throw new ConnectError("private-owner-reason", code, new Headers({ "retry-after": "12" }))
        },
      },
      async (base) => {
        const response = await post(base)
        assert.equal(response.status, status)
        const body = await response.json()
        assert.equal(body.error.code, expected)
        assert.equal(JSON.stringify(body).includes("private-owner-reason"), false)
        assert.equal(response.headers.get("retry-after"), status === 429 ? "12" : null)
      },
    )
})

test("Begin requires configured approved object origin without affecting Get", async () => {
  await withServer(
    {
      beginPackageUpload: async () => {
        throw new Error("must not call")
      },
      getPackageUpload: async () => ({ skillId: { value: "skill-1" }, attemptEpoch: 0n, phase: 1 }),
    },
    async (base) => {
      assert.equal((await post(base)).status, 503)
      const get = await fetch(`${base}/v1/skills/skill-1/package-upload`, { headers })
      assert.equal(get.status, 400) // Get rejects an Idempotency-Key, independent of Begin's origin gate.
      const cleanGet = await fetch(`${base}/v1/skills/skill-1/package-upload`, {
        headers: {
          authorization: headers.authorization,
          "x-kokoro-service": headers["x-kokoro-service"],
          "x-kokoro-internal-secret": headers["x-kokoro-internal-secret"],
        },
      })
      assert.equal(cleanGet.status, 200)
    },
    undefined,
    { storageObjectOrigin: null },
  )
})

test("real generated Begin Connect client forwards only catalog credential and exact v4 command fields", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { CatalogConnectClient } = await import("../dist/infrastructure/clients/platform/catalog-connect.js")
  const { SkillCatalogService } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  let calls = 0
  const owner = createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(SkillCatalogService, {
          beginSkillPackageUpload(request, context) {
            calls++
            assert.equal(context.requestHeader.get("authorization"), "Bearer catalog-machine")
            assert.equal(context.requestHeader.get("x-tenant-ref"), "tenant")
            assert.equal(request.command?.commandId, "command-1")
            assert.equal(request.command?.requestDigest, "a".repeat(64))
            assert.equal(request.skillId?.value, "skill-1")
            assert.equal(request.productContext?.subjectId, "user")
            assert.equal(request.productContext?.ownerScope?.kind, "user")
            assert.equal(request.productContext?.ownerScope?.id, "user")
            assert.equal(request.filename, "sample.zip")
            assert.equal(request.sizeBytes, 143n)
            assert.equal(request.replacesAttemptId, "attempt-1")
            return result()
          },
        })
      },
    }),
  )
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  try {
    const client = new CatalogConnectClient(`http://127.0.0.1:${owner.address().port}`, { get: async () => "catalog-machine" }, 1000)
    const response = await client.beginPackageUpload({
      requestId: "request-1",
      commandId: "command-1",
      digest: "a".repeat(64),
      tenant: "tenant",
      user: "user",
      skillId: "skill-1",
      filename: "sample.zip",
      mimeType: "application/zip",
      sizeBytes: 143,
      contentSha256: "b".repeat(64),
      replacesAttemptId: "attempt-1",
    })
    assert.equal(response.attemptId, "attempt-1")
    assert.equal(calls, 1)
  } finally {
    await new Promise((resolve) => owner.close(resolve))
  }
})
