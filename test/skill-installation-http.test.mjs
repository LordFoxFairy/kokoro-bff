import { create } from "@bufbuild/protobuf"
import { SkillProductFactsSchema } from "../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import assert from "node:assert/strict"
import { once } from "node:events"
import { request as httpRequest } from "node:http"
import test from "node:test"
import { Code, ConnectError } from "@connectrpc/connect"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { createLiveTestBffServer } from "./doubles/server.ts"
import { SkillInstallationChange } from "../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { projectInstallation, projectInstallationAck, projectInstallationList } from "../dist/infrastructure/clients/platform/skill-installation-response.js"
import { installSkillDigest, removeSkillDigest, setSkillEnabledDigest } from "../dist/infrastructure/clients/platform/skill-installation-projector.js"
import { SkillInstallationConnectClient } from "../dist/infrastructure/clients/platform/skill-installation-connect.js"
const timestamp = (seconds, nanos = 0) => ({
  $typeName: "google.protobuf.Timestamp",
  seconds: BigInt(seconds),
  nanos,
})
const installation = () => ({
  installationId: { value: "i" },
  sourceRef: { value: "skill:one" },
  seriesId: { value: "s" },
  revision: 18446744073709551615n,
  acquisitionKind: 1,
  installed: true,
  enabled: true,
  installedAt: timestamp(1),
  updatedAt: timestamp(2),
  displayName: "Research assistant",
  summary: "",
  tags: [],
  sourceStatus: 2,
  skillUpdatedAt: timestamp(3, 123456789),
  examplePrompts: { prompts: [] },
  categoryKeys: { keys: [] },
  product: create(SkillProductFactsSchema, { publicationAudience: "owner", stateVersion: 1n }),
})
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
  skillDraft: {
    enabled: false,
    platformBaseUrl: null,
    credentialFile: null,
    timeoutMs: 100,
  },
}
const headers = {
  authorization: "Bearer session",
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "secret",
}
async function withServer(client, run, overrides = {}) {
  const server = createLiveTestBffServer(config, {
    skillAuthorization: { check: async () => ({ ok: true }) },
    sessionAdmission: {
      verify: async () => ({
        ok: true,
        identity: { namespace: "tenant", userId: "user-session" },
      }),
    },
    installationClient: client,
    ...overrides,
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
const requestWithBody = (url, method, body, idempotency = false) =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method,
        headers: { ...headers, ...(idempotency ? { "idempotency-key": "k" } : {}), "content-length": String(Buffer.byteLength(body)) },
      },
      resolve,
    )
    request.on("error", reject)
    request.end(body)
  })
