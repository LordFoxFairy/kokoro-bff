import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { create } from "@bufbuild/protobuf"
import { timestampFromDate } from "@bufbuild/protobuf/wkt"
import { createBffServer } from "../src/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.js"
import { bindCustomApiCommand } from "../src/infrastructure/clients/platform/custom-api-binding.js"
import { projectCustomApiResponse } from "../src/infrastructure/clients/platform/custom-api-response.js"
import { CreatePersonalCustomApiResponseSchema, PersonalCustomApiSchema } from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"

const identity = {
  requestId: "request",
  tenant: "tenant",
  subject: "user",
  commandId: "key",
  name: "API",
  environment: [{ name: "API_TOKEN", value: "secret-a" }],
}

const profile = {
  profile_id: "profile-one",
  name: "Partner API",
  instructions: "Use the partner endpoint for supported requests.",
  state_version: "1",
  created_at: "2026-10-15T00:00:00.000Z",
  updated_at: "2026-10-15T00:00:00.000Z",
  environment: [
    {
      name: "API_TOKEN",
      configured: true,
      state_version: "1",
      status: "active",
    },
  ],
} as const

const browserHeaders = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
  authorization: "Bearer human-session",
  "x-request-id": "custom-api-http-1",
}

async function customApiFixture(execute: (operation: string, input: Record<string, unknown>) => Promise<unknown>) {
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live" as const,
    domain: "dev.kokoro.localhost",
    tenantId: "tenant-server",
    iamBaseUrl: "http://iam.invalid",
    sharedSecret: "test-secret",
    upstreamSecret: "upstream-secret",
    upstreamTimeoutMs: 5_000,
    upstreamMaxResponseBytes: 1_048_576,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {
      system: null,
      capability: null,
      scheduler: null,
      agents: null,
      billing: null,
      music: null,
    },
  }
  const app = createBffServer(config, {
    businessStore: null,
    readiness: async () => undefined,
    sessionAdmission: {
      verify: async () => ({
        ok: true as const,
        identity: { namespace: "tenant-server", userId: "human-one" },
        platformAdmin: false,
      }),
    },
    customApiClient: {
      execute: async (operation, input) => execute(operation, input as unknown as Record<string, unknown>),
    },
  })
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve))
  const address = app.address()
  assert.ok(address && typeof address === "object")
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      app.closeAllConnections()
      await new Promise<void>((resolve) => app.close(() => resolve()))
    },
  }
}

