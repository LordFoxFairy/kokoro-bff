import assert from "node:assert/strict"
import { once } from "node:events"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { Code, ConnectError } from "@connectrpc/connect"
import { createBffServer } from "../src/bootstrap/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"

const headers = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
  authorization: "Bearer human-session",
  "x-request-id": "publication-test",
}
const source = { server_id: "source-server", connector_id: "source-connector", expected_source_state_version: "3" }
const targets = [
  { project_id: "project-b", expected_pin: { absent: true } },
  { project_id: "project-a", expected_pin: { absent: true } },
]
const revision = {
  revision_id: "revision-1",
  server_id: source.server_id,
  connector_id: source.connector_id,
  content_digest: "a".repeat(64),
  source_state_version: "3",
  display_name: "Pinned URL",
  created_at: "2026-10-25T00:00:00.000Z",
}
const pin = (project_id, removed = false) => ({
  pin_id: `pin-${project_id}`,
  project_id,
  revision,
  state_version: removed ? "2" : "1",
  removed,
  updated_at: "2026-10-25T00:00:00.000Z",
  execution_ready: false,
})
const publication = () => ({ revision, pins: [pin("project-a"), pin("project-b")], replayed: false })
async function fixture({ execute = async () => publication(), find, verify, check, timeout = 3000, tenantId = "tenant" } = {}) {
  const events = [],
    calls = []
  const app = createBffServer(
    {
      host: "127.0.0.1",
      port: 0,
      mode: "live",
      domain: "test.localhost",
      tenantId,
      sharedSecret: "test-secret",
      upstreamSecret: "test-upstream",
      upstreamTimeoutMs: timeout,
      upstreamMaxResponseBytes: 1048576,
      iamBaseUrl: null,
      schedulerServiceToken: null,
      schedulerTargetUrl: null,
      agentEnabled: false,
      postgresUrl: null,
      redisUrl: null,
      agUi: DEFAULT_AGUI_CONFIG,
      upstreams: { system: null, capability: null, scheduler: null, agents: null, billing: null, music: null },
    },
    {
      readiness: async () => {},
      sessionAdmission: { verify: verify ?? (async () => ({ ok: true, identity: { namespace: "tenant", userId: "reader" }, platformAdmin: false })) },
      mcpAuthorization: {
        check:
          check ??
          (async (input) => {
            events.push(`action:${input.action}`)
            return { ok: true }
          }),
      },
      businessStore: {
        ready: async () => {},
        close: async () => {},
        services: {
          projects: {
            find: async (scope, id) => {
              assert.deepEqual(scope, { tenantId: "tenant", subjectId: "reader" })
              events.push(`project:${id}`)
              return find ? find(id) : { id }
            },
          },
        },
        getReceipt: async () => null,
      },
      mcpProjectPublicationClient: {
        execute: async (identity, input, signal, deadline) => {
          events.push("owner")
          calls.push(structuredClone({ identity, input }))
          return execute(identity, input, signal, deadline)
        },
      },
    },
  )
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
  return {
    events,
    calls,
    request: (path, init = {}) => fetch(`http://127.0.0.1:${app.address().port}${path}`, { ...init, headers: { ...headers, ...init.headers } }),
    close: async () => {
      app.closeAllConnections()
      await new Promise((resolve) => app.close(resolve))
    },
  }
}
const publishPath = "/browser/v1/mcp/servers/source-server/project-publications"
const command = (body) => ({ method: "POST", headers: { "content-type": "application/json", "idempotency-key": "original-key" }, body: JSON.stringify(body) })
const publishBody = () => ({ connector_id: source.connector_id, expected_source_state_version: "3", targets })

