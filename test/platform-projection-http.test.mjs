import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { ProjectionTokenSource } from "../dist/infrastructure/clients/platform/projection-token.js"
import { PlatformProjectionHttpClient } from "../dist/infrastructure/clients/platform/projection-http.js"
test("projection client sends tenant/subject bearer and rejects missing no-store", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "projection-")),
    file = path.join(dir, "c.json")
  await writeFile(
    file,
    JSON.stringify([
      {
        tenantId: "t",
        generation: 1,
        credentialRefVersion: "v",
        clientId: "id",
        clientSecret: "s",
        resource: "https://kokoro.dev/resources/platform-internal",
        scope: "platform:projection.read",
      },
    ]),
  )
  await chmod(file, 0o600)
  const original = globalThis.fetch
  let ownerHeaders
  globalThis.fetch = async (input, init) =>
    String(input).includes("/iam/oauth2/token")
      ? new Response(JSON.stringify({ access_token: "token", token_type: "Bearer", scope: "platform:projection.read", expires_in: 60 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : ((ownerHeaders = new Headers(input instanceof Request ? input.headers : init.headers)),
        new Response(JSON.stringify({ data: { skills: [] } }), { status: 200, headers: { "content-type": "application/json", "x-kokoro-request-id": "r" } }))
  try {
    const result = await new PlatformProjectionHttpClient("http://platform.test", "http://iam.test", file).read("skills", "t", "u", "r")
    assert.deepEqual(result, { ok: false, status: 502, code: "skill_response_invalid", retryable: false })
    assert.equal(ownerHeaders.get("authorization"), "Bearer token")
    assert.equal(ownerHeaders.get("x-kokoro-subject"), "u")
  } finally {
    globalThis.fetch = original
    await rm(dir, { recursive: true, force: true })
  }
})

test("projection client rejects an oversized stream before full buffering", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "projection-"))
  const file = path.join(dir, "c.json")
  await writeFile(
    file,
    JSON.stringify([
      {
        tenantId: "t",
        generation: 1,
        credentialRefVersion: "v",
        clientId: "id",
        clientSecret: "s",
        resource: "https://kokoro.dev/resources/platform-internal",
        scope: "platform:projection.read",
      },
    ]),
  )
  await chmod(file, 0o600)
  const original = globalThis.fetch
  let cancelled = false
  let pulls = 0
  globalThis.fetch = async (input) => {
    if (String(input).includes("/iam/oauth2/token"))
      return new Response(JSON.stringify({ access_token: "token", token_type: "Bearer", scope: "platform:projection.read", expires_in: 60 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    const body = new ReadableStream({
      pull(controller) {
        pulls += 1
        if (pulls <= 2) controller.enqueue(new Uint8Array(16))
        else controller.close()
      },
      cancel() {
        cancelled = true
      },
    })
    return new Response(body, { status: 200, headers: { "content-type": "application/json", "x-kokoro-request-id": "r", "cache-control": "no-store" } })
  }
  try {
    const result = await new PlatformProjectionHttpClient("http://platform.test", "http://iam.test", file, 5000, 8).read("skills", "t", "u", "r")
    assert.deepEqual(result, { ok: false, status: 502, code: "skill_response_invalid", retryable: false })
    assert.equal(cancelled, true)
    assert.ok(pulls <= 2)
  } finally {
    globalThis.fetch = original
    await rm(dir, { recursive: true, force: true })
  }
})

async function withProjectionOwner(ownerFetch, run, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "projection-"))
  const file = path.join(dir, "c.json")
  await writeFile(
    file,
    JSON.stringify([
      {
        tenantId: "t",
        generation: 1,
        credentialRefVersion: "v",
        clientId: "id",
        clientSecret: "s",
        resource: "https://kokoro.dev/resources/platform-internal",
        scope: "platform:projection.read",
      },
    ]),
  )
  await chmod(file, 0o600)
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) =>
    String(input).includes("/iam/oauth2/token")
      ? options.tokenFetch
        ? options.tokenFetch(input, init)
        : new Response(JSON.stringify({ access_token: "token", token_type: "Bearer", scope: "platform:projection.read", expires_in: 60 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      : ownerFetch(input, init)
  try {
    return await run(
      new PlatformProjectionHttpClient("http://platform.test", "http://iam.test", file, options.timeoutMs ?? 5000, options.maxBytes ?? 1024 * 1024),
    )
  } finally {
    globalThis.fetch = original
    await rm(dir, { recursive: true, force: true })
  }
}

const ownerHeaders = { "content-type": "application/json", "x-kokoro-request-id": "r", "cache-control": "no-store" }

test("projection client does not leak owner auth/error codes to Product API", async () => {
  for (const [ownerStatus, ownerCode, publicStatus, publicCode] of [
    [404, "capability.route_not_found", 404, "skill_not_found"],
    [401, "capability.service_auth_failed", 503, "skill_dependency_unavailable"],
    [403, "capability.tenant_mismatch", 503, "skill_dependency_unavailable"],
    [429, "capability.rate_limited", 502, "skill_response_invalid"],
  ]) {
    const result = await withProjectionOwner(
      async () =>
        new Response(JSON.stringify({ error: { code: ownerCode, message: "internal", retryable: false } }), { status: ownerStatus, headers: ownerHeaders }),
      (client) => client.read("skill", "t", "u", "r", { skillId: "skill-one" }),
    )
    assert.equal(result.status, publicStatus)
    assert.equal(result.code, publicCode)
  }
  const network = await withProjectionOwner(
    async () => {
      throw new Error("network down")
    },
    (client) => client.read("skill", "t", "u", "r", { skillId: "skill-one" }),
  )
  assert.deepEqual(network, { ok: false, status: 503, code: "skill_dependency_unavailable", retryable: true })
})

test("projection by-ID response must bind requested identity and exact public fields", async () => {
  const base = {
    skill_id: "skill-one",
    source_ref: "skill:skill-one",
    revision: "1",
    status: "active",
    name: "Name",
    summary: "Summary",
    tags: [],
    skill_updated_at: "2026-10-08T12:34:56.123456789Z",
  }
  for (const data of [
    { ...base, skill_id: "skill-other" },
    { ...base, source_ref: "skill:skill-other" },
    { ...base, status: "draft" },
    { ...base, package_asset_ref: "private" },
  ]) {
    const result = await withProjectionOwner(
      async () => new Response(JSON.stringify({ data }), { status: 200, headers: ownerHeaders }),
      (client) => client.read("skill", "t", "u", "r", { skillId: "skill-one" }),
    )
    assert.deepEqual(result, { ok: false, status: 502, code: "skill_response_invalid", retryable: false })
  }
})

test("R345 all three HTTP Skill shapes require one closed UTC Z update instant and preserve nanoseconds", async () => {
  const instant = "2026-10-08T12:34:56.123456789Z"
  const visible = {
    source_ref: "skill:skill-one",
    name: "Name",
    description: "Summary",
    content_hash: "hash",
    scope: "personal",
    revision: "1",
    enabled: true,
    categories: [],
    skill_updated_at: instant,
  }
  const published = {
    skill_id: "skill-one",
    source_ref: "skill:skill-one",
    revision: "1",
    status: "active",
    name: "Name",
    summary: "Summary",
    tags: [],
    skill_updated_at: instant,
  }
  const managed = {
    skill_id: "skill-one",
    source_ref: "skill:skill-one",
    series_id: "series-one",
    revision: "1",
    name: "Name",
    summary: "Summary",
    tags: [],
    status: "active",
    skill_updated_at: instant,
  }
  const cases = [
    {
      label: "visible Skill",
      value: visible,
      response: (value) => ({ data: { skills: [value] } }),
      read: (client) => client.read("skills", "t", "u", "r"),
      expected: { ok: true, status: 200, data: { skills: [visible] } },
      invalid: { ok: false, status: 502, code: "skill_response_invalid", retryable: false },
    },
    {
      label: "published personal Skill",
      value: published,
      response: (value) => ({ data: value }),
      read: (client) => client.read("skill", "t", "u", "r", { skillId: "skill-one" }),
      expected: { ok: true, status: 200, data: published },
      invalid: { ok: false, status: 502, code: "skill_response_invalid", retryable: false },
    },
    {
      label: "managed personal Skill",
      value: managed,
      response: (value) => ({ data: value }),
      read: (client) =>
        client.readManagedPersonalSkill("managedSkill", "t", "u", "r", { skillId: "skill-one" }, new AbortController().signal, performance.now() + 5000),
      expected: { ok: true, status: 200, data: managed },
      invalid: { ok: false, status: 502, code: "skill_response_invalid" },
    },
  ]
  for (const profile of cases) {
    const valid = await withProjectionOwner(
      async () => new Response(JSON.stringify(profile.response(profile.value)), { status: 200, headers: ownerHeaders }),
      profile.read,
    )
    assert.deepEqual(valid, profile.expected, `${profile.label} preserves the exact owner instant`)
    for (const [label, mutate] of [
      ["missing", (value) => delete value.skill_updated_at],
      ["extra", (value) => (value.unreviewed = true)],
      ["invalid", (value) => (value.skill_updated_at = "not-an-instant")],
      ["non-Z", (value) => (value.skill_updated_at = "2026-10-08T12:34:56+00:00")],
    ]) {
      const changed = structuredClone(profile.value)
      mutate(changed)
      const result = await withProjectionOwner(
        async () => new Response(JSON.stringify(profile.response(changed)), { status: 200, headers: ownerHeaders }),
        profile.read,
      )
      assert.deepEqual(result, profile.invalid, `${profile.label} rejects ${label} field drift`)
    }
  }
})

test("projection oversized Content-Length returns without waiting for a stuck cancel", async () => {
  const stream = new ReadableStream({ cancel: () => new Promise(() => undefined) })
  const outcome = await Promise.race([
    withProjectionOwner(
      async () => new Response(stream, { status: 200, headers: { ...ownerHeaders, "content-length": "9999999" } }),
      (client) => client.read("skills", "t", "u", "r"),
    ),
    new Promise((resolve) => setTimeout(() => resolve("timed_out"), 200)),
  ])
  assert.deepEqual(outcome, { ok: false, status: 502, code: "skill_response_invalid", retryable: false })
})

test("projection streamed overflow returns without waiting for a stuck reader cancel", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 + 1))
    },
    cancel: () => new Promise(() => undefined),
  })
  const outcome = await Promise.race([
    withProjectionOwner(
      async () => new Response(stream, { status: 200, headers: ownerHeaders }),
      (client) => client.read("skills", "t", "u", "r"),
    ),
    new Promise((resolve) => setTimeout(() => resolve("timed_out"), 200)),
  ])
  assert.deepEqual(outcome, { ok: false, status: 502, code: "skill_response_invalid", retryable: false })
})

