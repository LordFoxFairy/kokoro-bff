import assert from "node:assert/strict"
import test from "node:test"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import {
  ListPersonalMcpConnectorsResponseSchema,
  PersonalMcpConnectorSchema,
  GetPersonalMcpConnectionResponseSchema,
} from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { projectMcpPersonalResponse, validateMcpPersonalPublic, mcpPersonalFault } from "../src/infrastructure/clients/platform/mcp-personal-response.js"
const input = { tenant: "tenant", subject: "user", requestId: "test" }
const connector = {
  connector_id: "connector",
  connector_type: "mcp",
  provider_key: "github",
  status: "active",
  approved_scopes: [],
  enabled: true,
  state_version: "3",
  display_name: "private display",
}
const wireConnector = () =>
  create(PersonalMcpConnectorSchema, {
    connectorId: { value: "connector" },
    connectorType: 3,
    providerKey: "github",
    status: 2,
    approvedScopes: [],
    displayName: "private display",
    enabled: true,
    stateVersion: 3n,
  })

test("projects current generated owner fields with true optional metadata and CAS", () => {
  const raw = create(ListPersonalMcpConnectorsResponseSchema, { connectors: [wireConnector()], page: {} })
  assert.deepEqual(projectMcpPersonalResponse("connectors", raw, input), { items: [connector], next_cursor: null })
})
for (const field of ["connectorId", "connectorType", "status", "providerKey", "approvedScopes"] as const)
  test(`rejects invalid owner connector ${field}`, () => {
    const value = wireConnector()
    if (field === "connectorId") value.connectorId = undefined
    if (field === "connectorType") value.connectorType = 99
    if (field === "status") value.status = 0
    if (field === "providerKey") value.providerKey = "bad key"
    if (field === "approvedScopes") value.approvedScopes = ["x", "x"]
    assert.throws(() => projectMcpPersonalResponse("connectors", create(ListPersonalMcpConnectorsResponseSchema, { connectors: [value], page: {} }), input))
  })
test("rejects binary unknown fields, duplicate resources, status filters and cursor drift", () => {
  const value = wireConnector()
  value.$unknown = [{ no: 99, wireType: 0, data: new Uint8Array([1]) }]
  assert.throws(() => projectMcpPersonalResponse("connectors", create(ListPersonalMcpConnectorsResponseSchema, { connectors: [value], page: {} }), input))
  assert.throws(() => validateMcpPersonalPublic("connectors", { items: [connector, connector], next_cursor: null }, input))
  assert.throws(() => validateMcpPersonalPublic("connectors", { items: [connector], next_cursor: null }, { ...input, status: "revoked" }))
  assert.throws(() => validateMcpPersonalPublic("connectors", { items: [], next_cursor: "" }, input))
})
test("connection detail and list are strictly bound to requested resource", () => {
  const raw = create(GetPersonalMcpConnectionResponseSchema, {
    connection: {
      connectionId: { value: "connection" },
      connectorId: { value: "connector" },
      serverId: { value: "server" },
      allowedSelectors: [" tools.read "],
      policyDigest: "a".repeat(64),
      status: "active",
    },
  })
  assert.throws(() => projectMcpPersonalResponse("connection", raw, { ...input, id: "connection" }))
  raw.connection!.allowedSelectors = ["tools.read"]
  assert.throws(() => projectMcpPersonalResponse("connection", raw, { ...input, id: "other" }))
  const result = projectMcpPersonalResponse("connection", raw, { ...input, id: "connection" }) as { connection: unknown }
  assert.throws(() => validateMcpPersonalPublic("connections", { items: [result.connection], next_cursor: null }, { ...input, id: "other" }))
})
for (const [code, status] of [
  [Code.NotFound, 404],
  [Code.InvalidArgument, 502],
  [Code.Canceled, 503],
  [Code.DeadlineExceeded, 503],
  [Code.PermissionDenied, 503],
  [Code.Internal, 502],
] as const)
  test(`owner code ${code} maps only to personal status ${status}`, () => {
    assert.equal(mcpPersonalFault(new ConnectError("private owner error", code)).status, status)
  })
test("bounded real Connect transport binds body/header identity and rejects owner header drift", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ProductMcpPersonalService } = await import("../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const { McpPersonalConnectClient } = await import("../src/infrastructure/clients/platform/mcp-personal-connect.js")
  let mode = "valid"
  const seen: Array<{ id: string; tenant: string | null; subject: string | null; requestId: string | null; authorization: string | null }> = []
  const server = createServer(
    connectNodeAdapter({
      routes: (router) => {
        router.service(ProductMcpPersonalService, {
          listPersonalMcpConnectors: (request, context) => {
            seen.push({
              id: request.requestId,
              authorization: context.requestHeader.get("authorization"),
              tenant: context.requestHeader.get("x-kokoro-tenant"),
              subject: context.requestHeader.get("x-kokoro-subject"),
              requestId: context.requestHeader.get("x-kokoro-request-id"),
            })
            context.responseHeader.set("x-kokoro-request-id", mode === "wrong-id" ? "wrong" : request.requestId)
            if (mode !== "missing-cache") context.responseHeader.set("cache-control", "no-store")
            return { connectors: [wireConnector()], page: {} }
          },
        })
      },
    }),
  )
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const tokens = { get: async () => "workload", retire: () => undefined, close: () => undefined }
  const client = new McpPersonalConnectClient(`http://127.0.0.1:${address.port}`, tokens)
  try {
    assert.deepEqual(await client.read("connectors", input, new AbortController().signal, performance.now() + 1000), { items: [connector], next_cursor: null })
    assert.deepEqual(seen[0], {
      id: input.requestId,
      tenant: input.tenant,
      subject: input.subject,
      requestId: input.requestId,
      authorization: "Bearer workload",
    })
    for (mode of ["wrong-id", "missing-cache"])
      await assert.rejects(client.read("connectors", input, new AbortController().signal, performance.now() + 1000), /response_invalid/u)
    client.close()
    await assert.rejects(client.read("connectors", input, new AbortController().signal, performance.now() + 1000), /closed/u)
  } finally {
    client.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("owner opaque cursor rejection is the only InvalidArgument mapped to public 400", () => {
  assert.equal(mcpPersonalFault(new ConnectError("cursor", Code.InvalidArgument), true).status, 400)
})