test("production bootstrap admits all canonical owned projects before one URL publication and returns only a definition pin", async () => {
  const f = await fixture()
  try {
    const response = await f.request(publishPath, command(publishBody()))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { data: publication() })
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("x-request-id"), "publication-test")
    assert.equal(f.calls.length, 1)
    assert.deepEqual(f.calls[0].identity, { tenant: "tenant", subject: "reader", requestId: "publication-test" })
    assert.deepEqual(f.calls[0].input, { kind: "publish", commandId: "original-key", input: { ...source, targets: [...targets].reverse() } })
    const ownerIndex = f.events.indexOf("owner")
    for (const project of ["project-a", "project-b"]) {
      assert.ok(f.events.indexOf(`project:${project}`) < ownerIndex)
      assert.ok(f.events.lastIndexOf(`project:${project}`) > ownerIndex)
    }
  } finally {
    await f.close()
  }
})

test("one invisible project rejects the whole publication with zero owner calls", async () => {
  const f = await fixture({ find: (id) => (id === "project-b" ? null : { id }) })
  try {
    const response = await f.request(publishPath, command(publishBody()))
    assert.equal(response.status, 404)
    assert.equal(f.calls.length, 0)
    assert.equal((await response.json()).error.code, "mcp_project_publication_not_found")
  } finally {
    await f.close()
  }
})

test("list preserves tombstones; remove and read-only original receipt use their distinct owner operations", async () => {
  const f = await fixture({
    execute: async (_identity, call) =>
      call.kind === "list"
        ? { pins: [pin("project-a", true)], next_cursor: "owner_cursor" }
        : call.kind === "remove"
          ? { pin: pin("project-a", true), replayed: false }
          : { removal: { pin: pin("project-a", true), replayed: true } },
  })
  try {
    const listed = await f.request("/browser/v1/projects/project-a/mcp-pins?limit=5&cursor=previous")
    assert.equal(listed.status, 200)
    assert.equal((await listed.json()).data.pins[0].removed, true)
    const removed = await f.request("/browser/v1/projects/project-a/mcp-pins/pin-project-a", { ...command({ expected_state_version: "1" }), method: "DELETE" })
    assert.equal(removed.status, 200)
    const recovered = await f.request(
      "/browser/v1/mcp/project-publication-receipts",
      command({ removal: { project_id: "project-a", pin_id: "pin-project-a", expected_state_version: "1" } }),
    )
    assert.equal(recovered.status, 200)
    assert.equal((await recovered.json()).data.removal.replayed, true)
    assert.deepEqual(
      f.calls.map((call) => call.input.kind),
      ["list", "remove", "receipt"],
    )
    assert.deepEqual(f.calls[2].input.original, f.calls[1].input)
  } finally {
    await f.close()
  }
})

test("unknown publication is queried with its original key and CAS, never converted into another publish", async () => {
  const f = await fixture({
    execute: async (_identity, call) => {
      if (call.kind === "publish") throw Error("lost owner ACK")
      return { publication: { ...publication(), replayed: true } }
    },
  })
  try {
    assert.equal((await f.request(publishPath, command(publishBody()))).status, 503)
    const result = await f.request("/browser/v1/mcp/project-publication-receipts", command({ publication: { ...source, targets } }))
    assert.equal(result.status, 200)
    assert.equal((await result.json()).data.publication.replayed, true)
    assert.deepEqual(
      f.calls.map((call) => call.input.kind),
      ["publish", "receipt"],
    )
    assert.deepEqual(f.calls[1].input.original, f.calls[0].input)
  } finally {
    await f.close()
  }
})

for (const body of [
  { ...publishBody(), tenant_id: "foreign" },
  { ...publishBody(), expected_source_state_version: 3 },
  { ...publishBody(), expected_source_state_version: "03" },
  { ...publishBody(), expected_source_state_version: "2147483648" },
  { ...publishBody(), targets: [] },
  { ...publishBody(), targets: [targets[0], targets[0]] },
  { ...publishBody(), targets: [{ project_id: "project-a", expected_pin: { absent: false } }] },
  { ...publishBody(), targets: [{ project_id: "project-a", expected_pin: { absent: true, current: { pin_id: "pin-a", state_version: "1" } } }] },
])
  test(`closed publication input rejects ${JSON.stringify(body)} without owner traffic`, async () => {
    const f = await fixture()
    try {
      assert.equal((await f.request(publishPath, command(body))).status, 400)
      assert.equal(f.calls.length, 0)
    } finally {
      await f.close()
    }
  })

