import assert from "node:assert/strict"
import { once } from "node:events"
import { request as httpRequest } from "node:http"
import test from "node:test"
import { Code, ConnectError } from "@connectrpc/connect"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { createLiveTestBffServer } from "./doubles/server.ts"

const config = {
  host: "127.0.0.1",
  port: 0,
  mode: "live",
  domain: "dev.kokoro.localhost",
  tenantId: "tenant-personal",
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
  skillDraft: {
    enabled: false,
    platformBaseUrl: null,
    credentialFile: null,
    timeoutMs: 100,
  },
}
const baseHeaders = {
  authorization: "Bearer session",
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "secret",
  "content-type": "application/json",
  "idempotency-key": "lifecycle-key-1",
}
const admission = {
  calls: [],
  async verify(input) {
    this.calls.push(input)
    return {
      ok: true,
      identity: { namespace: "tenant-personal", userId: "user-personal" },
      platformAdmin: false,
    }
  },
}
const versionResult = (override = {}) => ({
  stateVersion: 1n,
  skillId: { value: "skill-new" },
  seriesId: { value: "series-1" },
  revision: 2n,
  status: 1,
  replayed: false,
  ...override,
})
const withdrawResult = (override = {}) => ({
  stateVersion: 1n,
  sourceRef: { value: "skill:skill-base" },
  status: 3,
  eventId: `evt:${"a".repeat(64)}`,
  replayed: false,
  ...override,
})

