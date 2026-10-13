import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { create } from "@bufbuild/protobuf"
import { parseMcpPersonalServer } from "../src/http/mcp-personal-server-input.js"
import { bindMcpPersonalServerRegistration } from "../src/infrastructure/clients/platform/mcp-personal-server-binding.js"
import { projectMcpPersonalServer } from "../src/infrastructure/clients/platform/mcp-personal-server-response.js"
import {
  PersonalMcpConnectorSchema,
  PersonalMcpServerSchema,
  RegisterPersonalMcpServerResponseSchema,
} from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value))
const input = {
  tenant: "tenant",
  subject: "subject",
  requestId: "request",
  commandId: "intent-1",
  displayName: "Private tools",
  serverUrl: "https://tools.example/mcp",
}

test("private URL MCP registration accepts only a name and canonical HTTPS URL", () => {
  assert.deepEqual(parseMcpPersonalServer("registerServer", bytes({ display_name: input.displayName, server_url: input.serverUrl })), {
    displayName: input.displayName,
    serverUrl: input.serverUrl,
  })
  for (const invalid of [
    { display_name: input.displayName, server_url: "http://tools.example/mcp" },
    { display_name: input.displayName, server_url: "https://user:pass@tools.example/mcp" },
    { display_name: input.displayName, server_url: "https://tools.example/mcp#fragment" },
    { display_name: input.displayName, server_url: input.serverUrl, tenant_id: "forged" },
    { display_name: input.displayName, server_url: input.serverUrl, declaration_digest: "forged" },
  ])
    assert.throws(() => parseMcpPersonalServer("registerServer", bytes(invalid)))
})

test("private URL MCP registration binds the owner method, trusted identity, and immutable browser intent", () => {
  const canonical =
    '{"input":{"display_name":"Private tools","server_url":"https://tools.example/mcp"},"method":"kokoro.platform.v1.ProductMcpPersonalService/RegisterPersonalMcpServer","subject_id":"subject","tenant_id":"tenant"}'
  assert.deepEqual(bindMcpPersonalServerRegistration(input), {
    commandId: "intent-1",
    requestDigest: createHash("sha256").update(canonical).digest("hex"),
  })
  assert.notEqual(
    bindMcpPersonalServerRegistration(input).requestDigest,
    bindMcpPersonalServerRegistration({ ...input, serverUrl: "https://tools.example/other" }).requestDigest,
  )
})

test("private URL MCP projection returns lifecycle facts but not declarations or OAuth credentials", () => {
  const server = create(PersonalMcpServerSchema, {
    serverId: { value: "server-one" },
    displayName: input.displayName,
    serverUrl: input.serverUrl,
    status: "pending",
    stateVersion: 1n,
  })
  const connector = create(PersonalMcpConnectorSchema, {
    connectorId: { value: "connector-one" },
    connectorType: 3,
    providerKey: "private-server-one",
    serverId: { value: "server-one" },
    status: 1,
    approvedScopes: [],
    enabled: false,
    stateVersion: 1n,
  })
  const raw = create(RegisterPersonalMcpServerResponseSchema, { server, connector })
  assert.deepEqual(projectMcpPersonalServer("registerServer", raw, input), {
    server: {
      server_id: "server-one",
      display_name: input.displayName,
      server_url: input.serverUrl,
      status: "pending",
      state_version: "1",
    },
    connector: {
      connector_id: "connector-one",
      connector_type: "mcp",
      provider_key: "private-server-one",
      server_id: "server-one",
      status: "pending",
      approved_scopes: [],
      enabled: false,
      state_version: "1",
    },
  })
  connector.serverId = { value: "other" }
  assert.throws(() => projectMcpPersonalServer("registerServer", raw, input))
})

test("private URL MCP Connect client forwards only the command body plus trusted request headers", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ProductMcpPersonalService } = await import("../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const { McpPersonalConnectClient } = await import("../src/infrastructure/clients/platform/mcp-personal-connect.js")
  const { McpPersonalTokenSource } = await import("../src/infrastructure/clients/platform/mcp-personal-token.js")
  let seen: unknown
  const server = createServer(
    connectNodeAdapter({
      routes: (router) =>
        router.service(ProductMcpPersonalService, {
          registerPersonalMcpServer: (request, context) => {
            seen = request
            assert.equal(context.requestHeader.get("x-tenant-ref"), input.tenant)
            assert.equal(context.requestHeader.get("x-kokoro-subject"), input.subject)
            context.responseHeader.set("cache-control", "no-store")
            context.responseHeader.set("x-kokoro-request-id", input.requestId)
            return {
              server: { serverId: { value: "server-one" }, displayName: input.displayName, serverUrl: input.serverUrl, status: "registered", stateVersion: 1n },
              connector: {
                connectorId: { value: "connector-one" },
                connectorType: 3,
                providerKey: "private-server-one",
                serverId: { value: "server-one" },
                status: 2,
                approvedScopes: [],
                enabled: false,
                stateVersion: 1n,
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
  const client = new McpPersonalConnectClient(`http://127.0.0.1:${address.port}`, tokens as unknown as McpPersonalTokenSource)
  try {
    const result = await client.server("registerServer", input, new AbortController().signal, performance.now() + 1_000)
    assert.equal((seen as { displayName: string }).displayName, input.displayName)
    assert.equal((seen as { serverUrl: string }).serverUrl, input.serverUrl)
    assert.deepEqual((seen as { command: unknown }).command, { ...bindMcpPersonalServerRegistration(input), $typeName: "kokoro.common.v1.CommandIdentity" })
    assert.deepEqual(result, {
      server: { server_id: "server-one", display_name: input.displayName, server_url: input.serverUrl, status: "registered", state_version: "1" },
      connector: {
        connector_id: "connector-one",
        connector_type: "mcp",
        provider_key: "private-server-one",
        server_id: "server-one",
        status: "active",
        approved_scopes: [],
        enabled: false,
        state_version: "1",
      },
    })
  } finally {
    client.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