test("R257 self MCP connections client reads six-field current-person projection from the connection endpoint", async () => {
  const connection = {
    connection_id: "connection-one",
    connector_id: "connector-one",
    server_id: "server-one",
    provider_key: "provider-one",
    transport: "streamable_http",
    status: "active",
  }
  const query = { provider_key: "provider-one", limit: 1, cursor: "opaque-current-page" }
  const data = { connections: [connection], next_cursor: "opaque-next-page" }
  const requests = []
  const result = await withProjectionOwner(
    async (input, init) => {
      requests.push(input instanceof Request ? input : new Request(input, init))
      return new Response(JSON.stringify({ data }), { status: 200, headers: ownerHeaders })
    },
    (client) => client.read("mcpConnections", "t", "u", "r", { query }),
  )
  assert.equal(requests.length, 1, "one owner read without fallback or retry")
  const request = requests[0]
  assert.equal(request.method, "GET")
  assert.equal(request.headers.get("authorization"), "Bearer token")
  assert.equal(request.headers.get("x-kokoro-tenant-id"), "t")
  assert.equal(request.headers.get("x-kokoro-subject"), "u")
  assert.equal(request.headers.get("x-kokoro-request-id"), "r")
  const url = new URL(request.url)
  assert.equal(url.origin, "http://platform.test")
  assert.equal(url.pathname, "/v1/mcp/connections", "self Connection must not use a Skill or global Server endpoint")
  assert.deepEqual(
    [...url.searchParams].sort(),
    Object.entries(query)
      .map(([key, value]) => [key, String(value)])
      .sort(),
  )
  assert.deepEqual(result, { ok: true, status: 200, data })
})

