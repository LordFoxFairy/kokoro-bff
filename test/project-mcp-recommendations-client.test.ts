import assert from "node:assert/strict"
import { test } from "node:test"
import { Code, ConnectError } from "@connectrpc/connect"
import { validateProjectMcpRecommendationCandidates as validate } from "../src/infrastructure/clients/platform/project-mcp-recommendation-candidates.js"
const identity = { tenant: "tenant", subject: "subject", requestId: "request" }
const provider = (id: string) => ({
  provider: { provider_key: id, display_name: "Provider", directory_type: "app", category_keys: [], example_prompts: [], enabled: true, state_version: "1" },
})
const connector = {
  connector: {
    connector_id: "c",
    connector_type: "mcp",
    provider_key: "private-c",
    status: "active",
    approved_scopes: [],
    enabled: true,
    state_version: "1",
    availability: "available",
  },
}

test("new ref verification uses existing exact scoped metadata only, with at most four concurrent reads", async () => {
  let active = 0,
    peak = 0
  const seen: unknown[] = []
  const clients = {
    mcpPersonalClient: {
      read: async (operation: string, input: any) => {
        active++
        peak = Math.max(peak, active)
        seen.push([operation, input])
        await new Promise((r) => setTimeout(r, 5))
        active--
        return operation === "connector" ? connector : provider(input.id)
      },
    },
    customApiClient: {
      execute: async (operation: string, input: any) => {
        seen.push([operation, input])
        return {
          custom_api: {
            profile_id: input.profileId,
            name: "API",
            state_version: "1",
            environment: [{ name: "KEY", configured: true, state_version: "1", status: "active" }],
            created_at: "2026-10-27T00:00:00Z",
            updated_at: "2026-10-27T00:00:00Z",
          },
        }
      },
    },
  }
  await validate(
    [
      ...Array.from({ length: 8 }, (_, i) => ({ kind: "provider" as const, provider_key: `p${i}` })),
      { kind: "mcp_connector", connector_id: "c" },
      { kind: "custom_api", profile_id: "api" },
    ],
    clients as any,
    identity,
    new AbortController().signal,
    performance.now() + 2000,
  )
  assert.equal(peak, 4)
  assert.equal(seen.length, 10)
  for (const [op, input] of seen as any[]) {
    assert.ok(["provider", "connector", "get"].includes(op))
    assert.equal(input.subject, "subject")
    assert.equal(input.tenant, "tenant")
    assert.equal(input.commandId, undefined)
  }
})
test("candidate verification rejects wrong identities, revoked or wrong-type connectors and stale caller without commands", async () => {
  for (const value of [
    { ...connector.connector, connector_id: "other" },
    { ...connector.connector, status: "revoked" },
    { ...connector.connector, connector_type: "builtin" },
    { ...connector.connector, secret: "never" },
  ]) {
    await assert.rejects(
      validate(
        [{ kind: "mcp_connector", connector_id: "c" }],
        { mcpPersonalClient: { read: async () => ({ connector: value }) } as any, customApiClient: null },
        identity,
        new AbortController().signal,
        performance.now() + 1000,
      ),
    )
  }
  let calls = 0
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    validate(
      [{ kind: "provider", provider_key: "p" }],
      {
        mcpPersonalClient: {
          read: async () => {
            calls++
            return provider("p")
          },
        } as any,
        customApiClient: null,
      },
      identity,
      controller.signal,
      performance.now() + 1000,
    ),
  )
  assert.equal(calls, 0)
  await assert.rejects(
    validate(
      [{ kind: "provider", provider_key: "p" }],
      {
        mcpPersonalClient: {
          read: async () => {
            throw new ConnectError("private", Code.NotFound)
          },
        } as any,
        customApiClient: null,
      },
      identity,
      new AbortController().signal,
      performance.now() + 1000,
    ),
    (e) => e instanceof ConnectError && e.code === Code.NotFound,
  )
})