test("duplicate raw members and forged command headers are rejected before owner traffic", async () => {
  const f = await fixture()
  try {
    const init = command(publishBody())
    for (const mutation of [
      { ...init, body: init.body.replace('"connector_id":', '"connector_id":"forged","connector_id":') },
      { ...init, headers: { ...init.headers, "idempotency-key": "key with spaces" } },
      { ...init, headers: { ...init.headers, "content-type": "text/plain" } },
    ])
      assert.equal((await f.request(publishPath, mutation)).status, 400)
    assert.equal((await f.request(`${publishPath}?project_id=foreign`, init)).status, 400)
    assert.equal(f.calls.length, 0)
  } finally {
    await f.close()
  }
})

test("current human action denial and a canonical ID resolved to a different project both fail closed", async () => {
  for (const options of [{ check: async () => ({ ok: false, status: 403, code: "permission_denied" }) }, { find: (id) => ({ id: `${id}-other` }) }]) {
    const f = await fixture(options)
    try {
      assert.equal((await f.request(publishPath, command(publishBody()))).status, options.check ? 403 : 404)
      assert.equal(f.calls.length, 0)
    } finally {
      await f.close()
    }
  }
})

for (const mutation of [
  (value) => ({ ...value, revision: { ...value.revision, connector_id: "foreign" } }),
  (value) => ({ ...value, pins: value.pins.slice(0, 1) }),
  (value) => ({ ...value, pins: [value.pins[0], value.pins[0]] }),
  (value) => ({ ...value, pins: value.pins.map((p) => ({ ...p, execution_ready: true })) }),
  (value) => ({ ...value, pins: value.pins.map((p) => ({ ...p, state_version: "2" })) }),
  (value) => ({ ...value, secret: "owner-only" }),
])
  test("malformed or execution-ready owner acknowledgements never become publication success", async () => {
    const f = await fixture({ execute: async () => mutation(publication()) })
    try {
      const response = await f.request(publishPath, command(publishBody()))
      assert.equal(response.status, 502)
      assert.equal((await response.text()).includes("owner-only"), false)
    } finally {
      await f.close()
    }
  })

test("project deletion or subject replacement after owner ACK suppresses stale success without another mutation", async () => {
  for (const kind of ["project", "subject"]) {
    let committed = false
    const f = await fixture({
      execute: async () => {
        committed = true
        return publication()
      },
      find: (id) => (committed && kind === "project" ? null : { id }),
      verify: async () => ({
        ok: true,
        identity: { namespace: "tenant", userId: committed && kind === "subject" ? "replacement" : "reader" },
        platformAdmin: false,
      }),
    })
    try {
      const response = await f.request(publishPath, command(publishBody()))
      assert.equal(response.status, 404)
      assert.equal(f.calls.length, 1)
      assert.equal((await response.text()).includes("revision-1"), false)
    } finally {
      await f.close()
    }
  }
})

test("disconnect during the last target admission does not issue a late owner mutation", async () => {
  let entered, release
  const waiting = new Promise((resolve) => {
      entered = resolve
    }),
    blocked = new Promise((resolve) => {
      release = resolve
    })
  const f = await fixture({
    find: async (id) => {
      if (id === "project-b") {
        entered()
        await blocked
      }
      return { id }
    },
  })
  try {
    const controller = new AbortController()
    const work = f.request(publishPath, { ...command(publishBody()), signal: controller.signal }).catch(() => null)
    await waiting
    controller.abort()
    await work
    await new Promise((resolve) => setTimeout(resolve, 20))
    release()
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(f.calls.length, 0)
  } finally {
    release()
    await f.close()
  }
})

