import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { Code, ConnectError } from "@connectrpc/connect"
import { create } from "@bufbuild/protobuf"
import { parseMcpPersonalCommand } from "../src/http/mcp-personal-command-input.js"
import { bindMcpPersonalCommand } from "../src/infrastructure/clients/platform/mcp-personal-command-binding.js"
import {
  projectMcpPersonalResponse,
  projectMcpPersonalCommand,
  validateMcpPersonalCommand,
  mcpPersonalFault,
} from "../src/infrastructure/clients/platform/mcp-personal-response.js"
import {
  PersonalMcpConnectorSchema,
  CreatePersonalMcpConnectorResponseSchema,
  GetPersonalMcpConnectorResponseSchema,
  PersonalMcpProviderSchema,
  GetPersonalMcpProviderResponseSchema,
} from "../src/generated/platform-mcp-presentation-connect/kokoro/platform/v1/platform_runtime_pb.js"
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value))
const identity = { tenant: "tenant", subject: "subject", requestId: "request", commandId: "original-key" }
const fields = { provider_key: "test", connector_type: "mcp", display_name: "😀".repeat(100), description: "" }
test("A2 command input is closed UTF8/scalar and positive canonical safe decimal CAS", () => {
  assert.equal(parseMcpPersonalCommand("create", bytes(fields)).displayName, fields.display_name)
  for (const bad of [
    { ...fields, expected_state_version: "1" },
    { ...fields, display_name: "😀".repeat(101) },
    { ...fields, display_name: "\ud800" },
    { ...fields, description: null },
    { ...fields, connector_type: "unknown" },
  ])
    assert.throws(() => parseMcpPersonalCommand("create", bytes(bad)))
  assert.throws(() => parseMcpPersonalCommand("create", Buffer.from('{"provider_key":"test","provider_key":"evil"}')))
  assert.throws(() => parseMcpPersonalCommand("create", new Uint8Array([0xff])))
  assert.throws(() => parseMcpPersonalCommand("create", new Uint8Array(65_537)), /body_too_large/u)
  for (const version of ["0", "01", "-1", "1.0", "9007199254740992", 1, null])
    assert.throws(() => parseMcpPersonalCommand("remove", bytes({ expected_state_version: version })))
  assert.equal(parseMcpPersonalCommand("remove", bytes({ expected_state_version: "9007199254740991" })).expectedStateVersion, "9007199254740991")
  assert.throws(() => parseMcpPersonalCommand("enabled", bytes({ expected_state_version: "1", enabled: "true" })))
})
test("A2 digest exactly binds owner method/tenant/subject/enum and canonical CAS but not request id", () => {
  const input = { ...identity, ...parseMcpPersonalCommand("create", bytes({ ...fields, display_name: "Example" })) }
  const expected =
    '{"input":{"connector_type":3,"description":"","display_name":"Example","provider_key":"test"},"method":"kokoro.platform.v1.ProductMcpPersonalService/CreatePersonalMcpConnector","subject_id":"subject","tenant_id":"tenant"}'
  assert.deepEqual(bindMcpPersonalCommand("create", input), { commandId: "original-key", requestDigest: createHash("sha256").update(expected).digest("hex") })
  assert.equal(bindMcpPersonalCommand("create", { ...input, requestId: "new-request" }).requestDigest, bindMcpPersonalCommand("create", input).requestDigest)
  assert.notEqual(bindMcpPersonalCommand("create", { ...input, subject: "other" }).requestDigest, bindMcpPersonalCommand("create", input).requestDigest)
  assert.notEqual(bindMcpPersonalCommand("create", { ...input, displayName: "Changed" }).requestDigest, bindMcpPersonalCommand("create", input).requestDigest)
  const update = { ...identity, id: "connector", expectedStateVersion: "1", displayName: "Changed", description: "" }
  assert.notEqual(
    bindMcpPersonalCommand("update", update).requestDigest,
    bindMcpPersonalCommand("update", { ...update, expectedStateVersion: "2" }).requestDigest,
  )
})
test("A2 projects true metadata and presence without fabricated historical name or date", () => {
  const input = { ...identity, id: "connector" }
  const connector = create(PersonalMcpConnectorSchema, {
    connectorId: { value: "connector" },
    connectorType: 3,
    providerKey: "test",
    status: 1,
    enabled: true,
    stateVersion: 1n,
  })
  assert.deepEqual(projectMcpPersonalResponse("connector", create(GetPersonalMcpConnectorResponseSchema, { connector }), input), {
    connector: {
      connector_id: "connector",
      connector_type: "mcp",
      provider_key: "test",
      status: "pending",
      approved_scopes: [],
      enabled: true,
      state_version: "1",
    },
  })
  connector.displayName = "Real"
  connector.description = ""
  connector.createdAt = "2026-10-10T00:00:00.000Z"
  const projected = projectMcpPersonalResponse("connector", create(GetPersonalMcpConnectorResponseSchema, { connector }), input) as {
    connector: Record<string, unknown>
  }
  assert.equal(projected.connector.display_name, "Real")
  assert.equal(projected.connector.description, "")
  assert.equal(projected.connector.created_at, connector.createdAt)
  assert.ok(!Object.hasOwn(projected.connector, "updated_at"))
  connector.stateVersion = 0n
  assert.throws(() => projectMcpPersonalResponse("connector", create(GetPersonalMcpConnectorResponseSchema, { connector }), input))
})
test("A2 command ACK never creates connection/replay facts and is identity/state bound", () => {
  const connector = {
    connector_id: "connector",
    connector_type: "mcp",
    provider_key: "test",
    status: "revoked",
    approved_scopes: [],
    enabled: false,
    state_version: "2",
  }
  const input = { ...identity, id: "connector", expectedStateVersion: "1" }
  assert.deepEqual(validateMcpPersonalCommand("remove", { connector }, input), { connector })
  for (const bad of [
    { connector: { ...connector, enabled: true } },
    { connector: { ...connector, connector_id: "other" } },
    { connector, replayed: true },
    { connector: { ...connector, state_version: "9007199254740992" } },
  ])
    assert.throws(() => validateMcpPersonalCommand("remove", bad, input))
})
test("A2 provider projection contains only official directory facts, with safe optional URLs", () => {
  const provider = create(PersonalMcpProviderSchema, {
    providerKey: "test",
    displayName: "Real",
    directoryType: "data_source",
    categoryKeys: ["development"],
    examplePrompts: ["Real example"],
    enabled: true,
    stateVersion: 3n,
    coverImageUrl: "https://cdn.example.test/connectors/test.webp",
    updatedAt: "2026-10-11T12:34:56.000Z",
  })
  const input = { ...identity, id: "test" }
  const raw = () => create(GetPersonalMcpProviderResponseSchema, { provider })
  assert.deepEqual(projectMcpPersonalResponse("provider", raw(), input), {
    provider: {
      provider_key: "test",
      display_name: "Real",
      directory_type: "data_source",
      category_keys: ["development"],
      example_prompts: ["Real example"],
      enabled: true,
      state_version: "3",
      cover_image_url: "https://cdn.example.test/connectors/test.webp",
      updated_at: "2026-10-11T12:34:56.000Z",
    },
  })
  provider.website = "http://insecure.test"
  assert.throws(() => projectMcpPersonalResponse("provider", raw(), input))
  provider.website = "https://public.test"
  assert.throws(() => projectMcpPersonalResponse("provider", raw(), { ...input, id: "other" }))
})
test("A2 typed command errors preserve conflict/precondition/unknown semantics", () => {
  for (const [code, status, error, retryable] of [
    [Code.AlreadyExists, 409, "mcp_personal_idempotency_conflict", false],
    [Code.Aborted, 409, "mcp_personal_command_in_progress", true],
    [Code.FailedPrecondition, 412, "mcp_personal_precondition_failed", false],
    [Code.Unavailable, 503, "mcp_personal_dependency_unavailable", true],
  ] as const)
    assert.deepEqual(mcpPersonalFault(new ConnectError("safe", code), false, true), { status, code: error, retryable })
})