const connectionRow = {
  connection_id: "connection-one",
  connector_id: "connector-one",
  server_id: "server-one",
  provider_key: "provider",
  transport: "streamable_http",
  status: "active",
}
const connectionInvalid = { ok: false, status: 502, code: "mcp_connection_response_invalid", retryable: false }
const connectionUnavailable = { ok: false, status: 503, code: "mcp_connection_dependency_unavailable", retryable: true }

test("R257 self connections reject malformed owner shape, media, identity headers and transport fields", async () => {
  const valid = { data: { connections: [connectionRow] } }
  for (const body of [
    { data: { servers: [] } },
    { ...valid, meta: {} },
    { data: { ...valid.data, private: "secret" } },
    { data: { connections: [{ ...connectionRow, server_identity: "internal" }] } },
    { data: { connections: [{ ...connectionRow, connection_id: undefined }] } },
    { data: { connections: [{ ...connectionRow, status: "registered" }] } },
    { data: { connections: [{ ...connectionRow, transport: "stdio" }] } },
    { data: { connections: [{ ...connectionRow, connector_id: "bad/id" }] } },
    { data: { connections: [], next_cursor: null } },
    { data: { connections: [], next_cursor: "" } },
  ]) {
    const result = await withProjectionOwner(
      async () => new Response(JSON.stringify(body), { status: 200, headers: ownerHeaders }),
      (client) => client.read("mcpConnections", "t", "u", "r"),
    )
    assert.deepEqual(result, connectionInvalid)
  }
  for (const headers of [
    { ...ownerHeaders, "content-type": "text/plain" },
    { ...ownerHeaders, "content-type": "application/json-bad" },
    { ...ownerHeaders, "x-kokoro-request-id": "different" },
    { ...ownerHeaders, "cache-control": "public" },
    { "content-type": "application/json", "x-kokoro-request-id": "r" },
  ]) {
    const result = await withProjectionOwner(
      async () => new Response(JSON.stringify(valid), { status: 200, headers }),
      (client) => client.read("mcpConnections", "t", "u", "r"),
    )
    assert.deepEqual(result, connectionInvalid)
  }
  for (const body of ["{invalid", new Uint8Array([123, 34, 255, 34, 58, 49, 125])]) {
    const result = await withProjectionOwner(
      async () => new Response(body, { status: 200, headers: ownerHeaders }),
      (client) => client.read("mcpConnections", "t", "u", "r"),
    )
    assert.deepEqual(result, connectionInvalid)
  }
})

