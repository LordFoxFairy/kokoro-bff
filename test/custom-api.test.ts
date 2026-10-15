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
