import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { create } from "@bufbuild/protobuf"
import { parseMcpPersonalAuthorization } from "../src/http/mcp-personal-authorization-input.js"
import { bindMcpPersonalConnection } from "../src/infrastructure/clients/platform/mcp-personal-authorization-binding.js"
import { projectMcpPersonalAuthorization } from "../src/infrastructure/clients/platform/mcp-personal-authorization-response.js"
import {
  BeginPersonalMcpConnectorAuthorizationResponseSchema,
  CompletePersonalMcpConnectorAuthorizationResponseSchema,
  PersonalMcpConnectorSchema,
  PersonalMcpConnectionSchema,
  CreatePersonalMcpConnectionResponseSchema,
} from "../src/generated/platform-mcp-product-connect/kokoro/platform/v1/platform_runtime_pb.js"

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value))
const identity = { tenant: "tenant", subject: "subject", requestId: "request" }

test("A3 authorization input has one closed, opaque callback shape and a distinct connection command", () => {
  assert.deepEqual(parseMcpPersonalAuthorization("begin", bytes({ server_id: "server", expected_state_version: "1" })), {
    serverId: "server",
    expectedStateVersion: "1",
  })
  assert.deepEqual(parseMcpPersonalAuthorization("complete", bytes({ state: "opaque-state", code: "opaque-code" })), {
    state: "opaque-state",
    code: "opaque-code",
  })
  assert.deepEqual(
    parseMcpPersonalAuthorization(
      "createConnection",
      bytes({ connector_id: "connector", server_id: "server", allowed_selectors: ["tool.read"], expected_state_version: "2" }),
    ),
    {
      connectorId: "connector",
      serverId: "server",
      allowedSelectors: ["tool.read"],
      expectedStateVersion: "2",
    },
  )
  for (const invalid of [
    ["complete", { state: "opaque-state", code: "one", error: "two" }],
    ["complete", { state: "opaque-state" }],
    ["begin", { server_id: "server", expected_state_version: "01" }],
    ["createConnection", { connector_id: "connector", server_id: "server", allowed_selectors: ["tool.read", "tool.read"], expected_state_version: "2" }],
    ["createConnection", { connector_id: "connector", server_id: "server", allowed_selectors: [" tool.read"], expected_state_version: "2" }],
  ] as const)
    assert.throws(() => parseMcpPersonalAuthorization(invalid[0], bytes(invalid[1])))
})

test("A3 connection binding has the owner operation, identity, CAS, selectors and no callback secret", () => {
  const input = {
    ...identity,
    id: "connector",
    serverId: "server",
    allowedSelectors: ["tool.read"],
    expectedStateVersion: "2",
    commandId: "idempotency-key",
  }
  const canonical =
    '{"input":{"allowed_selectors":["tool.read"],"connector_id":"connector","expected_state_version":"2","server_id":"server"},"method":"kokoro.platform.v1.ProductMcpPersonalService/CreatePersonalMcpConnection","subject_id":"subject","tenant_id":"tenant"}'
  assert.deepEqual(bindMcpPersonalConnection(input), {
    commandId: "idempotency-key",
    requestDigest: createHash("sha256").update(canonical).digest("hex"),
  })
  assert.notEqual(bindMcpPersonalConnection(input).requestDigest, bindMcpPersonalConnection({ ...input, allowedSelectors: ["tool.write"] }).requestDigest)
})

