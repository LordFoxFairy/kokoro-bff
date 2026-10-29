import { deflateSync } from "node:zlib"
import assert from "node:assert/strict"
import test from "node:test"
import { create } from "@bufbuild/protobuf"
import { SkillCoverSchema } from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts"
test("cover proxy validates exact PNG dimensions without claiming an absent owner digest", async () => {
  const module = await import("../src/infrastructure/clients/storage/skill-product-transfer.ts").catch(() => ({}))
  assert.equal(typeof module.readSkillCoverBytes, "function", "cover byte validator missing")
  const crc = (value) => {
    let x = 0xffffffff
    for (const b of value) {
      x ^= b
      for (let i = 0; i < 8; i++) x = (x >>> 1) ^ (x & 1 ? 0xedb88320 : 0)
    }
    return (x ^ 0xffffffff) >>> 0
  }
  const chunk = (kind, data) => {
    const body = Buffer.concat([Buffer.from(kind), data]),
      value = Buffer.alloc(data.length + 12)
    value.writeUInt32BE(data.length)
    body.copy(value, 4)
    value.writeUInt32BE(crc(body), value.length - 4)
    return value
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(2)
  ihdr.writeUInt32BE(3, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(27))),
    chunk("IEND", Buffer.alloc(0)),
  ])
  const reference = {
    url: "https://objects.test/cover",
    method: "GET",
    requiredHeaders: {},
    expiresAt: {
      seconds: BigInt(Math.floor(Date.now() / 1000) + 60),
      nanos: 0,
    },
  }
  const cover = create(SkillCoverSchema, {
    assetRef: "asset",
    mimeType: "image/png",
    width: 2,
    height: 3,
  })
  const fetcher = async () => new Response(bytes, { headers: { "content-type": "image/png" } })
  assert.deepEqual(await module.readSkillCoverBytes(reference, cover, "https://objects.test", new AbortController().signal, fetcher), bytes)
  await assert.rejects(module.readSkillCoverBytes(reference, { ...cover, width: 4 }, "https://objects.test", new AbortController().signal, fetcher))
  await assert.rejects(
    module.readSkillCoverBytes({ ...reference, url: "https://evil.test/cover" }, cover, "https://objects.test", new AbortController().signal, fetcher),
  )
})

test("Cover decoder rejects a header-only PNG before returning any object bytes", async () => {
  const { readSkillCoverBytes } = await import("../src/infrastructure/clients/storage/skill-product-transfer.ts")
  const bytes = Buffer.alloc(33)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write("IHDR", 12)
  bytes.writeUInt32BE(2, 16)
  bytes.writeUInt32BE(3, 20)
  const cover = create(SkillCoverSchema, {
    assetRef: "asset",
    mimeType: "image/png",
    width: 2,
    height: 3,
  })
  const reference = {
    url: "https://objects.test/cover",
    method: "GET",
    requiredHeaders: {},
    expiresAt: {
      seconds: BigInt(Math.floor(Date.now() / 1000) + 60),
      nanos: 0,
    },
  }
  await assert.rejects(
    readSkillCoverBytes(
      reference,
      cover,
      "https://objects.test",
      AbortSignal.timeout(1000),
      async () => new Response(bytes, { headers: { "content-type": "image/png" } }),
    ),
  )
})

import { createBffServer } from "../src/bootstrap/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"
import { createServer } from "node:http"
import { EventEmitter, once } from "node:events"
import { Code, ConnectError } from "@connectrpc/connect"
const correctionConfig = {
  host: "127.0.0.1",
  port: 4300,
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
  platformProjection: { baseUrl: null, credentialFile: null, timeoutMs: 100 },
  skillDraft: {
    enabled: false,
    platformBaseUrl: null,
    credentialFile: null,
    timeoutMs: 100,
  },
}
const correctionHeaders = {
  authorization: "Bearer session",
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "secret",
  "content-type": "application/json",
  "idempotency-key": "readmit-1",
}

for (const [ownerCode, status, errorCode] of [
  [Code.NotFound, 404, "skill_not_found"],
  [Code.Unavailable, 503, "skill_dependency_unavailable"],
])
  test(`exact cover locator leaves media ${status} to the independent admitted GET`, async () => {
    const { skillCoverRoute } = await import("../src/http/routes/skill-cover.ts")
    const request = Object.assign(new EventEmitter(), { method: "GET", url: "/v1/skills/current-version/cover", headers: {} })
    const responseHeaders = {},
      calls = []
    let body, responseStatus
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      headersSent: false,
      destroyed: false,
      setHeader(name, value) {
        responseHeaders[name] = value
      },
      writeHead(code, values) {
        responseStatus = code
        Object.assign(responseHeaders, values)
      },
      end(value) {
        body = JSON.parse(value.toString())
        this.writableEnded = true
      },
    })
    await skillCoverRoute(
      request,
      response,
      { requestId: "media-read", identity: { namespace: "tenant", userId: "user" } },
      "current-version",
      "cover",
      {
        async cover(input) {
          calls.push(input)
          throw new ConnectError("private owner failure", ownerCode)
        },
      },
      "https://objects.test",
    )
    assert.deepEqual(calls, [{ requestId: "media-read", tenant: "tenant", subject: "user", sourceRef: "skill:current-version" }])
    assert.equal(responseStatus, status)
    assert.equal(body.error.code, errorCode)
    assert.equal(JSON.stringify(body).includes("private owner failure"), false)
    assert.equal(responseHeaders["x-request-id"], "media-read")
    assert.equal(responseHeaders["cache-control"], "no-store")
  })

test("Cover real HTTP rejects owner MIME schema as502 without transferring bytes", async () => {
  let calls = 0
  const server = createBffServer(correctionConfig, {
    businessStore: null,
    sessionAdmission: {
      verify: async () => ({
        ok: true,
        identity: { namespace: "tenant", userId: "user" },
        platformAdmin: false,
      }),
    },
    skillAuthorization: { check: async () => ({ ok: true }) },
    skillProductClient: {
      getCoverUpload: async () => {
        calls++
        return {
          skillId: { value: "s" },
          stateVersion: 1n,
          attemptEpoch: 1n,
          phase: "completed",
          cover: create(SkillCoverSchema, {
            assetRef: "asset",
            mimeType: "bogus",
            width: 2,
            height: 3,
          }),
        }
      },
    },
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const headers = { ...correctionHeaders }
    delete headers["idempotency-key"]
    delete headers["content-type"]
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/skills/s/cover-upload`, { headers })
    assert.equal(response.status, 502)
    assert.equal((await response.json()).error.code, "skill_response_invalid")
    assert.equal(calls, 1)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