test("safe installation ACK maps enum, uint64 and UTC without private fields", () => {
  assert.deepEqual(
    projectInstallationAck({
      installation: installation(),
      change: SkillInstallationChange.INSTALLED,
      eventId: "event-1",
      replayed: false,
    }),
    {
      installation: {
        installation_id: "i",
        source_ref: "skill:one",
        series_id: "s",
        revision: "18446744073709551615",
        installed: true,
        enabled: true,
        installed_at: "1970-01-01T00:00:01.000Z",
        updated_at: "1970-01-01T00:00:02.000Z",
        display_name: "Research assistant",
        summary: "",
        tags: [],
        category_keys: [],
        product: { publication_audience: "owner", state_version: "1" },
        source_status: "active",
        example_prompts: [],
        skill_updated_at: "1970-01-01T00:00:03.123Z",
      },
      change: "installed",
      event_id: "event-1",
      replayed: false,
    },
  )
})
test("response rejects unknown metadata status, unchanged event and invalid page presence", () => {
  assert.throws(() => projectInstallation({ ...installation(), sourceStatus: 1 }))
  assert.throws(() => projectInstallation({ ...installation(), displayName: "   " }))
  assert.throws(() => projectInstallation({ ...installation(), displayName: "x".repeat(256) }))
  assert.throws(() => projectInstallation({ ...installation(), summary: "x".repeat(65_536) }))
  assert.equal(projectInstallation({ ...installation(), summary: "" }).summary, "")
  assert.throws(() =>
    projectInstallationAck({
      installation: installation(),
      change: 0,
      eventId: "e",
      replayed: false,
    }),
  )
  assert.throws(() =>
    projectInstallationAck({
      installation: installation(),
      change: SkillInstallationChange.UNCHANGED,
      eventId: "e",
      replayed: true,
    }),
  )
  assert.throws(() =>
    projectInstallationList({
      installations: [installation()],
      page: { nextCursor: "" },
    }),
  )
})
test("R345 installation requires a distinct valid Skill update Timestamp and never substitutes installation time", () => {
  const projected = projectInstallation(installation())
  assert.equal(projected.installed_at, "1970-01-01T00:00:01.000Z")
  assert.equal(projected.updated_at, "1970-01-01T00:00:02.000Z")
  assert.equal(projected.skill_updated_at, "1970-01-01T00:00:03.123Z")
  assert.notEqual(projected.skill_updated_at, projected.updated_at)
  assert.match(projected.skill_updated_at, /Z$/u)
  assert.throws(() => projectInstallation({ ...installation(), skillUpdatedAt: undefined }), /skill_installation_response_invalid/u)
  assert.throws(() => projectInstallation({ ...installation(), skillUpdatedAt: timestamp(3, -1) }), /skill_installation_response_invalid/u)
  assert.throws(() => projectInstallation({ ...installation(), skillUpdatedAt: timestamp(3, 1_000_000_000) }), /skill_installation_response_invalid/u)
})
test("R345 installation rejects protobuf Timestamp seconds outside the canonical range", () => {
  const minimum = timestamp(-62_135_596_800n)
  const maximum = timestamp(253_402_300_799n, 999_999_999)
  const belowMinimum = timestamp(-62_135_596_801n)
  const aboveMaximum = timestamp(253_402_300_800n)
  assert.equal(projectInstallation({ ...installation(), skillUpdatedAt: minimum }).skill_updated_at, "0001-01-01T00:00:00.000Z")
  assert.equal(projectInstallation({ ...installation(), skillUpdatedAt: maximum }).skill_updated_at, "9999-12-31T23:59:59.999Z")
  assert.equal(projectInstallation({ ...installation(), installedAt: minimum, updatedAt: minimum }).installed_at, "0001-01-01T00:00:00.000Z")
  assert.equal(projectInstallation({ ...installation(), installedAt: maximum, updatedAt: maximum }).updated_at, "9999-12-31T23:59:59.999Z")
  assert.throws(() => projectInstallation({ ...installation(), skillUpdatedAt: belowMinimum }), /skill_installation_response_invalid/u)
  assert.throws(() => projectInstallation({ ...installation(), skillUpdatedAt: aboveMaximum }), /skill_installation_response_invalid/u)
  assert.throws(() => projectInstallation({ ...installation(), installedAt: belowMinimum, updatedAt: belowMinimum }), /skill_installation_response_invalid/u)
  assert.throws(() => projectInstallation({ ...installation(), installedAt: aboveMaximum, updatedAt: aboveMaximum }), /skill_installation_response_invalid/u)
})
test("routes reject forbidden query/body/header shapes before the owner", async () => {
  let calls = 0
  const client = new Proxy(
    {},
    {
      get: () => async () => {
        calls++
        return {}
      },
    },
  )
  await withServer(client, async (base) => {
    const cases = [
      fetch(`${base}/v1/skill-installations?x=1`, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "idempotency-key": "k",
        },
        body: '{"source_ref":"skill:one"}',
      }),
      fetch(`${base}/v1/skill-installations`, {
        method: "GET",
        headers: { ...headers, "idempotency-key": "k" },
      }),
      requestWithBody(`${base}/v1/skill-installations`, "GET", "x"),
      fetch(`${base}/v1/skill-installations/i?x=1`, {
        method: "DELETE",
        headers: { ...headers, "idempotency-key": "k" },
      }),
      fetch(`${base}/v1/skill-installations/i/enabled?x=1`, {
        method: "PUT",
        headers: {
          ...headers,
          "content-type": "application/json",
          "idempotency-key": "k",
        },
        body: '{"enabled":true}',
      }),
    ]
    for (const pending of cases) {
      const response = await pending
      assert.equal(response.status ?? response.statusCode, 400)
      response.resume?.()
    }
  })
  assert.equal(calls, 0)
})
test("every installation operation returns dedicated 413 for its reachable body limit", async () => {
  let calls = 0
  const client = new Proxy(
    {},
    {
      get: () => async () => {
        calls++
        return {}
      },
    },
  )
  await withServer(client, async (base) => {
    const cases = [
      fetch(`${base}/v1/skill-installations`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": "k" },
        body: "x".repeat(65_537),
      }),
      fetch(`${base}/v1/skill-installations/i/enabled`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": "k" },
        body: "x".repeat(65_537),
      }),
      requestWithBody(`${base}/v1/skill-installations`, "GET", "xx"),
      requestWithBody(`${base}/v1/skill-installations/i`, "GET", "xx"),
      requestWithBody(`${base}/v1/skill-installations/i`, "DELETE", "xx", true),
    ]
    for (const pending of cases) {
      const response = await pending
      assert.equal(response.status ?? response.statusCode, 413)
      response.resume?.()
    }
  })
  assert.equal(calls, 0)
})
test("owner permission and deadline errors remain distinct", async () => {
  for (const [code, status] of [
    [Code.PermissionDenied, 403],
    [Code.NotFound, 404],
    [Code.DeadlineExceeded, 504],
  ]) {
    await withServer(
      {
        get: async () => {
          throw new ConnectError("owner", code)
        },
      },
      async (base) => {
        assert.equal((await fetch(`${base}/v1/skill-installations/i`, { headers })).status, status)
      },
    )
  }
})
test("one absolute deadline and caller cancellation cover token acquisition before RPC", async () => {
  let observed
  const blocked = {
    get: async (_tenant, signal) => {
      observed = signal
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
    },
  }
  const client = new SkillInstallationConnectClient("http://127.0.0.1:1", blocked, blocked, 10)
  const keepAlive = setTimeout(() => undefined, 50)
  await assert.rejects(client.get({ requestId: "request-1", tenant: "tenant", subject: "user", installationId: "i" }))
  clearTimeout(keepAlive)
  assert.equal(observed.aborted, true)

  const caller = new AbortController()
  const pending = client.list({ requestId: "request-2", tenant: "tenant", subject: "user" }, caller.signal)
  caller.abort(new Error("caller_cancelled"))
  await assert.rejects(pending, { message: "caller_cancelled" })
})
test("HTTP maps token-stage budget exhaustion to 504 without relabeling caller cancellation", async () => {
  const blocked = {
    get: async (_tenant, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  }
  await withServer(new SkillInstallationConnectClient("http://127.0.0.1:1", blocked, blocked, 10), async (base) => {
    const keepAlive = setTimeout(() => undefined, 50)
    const timeout = await fetch(`${base}/v1/skill-installations/i`, { headers })
    clearTimeout(keepAlive)
    assert.equal(timeout.status, 504)
    assert.equal((await timeout.json()).error.code, "skill_installation_dependency_timeout")
  })

  let tokenAbortReason
  const cancellationBlocked = {
    get: async (_tenant, signal) =>
      new Promise((_, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            tokenAbortReason = signal.reason
            reject(signal.reason)
          },
          { once: true },
        ),
      ),
  }
  await withServer(new SkillInstallationConnectClient("http://127.0.0.1:1", cancellationBlocked, cancellationBlocked, 1_000), async (base) => {
    const caller = new AbortController()
    const pending = fetch(`${base}/v1/skill-installations/i`, { headers, signal: caller.signal })
    caller.abort(new Error("browser_cancelled"))
    await assert.rejects(pending, { message: "browser_cancelled" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.notEqual(tokenAbortReason?.name, "TimeoutError")
  })
})

test("installation examples require present typed message and valid original strings", () => {
  for (const examplePrompts of [undefined, null, { prompts: null }, { prompts: ["\ud800"] }, { prompts: ["\u0000"] }, { prompts: [" "] }, { prompts: [1] }])
    assert.throws(() => projectInstallation({ ...installation(), examplePrompts }), /skill_installation_response_invalid/u)
  for (const prompts of [[], ["  a\n", "same", "same"], ["😀".repeat(1000)]])
    assert.deepEqual(projectInstallation({ ...installation(), examplePrompts: { prompts } }).example_prompts, prompts)
})

test("installation source filter reaches the owner protobuf request with cursor presence", async () => {
  const { createServer } = await import("node:http")
  const { fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const { ListPersonalSkillInstallationsRequestSchema, ListPersonalSkillInstallationsResponseSchema } =
    await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const seen = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    seen.push(fromBinary(ListPersonalSkillInstallationsRequestSchema, Buffer.concat(chunks)))
    response.writeHead(200, { "content-type": "application/proto" })
    response.end(toBinary(ListPersonalSkillInstallationsResponseSchema, create(ListPersonalSkillInstallationsResponseSchema)))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const token = { get: async () => "workload" }
    const client = new SkillInstallationConnectClient(`http://127.0.0.1:${server.address().port}`, token, token, 1000)
    for (const sourceKind of [undefined, "personal", "official", "third_party"]) {
      await client.list({ requestId: "request-source", tenant: "tenant", subject: "user", sourceKind, cursor: "owner-bound-cursor", limit: 1 })
    }
    assert.deepEqual(
      seen.map((input) => input.sourceKind),
      [undefined, "personal", "official", "third_party"],
    )
    for (const input of seen) {
      assert.equal(input.page.cursor, "owner-bound-cursor")
      assert.equal(input.page.limit, 1)
    }
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  await withServer(
    {
      list: async (input) => {
        assert.equal(input.sourceKind, "third_party")
        assert.equal(input.cursor, "owner-bound-cursor")
        return { installations: [] }
      },
    },
    async (base) => {
      const response = await fetch(`${base}/v1/skill-installations?source_kind=third_party&cursor=owner-bound-cursor`, { headers })
      assert.equal(response.status, 200)
    },
  )
})

test("P4 installation HTTP forwards literal query and source filter before owner cursor pagination", async () => {
  const seen = [],
    query = "%_\\😀 exact"
  await withServer(
    {
      list: async (input) => {
        seen.push(input)
        if (input.cursor && input.query !== query) throw new ConnectError("cursor filter mismatch", Code.InvalidArgument)
        return { installations: [], page: { nextCursor: input.cursor ? undefined : "owner_cursor" } }
      },
    },
    async (base) => {
      const page1 = await fetch(
        `${base}/v1/skill-installations?${new URLSearchParams({ query: "  " + query + "  ", source_kind: "third_party", limit: "1" })}`,
        { headers },
      )
      assert.equal(page1.status, 200)
      assert.equal((await page1.json()).meta.next_cursor, "owner_cursor")
      const page2 = await fetch(
        `${base}/v1/skill-installations?${new URLSearchParams({ query, source_kind: "third_party", cursor: "owner_cursor", limit: "1" })}`,
        { headers },
      )
      assert.equal(page2.status, 200)
      assert.equal(seen[0].query, query)
      assert.equal(seen[1].query, query)
      assert.equal(seen[1].cursor, "owner_cursor")
      assert.equal(seen[0].sourceKind, "third_party")
      const changed = await fetch(`${base}/v1/skill-installations?query=other&source_kind=third_party&cursor=owner_cursor`, { headers })
      assert.equal(changed.status, 400)
      assert.equal((await changed.json()).error.code, "invalid_skill_installation_request")
      for (const url of ["?query=", "?query=%20%20", "?query=x&query=y", "?query=" + "x".repeat(1025), "?source_kind=all&query=x"])
        assert.equal((await fetch(`${base}/v1/skill-installations${url}`, { headers })).status, 400)
      assert.equal(seen.length, 3, "invalid filters do not reach owner")
    },
  )
})

test("P4 installation Connect preserves optional query6 and exact source_kind5 protobuf presence", async () => {
  const { createServer } = await import("node:http"),
    { fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const { ListPersonalSkillInstallationsRequestSchema, ListPersonalSkillInstallationsResponseSchema } =
    await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const seen = [],
    server = createServer(async (req, res) => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      seen.push(fromBinary(ListPersonalSkillInstallationsRequestSchema, Buffer.concat(chunks)))
      res.writeHead(200, { "content-type": "application/proto" })
      res.end(toBinary(ListPersonalSkillInstallationsResponseSchema, create(ListPersonalSkillInstallationsResponseSchema)))
    })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const token = { get: async () => "token" },
      client = new SkillInstallationConnectClient(`http://127.0.0.1:${server.address().port}`, token, token, 1000)
    for (const query of [undefined, "%_\\😀 exact"])
      await client.list({ requestId: "query-request", tenant: "tenant", subject: "user", query, sourceKind: "personal", cursor: "opaque_owner", limit: 1 })
    assert.deepEqual(
      seen.map((input) => input.query),
      [undefined, "%_\\😀 exact"],
    )
    assert.deepEqual(
      seen.map((input) => input.sourceKind),
      ["personal", "personal"],
    )
    assert.deepEqual(
      seen.map((input) => input.page.cursor),
      ["opaque_owner", "opaque_owner"],
    )
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("R356 owner query-bound cursor rejection stays a browser invalid request", async () => {
  let calls = 0
  await withServer(
    {
      list: async () => {
        calls++
        throw new ConnectError("private cursor query scope differs", Code.InvalidArgument)
      },
    },
    async (base) => {
      const response = await fetch(`${base}/v1/skill-installations?query=changed&cursor=opaque`, { headers })
      assert.equal(response.status, 400)
      const body = await response.json()
      assert.equal(body.error.code, "invalid_skill_installation_request")
      assert.equal(body.error.retryable, false)
      assert.equal(JSON.stringify(body).includes("private cursor"), false)
    },
  )
  assert.equal(calls, 1)
})

test("explicit update preserves disabled state and original command identity on replay", async () => {
  const seen = [],
    actions = []
  await withServer(
    {
      update: async (input) => {
        seen.push(input)
        return {
          installation: { ...installation(), sourceRef: { value: input.sourceRef }, revision: 2n, enabled: false },
          change: 2,
          eventId: "upgrade-event",
          replayed: seen.length > 1,
        }
      },
    },
    async (base) => {
      for (const replayed of [false, true]) {
        const response = await fetch(`${base}/v1/skill-installations/i/update`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": "same-update" },
          body: JSON.stringify({ expected_source_ref: "skill:one", source_ref: "skill:two" }),
        })
        assert.equal(response.status, 200)
        assert.equal(response.headers.get("cache-control"), "no-store")
        const { data } = await response.json()
        assert.equal(data.installation.enabled, false)
        assert.equal(data.installation.installation_id, "i")
        assert.equal(data.installation.source_ref, "skill:two")
        assert.equal(data.change, "upgraded")
        assert.equal(data.event_id, "upgrade-event")
        assert.equal(data.replayed, replayed)
      }
    },
    {
      skillAuthorization: {
        check: async (input) => {
          actions.push(input.action)
          return { ok: true }
        },
      },
    },
  )
  assert.deepEqual(actions, ["install", "install"])
  assert.equal(seen[0].commandId, seen[1].commandId)
  assert.equal(seen[0].digest, seen[1].digest)
  assert.equal(seen[0].expectedSourceRef, "skill:one")
})

test("explicit update rejects ambiguous input before calling the owner and requires fresh install authorization", async () => {
  let calls = 0,
    allowed = true
  const client = {
    update: async () => {
      calls++
      return { installation: { ...installation(), sourceRef: { value: "skill:two" }, enabled: false }, change: 2, eventId: "upgrade-event", replayed: false }
    },
  }
  await withServer(
    client,
    async (base) => {
      const post = (body, extra = {}) =>
        fetch(`${base}/v1/skill-installations/i/update`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": "k", ...extra },
          body,
        })
      for (const body of [
        "{}",
        '{"expected_source_ref":"skill:one","source_ref":"skill:two","enabled":true}',
        '{"expected_source_ref":"skill:one","source_ref":"skill:two","source_ref":"skill:three"}',
        '{"expected_source_ref":"skill:one","source_ref":"skill:two\\n"}',
        Buffer.from([0xff]),
      ])
        assert.equal((await post(body)).status, 400)
      const body = JSON.stringify({ expected_source_ref: "skill:one", source_ref: "skill:two" })
      assert.equal((await post(body, { "content-type": "text/plain" })).status, 400)
      assert.equal((await post(" ".repeat(65_537))).status, 413)
      assert.equal(calls, 0)
      assert.equal((await post(body)).status, 200)
      allowed = false
      const replay = await post(body)
      assert.equal(replay.status, 403)
      assert.equal((await replay.json()).error.code, "skill_forbidden")
      assert.equal(calls, 1)
    },
    {
      skillAuthorization: {
        check: async (input) => {
          assert.equal(input.action, "install")
          return allowed ? { ok: true } : { ok: false, status: 403, code: "skill_forbidden" }
        },
      },
    },
  )
})

test("update ACK rejects the wrong installation, source, lifecycle, change or unknown owner wire", async () => {
  let mutate = (value) => value
  await withServer(
    {
      update: async () =>
        mutate({
          installation: { ...installation(), sourceRef: { value: "skill:two" }, enabled: false },
          change: 2,
          eventId: "upgrade-event",
          replayed: false,
        }),
    },
    async (base) => {
      for (const change of [
        (v) => ({ ...v, installation: { ...v.installation, installationId: { value: "other" } } }),
        (v) => ({ ...v, installation: { ...v.installation, sourceRef: { value: "skill:one" } } }),
        (v) => ({ ...v, installation: { ...v.installation, installed: false, removedAt: timestamp(2) } }),
        (v) => ({ ...v, change: 1 }),
        (v) => ({ ...v, eventId: undefined }),
        (v) => ({ ...v, $unknown: [{ no: 200, wireType: 0, data: new Uint8Array([1]) }] }),
      ]) {
        mutate = change
        const response = await fetch(`${base}/v1/skill-installations/i/update`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": "k" },
          body: '{"expected_source_ref":"skill:one","source_ref":"skill:two"}',
        })
        assert.equal(response.status, 502)
        assert.equal((await response.json()).error.code, "skill_installation_response_invalid")
      }
    },
  )
})

test("official update Connect wire binds original pins and key; no install/remove dispatch is issued", async () => {
  const { createServer } = await import("node:http"),
    { fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const p = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const seen = [],
    server = createServer(async (req, res) => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      seen.push({ path: req.url, headers: req.headers, input: fromBinary(p.UpdatePersonalSkillInstallationRequestSchema, Buffer.concat(chunks)) })
      if (seen.length > 1 && seen.at(-1).input.command.requestDigest !== seen[0].input.command.requestDigest) {
        res.writeHead(409, { "content-type": "application/json" })
        res.end(JSON.stringify({ code: "already_exists", message: "fixture command conflict" }))
        return
      }
      res.writeHead(200, { "content-type": "application/proto" })
      res.end(
        toBinary(
          p.UpdatePersonalSkillInstallationResponseSchema,
          create(p.UpdatePersonalSkillInstallationResponseSchema, {
            installation: { ...installation(), sourceRef: { value: "skill:two" }, revision: 2n, enabled: false },
            change: 2,
            eventId: "event",
            replayed: seen.length > 1,
          }),
        ),
      )
    })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const client = new SkillInstallationConnectClient(
      `http://127.0.0.1:${server.address().port}`,
      { get: async () => "catalog-workload" },
      {
        get: async () => {
          throw Error("read credential used")
        },
      },
      1000,
    )
    await withServer(client, async (base) => {
      for (const expected of ["skill:one", "skill:one", "skill:other"]) {
        const response = await fetch(`${base}/v1/skill-installations/i/update`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": "original" },
          body: JSON.stringify({ expected_source_ref: expected, source_ref: "skill:two" }),
        })
        assert.equal(response.status, expected === "skill:other" ? 409 : 200)
        if (response.status === 409) assert.equal((await response.json()).error.code, "skill_installation_idempotency_conflict")
      }
    })
    assert.equal(seen.length, 3)
    for (const item of seen) {
      assert.equal(item.path, "/kokoro.platform.v1.ProductSkillInstallationService/UpdatePersonalSkillInstallation")
      assert.equal(item.headers.authorization, "Bearer catalog-workload")
      assert.equal(item.headers["x-kokoro-subject"], "user-session")
      assert.equal(item.input.installationId.value, "i")
      assert.equal(item.input.sourceRef.value, "skill:two")
      assert.equal(item.input.command.commandId, seen[0].input.command.commandId)
    }
    assert.equal(seen[0].input.command.requestDigest, seen[1].input.command.requestDigest)
    assert.notEqual(seen[0].input.command.requestDigest, seen[2].input.command.requestDigest)
    assert.deepEqual(
      seen.map((v) => v.input.expectedSourceRef.value),
      ["skill:one", "skill:one", "skill:other"],
    )
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("public update contract is a closed two-pin command with only upgraded receipts", async () => {
  const { readFile } = await import("node:fs/promises"),
    { load } = await import("js-yaml")
  const doc = load(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"))
  const path = doc.paths["/v1/skill-installations/{installation_id}/update"]
  assert.equal(path.post.operationId, "updatePersonalSkillInstallation")
  assert.equal(path.post["x-kokoro-permission"], "product.skill.install")
  assert.equal(path.post["x-kokoro-idempotency"], "required")
  const schema = path.post.requestBody.content["application/json"].schema
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.required.sort(), ["expected_source_ref", "source_ref"])
  assert.deepEqual(Object.keys(schema.properties).sort(), schema.required)
  for (const field of Object.values(schema.properties)) {
    assert.equal(new RegExp(field.pattern, "u").test("skill:one"), true)
    for (const invalid of ["skill:skill:one", "skill:one\n", "skill:one "]) assert.equal(new RegExp(field.pattern, "u").test(invalid), false)
  }
  const component = doc.components.responses.SkillInstallationUpdateSuccess.content["application/json"].schema
  assert.equal(component.additionalProperties, false)
  const restriction = component.properties.data.allOf[1]
  assert.deepEqual(restriction.required, ["event_id"])
  assert.equal(restriction.properties.change.const, "upgraded")
  assert.equal(restriction.properties.installation.properties.installed.const, true)
  assert.equal(restriction.properties.installation.properties.removed_at, false)
})

test("update body stalled after a partial chunk expires the original request budget with zero owner calls", async () => {
  const { createServer, request } = await import("node:http")
  const { skillInstallationRoute } = await import("../dist/http/routes/skill-installations.js")
  const { startSkillRequestBudget } = await import("../dist/http/routes/skill-drafts.js")
  let calls = 0
  const server = createServer((req, res) => {
    startSkillRequestBudget(req, 50)
    void skillInstallationRoute(
      req,
      res,
      { requestId: "stalled-input", identity: { namespace: "tenant", userId: "user" } },
      ["skill-installations", "i", "update"],
      {
        update: async () => {
          calls++
          throw Error("partial body reached owner")
        },
      },
    ).catch((error) => res.destroy(error))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    await new Promise((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${server.address().port}/v1/skill-installations/i/update`,
        { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "original", "transfer-encoding": "chunked" } },
        (res) => {
          void (async () => {
            try {
              const chunks = []
              for await (const chunk of res) chunks.push(chunk)
              assert.equal(res.statusCode, 504)
              assert.equal(JSON.parse(Buffer.concat(chunks)).error.code, "skill_installation_dependency_timeout")
              assert.equal(res.headers.connection, "close")
              await closed
              resolve()
            } catch (error) {
              reject(error)
            }
          })()
        },
      )
      const closed = once(req, "close")
      req.on("error", reject)
      req.setTimeout(1000, () => req.destroy(Error("partial body outlived its request budget")))
      req.write('{"expected_source_ref":')
    })
    assert.equal(calls, 0)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("Project installation six routes use the current owned project, distinct command binding and exit rechecks", async () => {
  const { createBffServer } = await import("../dist/bootstrap/server.js")
  let selection = [],
    writes = 0,
    commits = 0,
    admitted = true
  const calls = []
  let visible = true
  let wrongResponse = null
  const project = { id: "project-canonical" }
  const client = Object.fromEntries(
    ["install", "update", "setEnabled", "remove", "get", "list"].map((method) => [
      method,
      async (input) => {
        calls.push({ method, input })
        assert.equal(input.projectRef, project.id)
        const view = {
          ...installation(),
          revision: 2n,
          sourceRef: { value: method === "update" ? "skill:b" : "skill:a" },
          ...(method === "remove" ? { installed: false, enabled: false, removedAt: timestamp(2) } : {}),
          ...(method === "setEnabled" ? { enabled: false } : {}),
        }
        if (wrongResponse) return wrongResponse(method, view)
        if (method === "list") return { projectRef: project.id, installations: [view] }
        if (method === "get") return { projectRef: project.id, installation: view }
        return {
          projectRef: project.id,
          installation: view,
          change: { install: 1, update: 2, setEnabled: 5, remove: 6 }[method],
          eventId: "event",
          replayed: false,
        }
      },
    ]),
  )
  const idle = { start() {}, async stop() {} }
  const server = createBffServer(
    { ...config, agentEnabled: true, upstreams: { ...config.upstreams, agents: "http://127.0.0.1:9" } },
    {
      agentDispatchDispatcher: idle,
      agentCancellationDispatcher: idle,
      agUiProjector: idle,
      scheduledTaskDispatcher: idle,
      scheduledAgentDispatcher: idle,
      scheduledAgentTerminalConsumer: idle,
      sessionAdmission: {
        verify: async () =>
          admitted
            ? { ok: true, identity: { namespace: "tenant", userId: "user-session" } }
            : { ok: false, status: 403, code: "permission_denied", message: "Denied" },
      },
      skillAuthorization: { check: async () => ({ ok: true }) },
      installationClient: client,
      businessStore: {
        ready: async () => {},
        getReceipt: async () => null,
        services: {
          chat: {},
          chatTurns: {
            submit: async (_input, resolve) => {
              await resolve(project.id, ["i"])
              commits++
              throw Error("unexpected commit")
            },
          },
          projects: {
            skillSelection: async () => ({ project_id: project.id, installation_ids: [...selection] }),
            replaceSkillSelection: async (_scope, id, ids) => {
              assert.equal(id, project.id)
              writes++
              selection = [...ids]
              return { kind: "replaced", receipt: { data: { project_id: id, installation_ids: [...ids] } } }
            },
            find: async (scope, ref) => {
              assert.deepEqual(scope, { tenantId: "tenant", subjectId: "user-session" })
              return visible && ["project-alias", project.id].includes(ref) ? project : null
            },
          },
        },
      },
      readiness: async () => {},
    },
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const base = `http://127.0.0.1:${server.address().port}/v1/projects/project-alias/skill-installations`
  try {
    for (const [method, suffix, body, expected] of [
      ["POST", "", { source_ref: "skill:a" }, "install"],
      ["GET", "", undefined, "list"],
      ["GET", "/i", undefined, "get"],
      ["PUT", "/i/enabled", { enabled: false }, "setEnabled"],
      ["POST", "/i/update", { expected_source_ref: "skill:a", source_ref: "skill:b" }, "update"],
      ["DELETE", "/i", undefined, "remove"],
    ]) {
      const r = await fetch(base + suffix, {
        method,
        headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}), ...(method !== "GET" ? { "idempotency-key": "project-key" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      assert.equal(r.status, 200, JSON.stringify(await r.clone().json()))
      assert.equal(calls.at(-1).method, expected)
    }
    // A valid response for another resource or operation must never acknowledge this request.
    const invalidResults = [
      ["GET", "/i", undefined, "get", { installationId: { value: "other" } }, undefined],
      ["POST", "", { source_ref: "skill:a" }, "install", { sourceRef: { value: "skill:other" } }, 1],
      ["POST", "", { source_ref: "skill:a" }, "install", {}, 2],
      ["DELETE", "/i", undefined, "remove", { installationId: { value: "other" } }, 6],
      ["DELETE", "/i", undefined, "remove", { installed: true, enabled: true, removedAt: undefined }, 4],
      ["PUT", "/i/enabled", { enabled: false }, "setEnabled", { installationId: { value: "other" } }, 5],
      ["PUT", "/i/enabled", { enabled: false }, "setEnabled", { enabled: true }, 4],
      ["PUT", "/i/enabled", { enabled: false }, "setEnabled", {}, 6],
    ]
    for (const [method, suffix, body, operation, patch, change] of invalidResults) {
      wrongResponse = (actual, view) => {
        assert.equal(actual, operation)
        return { projectRef: project.id, installation: { ...view, ...patch }, ...(change === undefined ? {} : { change, eventId: "event", replayed: false }) }
      }
      const result = await fetch(base + suffix, {
        method,
        headers: { ...headers, "content-type": "application/json", ...(method === "GET" ? {} : { "idempotency-key": "project-key" }) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      assert.equal(result.status, 502, `${method} ${suffix} must reject the wrong owner result`)
      assert.equal((await result.json()).error.code, "skill_installation_response_invalid")
    }
    wrongResponse = null
    const selectionUrl = base.replace("skill-installations", "skill-selection")
    const select = async (body) =>
      fetch(selectionUrl, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": "selection" },
        body: JSON.stringify(body),
      })
    assert.deepEqual((await (await fetch(selectionUrl, { headers })).json()).data, { project_id: project.id, installation_ids: [] })
    assert.equal((await select({ installation_ids: ["i"] })).status, 200)
    assert.deepEqual((await (await fetch(selectionUrl, { headers })).json()).data.installation_ids, ["i"])
    for (const invalid of [{ installation_ids: ["i", "i"] }, { installation_ids: ["i"], extra: true }, { installation_ids: ["bad\n"] }]) {
      const beforeWrites = writes,
        beforeCalls = calls.length
      assert.equal((await select(invalid)).status, 400)
      assert.equal(writes, beforeWrites)
      assert.equal(calls.length, beforeCalls)
    }
    for (const patch of [{ installationId: { value: "other" } }, { enabled: false }]) {
      wrongResponse = (_method, view) => ({ projectRef: project.id, installation: { ...view, ...patch } })
      const beforeWrites = writes
      assert.equal((await select({ installation_ids: ["i"] })).status, patch.enabled === false ? 412 : 502)
      assert.equal(writes, beforeWrites)
    }
    wrongResponse = null
    const originalGet = client.get
    const originalWrites = writes
    client.get = async (input) => {
      const result = await originalGet(input)
      admitted = false
      return result
    }
    assert.equal((await select({ installation_ids: ["i"] })).status, 403)
    assert.equal(writes, originalWrites)
    admitted = true
    client.get = originalGet
    client.get = async () => {
      throw Error("skill_installation_response_invalid")
    }
    const badMessage = await fetch(base.replace("/projects/project-alias/skill-installations", "/sessions/conv_x/messages"), {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "bad-owner" },
      body: '{"content":"hello"}',
    })
    assert.equal(badMessage.status, 502, JSON.stringify(await badMessage.clone().json()))
    assert.equal((await badMessage.json()).error.code, "skill_installation_response_invalid")
    assert.equal(commits, 0)
    client.get = originalGet
    client.get = async (input) => {
      const result = await originalGet(input)
      visible = false
      return result
    }
    const beforeWrites = writes
    assert.equal((await select({ installation_ids: ["i"] })).status, 404)
    assert.equal(writes, beforeWrites)
    visible = true
    client.get = originalGet
    assert.equal((await select({ installation_ids: [] })).status, 200)
    assert.deepEqual(selection, [])
    assert.equal(
      (
        await fetch(base.replace("skill-installations", "skills/skill-builder"), {
          method: "PATCH",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": "retired" },
          body: '{"enabled":false}',
        })
      ).status,
      404,
    )
    const command = calls[0].input
    assert.notEqual(command.digest, installSkillDigest("tenant", "user-session", "skill:a"))
    const before = calls.length
    visible = false
    const denied = await fetch(base, { headers })
    assert.equal(denied.status, 404)
    assert.equal(calls.length, before)
    visible = true
    client.list = async (input) => {
      visible = false
      return { projectRef: input.projectRef, installations: [] }
    }
    const revoked = await fetch(base, { headers })
    assert.equal(revoked.status, 404)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("Project Connect calls the six formal methods and rejects mismatched or unknown project response identity", async () => {
  const { createServer } = await import("node:http"),
    { fromBinary, toBinary } = await import("@bufbuild/protobuf")
  const p = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const methods = {
    install: "InstallProjectSkill",
    update: "UpdateProjectSkillInstallation",
    setEnabled: "SetProjectSkillInstallationEnabled",
    remove: "RemoveProjectSkillInstallation",
    get: "GetProjectSkillInstallation",
    list: "ListProjectSkillInstallations",
  }
  const seen = []
  let bad = false
  let unknown = false
  const owner = createServer(async (req, res) => {
    const name = req.url.split("/").at(-1)
    assert.equal(req.url, `/kokoro.platform.v1.ProductProjectSkillInstallationService/${name}`)
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const input = fromBinary(p[`${name}RequestSchema`], Buffer.concat(chunks))
    seen.push({ name, input, headers: req.headers })
    assert.equal(req.headers["x-kokoro-project-ref"], "project-1")
    assert.equal(req.headers["x-kokoro-tenant"], "tenant")
    const response = {
      projectRef: bad ? "other" : "project-1",
      ...(name.startsWith("List") ? { installations: [] } : { installation: installation() }),
      ...(name.startsWith("Get") || name.startsWith("List") ? {} : { change: 7, replayed: false }),
    }
    res.writeHead(200, { "content-type": "application/proto" })
    const message = create(p[`${name}ResponseSchema`], response)
    if (unknown) message.$unknown = [{ no: 200, wireType: 0, data: new Uint8Array([1]) }]
    res.end(toBinary(p[`${name}ResponseSchema`], message))
  })
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  try {
    const credential = { get: async () => "workload" },
      client = new SkillInstallationConnectClient(`http://127.0.0.1:${owner.address().port}`, credential, credential, 1000)
    const common = {
      requestId: "r",
      tenant: "tenant",
      subject: "user-session",
      projectRef: "project-1",
      commandId: "c",
      digest: "a".repeat(64),
      sourceRef: "skill:a",
      installationId: "i",
      expectedSourceRef: "skill:b",
      enabled: false,
    }
    for (const [method, name] of Object.entries(methods)) {
      await client[method](common)
      assert.equal(seen.at(-1).name, name)
    }
    assert.equal(seen[1].input.expectedSourceRef.value, "skill:b")
    assert.equal(seen[2].input.enabled, false)
    bad = true
    await assert.rejects(client.list(common), /skill_installation_response_invalid/u)
    bad = false
    unknown = true
    await assert.rejects(client.list(common), /skill_installation_response_invalid/u)
  } finally {
    owner.closeAllConnections()
    await new Promise((resolve) => owner.close(resolve))
  }
})

test("project qualification that ignores cancellation cannot hold the public installation deadline open", async () => {
  const { createServer } = await import("node:http"),
    { skillInstallationRoute } = await import("../dist/http/routes/skill-installations.js"),
    { startSkillRequestBudget } = await import("../dist/http/routes/skill-drafts.js")
  const server = createServer((req, res) => {
    startSkillRequestBudget(req, 40)
    void skillInstallationRoute(
      req,
      res,
      { requestId: "deadline", identity: { namespace: "tenant", userId: "user" } },
      ["skill-installations"],
      {},
      undefined,
      null,
      () => new Promise(() => {}),
    )
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/v1/projects/p/skill-installations`, { signal: AbortSignal.timeout(1000) })
    assert.equal(r.status, 504)
    assert.equal((await r.json()).error.code, "skill_installation_dependency_timeout")
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("a deleted source retains its exact installation reference without update or cover eligibility", () => {
  const value = projectInstallation({ ...installation(), sourceStatus: 7 })
  assert.equal(value.source_status, "deleted")
  assert.equal(value.source_ref, "skill:one")
  assert.equal(value.revision, "18446744073709551615")
  assert.equal(value.available_update, undefined)
  assert.equal(value.product.cover, undefined)
})