test("R257 self connections enforce owner status-code-retryable pairs and safe failures", async () => {
  for (const [status, code, retryable, expected] of [
    [400, "capability.invalid_request", false, { ok: false, status: 400, code: "invalid_query_parameter", retryable: false }],
    [401, "capability.service_auth_failed", false, connectionUnavailable],
    [403, "capability.permission_denied", false, connectionUnavailable],
    [403, "capability.tenant_mismatch", false, connectionUnavailable],
    [500, "capability.internal_error", false, connectionUnavailable],
    [503, "capability.dependencies_unavailable", true, connectionUnavailable],
    [400, "capability.invalid_request", true, connectionInvalid],
    [403, "capability.invalid_request", false, connectionInvalid],
    [503, "capability.dependencies_unavailable", false, connectionInvalid],
    [404, "capability.route_not_found", false, connectionInvalid],
    [429, "capability.rate_limited", false, connectionInvalid],
    [302, "capability.invalid_request", false, connectionInvalid],
  ]) {
    const result = await withProjectionOwner(
      async (input) => {
        assert.equal(input.redirect, "error")
        return new Response(JSON.stringify({ error: { code, message: "internal secret", retryable } }), { status, headers: ownerHeaders })
      },
      (client) => client.read("mcpConnections", "t", "u", "r"),
    )
    assert.deepEqual(result, expected, status + " " + code)
  }
  const network = await withProjectionOwner(
    async () => {
      throw new Error("private network detail")
    },
    (client) => client.read("mcpConnections", "t", "u", "r"),
  )
  assert.deepEqual(network, connectionUnavailable)
})

test("R257 self connections bound token plus owner body by one total deadline", async () => {
  let ownerSignal
  let cancelled = false
  let calls = 0
  const started = performance.now()
  const result = await withProjectionOwner(
    async (input) => {
      calls += 1
      ownerSignal = input.signal
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true
          },
        }),
        { status: 200, headers: ownerHeaders },
      )
    },
    (client) => client.read("mcpConnections", "t", "u", "r"),
    {
      timeoutMs: 200,
      tokenFetch: async () => {
        await new Promise((resolve) => setTimeout(resolve, 120))
        return new Response(JSON.stringify({ access_token: "token", token_type: "Bearer", scope: "platform:projection.read", expires_in: 60 }), {
          headers: { "content-type": "application/json" },
        })
      },
    },
  )
  assert.deepEqual(result, connectionUnavailable)
  assert.equal(calls, 1)
  assert.equal(ownerSignal.aborted, true)
  assert.equal(cancelled, true)
  assert.ok(performance.now() - started < 300, "token wait must not reset the owner deadline")
})