const publicationContract = JSON.parse(await readFile(new URL("../contract/openapi/browser/v1/mcp-project-publication.json", import.meta.url), "utf8"))
const publicationPolicy = publicationContract["x-kokoro-publication-policy"]
function publishedFault(status, code, retryable, operation = "publishMcpUrlToProjects") {
  const entry = Object.values(publicationContract.paths)
    .flatMap((path) => Object.values(path))
    .find((value) => value.operationId === operation)
  const schema = entry.responses[status].content["application/json"].schema
  const alternatives = schema.anyOf ?? [schema]
  assert.ok(
    alternatives.some(
      (value) => value.properties?.error?.properties?.code?.const === code && value.properties?.error?.properties?.retryable?.const === retryable,
    ),
    `missing exact HTTP tuple ${status}/${code}/${retryable}`,
  )
  return [...Object.values(publicationPolicy.faults ?? {}), ...Object.values(publicationPolicy.admission_faults ?? {})].find((value) => value.code === code)
}

test("publication error machine contract closes actual owner tuples and only exact first rejection permits a revised intent", async () => {
  for (const [rpc, status, suffix, retryable, revised] of [
    [Code.InvalidArgument, 400, "request_invalid", false, true],
    [Code.FailedPrecondition, 412, "precondition_failed", false, true],
    [Code.NotFound, 404, "not_found", false, false],
    [Code.PermissionDenied, 403, "forbidden", false, false],
    [Code.AlreadyExists, 409, "idempotency_conflict", false, false],
    [Code.Aborted, 409, "in_progress", true, false],
    [Code.ResourceExhausted, 429, "rate_limited", true, false],
    [Code.Unavailable, 503, "dependency_unavailable", true, false],
    [Code.Internal, 502, "response_invalid", false, false],
  ]) {
    const f = await fixture({
      execute: async () => {
        throw new ConnectError("hidden owner error", rpc)
      },
    })
    try {
      const response = await f.request(publishPath, command(publishBody()))
      assert.equal(response.status, status)
      const body = await response.json(),
        code = `mcp_project_publication_${suffix}`
      assert.equal(body.error.code, code)
      assert.equal(body.error.retryable, retryable)
      assert.equal(publishedFault(status, code, retryable).first_rejection_allows_revised_command, revised)
      assert.equal(f.calls.length, 1)
    } finally {
      await f.close()
    }
  }
})

test("published recovery never releases an unknown command on receipt404, post-ACK404 or later400/412", async () => {
  let sent = false
  const f = await fixture({
    execute: async (_identity, call) => {
      if (call.kind === "receipt") throw new ConnectError("receipt absent", Code.NotFound)
      sent = true
      return publication()
    },
    find: (id) => (sent ? null : { id }),
  })
  try {
    const response = await f.request(publishPath, command(publishBody()))
    assert.equal(response.status, 404)
    const fault = await response.json()
    assert.equal(publishedFault(404, fault.error.code, fault.error.retryable).first_rejection_allows_revised_command, false)
    assert.equal(f.calls.length, 1)
  } finally {
    await f.close()
  }
  const receipt = await fixture({
    execute: async () => {
      throw new ConnectError("receipt absent", Code.NotFound)
    },
  })
  try {
    const response = await receipt.request("/browser/v1/mcp/project-publication-receipts", command({ publication: { ...source, targets } }))
    assert.equal(response.status, 404)
    assert.equal(receipt.calls[0].input.kind, "receipt")
    assert.equal(publicationPolicy.new_command_policy.after_unknown, false)
    assert.equal(publicationPolicy.new_command_policy.receipt_not_found, false)
    for (const suffix of ["request_invalid", "precondition_failed"]) {
      const vector = publicationContract["x-kokoro-publication-error-vectors"].find(
        (value) => value.code === `mcp_project_publication_${suffix}` && value.prior_unknown,
      )
      assert.equal(vector.new_command_authorized, false)
      assert.equal(vector.recovery, "inspect_owner")
    }
  } finally {
    await receipt.close()
  }
})

