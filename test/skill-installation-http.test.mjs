import assert from "node:assert/strict"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { request as httpRequest } from "node:http"
import test from "node:test"
import { Code, ConnectError } from "@connectrpc/connect"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { createLiveTestBffServer } from "./doubles/server.ts"
import { SkillInstallationChange } from "../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { projectInstallation, projectInstallationAck, projectInstallationList } from "../dist/infrastructure/clients/platform/personal-installation-response.js"
import {
  installPersonalDigest,
  removePersonalDigest,
  setPersonalEnabledDigest,
} from "../dist/infrastructure/clients/platform/personal-installation-projector.js"
import { PersonalInstallationConnectClient } from "../dist/infrastructure/clients/platform/personal-installation-connect.js"
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
  installed: true,
  enabled: true,
  installedAt: timestamp(1),
  updatedAt: timestamp(2),
  displayName: "Research assistant",
  summary: "",
  sourceStatus: 2,
  skillUpdatedAt: timestamp(3, 123456789),
  examplePrompts: { prompts: [] },
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
async function withServer(client, run) {
  const server = createLiveTestBffServer(config, {
    sessionAdmission: {
      verify: async () => ({
        ok: true,
        identity: { namespace: "tenant", userId: "user-session" },
      }),
    },
    personalInstallationClient: client,
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
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
test("all owner product installation projection vectors keep their published digests", async () => {
  const source = new URL(
    "../contract/vendor/kokoro-platform/94bd0ea94aabc60c666fdb2cfa8784baf194e24b/execution-operations-v5/vectors/product-installation.json",
    import.meta.url,
  )
  const vectors = JSON.parse(await readFile(source, "utf8")).vectors.filter((vector) => vector.stage === "projection")
  assert.equal(vectors.length, 4)
  for (const vector of vectors) {
    const command = vector.projection.command
    const actual =
      vector.method === "InstallPersonalSkill"
        ? installPersonalDigest(vector.projection.tenant_ref, command.subject_id, command.source_ref.value)
        : vector.method === "RemovePersonalSkillInstallation"
          ? removePersonalDigest(vector.projection.tenant_ref, command.subject_id, command.installation_id.value)
          : setPersonalEnabledDigest(vector.projection.tenant_ref, command.subject_id, command.installation_id.value, command.enabled)
    assert.equal(actual, vector.sha256, vector.name)
  }
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
  const client = new PersonalInstallationConnectClient("http://127.0.0.1:1", blocked, blocked, 10)
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
  await withServer(new PersonalInstallationConnectClient("http://127.0.0.1:1", blocked, blocked, 10), async (base) => {
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
  await withServer(new PersonalInstallationConnectClient("http://127.0.0.1:1", cancellationBlocked, cancellationBlocked, 1_000), async (base) => {
    const caller = new AbortController()
    const pending = fetch(`${base}/v1/skill-installations/i`, { headers, signal: caller.signal })
    caller.abort(new Error("browser_cancelled"))
    await assert.rejects(pending, { message: "browser_cancelled" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.notEqual(tokenAbortReason?.name, "TimeoutError")
  })
})

test("installation examples require present typed message and valid original strings", () => {
 for (const examplePrompts of [undefined, null, {prompts:null}, {prompts:["\ud800"]}, {prompts:["\u0000"]}, {prompts:[" "]}, {prompts:[1]}])
  assert.throws(() => projectInstallation({...installation(), examplePrompts}), /skill_installation_response_invalid/u)
 for (const prompts of [[], ["  a\n", "same", "same"], ["😀".repeat(1000)]])
  assert.deepEqual(projectInstallation({...installation(), examplePrompts:{prompts}}).example_prompts, prompts)
})