test("R257 self connections retire late token and owner headers after caller cancellation", async () => {
  for (const phase of ["token", "owner"]) {
    let release
    let entered
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const reached = new Promise((resolve) => {
      entered = resolve
    })
    const controller = new AbortController()
    let ownerCalls = 0
    let cancelled = false
    await withProjectionOwner(
      async () => {
        ownerCalls += 1
        entered()
        await gate
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true
            },
          }),
          { status: 200, headers: ownerHeaders },
        )
      },
      async (client) => {
        const pending = client.read("mcpConnections", "t", "u", "r", {}, controller.signal)
        await reached
        controller.abort()
        assert.deepEqual(await pending, connectionUnavailable)
        release()
        await new Promise((resolve) => setTimeout(resolve, 0))
        assert.equal(ownerCalls, phase === "token" ? 0 : 1)
        if (phase === "owner") assert.equal(cancelled, true)
      },
      phase === "token"
        ? {
            tokenFetch: async () => {
              entered()
              await gate
              return new Response(JSON.stringify({ access_token: "token", token_type: "Bearer", scope: "platform:projection.read", expires_in: 60 }), {
                headers: { "content-type": "application/json" },
              })
            },
          }
        : {},
    )
  }
})

test("R257 self connections retain strict body caps and nonblocking cancellation", async () => {
  for (const declared of [true, false]) {
    let cancelled = false
    const result = await withProjectionOwner(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(33))
            },
            cancel() {
              cancelled = true
              return new Promise(() => undefined)
            },
          }),
          { status: 200, headers: { ...ownerHeaders, ...(declared ? { "content-length": "33" } : {}) } },
        ),
      (client) => client.read("mcpConnections", "t", "u", "r"),
      { timeoutMs: 200, maxBytes: 32 },
    )
    assert.deepEqual(result, connectionInvalid)
    assert.equal(cancelled, true)
  }
})

test("R257 cancelled credential wait never starts token HTTP after its late resolution", async () => {
  let release
  let entered
  const pendingCredential = new Promise((resolve) => {
    release = resolve
  })
  const credentialStarted = new Promise((resolve) => {
    entered = resolve
  })
  const credentials = {
    async read() {
      entered()
      return pendingCredential
    },
  }
  const controller = new AbortController()
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error("unexpected late token HTTP")
  }
  try {
    const tokens = new ProjectionTokenSource("http://iam.test", credentials, 1000)
    const pending = tokens.get("t", controller.signal)
    const rejected = assert.rejects(pending, { name: "AbortError" })
    await credentialStarted
    controller.abort()
    release({
      cacheKey: "test",
      clientId: "id",
      clientSecret: "s",
      resource: "https://kokoro.dev/resources/platform-internal",
      scope: "platform:projection.read",
    })
    await rejected
    assert.equal(calls, 0)
    await assert.rejects(tokens.get("t", controller.signal), { name: "AbortError" })
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("R257 self connections expire during token HTTP without opening an owner read", async () => {
  let tokenSignal
  let ownerCalls = 0
  const result = await withProjectionOwner(
    async () => {
      ownerCalls += 1
      throw new Error("unexpected owner")
    },
    (client) => client.read("mcpConnections", "t", "u", "r"),
    {
      timeoutMs: 40,
      tokenFetch: async (_input, init) => {
        tokenSignal = init.signal
        return new Promise((_resolve, reject) => {
          tokenSignal.addEventListener("abort", () => reject(tokenSignal.reason), { once: true })
        })
      },
    },
  )
  assert.deepEqual(result, connectionUnavailable)
  assert.equal(tokenSignal.aborted, true)
  assert.equal(ownerCalls, 0)
})

test("R257 self connection response provider and cursor bounds count Unicode code points", async () => {
  for (const [providerLength, cursorLength, expected] of [
    [191, 2048, true],
    [192, 2048, false],
    [191, 2049, false],
  ]) {
    const data = { connections: [{ ...connectionRow, provider_key: "😀".repeat(providerLength) }], next_cursor: "😀".repeat(cursorLength) }
    const result = await withProjectionOwner(
      async () => new Response(JSON.stringify({ data }), { status: 200, headers: ownerHeaders }),
      (client) => client.read("mcpConnections", "t", "u", "r"),
    )
    assert.deepEqual(result, expected ? { ok: true, status: 200, data } : connectionInvalid)
  }
})