test("publication machine contract includes early session and action rejection without authorizing a new command", async () => {
  for (const [status, code] of [
    [401, "session_invalid"],
    [403, "session_forbidden"],
    [429, "session_rate_limited"],
    [503, "iam_admission_unavailable"],
  ]) {
    const f = await fixture({ verify: async () => ({ ok: false, status, code }) })
    try {
      const response = await f.request(publishPath, command(publishBody()))
      assert.equal(response.status, status)
      const body = await response.json()
      assert.equal(body.error.code, code)
      assert.equal(publishedFault(status, code, body.error.retryable).first_rejection_allows_revised_command, false)
      assert.equal(f.calls.length, 0)
    } finally {
      await f.close()
    }
  }
})

test("shared receipt expiry is not generic CAS rejection and exact original requests remain frozen after unknown", async () => {
  const shared = JSON.parse(await readFile(new URL("../contract/connector-command-errors-v1.json", import.meta.url), "utf8"))
  const f = await fixture({
    execute: async () => {
      throw new ConnectError("hidden expiry", Code.FailedPrecondition, { "x-kokoro-error-code": "command_receipt_replay_expired" })
    },
  })
  try {
    const response = await f.request(publishPath, command(publishBody()))
    assert.equal(response.status, shared.mcp.replay_expired.status)
    const body = await response.json()
    assert.equal(body.error.code, shared.mcp.replay_expired.code)
    publishedFault(response.status, body.error.code, body.error.retryable)
    const vector = publicationContract["x-kokoro-publication-error-vectors"].find((value) => value.code === body.error.code && !value.prior_unknown)
    assert.equal(vector.recovery, "inspect_owner")
    assert.equal(vector.new_command_authorized, false)
  } finally {
    await f.close()
  }
  for (const rpc of [Code.InvalidArgument, Code.FailedPrecondition]) {
    let calls = 0
    const f = await fixture({
      execute: async () => {
        if (++calls === 1) throw Error("lost owner ACK")
        throw new ConnectError("subsequent rejection", rpc)
      },
    })
    try {
      assert.equal((await f.request(publishPath, command(publishBody()))).status, 503)
      const retried = await f.request(publishPath, command(publishBody())),
        body = await retried.json()
      const vector = publicationContract["x-kokoro-publication-error-vectors"].find(
        (value) => value.status === retried.status && value.code === body.error.code && value.retryable === body.error.retryable && value.prior_unknown,
      )
      assert.equal(vector.new_command_authorized, false)
      assert.equal(vector.recovery, "inspect_owner")
      assert.deepEqual(f.calls[0].input, f.calls[1].input)
    } finally {
      await f.close()
    }
  }
  assert.deepEqual(publicationPolicy.unknown_error_policy, { recovery: "inspect_owner", preserve_original_command: true, new_command_authorized: false })
})

test("publication profile covers service, missing bearer, configured tenant and current tenant admission boundaries", async () => {
  for (const [options, headers, status, code] of [
    [{}, { "x-kokoro-internal-secret": "wrong-test-secret" }, 403, "service_auth_failed"],
    [{}, { authorization: "" }, 401, "session_authentication_required"],
    [{ tenantId: null }, {}, 503, "product_tenant_not_configured"],
    [{ verify: async () => ({ ok: true, identity: { namespace: "foreign", userId: "reader" }, platformAdmin: false }) }, {}, 403, "product_tenant_forbidden"],
  ]) {
    const f = await fixture(options)
    try {
      const input = command(publishBody()),
        response = await f.request(publishPath, { ...input, headers: { ...input.headers, ...headers } })
      assert.equal(response.status, status)
      const body = await response.json()
      assert.equal(body.error.code, code)
      assert.equal(publishedFault(status, code, body.error.retryable).first_rejection_allows_revised_command, false)
      assert.equal(f.calls.length, 0)
    } finally {
      await f.close()
    }
  }
})