async function withServer(client, run, sessionAdmission = admission) {
  const server = createLiveTestBffServer(config, {
    skillAuthorization: { check: async () => ({ ok: true }) },
    sessionAdmission,
    skillDraftClient: client,
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const post = (origin, path, body, headers = {}) =>
  fetch(origin + path, {
    method: "POST",
    headers: { ...baseHeaders, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

test("personal Skill lifecycle legal CreateVersion reaches the admitted owner and projects strict public metadata", async () => {
  const calls = []
  await withServer(
    {
      createPersonalVersion: async (input) => {
        calls.push(input)
        return versionResult()
      },
    },
    async (origin) => {
      const response = await post(origin, "/v1/self/skills/skill-base/versions", {
        display_name: "Published name",
        summary: "Next version",
        tags: ["managed"],
        example_prompts: ["  First\nline  ", "same", "same"],
      })
      assert.equal(response.status, 201)
      const requestId = response.headers.get("x-request-id")
      assert.ok(requestId)
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.deepEqual(await response.json(), {
        data: {
          state_version: "1",
          skill_id: "skill-new",
          series_id: "series-1",
          revision: "2",
          status: "draft",
          replayed: false,
        },
        meta: { request_id: requestId },
      })
    },
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].tenant, "tenant-personal")
  assert.equal(calls[0].user, "user-personal")
  assert.equal(calls[0].baseSkillId, "skill-base")
  assert.equal(calls[0].displayName, "Published name")
  assert.equal(calls[0].summary, "Next version")
  assert.deepEqual(calls[0].tags, ["managed"])
  assert.deepEqual(calls[0].examplePrompts, ["  First\nline  ", "same", "same"])
  assert.match(calls[0].commandId, /^bff\.skill\.create_version\.v1\.[a-f0-9]{64}$/u)
  assert.match(calls[0].digest, /^[a-f0-9]{64}$/u)
})

test("personal Skill lifecycle legal Withdraw reaches the admitted owner and binds source identity", async () => {
  const calls = []
  await withServer(
    {
      withdrawPersonal: async (input) => {
        calls.push(input)
        return withdrawResult({ replayed: true })
      },
    },
    async (origin) => {
      const response = await post(origin, "/v1/self/skills/skill-base/withdraw", { expected_state_version: "8", reason: "Superseded by a safer revision" })
      assert.equal(response.status, 200)
      const requestId = response.headers.get("x-request-id")
      assert.ok(requestId)
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.deepEqual(await response.json(), {
        data: {
          state_version: "1",
          source_ref: "skill:skill-base",
          status: "withdrawn",
          event_id: `evt:${"a".repeat(64)}`,
          replayed: true,
        },
        meta: { request_id: requestId },
      })
    },
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].tenant, "tenant-personal")
  assert.equal(calls[0].user, "user-personal")
  assert.equal(calls[0].skillId, "skill-base")
  assert.equal(calls[0].reason, "Superseded by a safer revision")
  assert.equal(calls[0].expectedStateVersion, "8")
  assert.match(calls[0].commandId, /^bff\.skill\.withdraw\.v1\.[a-f0-9]{64}$/u)
  assert.match(calls[0].digest, /^[a-f0-9]{64}$/u)
})

test("personal Skill lifecycle closes raw input, framing, key, UTF-8 and reason code-point boundaries before owner I/O", async () => {
  let calls = 0
  const client = {
    createPersonalVersion: async () => {
      calls += 1
      return versionResult()
    },
    withdrawPersonal: async () => {
      calls += 1
      return withdrawResult()
    },
  }
  await withServer(client, async (origin) => {
    const invalid = [
      post(origin, "/v1/self/skills/skill-base/versions?x=1", {
        display_name: "Name",
        summary: "",
        tags: [],
      }),
      post(origin, "/v1/self/skills/skill-base/versions", '{"display_name":"Name","display_name":"Other","summary":"","tags":[]}'),
      post(origin, "/v1/self/skills/skill-base/versions", {
        display_name: "Name",
        summary: "",
        tags: [],
        tenant: "other",
      }),
      post(origin, "/v1/self/skills/skill-base/withdraw", { expected_state_version: "8", reason: "\n\t" }),
      post(origin, "/v1/self/skills/skill-base/withdraw", {
        expected_state_version: "8",
        reason: "😀".repeat(2049),
      }),
      post(origin, "/v1/self/skills/skill-base/withdraw", { expected_state_version: "8", reason: "valid" }, { "idempotency-key": "" }),
      post(origin, "/v1/self/skills/skill-base/withdraw", { expected_state_version: "8", reason: "valid" }, { "content-type": "text/plain" }),
    ]
    for (const pending of invalid) {
      const response = await pending
      assert.equal(response.status, 400)
      assert.equal(Object.hasOwn(await response.json(), "meta"), true)
    }
    const validCodePoints = await post(origin, "/v1/self/skills/skill-base/withdraw", { expected_state_version: "8", reason: "😀".repeat(2048) })
    assert.equal(validCodePoints.status, 200)
    await new Promise((resolve, reject) => {
      const rawBody = '{"expected_state_version":"8","reason":"valid"}'
      const request = httpRequest(
        origin + "/v1/self/skills/skill-base/withdraw",
        {
          method: "POST",
          headers: [
            "host",
            new URL(origin).host,
            "authorization",
            "Bearer session",
            "x-kokoro-service",
            "web-bff",
            "x-kokoro-internal-secret",
            "secret",
            "content-type",
            "application/json",
            "content-length",
            String(Buffer.byteLength(rawBody)),
            "idempotency-key",
            "one",
            "idempotency-key",
            "two",
          ],
        },
        (response) => {
          const chunks = []
          response.on("data", (chunk) => chunks.push(chunk))
          response.once("end", () => {
            try {
              assert.equal(response.statusCode, 400)
              assert.equal(JSON.parse(Buffer.concat(chunks).toString("utf8")).error.code, "invalid_idempotency_key")
              resolve()
            } catch (error) {
              reject(error)
            }
          })
        },
      )
      request.once("error", reject)
      request.end(rawBody)
    })
  })
  assert.equal(calls, 1)
})

test("personal Skill lifecycle rejects invalid owner projections and maps only the closed owner error tuples", async () => {
  const invalidVersions = [
    versionResult({ stateVersion: 1n, skillId: { value: "skill-base" } }),
    versionResult({ revision: 1n }),
    versionResult({ revision: 18_446_744_073_709_551_616n }),
    versionResult({ status: 2 }),
  ]
  for (const owner of invalidVersions) {
    await withServer({ createPersonalVersion: async () => owner }, async (origin) => {
      const response = await post(origin, "/v1/self/skills/skill-base/versions", { display_name: "Name", summary: "", tags: [] })
      assert.equal(response.status, 502)
      assert.equal((await response.json()).error.code, "skill_response_invalid")
    })
  }
  const invalidWithdrawals = [
    withdrawResult({ sourceRef: { value: "skill:other" } }),
    withdrawResult({ status: 2 }),
    withdrawResult({ eventId: "not-an-event" }),
  ]
  for (const owner of invalidWithdrawals) {
    await withServer({ withdrawPersonal: async () => owner }, async (origin) => {
      const response = await post(origin, "/v1/self/skills/skill-base/withdraw", { expected_state_version: "8", reason: "valid" })
      assert.equal(response.status, 502)
      assert.equal((await response.json()).error.code, "skill_response_invalid")
    })
  }
  const errors = [
    [Code.NotFound, 404, "skill_not_found"],
    [Code.PermissionDenied, 404, "skill_not_found"],
    [Code.AlreadyExists, 409, "skill_idempotency_conflict"],
    [Code.Aborted, 409, "skill_command_in_progress"],
    [Code.FailedPrecondition, 412, "skill_precondition_failed"],
    [Code.ResourceExhausted, 429, "skill_rate_limited"],
    [Code.Unavailable, 503, "skill_dependency_unavailable"],
    [Code.InvalidArgument, 502, "skill_response_invalid"],
  ]
  for (const [code, status, expected] of errors) {
    const metadata = new Headers(code === Code.ResourceExhausted ? { "retry-after": "12" } : {})
    await withServer(
      {
        withdrawPersonal: async () => {
          throw new ConnectError("private owner detail", code, metadata)
        },
      },
      async (origin) => {
        const response = await post(origin, "/v1/self/skills/skill-base/withdraw", { expected_state_version: "8", reason: "valid" })
        assert.equal(response.status, status)
        const body = await response.json()
        assert.equal(body.error.code, expected)
        assert.equal(Object.hasOwn(body.error, "retryable"), false)
        assert.equal(JSON.stringify(body).includes("private owner detail"), false)
        assert.equal(body.meta.request_id, response.headers.get("x-request-id"))
      },
    )
  }
})

test("personal Skill Withdraw rejects a NUL reason with the strict public error envelope before owner I/O", async () => {
  let calls = 0
  await withServer(
    {
      withdrawPersonal: async () => {
        calls += 1
        return withdrawResult()
      },
    },
    async (origin) => {
      const response = await post(origin, "/v1/self/skills/skill-base/withdraw", { expected_state_version: "8", reason: "not\u0000allowed" })
      assert.equal(response.status, 400)
      assert.equal(response.headers.get("cache-control"), "no-store")
      const requestId = response.headers.get("x-request-id")
      assert.ok(requestId)
      assert.deepEqual(await response.json(), {
        error: {
          code: "invalid_skill_request",
          message: "Skill lifecycle request is invalid",
        },
        meta: { request_id: requestId },
      })
    },
  )
  assert.equal(calls, 0)
})

test("personal Skill lifecycle closes synchronous and asynchronous admission failures as bounded 503 without owner I/O", async () => {
  for (const sessionAdmission of [
    {
      verify() {
        throw new Error("synchronous admission failure")
      },
    },
    {
      async verify() {
        throw new Error("asynchronous admission failure")
      },
    },
  ]) {
    let ownerCalls = 0
    const server = createLiveTestBffServer(config, {
      skillAuthorization: { check: async () => ({ ok: true }) },
      sessionAdmission,
      skillDraftClient: {
        withdrawPersonal: async () => {
          ownerCalls += 1
          return withdrawResult()
        },
      },
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    try {
      let response
      try {
        response = await fetch(`http://127.0.0.1:${server.address().port}/v1/self/skills/skill-base/withdraw`, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify({ expected_state_version: "8", reason: "valid" }),
          signal: AbortSignal.timeout(1500),
        })
      } catch (error) {
        assert.fail(`admission failure did not produce a bounded HTTP response: ${String(error)}`)
      }
      assert.equal(response.status, 503)
      assert.equal(response.headers.get("cache-control"), "no-store")
      const requestId = response.headers.get("x-request-id")
      assert.ok(requestId)
      assert.deepEqual(await response.json(), {
        error: {
          code: "iam_admission_unavailable",
          message: "BFF user admission failed",
        },
        meta: { request_id: requestId },
      })
      assert.equal(ownerCalls, 0)
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

test("personal Skill lifecycle accepts only bounded admission Retry-After values for the closed 429 profile", async () => {
  for (const [retryAfter, status, code] of [
    [undefined, 502, "skill_response_invalid"],
    ["0", 502, "skill_response_invalid"],
    ["86401", 502, "skill_response_invalid"],
    ["12,13", 502, "skill_response_invalid"],
    ["1", 429, "session_rate_limited"],
    ["86400", 429, "session_rate_limited"],
  ]) {
    let ownerCalls = 0
    await withServer(
      {
        withdrawPersonal: async () => {
          ownerCalls += 1
          return withdrawResult()
        },
      },
      async (origin) => {
        const response = await post(origin, "/v1/self/skills/skill-base/withdraw", { expected_state_version: "8", reason: "valid" })
        assert.equal(response.status, status, String(retryAfter))
        assert.equal(response.headers.get("cache-control"), "no-store")
        assert.equal(response.headers.get("retry-after"), status === 429 ? retryAfter : null)
        const requestId = response.headers.get("x-request-id")
        assert.ok(requestId)
        const body = await response.json()
        assert.equal(body.error.code, code)
        assert.equal(body.meta.request_id, requestId)
        assert.equal(Object.hasOwn(body.error, "retryable"), false)
      },
      {
        async verify() {
          return {
            ok: false,
            status: 429,
            code: "session_rate_limited",
            ...(retryAfter === undefined ? {} : { retryAfter }),
          }
        },
      },
    )
    assert.equal(ownerCalls, 0)
  }
})

test("personal Skill lifecycle held admission is bounded by the single service deadline and a late success is never adopted", async () => {
  let releaseAdmission
  let admissionInputResolve
  const admissionInput = new Promise((resolve) => {
    admissionInputResolve = resolve
  })
  const heldAdmission = new Promise((resolve) => {
    releaseAdmission = resolve
  })
  let ownerCalls = 0
  const server = createLiveTestBffServer(config, {
    skillAuthorization: { check: async () => ({ ok: true }) },
    sessionAdmission: {
      verify(input) {
        admissionInputResolve(input)
        return heldAdmission
      },
    },
    skillDraftClient: {
      withdrawPersonal: async () => {
        ownerCalls += 1
        return withdrawResult()
      },
    },
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const started = performance.now()
  try {
    const pendingResponse = fetch(`http://127.0.0.1:${server.address().port}/v1/self/skills/skill-base/withdraw`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({ expected_state_version: "8", reason: "valid" }),
      signal: AbortSignal.timeout(13_000),
    })
    const observedAdmission = await admissionInput
    let response
    try {
      response = await pendingResponse
    } catch (error) {
      assert.fail(`service did not answer the held admission inside its deadline: ${String(error)}`)
    }
    const elapsed = performance.now() - started
    assert.ok(elapsed >= 9_500, String(elapsed))
    assert.ok(elapsed <= 12_000, String(elapsed))
    assert.equal(response.status, 503)
    assert.equal(response.headers.get("cache-control"), "no-store")
    const requestId = response.headers.get("x-request-id")
    assert.ok(requestId)
    assert.deepEqual(await response.json(), {
      error: {
        code: "skill_dependency_unavailable",
        message: "Skill lifecycle dependency is unavailable",
      },
      meta: { request_id: requestId },
    })
    assert.equal(observedAdmission.signal.aborted, true)
    releaseAdmission({
      ok: true,
      identity: { namespace: "tenant-personal", userId: "user-personal" },
      platformAdmin: false,
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(ownerCalls, 0)
  } finally {
    releaseAdmission?.({
      ok: true,
      identity: { namespace: "tenant-personal", userId: "user-personal" },
      platformAdmin: false,
    })
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("personal Skill lifecycle rejects structural URL aliases while preserving a legal encoded opaque identifier", async () => {
  let ownerCalls = 0
  const client = {
    createPersonalVersion: async () => {
      ownerCalls += 1
      return versionResult()
    },
    withdrawPersonal: async () => {
      ownerCalls += 1
      return withdrawResult()
    },
  }
  await withServer(client, async (origin) => {
    for (const path of [
      "/v1//self/skills/skill-base/versions",
      "/v1/self/skills/skill-base/versions/",
      "/v1/%73elf/skills/skill-base/versions",
      "/v1/self/skills/skill-base/%76ersions",
      "/v1//self/skills/skill-base/withdraw",
      "/v1/self/skills/skill-base/withdraw/",
      "/v1/%73elf/skills/skill-base/withdraw",
      "/v1/self/skills/skill-base/%77ithdraw",
    ]) {
      const body =
        path.endsWith("withdraw") || path.endsWith("%77ithdraw")
          ? { expected_state_version: "8", reason: "valid" }
          : { display_name: "Name", summary: "", tags: [] }
      const response = await post(origin, path, body)
      assert.equal(response.status, 400, path)
      const requestId = response.headers.get("x-request-id")
      assert.ok(requestId)
      const payload = await response.json()
      assert.equal(payload.error.code, "invalid_skill_request")
      assert.equal(payload.meta.request_id, requestId)
    }
    assert.equal(ownerCalls, 0)
    const encodedIdentifier = await post(origin, "/v1/self/skills/skill%2Dbase/withdraw", { expected_state_version: "8", reason: "valid" })
    assert.equal(encodedIdentifier.status, 200)
  })
  assert.equal(ownerCalls, 1)
})

test("personal Skill lifecycle oversized declared body replies 413 then retires the incomplete upload socket", async () => {
  let ownerCalls = 0
  const server = createLiveTestBffServer(config, {
    skillAuthorization: { check: async () => ({ ok: true }) },
    sessionAdmission: admission,
    skillDraftClient: {
      withdrawPersonal: async () => {
        ownerCalls += 1
        return withdrawResult()
      },
    },
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  let request
  try {
    const socketClosed = new Promise((resolve) => {
      request = httpRequest(`http://127.0.0.1:${server.address().port}/v1/self/skills/skill-base/withdraw`, {
        method: "POST",
        headers: {
          ...baseHeaders,
          "content-length": "1000000",
        },
      })
      request.once("socket", (socket) => socket.once("close", resolve))
    })
    const responseComplete = new Promise((resolve, reject) => {
      request.once("response", (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.once("end", () => {
          try {
            assert.equal(response.statusCode, 413)
            assert.equal(response.headers["cache-control"], "no-store")
            const requestId = response.headers["x-request-id"]
            assert.equal(typeof requestId, "string")
            assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), {
              error: {
                code: "request_body_too_large",
                message: "Skill lifecycle request is invalid",
              },
              meta: { request_id: requestId },
            })
            resolve()
          } catch (error) {
            reject(error)
          }
        })
      })
      request.once("error", reject)
    })
    request.write(Buffer.alloc(65_537, 0x61))
    await Promise.race([responseComplete, new Promise((_, reject) => setTimeout(() => reject(new Error("413 response harness timeout")), 2000))])
    await Promise.race([socketClosed, new Promise((_, reject) => setTimeout(() => reject(new Error("oversized upload socket was not retired")), 1500))])
    assert.equal(ownerCalls, 0)
  } finally {
    request?.destroy()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("personal Skill lifecycle retires incomplete upload sockets after every early closed rejection", async () => {
  const cases = [
    {
      name: "missing key",
      admission,
      headers: { ...baseHeaders, "idempotency-key": undefined },
      status: 400,
      code: "idempotency_key_required",
    },
    {
      name: "admission denial",
      admission: {
        verify: async () => ({
          ok: false,
          status: 403,
          code: "session_forbidden",
        }),
      },
      headers: baseHeaders,
      status: 403,
      code: "session_forbidden",
    },
    {
      name: "admission failure",
      admission: {
        verify: async () => Promise.reject(new Error("controlled admission failure")),
      },
      headers: baseHeaders,
      status: 503,
      code: "iam_admission_unavailable",
    },
  ]
  for (const scenario of cases) {
    let ownerCalls = 0
    const server = createLiveTestBffServer(config, {
      skillAuthorization: { check: async () => ({ ok: true }) },
      sessionAdmission: scenario.admission,
      skillDraftClient: {
        withdrawPersonal: async () => {
          ownerCalls += 1
          return withdrawResult()
        },
      },
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    let request
    try {
      const headers = Object.fromEntries(Object.entries(scenario.headers).filter(([, value]) => value !== undefined))
      request = httpRequest(`http://127.0.0.1:${server.address().port}/v1/self/skills/skill-base/withdraw`, {
        method: "POST",
        headers: { ...headers, "content-length": "1000000" },
      })
      const socketClosed = new Promise((resolve) => request.once("socket", (socket) => socket.once("close", resolve)))
      const responseComplete = new Promise((resolve, reject) => {
        request.once("response", (response) => {
          const chunks = []
          response.on("data", (chunk) => chunks.push(chunk))
          response.once("end", () => {
            try {
              assert.equal(response.statusCode, scenario.status, scenario.name)
              assert.equal(response.headers["cache-control"], "no-store", scenario.name)
              const requestId = response.headers["x-request-id"]
              assert.equal(typeof requestId, "string", scenario.name)
              const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"))
              assert.equal(payload.error.code, scenario.code, scenario.name)
              assert.equal(payload.meta.request_id, requestId, scenario.name)
              resolve()
            } catch (error) {
              reject(error)
            }
          })
        })
        request.once("error", reject)
      })
      request.write('{"rea')
      await Promise.race([responseComplete, new Promise((_, reject) => setTimeout(() => reject(new Error(`${scenario.name} response timeout`)), 2000))])
      await Promise.race([socketClosed, new Promise((_, reject) => setTimeout(() => reject(new Error(`${scenario.name} socket was not retired`)), 1500))])
      assert.equal(ownerCalls, 0, scenario.name)
    } finally {
      request?.destroy()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

test("personal Skill lifecycle generated Connect transport preserves commands and rejects root or nested unknown ACK fields", async () => {
  const { create } = await import("@bufbuild/protobuf")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { createServer } = await import("node:http")
  const { CatalogConnectClient } = await import("../dist/infrastructure/clients/platform/catalog-connect.js")
  const {
    CreateSkillVersionResponseSchema,
    SkillCatalogService,
    SkillIdSchema,
    SkillSeriesIdSchema,
    SkillSourceRefSchema,
    SkillStatus,
    WithdrawSkillResponseSchema,
  } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const unknown = () => [{ no: 99, wireType: 0, data: Uint8Array.of(1) }]
  const ownerCalls = []
  const owner = createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(SkillCatalogService, {
          createSkillVersion(request, context) {
            context.responseHeader.set("x-kokoro-request-id", request.requestId)
            context.responseHeader.set("cache-control", "no-store")
            ownerCalls.push({ method: "create", request })
            assert.equal(context.requestHeader.get("x-kokoro-request-id"), request.requestId)
            assert.equal(Object.hasOwn(request, "expectedStateVersion"), false)
            assert.equal(context.requestHeader.get("authorization"), "Bearer catalog-machine")
            assert.equal(context.requestHeader.get("x-tenant-ref"), "tenant-personal")
            assert.equal(request.ownerScope?.kind, "user")
            assert.equal(request.ownerScope?.id, "user-personal")
            assert.equal(request.productContext?.subjectId, "user-personal")
            assert.equal(request.productContext?.ownerScope?.id, "user-personal")
            assert.deepEqual(JSON.parse(Buffer.from(request.metadata?.metadataJson ?? []).toString("utf8")), {})
            const result = create(CreateSkillVersionResponseSchema, {
              stateVersion: 1n,
              skillId: create(SkillIdSchema, { value: "skill-new" }),
              seriesId: create(SkillSeriesIdSchema, { value: "series-1" }),
              revision: 2n,
              status: SkillStatus.DRAFT,
              replayed: false,
            })
            if (request.metadata?.displayName === "root unknown") result.$unknown = unknown()
            if (request.metadata?.displayName === "skill unknown") result.skillId.$unknown = unknown()
            if (request.metadata?.displayName === "series unknown") result.seriesId.$unknown = unknown()
            return result
          },
          withdrawSkill(request, context) {
            context.responseHeader.set("x-kokoro-request-id", request.requestId)
            context.responseHeader.set("cache-control", "no-store")
            ownerCalls.push({ method: "withdraw", request })
            assert.equal(context.requestHeader.get("x-kokoro-request-id"), request.requestId)
            assert.equal(request.expectedStateVersion, 8n)
            assert.equal(context.requestHeader.get("authorization"), "Bearer catalog-machine")
            assert.equal(context.requestHeader.get("x-tenant-ref"), "tenant-personal")
            assert.equal(request.productContext?.subjectId, "user-personal")
            assert.equal(request.productContext?.ownerScope?.id, "user-personal")
            const result = create(WithdrawSkillResponseSchema, {
              stateVersion: 1n,
              sourceRef: create(SkillSourceRefSchema, {
                value: "skill:skill-base",
              }),
              status: SkillStatus.WITHDRAWN,
              eventId: `evt:${"a".repeat(64)}`,
              replayed: false,
            })
            if (request.reason === "root unknown") result.$unknown = unknown()
            if (request.reason === "source unknown") result.sourceRef.$unknown = unknown()
            return result
          },
        })
      },
    }),
  )
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  try {
    const client = new CatalogConnectClient(`http://127.0.0.1:${owner.address().port}`, { get: async () => "catalog-machine" }, 1000)
    await withServer(client, async (origin) => {
      const createResponse = await post(origin, "/v1/self/skills/skill-base/versions", {
        display_name: "Published name",
        summary: "Next version",
        tags: ["managed"],
      })
      assert.equal(createResponse.status, 201)
      const withdrawResponse = await post(origin, "/v1/self/skills/skill-base/withdraw", { expected_state_version: "8", reason: "Superseded" })
      assert.equal(withdrawResponse.status, 200)

      for (const displayName of ["root unknown", "skill unknown", "series unknown"]) {
        const response = await post(origin, "/v1/self/skills/skill-base/versions", { display_name: displayName, summary: "", tags: [] })
        assert.equal(response.status, 502, displayName)
        assert.equal((await response.json()).error.code, "skill_response_invalid", displayName)
      }
      for (const reason of ["root unknown", "source unknown"]) {
        const response = await post(origin, "/v1/self/skills/skill-base/withdraw", { expected_state_version: "8", reason })
        assert.equal(response.status, 502, reason)
        assert.equal((await response.json()).error.code, "skill_response_invalid", reason)
      }
    })
    assert.equal(ownerCalls.length, 7)
    for (const { request } of ownerCalls) {
      assert.match(request.requestId, /^[A-Za-z0-9._:-]+$/u)
      assert.match(request.command?.commandId ?? "", /^bff\.skill\.(?:create_version|withdraw)\.v1\.[a-f0-9]{64}$/u)
      assert.match(request.command?.requestDigest ?? "", /^[a-f0-9]{64}$/u)
    }
    assert.equal(ownerCalls.filter(({ method }) => method === "create").length, 4)
    assert.equal(ownerCalls.filter(({ method }) => method === "withdraw").length, 3)
  } finally {
    await new Promise((resolve) => owner.close(resolve))
  }
})

test("personal Skill lifecycle command digest projections retain the formal owner 3.0 golden vectors", async () => {
  const { projectCreatePersonalSkillVersion } = await import("../dist/infrastructure/clients/platform/create-personal-skill-version-projector.js")
  const { projectWithdrawPersonalSkill } = await import("../dist/infrastructure/clients/platform/withdraw-personal-skill-projector.js")
  const vectors = [
    {
      project: projectCreatePersonalSkillVersion,
      rawBase64:
        "eyJjb21tYW5kX2RpZ2VzdF92ZXJzaW9uIjoiMy4wLjAiLCJmcV9tZXRob2QiOiJrb2tvcm8ucGxhdGZvcm0udjEuU2tpbGxDYXRhbG9nU2VydmljZS9DcmVhdGVTa2lsbFZlcnNpb24iLCJ0ZW5hbnRfcmVmIjoidGVuYW50LTEiLCJyZXF1ZXN0Ijp7Im93bmVyX3Njb3BlIjp7ImtpbmQiOiJ1c2VyIiwiaWQiOiJ1c2VyLTEifSwicHJvZHVjdF9jb250ZXh0Ijp7InN1YmplY3RfaWQiOiJ1c2VyLTEiLCJvd25lcl9zY29wZSI6eyJraW5kIjoidXNlciIsImlkIjoidXNlci0xIn19LCJiYXNlX3NraWxsX2lkIjp7InZhbHVlIjoiaWQtMSJ9LCJtZXRhZGF0YSI6eyJkaXNwbGF5X25hbWUiOiJleGFtcGxlIiwic3VtbWFyeSI6ImV4YW1wbGUiLCJ0YWdzIjpbInNlY29uZCIsImZpcnN0Il0sIm1ldGFkYXRhX2pzb24iOiJlMzAifX19",
      hash: "a468637850921b3942b073337435701e4ea8e439a79851be58e7d6b36ab6a902",
    },
    {
      project: projectWithdrawPersonalSkill,
      rawBase64:
        "eyJjb21tYW5kX2RpZ2VzdF92ZXJzaW9uIjoiMy4wLjAiLCJmcV9tZXRob2QiOiJrb2tvcm8ucGxhdGZvcm0udjEuU2tpbGxDYXRhbG9nU2VydmljZS9XaXRoZHJhd1NraWxsIiwidGVuYW50X3JlZiI6InRlbmFudC0xIiwicmVxdWVzdCI6eyJzb3VyY2VfcmVmIjp7InZhbHVlIjoic2tpbGw6c2tpbGwtMSJ9LCJwcm9kdWN0X2NvbnRleHQiOnsic3ViamVjdF9pZCI6InVzZXItMSIsIm93bmVyX3Njb3BlIjp7ImtpbmQiOiJ1c2VyIiwiaWQiOiJ1c2VyLTEifX0sInJlYXNvbiI6ImV4YW1wbGUifX0=",
      hash: "aefba7d538e4f4427ee01298313a687055b55e413372ff6624a99810e43d64c6",
    },
  ]
  for (const vector of vectors) {
    const projected = vector.project(Buffer.from(vector.rawBase64, "base64"), true)
    assert.equal(projected.sha256, vector.hash)
  }
})

test("version HTTP rejects bad examples without owner dispatch and binds empty/order distinctly", async () => {
  const calls = []
  await withServer(
    {
      createPersonalVersion: async (input) => {
        calls.push(input)
        return versionResult()
      },
    },
    async (origin) => {
      for (const prompts of [null, {}, ["tail\ud800"], ["\u0000"], [...Array.from({ length: 8 }, () => "é".repeat(1000)), "é".repeat(192) + "a"]]) {
        const response = await post(origin, "/v1/self/skills/skill-base/versions", { display_name: "Tea", summary: "", tags: [], example_prompts: prompts })
        assert.equal(response.status, 400)
        assert.equal(calls.length, 0)
      }
      for (const prompts of [undefined, [], ["a", "b"], ["b", "a"]]) {
        const response = await post(origin, "/v1/self/skills/skill-base/versions", {
          display_name: "Tea",
          summary: "",
          tags: [],
          ...(prompts === undefined ? {} : { example_prompts: prompts }),
        })
        assert.equal(response.status, 201)
      }
    },
  )
  assert.equal(new Set(calls.map((c) => c.digest)).size, 4)
  assert.equal(Object.hasOwn(calls[0], "examplePrompts"), false)
})

test("P4 owned Skills production HTTP forwards literal Unicode query and owner cursor", async (t) => {
  const { PlatformProjectionHttpClient } = await import("../dist/infrastructure/clients/platform/projection-http.js")
  const calls = []
  t.mock.method(PlatformProjectionHttpClient.prototype, "readManagedPersonalSkill", async (_operation, _tenant, _subject, _request, input) => {
    calls.push(input.query)
    return { ok: true, status: 200, data: { skills: [], next_cursor: "owner_cursor" } }
  })
  const server = createLiveTestBffServer(
    {
      ...config,
      iamBaseUrl: "http://iam.test",
      platformProjection: { baseUrl: "http://platform.test", credentialFile: "/unused-token-fixture", timeoutMs: 1000 },
    },
    { sessionAdmission: admission, skillAuthorization: { check: async () => ({ ok: true }) } },
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const headers = { ...baseHeaders }
    delete headers["content-type"]
    delete headers["idempotency-key"]
    for (const query of ["%_\\😀 exact", "😀".repeat(1024)]) {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/v1/self/skills?${new URLSearchParams({ query: "  " + query + "  ", source_kind: "personal", cursor: "owner_cursor", limit: "1" })}`,
        { headers },
      )
      assert.equal(response.status, 200)
      assert.equal(calls.at(-1).query, query)
      assert.equal(calls.at(-1).cursor, "owner_cursor")
      assert.equal(calls.at(-1).source_kind, "personal")
    }
    for (const suffix of ["query=", "query=%20", "query=x&query=y", "query=" + "x".repeat(1025), "source_kind=all&query=x"])
      assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/v1/self/skills?${suffix}`, { headers })).status, 400)
    assert.equal(calls.length, 2)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("Public11 registered CreateVersion rejects unsupported CAS before owner I/O", async () => {
  let calls = 0
  await withServer(
    {
      createPersonalVersion: async () => {
        calls++
        return versionResult()
      },
    },
    async (origin) => {
      for (const cas of ["8", null]) {
        const response = await post(origin, "/v1/self/skills/skill-base/versions", { display_name: "Name", summary: "", tags: [], expected_state_version: cas })
        assert.equal(response.status, 400)
        assert.equal((await response.json()).error.code, "invalid_skill_request")
      }
    },
  )
  assert.equal(calls, 0)
})

test("Public11 registered Withdraw requires actual CAS before owner I/O", async () => {
  let calls = 0
  await withServer(
    {
      withdrawPersonal: async () => {
        calls++
        return withdrawResult()
      },
    },
    async (origin) => {
      for (const body of [{ reason: "Valid" }, { reason: "Valid", expected_state_version: null }]) {
        const response = await post(origin, "/v1/self/skills/skill-base/withdraw", body)
        assert.equal(response.status, 400)
        assert.equal((await response.json()).error.code, "invalid_skill_request")
      }
    },
  )
  assert.equal(calls, 0)
})