test("Custom API is available only through the admitted browser owner adapter", async () => {
  const calls: Array<{ operation: string; input: Record<string, unknown> }> = []
  const fixture = await customApiFixture(async (operation, input) => {
    calls.push({ operation, input })
    return operation === "list" ? { items: [profile], page: { next_cursor: null } } : { custom_api: profile, replayed: false }
  })
  try {
    const created = await fetch(`${fixture.origin}/browser/v1/connectors/custom-apis`, {
      method: "POST",
      headers: {
        ...browserHeaders,
        "content-type": "application/json",
        "idempotency-key": "custom-api-create-1",
      },
      body: JSON.stringify({
        name: profile.name,
        instructions: profile.instructions,
        environment: [{ name: "API_TOKEN", value: "write-only-secret" }],
      }),
    })
    assert.equal(created.status, 201)
    assert.deepEqual(await created.json(), {
      data: { custom_api: profile, replayed: false },
    })
    assert.deepEqual(calls[0], {
      operation: "create",
      input: {
        requestId: "custom-api-http-1",
        tenant: "tenant-server",
        subject: "human-one",
        commandId: "custom-api-create-1",
        name: profile.name,
        instructions: profile.instructions,
        environment: [{ name: "API_TOKEN", value: "write-only-secret" }],
      },
    })

    const listed = await fetch(`${fixture.origin}/browser/v1/connectors/custom-apis?limit=100`, {
      headers: browserHeaders,
    })
    assert.equal(listed.status, 200)
    assert.deepEqual(await listed.json(), {
      data: { items: [profile], page: { next_cursor: null } },
    })
    assert.deepEqual(calls[1], {
      operation: "list",
      input: {
        requestId: "custom-api-http-1",
        tenant: "tenant-server",
        subject: "human-one",
        limit: 100,
      },
    })
  } finally {
    await fixture.close()
  }
})
test("Custom API create wire binds owner identity and secret name, but never serializes the secret in its public digest", () => {
  const first = bindCustomApiCommand("create", identity)
  const changedSecret = bindCustomApiCommand("create", {
    ...identity,
    environment: [{ name: "API_TOKEN", value: "secret-b" }],
  })
  assert.equal(first.requestDigest, changedSecret.requestDigest)
  assert.notEqual(first.requestDigest, bindCustomApiCommand("create", { ...identity, tenant: "other" }).requestDigest)
  assert.equal(
    first.requestDigest,
    createHash("sha256")
      .update(
        '{"input":{"environment":["API_TOKEN"],"instructions":null,"name":"API"},"method":"kokoro.platform.v1.ProductCustomApiService/CreatePersonalCustomApi","subject_id":"user","tenant_id":"tenant"}',
      )
      .digest("hex"),
  )
})
test("Custom API update binds environment names as the owner command contract requires", () => {
  const first = bindCustomApiCommand("update", {
    ...identity,
    profileId: "profile",
    expectedStateVersion: "1",
    name: "API 2",
    environmentUpserts: [
      { name: "Z_TOKEN", value: "secret-z" },
      { name: "A_TOKEN", value: "secret-a" },
    ],
  })
  const changedSecret = bindCustomApiCommand("update", {
    ...identity,
    profileId: "profile",
    expectedStateVersion: "1",
    name: "API 2",
    environmentUpserts: [
      { name: "Z_TOKEN", value: "different-z" },
      { name: "A_TOKEN", value: "different-a" },
    ],
  })
  assert.equal(first.requestDigest, changedSecret.requestDigest)
  assert.equal(first.requestDigest, "3dc9e81429085235f5548da32e70c1242a8c87a38892a017774e7bc2415d434d")
})
test("Custom API response projection exposes descriptors only", () => {
  const profile = create(PersonalCustomApiSchema, {
    profileId: { value: "profile" },
    name: "API",
    stateVersion: 1n,
    createdAt: timestampFromDate(new Date("2026-01-01T00:00:00.000Z")),
    updatedAt: timestampFromDate(new Date("2026-01-01T00:00:00.000Z")),
    environment: [
      {
        name: "API_TOKEN",
        configured: true,
        stateVersion: 1n,
        status: "active",
      },
    ],
  })
  const result = projectCustomApiResponse("create", create(CreatePersonalCustomApiResponseSchema, { profile, replayed: false }))
  assert.deepEqual(result, {
    custom_api: {
      profile_id: "profile",
      name: "API",
      state_version: "1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      environment: [
        {
          name: "API_TOKEN",
          configured: true,
          state_version: "1",
          status: "active",
        },
      ],
    },
    replayed: false,
  })
  assert.doesNotMatch(JSON.stringify(result), /secret|value/i)
})

test("Custom API HTTP distinguishes receipt recovery states without replaying or exposing owner metadata", async () => {
  const { Code, ConnectError } = await import("@connectrpc/connect")
  let failure: unknown,
    calls = 0
  const fixture = await customApiFixture(async () => {
    calls++
    throw failure
  })
  try {
    for (const [reason, rpcCode, status, code, retryable] of [
      ["in_progress", Code.Aborted, 409, "custom_api_command_in_progress", true],
      ["outcome_unknown", Code.Unavailable, 503, "custom_api_command_outcome_unknown", false],
      ["replay_expired", Code.FailedPrecondition, 412, "custom_api_command_replay_expired", false],
      ["identity_conflict", Code.AlreadyExists, 409, "custom_api_conflict", false],
      ["ownership_lost", Code.Aborted, 409, "custom_api_command_ownership_lost", false],
      ["invalid", Code.Internal, 502, "custom_api_response_invalid", false],
    ] as const) {
      failure = new ConnectError("private-owner-marker", rpcCode, { "x-kokoro-error-code": `command_receipt_${reason}` })
      const before = calls
      const response = await fetch(`${fixture.origin}/browser/v1/connectors/custom-apis`, {
        method: "POST",
        headers: { ...browserHeaders, "content-type": "application/json", "idempotency-key": "original-custom-api" },
        body: JSON.stringify({ name: "Error classification only", environment: [] }),
      })
      assert.equal(response.status, status)
      assert.deepEqual((await response.json()).error, { code, message: "Custom API request failed", retryable })
      assert.equal(response.headers.get("x-kokoro-error-code"), null)
      assert.equal(response.headers.get("x-request-id"), browserHeaders["x-request-id"])
      assert.equal(calls, before + 1)
    }
    const response = await fetch(`${fixture.origin}/browser/v1/connectors/custom-apis`, { headers: browserHeaders })
    assert.equal(response.status, 502)
    assert.equal((await response.json()).error.code, "custom_api_response_invalid")
  } finally {
    await fixture.close()
  }
})