test("A3 authorization projects only browser-required URL metadata and owner facts", () => {
  const connector = create(PersonalMcpConnectorSchema, {
    connectorId: { value: "connector" },
    connectorType: 3,
    providerKey: "provider",
    status: 1,
    approvedScopes: ["read"],
    enabled: false,
    stateVersion: 2n,
  })
  const begun = create(BeginPersonalMcpConnectorAuthorizationResponseSchema, {
    authorizationId: { value: "authorization" },
    authorizationUrl: "https://oauth.example.test/authorize?state=opaque",
    expiresAt: { seconds: 1_800_000_000n, nanos: 0 },
    connector,
  })
  assert.deepEqual(projectMcpPersonalAuthorization("begin", begun, { ...identity, id: "connector" }), {
    authorization: {
      authorization_id: "authorization",
      authorization_url: "https://oauth.example.test/authorize?state=opaque",
      expires_at: "2027-01-15T08:00:00.000Z",
    },
    connector: {
      connector_id: "connector",
      connector_type: "mcp",
      provider_key: "provider",
      status: "pending",
      approved_scopes: ["read"],
      enabled: false,
      state_version: "2",
    },
  })
  const completed = create(CompletePersonalMcpConnectorAuthorizationResponseSchema, { connector: { ...connector, status: 2, stateVersion: 3n } })
  assert.deepEqual(projectMcpPersonalAuthorization("complete", completed, { ...identity }), {
    connector: {
      connector_id: "connector",
      connector_type: "mcp",
      provider_key: "provider",
      status: "active",
      approved_scopes: ["read"],
      enabled: false,
      state_version: "3",
    },
  })
  const connection = create(PersonalMcpConnectionSchema, {
    connectionId: { value: "connection" },
    connectorId: { value: "connector" },
    serverId: { value: "server" },
    allowedSelectors: ["tool.read"],
    policyDigest: "a".repeat(64),
    status: "active",
  })
  assert.deepEqual(
    projectMcpPersonalAuthorization("createConnection", create(CreatePersonalMcpConnectionResponseSchema, { connection }), inputForConnection()),
    {
      connection: {
        connection_id: "connection",
        connector_id: "connector",
        server_id: "server",
        allowed_selectors: ["tool.read"],
        policy_digest: "a".repeat(64),
        status: "active",
      },
    },
  )
})

function inputForConnection() {
  return { ...identity, id: "connector", serverId: "server", allowedSelectors: ["tool.read"], expectedStateVersion: "2", commandId: "idempotency-key" }
}

test("A3 real Connect lifecycle forwards opaque callback values and exact connection command binding", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ProductMcpPersonalService } = await import("../src/generated/platform-mcp-product-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const { McpPersonalConnectClient } = await import("../src/infrastructure/clients/platform/mcp-personal-connect.js")
  const { McpPersonalTokenSource } = await import("../src/infrastructure/clients/platform/mcp-personal-token.js")
  const seen: unknown[] = []
  const server = createServer(
    connectNodeAdapter({
      routes: (router) =>
        router.service(ProductMcpPersonalService, {
          completePersonalMcpConnectorAuthorization: (request, context) => {
            seen.push(request)
            assert.equal(context.requestHeader.get("x-tenant-ref"), identity.tenant)
            assert.equal(context.requestHeader.get("x-kokoro-subject"), identity.subject)
            context.responseHeader.set("cache-control", "no-store")
            context.responseHeader.set("x-kokoro-request-id", request.requestId)
            return {
              connector: { connectorId: { value: "connector" }, connectorType: 3, providerKey: "provider", status: 2, enabled: false, stateVersion: 3n },
            }
          },
          createPersonalMcpConnection: (request, context) => {
            seen.push(request)
            context.responseHeader.set("cache-control", "no-store")
            context.responseHeader.set("x-kokoro-request-id", request.requestId)
            return {
              connection: {
                connectionId: { value: "connection" },
                connectorId: request.connectorId,
                serverId: request.serverId,
                allowedSelectors: request.allowedSelectors,
                policyDigest: "a".repeat(64),
                status: "active",
              },
            }
          },
        }),
    }),
  )
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const tokens = { get: async () => "workload", retire: () => undefined, close: () => undefined }
  const client = new McpPersonalConnectClient(`http://127.0.0.1:${address.port}`, tokens as unknown as InstanceType<typeof McpPersonalTokenSource>)
  try {
    await client.authorization("complete", { ...identity, state: "opaque-state", code: "opaque-code" }, new AbortController().signal, performance.now() + 1_000)
    await client.authorization("createConnection", inputForConnection(), new AbortController().signal, performance.now() + 1_000)
    assert.deepEqual((seen[0] as { state: string; code: string }).state, "opaque-state")
    assert.deepEqual((seen[0] as { state: string; code: string }).code, "opaque-code")
    assert.deepEqual((seen[1] as { command: { commandId: string; requestDigest: string } }).command, {
      ...bindMcpPersonalConnection(inputForConnection()),
      $typeName: "kokoro.common.v1.CommandIdentity",
    })
  } finally {
    client.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