test("A2 Create projects actual generated disabled initial ACK and rejects fabricated enabled CAS or status", () => {
  const input = { ...identity, providerKey: "test", connectorType: "mcp" as const, displayName: "Real", description: "" }
  const connector = create(PersonalMcpConnectorSchema, {
    connectorId: { value: "connector" },
    connectorType: 3,
    providerKey: "test",
    status: 1,
    enabled: false,
    stateVersion: 1n,
    displayName: "Real",
    description: "",
  })
  const raw = () => create(CreatePersonalMcpConnectorResponseSchema, { connector })
  assert.equal((projectMcpPersonalCommand("create", raw(), input) as { connector: { enabled: boolean } }).connector.enabled, false)
  connector.status = 2
  assert.doesNotThrow(() => projectMcpPersonalCommand("create", raw(), input))
  connector.enabled = true
  assert.throws(() => projectMcpPersonalCommand("create", raw(), input))
  connector.enabled = false
  connector.stateVersion = 2n
  assert.throws(() => projectMcpPersonalCommand("create", raw(), input))
  connector.stateVersion = 1n
  connector.status = 3
  assert.throws(() => projectMcpPersonalCommand("create", raw(), input))
})
test("A2 real Connect command sends exact generated digest/key/CAS and uses shared close boundary", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ProductMcpPersonalService } = await import("../src/generated/platform-mcp-presentation-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const { McpPersonalConnectClient } = await import("../src/infrastructure/clients/platform/mcp-personal-connect.js")
  const { McpPersonalTokenSource } = await import("../src/infrastructure/clients/platform/mcp-personal-token.js")
  const seen: unknown[] = []
  const server = createServer(
    connectNodeAdapter({
      routes: (router) =>
        router.service(ProductMcpPersonalService, {
          updatePersonalMcpConnector: (request, context) => {
            seen.push(request)
            assert.equal(context.requestHeader.get("x-tenant-ref"), identity.tenant)
            assert.equal(context.requestHeader.get("x-kokoro-subject"), identity.subject)
            context.responseHeader.set("cache-control", "no-store")
            context.responseHeader.set("x-kokoro-request-id", request.requestId)
            return {
              connector: {
                connectorId: request.connectorId,
                connectorType: 3,
                providerKey: "test",
                status: 1,
                enabled: false,
                stateVersion: 2n,
                displayName: request.displayName,
                description: request.description,
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
  const input = { ...identity, id: "connector", expectedStateVersion: "1", displayName: "Updated", description: "" }
  try {
    for (let replay = 0; replay < 2; replay++) await client.command("update", input, new AbortController().signal, performance.now() + 1000)
    for (const raw of seen) {
      const request = raw as { expectedStateVersion: bigint; command: { commandId: string; requestDigest: string } }
      assert.equal(request.expectedStateVersion, 1n)
      assert.equal(request.command.commandId, input.commandId)
      assert.equal(request.command.requestDigest, bindMcpPersonalCommand("update", input).requestDigest)
    }
    const abort = new AbortController()
    abort.abort()
    await assert.rejects(client.command("update", input, abort.signal, performance.now() + 1000))
    assert.equal(seen.length, 2)
    client.close()
    await assert.rejects(client.command("update", input, new AbortController().signal, performance.now() + 1000), /closed/u)
  } finally {
    client.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