test("Custom API creation and icon-only edits forward the staged selector and clear, never browser identity", async () => {
  const seen: Record<string, unknown>[] = []
  const f = await customApiFixture(async (_operation, input) => {
    seen.push(input)
    return { custom_api: profile, replayed: false }
  })
  const icon = { intent_id: "12345678-1234-1234-1234-123456789abc", expected_state_version: "3" }
  try {
    for (const [method, path, body] of [
      ["POST", "", { name: "API", environment: [], icon }],
      ["PATCH", "/profile-one", { expected_state_version: "7", icon }],
      ["PATCH", "/profile-one", { expected_state_version: "7", clear_icon: true }],
    ] as const) {
      const result = await fetch(`${f.origin}/browser/v1/connectors/custom-apis${path}`, {
        method,
        headers: { ...browserHeaders, "content-type": "application/json", "idempotency-key": "same-icon-original-key" },
        body: JSON.stringify(body),
      })
      assert.equal(result.status, method === "POST" ? 201 : 200)
      await result.arrayBuffer()
    }
    assert.deepEqual(seen[0]!.icon, { intentId: icon.intent_id, expectedStateVersion: "3" })
    assert.deepEqual(seen[1]!.icon, seen[0]!.icon)
    assert.equal(seen[2]!.clearIcon, true)
    assert.equal(seen[1]!.tenant, "tenant-server")
    for (const bad of [
      { icon, clear_icon: true },
      { clear_icon: false },
      { icon: { ...icon, expected_state_version: 3 } },
      { icon, subject_id: "someone-else" },
    ]) {
      const result = await fetch(`${f.origin}/browser/v1/connectors/custom-apis/profile-one`, {
        method: "PATCH",
        headers: { ...browserHeaders, "content-type": "application/json", "idempotency-key": "invalid-icon-key" },
        body: JSON.stringify({ expected_state_version: "7", ...bad }),
      })
      assert.equal(result.status, 400)
      await result.arrayBuffer()
    }
    assert.equal(seen.length, 3)
  } finally {
    await f.close()
  }
})

test("invalid owner icon ACK is 502 inspect-owner, not a new browser error or retryable dependency failure", async () => {
  const makeWire = () =>
    create(CreatePersonalCustomApiResponseSchema, {
      profile: create(PersonalCustomApiSchema, {
        profileId: { value: "profile-one" },
        name: "API",
        stateVersion: 1n,
        createdAt: timestampFromDate(new Date(profile.created_at)),
        updatedAt: timestampFromDate(new Date(profile.updated_at)),
        icon: {
          intentId: "12345678-1234-1234-1234-123456789abc",
          contentSha256: "a".repeat(64),
          mimeType: "image/png",
          sizeBytes: 1024n,
          width: 24,
          height: 24,
        },
      }),
      replayed: false,
    })
  let wire = makeWire()
  const f = await customApiFixture(async (operation, input) => projectCustomApiResponse(operation as "create", wire, input as typeof identity))
  try {
    for (const invalid of ["zero-width", "unknown-wire", "wrong-binding"]) {
      wire = makeWire()
      if (invalid === "zero-width") wire.profile!.icon!.width = 0
      if (invalid === "unknown-wire") wire.profile!.icon!.$unknown = [{ no: 100, wireType: 2, data: new Uint8Array([0]) }]
      const response = await fetch(`${f.origin}/browser/v1/connectors/custom-apis`, {
        method: "POST",
        headers: { ...browserHeaders, "content-type": "application/json", "idempotency-key": "exact-original-key" },
        body: JSON.stringify({
          name: "API",
          environment: [],
          icon: {
            intent_id: invalid === "wrong-binding" ? "12345678-1234-1234-1234-123456789abd" : "12345678-1234-1234-1234-123456789abc",
            expected_state_version: "2",
          },
        }),
      })
      assert.equal(response.status, 502)
      assert.deepEqual((await response.json()).error, { code: "custom_api_response_invalid", message: "Custom API request failed", retryable: false })
    }
  } finally {
    await f.close()
  }
})
