import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { create } from "@bufbuild/protobuf"
import { parseMcpPersonalServer } from "../src/http/mcp-personal-server-input.js"
import { parseMcpPersonalJsonImport } from "../src/http/mcp-personal-json-import-input.js"
import { bindMcpPersonalServerCommand, bindMcpPersonalServerRegistration } from "../src/infrastructure/clients/platform/mcp-personal-server-binding.js"
import { bindMcpPersonalJsonImport } from "../src/infrastructure/clients/platform/mcp-personal-json-import-binding.js"
import { projectMcpPersonalJsonImport } from "../src/infrastructure/clients/platform/mcp-personal-json-import-response.js"
import { projectMcpPersonalServer } from "../src/infrastructure/clients/platform/mcp-personal-server-response.js"
import { mcpPersonalFault } from "../src/infrastructure/clients/platform/mcp-personal-response.js"
import { mcpPersonalPreconditionFault } from "../src/infrastructure/clients/platform/connector-command-fault.js"
import { Code, ConnectError } from "@connectrpc/connect"
import {
  PersonalMcpErrorDetailSchema,
  PersonalMcpErrorReason,
  PersonalMcpPrepareStatus,
  PersonalMcpConnectorSchema,
  PersonalMcpServerSchema,
  GetPersonalMcpServerResponseSchema,
  PreparePersonalMcpServerResponseSchema,
  RegisterPersonalMcpServerResponseSchema,
  ImportPersonalMcpJsonResponseSchema,
  DeletePersonalMcpServerResponseSchema,
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

test("private URL MCP registration accepts strict notes, secret headers and BYO OAuth without browser-owned identity", () => {
  assert.deepEqual(
    parseMcpPersonalServer(
      "registerServer",
      bytes({
        display_name: input.displayName,
        server_url: input.serverUrl,
        notes: "Internal only",
        headers: [{ name: "X-API-Key", value: "header-secret" }],
        oauth_client: {
          client_id: "client-one",
          client_secret: "client-secret",
        },
      }),
    ),
    {
      displayName: input.displayName,
      serverUrl: input.serverUrl,
      notes: "Internal only",
      headers: [{ name: "x-api-key", value: "header-secret" }],
      oauthClient: { clientId: "client-one", clientSecret: "client-secret" },
    },
  )
  for (const invalid of [
    { display_name: input.displayName, server_url: "http://tools.example/mcp" },
    {
      display_name: input.displayName,
      server_url: "https://user:pass@tools.example/mcp",
    },
    {
      display_name: input.displayName,
      server_url: "https://tools.example/mcp#fragment",
    },
    {
      display_name: input.displayName,
      server_url: "https://tools.example/mcp?tenant=forged",
    },
    {
      display_name: input.displayName,
      server_url: input.serverUrl,
      tenant_id: "forged",
    },
    {
      display_name: input.displayName,
      server_url: input.serverUrl,
      declaration_digest: "forged",
    },
    {
      display_name: input.displayName,
      server_url: input.serverUrl,
      headers: [{ name: "authorization", value: "secret" }],
    },
    {
      display_name: input.displayName,
      server_url: input.serverUrl,
      headers: [
        { name: "X-Key", value: "one" },
        { name: "x-key", value: "two" },
      ],
    },
    {
      display_name: input.displayName,
      server_url: input.serverUrl,
      oauth_client: { client_id: "client" },
    },
  ])
    assert.throws(() => parseMcpPersonalServer("registerServer", bytes(invalid)))
})

test("private URL MCP registration admits loopback HTTP only in a development runtime", () => {
  const previous = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = "development"
    assert.deepEqual(
      parseMcpPersonalServer(
        "registerServer",
        bytes({
          display_name: "Local fixture",
          server_url: "http://127.0.0.1:43191/mcp",
        }),
      ),
      {
        displayName: "Local fixture",
        serverUrl: "http://127.0.0.1:43191/mcp",
        headers: [],
      },
    )
    process.env.NODE_ENV = "production"
    assert.throws(() =>
      parseMcpPersonalServer(
        "registerServer",
        bytes({
          display_name: "Local fixture",
          server_url: "http://127.0.0.1:43191/mcp",
        }),
      ),
    )
  } finally {
    process.env.NODE_ENV = previous
  }
})

test("private URL MCP GET projects declarations_available and the full safe declaration snapshot in one response", () => {
  const server = create(PersonalMcpServerSchema, {
    transport: 2,
    availability: 5,
    serverId: { value: "server-one" },
    displayName: input.displayName,
    serverUrl: input.serverUrl,
    status: "registered",
    stateVersion: 4n,
    prepareStatus: PersonalMcpPrepareStatus.READY,
    authorizationStatus: "approved",
    declarationsAvailable: true,
    declarationDigest: "a".repeat(64),
    connectionId: { value: "connection-one" },
    declarations: [
      {
        kind: {
          case: "tool",
          value: {
            selector: "tools/list",
            displayName: "List tools",
            inputSchemaDigest: "b".repeat(64),
            requiredScopes: ["tools.read"],
          },
        },
      },
    ],
  })
  assert.deepEqual(projectMcpPersonalServer("server", create(GetPersonalMcpServerResponseSchema, { server }), { ...input, id: "server-one" }), {
    server: {
      transport: "streamable_http",
      server_id: "server-one",
      availability: "unavailable",
      display_name: input.displayName,
      server_url: input.serverUrl,
      status: "registered",
      state_version: "4",
      headers: [],
      prepare_status: "ready",
      authorization_status: "approved",
      declarations: [
        {
          kind: "tool",
          selector: "tools/list",
          display_name: "List tools",
          input_schema_digest: "b".repeat(64),
          required_scopes: ["tools.read"],
        },
      ],
      declaration_digest: "a".repeat(64),
      connection_id: "connection-one",
      declarations_available: true,
    },
  })
  const previous = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = "development"
    const local = create(PersonalMcpServerSchema, {
      transport: 2,
      availability: 5,
      ...server,
      serverUrl: "http://127.0.0.1:43191/mcp",
    })
    assert.equal(
      (
        projectMcpPersonalServer("server", create(GetPersonalMcpServerResponseSchema, { server: local }), { ...input, id: "server-one" }) as {
          server: { server_url: string }
        }
      ).server.server_url,
      "http://127.0.0.1:43191/mcp",
    )
  } finally {
    process.env.NODE_ENV = previous
  }
})

test("private URL MCP prepare and update require strict CAS and reject ambiguous or empty changes", () => {
  assert.deepEqual(parseMcpPersonalServer("prepareServer", bytes({ expected_state_version: "1" })), { expectedStateVersion: "1" })
  assert.deepEqual(parseMcpPersonalServer("deleteServer", bytes({ expected_state_version: "3" })), { expectedStateVersion: "3" })
  assert.throws(() => parseMcpPersonalServer("deleteServer", bytes({ expected_state_version: "3", extra: true })))
  assert.deepEqual(
    parseMcpPersonalServer(
      "updateServer",
      bytes({
        expected_state_version: "2",
        display_name: "Renamed",
        clear_notes: true,
        header_upserts: [{ name: "X-New", value: "new-secret" }],
        header_removals: ["X-Old"],
        revoke_oauth_client: true,
      }),
    ),
    {
      expectedStateVersion: "2",
      displayName: "Renamed",
      clearNotes: true,
      headerUpserts: [{ name: "x-new", value: "new-secret" }],
      headerRemovals: ["x-old"],
      revokeOauthClient: true,
    },
  )
  for (const invalid of [
    { expected_state_version: "0" },
    { expected_state_version: "2147483648" },
    { expected_state_version: "1", clear_notes: false },
    { expected_state_version: "1", notes: "new", clear_notes: true },
    {
      expected_state_version: "1",
      oauth_client: { client_id: "one", client_secret: "secret" },
      revoke_oauth_client: true,
    },
    {
      expected_state_version: "1",
      header_upserts: [{ name: "x-key", value: "secret" }],
      header_removals: ["X-Key"],
    },
  ])
    assert.throws(() => parseMcpPersonalServer("updateServer", bytes(invalid)))
})

test("private URL MCP registration binds the owner method, trusted identity, and immutable browser intent", () => {
  const canonical =
    '{"input":{"display_name":"Private tools","headers":[],"notes":null,"oauth_client_id":null,"oauth_client_present":false,"server_url":"https://tools.example/mcp"},"method":"kokoro.platform.v1.ProductMcpPersonalService/RegisterPersonalMcpServer","subject_id":"subject","tenant_id":"tenant"}'
  assert.deepEqual(bindMcpPersonalServerRegistration(input), {
    commandId: "intent-1",
    requestDigest: createHash("sha256").update(canonical).digest("hex"),
  })
  assert.notEqual(
    bindMcpPersonalServerRegistration(input).requestDigest,
    bindMcpPersonalServerRegistration({
      ...input,
      serverUrl: "https://tools.example/other",
    }).requestDigest,
  )
  const secretInput = {
    ...input,
    headers: [{ name: "x-api-key", value: "secret-one" }],
    oauthClient: { clientId: "client-one", clientSecret: "secret-one" },
  }
  assert.deepEqual(
    bindMcpPersonalServerCommand("registerServer", secretInput),
    bindMcpPersonalServerCommand("registerServer", {
      ...secretInput,
      headers: [{ name: "x-api-key", value: "secret-two" }],
      oauthClient: { clientId: "client-one", clientSecret: "secret-two" },
    }),
  )
  assert.notDeepEqual(
    bindMcpPersonalServerCommand("registerServer", secretInput),
    bindMcpPersonalServerCommand("registerServer", {
      ...secretInput,
      oauthClient: { ...secretInput.oauthClient, clientId: "client-two" },
    }),
  )
  assert.notDeepEqual(
    bindMcpPersonalServerCommand("updateServer", {
      ...input,
      id: "server-one",
      expectedStateVersion: "2",
      clearNotes: false,
      headerUpserts: [{ name: "x-api-key", value: "secret" }],
      headerRemovals: [],
      revokeOauthClient: false,
    }),
    bindMcpPersonalServerCommand("prepareServer", {
      ...input,
      id: "server-one",
      expectedStateVersion: "2",
    }),
  )
  assert.notDeepEqual(
    bindMcpPersonalServerCommand("deleteServer", {
      ...input,
      id: "server-one",
      expectedStateVersion: "2",
    }),
    bindMcpPersonalServerCommand("prepareServer", {
      ...input,
      id: "server-one",
      expectedStateVersion: "2",
    }),
  )
})

test("JSON import preserves the Manus-shaped document and binds only the safe HTTP metadata", () => {
  const configJson = JSON.stringify({
    mcpServers: {
      Remote: {
        type: "streamableHttp",
        url: "https://tools.example/mcp",
        headers: { "X-API-Key": "secret" },
      },
    },
  })
  assert.deepEqual(parseMcpPersonalJsonImport(bytes({ config_json: configJson })), { configJson })
  const canonical =
    '{"input":{"servers":[{"display_name":"Remote","headers":["x-api-key"],"notes":null,"server_url":"https://tools.example/mcp"}]},"method":"kokoro.platform.v1.ProductMcpPersonalService/ImportPersonalMcpJson","subject_id":"subject","tenant_id":"tenant"}'
  const bound = bindMcpPersonalJsonImport({
    tenant: "tenant",
    subject: "subject",
    requestId: "request",
    commandId: "intent-import",
    configJson,
  })
  assert.deepEqual(bound, {
    commandId: "intent-import",
    requestDigest: createHash("sha256").update(canonical).digest("hex"),
  })
  assert.equal(
    bindMcpPersonalJsonImport({
      ...bound,
      tenant: "tenant",
      subject: "subject",
      requestId: "request",
      commandId: "intent-stdio",
      configJson: JSON.stringify({
        mcpServers: { Local: { command: "node", args: ["server.js"] } },
      }),
    }).requestDigest.length,
    64,
  )
  assert.throws(() => parseMcpPersonalJsonImport(bytes({ config_json: "" })))
  assert.throws(() => parseMcpPersonalJsonImport(bytes({ config_json: configJson, extra: true })))
})

test("private URL MCP delete projects only the owner acknowledgement", () => {
  const raw = create(DeletePersonalMcpServerResponseSchema, {
    serverId: { value: "server-one" },
    deleted: true,
    replayed: true,
  })
  assert.deepEqual(
    projectMcpPersonalServer("deleteServer", raw, {
      ...input,
      id: "server-one",
      expectedStateVersion: "4",
    }),
    {
      server_id: "server-one",
      deleted: true,
      replayed: true,
    },
  )
  assert.throws(() =>
    projectMcpPersonalServer(
      "deleteServer",
      create(DeletePersonalMcpServerResponseSchema, {
        serverId: { value: "other" },
        deleted: true,
        replayed: false,
      }),
      {
        ...input,
        id: "server-one",
        expectedStateVersion: "4",
      },
    ),
  )
})

test("private URL MCP projection returns the complete safe descriptor without secret values", () => {
  const server = create(PersonalMcpServerSchema, {
    transport: 2,
    availability: 5,
    serverId: { value: "server-one" },
    displayName: input.displayName,
    serverUrl: input.serverUrl,
    status: "pending",
    stateVersion: 1n,
    notes: "Internal only",
    headers: [
      {
        name: "x-api-key",
        configured: true,
        stateVersion: 1n,
        status: "active",
      },
    ],
    oauthClient: {
      clientId: "client-one",
      configured: true,
      origin: "byo",
      status: "configured",
      stateVersion: 1n,
    },
    prepareStatus: PersonalMcpPrepareStatus.PENDING_PREPARE,
    declarationsAvailable: false,
  })
  const connector = create(PersonalMcpConnectorSchema, {
    availability: 5,
    connectorId: { value: "connector-one" },
    connectorType: 3,
    providerKey: "private-server-one",
    serverId: { value: "server-one" },
    status: 1,
    approvedScopes: [],
    enabled: false,
    stateVersion: 1n,
  })
  const raw = create(RegisterPersonalMcpServerResponseSchema, {
    server,
    connector,
    replayed: false,
  })
  const projected = projectMcpPersonalServer("registerServer", raw, {
    ...input,
    notes: "Internal only",
    headers: [{ name: "x-api-key", value: "header-secret" }],
    oauthClient: { clientId: "client-one", clientSecret: "client-secret" },
  })
  assert.deepEqual(projected, {
    server: {
      transport: "streamable_http",
      server_id: "server-one",
      availability: "unavailable",
      display_name: input.displayName,
      server_url: input.serverUrl,
      status: "pending",
      state_version: "1",
      notes: "Internal only",
      headers: [
        {
          name: "x-api-key",
          configured: true,
          state_version: "1",
          status: "active",
        },
      ],
      oauth_client: {
        client_id: "client-one",
        configured: true,
        origin: "byo",
        status: "configured",
        state_version: "1",
      },
      prepare_status: "pending_prepare",
      declarations: [],
      declarations_available: false,
    },
    connector: {
      connector_id: "connector-one",
      availability: "unavailable",
      connector_type: "mcp",
      provider_key: "private-server-one",
      server_id: "server-one",
      status: "pending",
      approved_scopes: [],
      enabled: false,
      state_version: "1",
    },
    replayed: false,
  })
  assert.equal(JSON.stringify(projected).includes("header-secret"), false)
  assert.equal(JSON.stringify(projected).includes("client-secret"), false)
  connector.serverId = { value: "other" }
  assert.throws(() => projectMcpPersonalServer("registerServer", raw, input))
})

test("JSON import projects newly allocated server descriptors without inventing a selector", () => {
  const server = create(PersonalMcpServerSchema, {
    transport: 2,
    availability: 5,
    serverId: { value: "server-imported" },
    displayName: "Imported MCP",
    serverUrl: "https://imported.example/mcp",
    status: "pending",
    stateVersion: 1n,
    prepareStatus: PersonalMcpPrepareStatus.PENDING_PREPARE,
    declarationsAvailable: false,
  })
  const connector = create(PersonalMcpConnectorSchema, {
    availability: 5,
    connectorId: { value: "connector-imported" },
    connectorType: 3,
    providerKey: "private-server-imported",
    serverId: { value: "server-imported" },
    status: 1,
    approvedScopes: [],
    enabled: false,
    stateVersion: 1n,
  })
  assert.deepEqual(
    projectMcpPersonalJsonImport(
      create(ImportPersonalMcpJsonResponseSchema, {
        imports: [{ server, connector }],
        replayed: false,
      }),
      {
        ...input,
        configJson: JSON.stringify({
          mcpServers: {
            "Imported MCP": {
              type: "streamableHttp",
              url: "https://imported.example/mcp",
            },
          },
        }),
      },
    ),
    {
      imports: [
        {
          server: {
            transport: "streamable_http",
            server_id: "server-imported",
            availability: "unavailable",
            display_name: "Imported MCP",
            server_url: "https://imported.example/mcp",
            status: "pending",
            state_version: "1",
            headers: [],
            prepare_status: "pending_prepare",
            declarations: [],
            declarations_available: false,
          },
          connector: {
            connector_id: "connector-imported",
            availability: "unavailable",
            connector_type: "mcp",
            provider_key: "private-server-imported",
            server_id: "server-imported",
            status: "pending",
            approved_scopes: [],
            enabled: false,
            state_version: "1",
          },
        },
      ],
      replayed: false,
    },
  )
})

test("private URL MCP Connect client forwards only the command body plus trusted request headers", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ProductMcpPersonalService } = await import("../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const { McpPersonalConnectClient } = await import("../src/infrastructure/clients/platform/mcp-personal-connect.js")
  let seen: unknown
  let seenDelete: unknown
  let deleteCalls = 0
  const wireInput = {
    ...input,
    notes: "Internal only",
    headers: [{ name: "x-api-key", value: "header-secret" }],
    oauthClient: { clientId: "client-one", clientSecret: "client-secret" },
  }
  const server = createServer(
    connectNodeAdapter({
      routes: (router) =>
        router.service(ProductMcpPersonalService, {
          registerPersonalMcpServer: (request, context) => {
            seen = request
            assert.equal(context.requestHeader.get("x-kokoro-tenant"), input.tenant)
            assert.equal(context.requestHeader.get("x-kokoro-subject"), input.subject)
            context.responseHeader.set("cache-control", "no-store")
            context.responseHeader.set("x-kokoro-request-id", input.requestId)
            return {
              server: {
                transport: 2,
                availability: 5,
                serverId: { value: "server-one" },
                displayName: input.displayName,
                serverUrl: input.serverUrl,
                status: "registered",
                stateVersion: 1n,
                notes: wireInput.notes,
                headers: [
                  {
                    name: "x-api-key",
                    configured: true,
                    stateVersion: 1n,
                    status: "active",
                  },
                ],
                oauthClient: {
                  clientId: "client-one",
                  configured: true,
                  origin: "byo",
                  status: "configured",
                  stateVersion: 1n,
                },
                prepareStatus: PersonalMcpPrepareStatus.PENDING_PREPARE,
                declarationsAvailable: false,
              },
              connector: {
                availability: 5,
                connectorId: { value: "connector-one" },
                connectorType: 3,
                providerKey: "private-server-one",
                serverId: { value: "server-one" },
                status: 2,
                approvedScopes: [],
                enabled: false,
                stateVersion: 1n,
              },
              replayed: false,
            }
          },
          deletePersonalMcpServer: (request, context) => {
            deleteCalls++
            seenDelete = request
            assert.equal(context.requestHeader.get("x-kokoro-tenant"), input.tenant)
            assert.equal(context.requestHeader.get("x-kokoro-subject"), input.subject)
            context.responseHeader.set("cache-control", "no-store")
            context.responseHeader.set("x-kokoro-request-id", input.requestId)
            return {
              serverId: request.serverId,
              deleted: true,
              replayed: false,
            }
          },
        }),
    }),
  )
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const tokens = {
    get: async () => "workload",
    retire: () => undefined,
    close: () => undefined,
  }
  const client = new McpPersonalConnectClient(`http://127.0.0.1:${address.port}`, tokens)
  try {
    const result = await client.server("registerServer", wireInput, new AbortController().signal, performance.now() + 1_000)
    assert.equal((seen as { displayName: string }).displayName, input.displayName)
    assert.equal((seen as { serverUrl: string }).serverUrl, input.serverUrl)
    assert.deepEqual((seen as { command: unknown }).command, {
      ...bindMcpPersonalServerRegistration(wireInput),
      $typeName: "kokoro.common.v1.CommandIdentity",
    })
    assert.deepEqual((seen as { headers: unknown }).headers, [
      {
        $typeName: "kokoro.platform.v1.PersonalMcpHeaderWrite",
        name: "x-api-key",
        value: "header-secret",
      },
    ])
    assert.deepEqual((seen as { oauthClient: unknown }).oauthClient, {
      $typeName: "kokoro.platform.v1.PersonalMcpOAuthClientWrite",
      clientId: "client-one",
      clientSecret: "client-secret",
    })
    assert.deepEqual(result, {
      server: {
        transport: "streamable_http",
        server_id: "server-one",
        availability: "unavailable",
        display_name: input.displayName,
        server_url: input.serverUrl,
        status: "registered",
        state_version: "1",
        notes: "Internal only",
        headers: [
          {
            name: "x-api-key",
            configured: true,
            state_version: "1",
            status: "active",
          },
        ],
        oauth_client: {
          client_id: "client-one",
          configured: true,
          origin: "byo",
          status: "configured",
          state_version: "1",
        },
        prepare_status: "pending_prepare",
        declarations: [],
        declarations_available: false,
      },
      connector: {
        connector_id: "connector-one",
        availability: "unavailable",
        connector_type: "mcp",
        provider_key: "private-server-one",
        server_id: "server-one",
        status: "active",
        approved_scopes: [],
        enabled: false,
        state_version: "1",
      },
      replayed: false,
    })
    assert.equal(JSON.stringify(result).includes("header-secret"), false)
    assert.equal(JSON.stringify(result).includes("client-secret"), false)
    const deleteInput = {
      ...input,
      id: "server-one",
      expectedStateVersion: "1",
      commandId: "delete-intent",
    }
    assert.deepEqual(await client.server("deleteServer", deleteInput, new AbortController().signal, performance.now() + 1_000), {
      server_id: "server-one",
      deleted: true,
      replayed: false,
    })
    assert.equal(deleteCalls, 1)
    assert.deepEqual(seenDelete, {
      $typeName: "kokoro.platform.v1.DeletePersonalMcpServerRequest",
      requestId: input.requestId,
      command: {
        ...bindMcpPersonalServerCommand("deleteServer", deleteInput),
        $typeName: "kokoro.common.v1.CommandIdentity",
      },
      serverId: {
        $typeName: "kokoro.platform.v1.McpServerId",
        value: "server-one",
      },
      expectedStateVersion: 1n,
    })
  } finally {
    client.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("private URL MCP strictly decodes typed owner preconditions and rejects invalid nonempty details", () => {
  for (const [reason, code] of [
    [PersonalMcpErrorReason.NOT_PREPARED, "mcp_personal_not_prepared"],
    [PersonalMcpErrorReason.NEEDS_CLIENT, "mcp_personal_needs_client"],
    [PersonalMcpErrorReason.AUTH_METHOD_UNSUPPORTED, "mcp_personal_auth_method_unsupported"],
  ] as const)
    assert.deepEqual(
      mcpPersonalPreconditionFault(
        new ConnectError("private owner detail", Code.FailedPrecondition, undefined, [{ desc: PersonalMcpErrorDetailSchema, value: { reason } }]),
      ),
      {
        status: 412,
        code,
        retryable: false,
      },
    )
  for (const details of [
    [{ desc: PersonalMcpErrorDetailSchema, value: { reason: PersonalMcpErrorReason.UNSPECIFIED } }],
    [{ desc: PersonalMcpErrorDetailSchema, value: { reason: 99 } }],
    [
      { desc: PersonalMcpErrorDetailSchema, value: { reason: PersonalMcpErrorReason.NOT_PREPARED } },
      { desc: PersonalMcpErrorDetailSchema, value: { reason: PersonalMcpErrorReason.NEEDS_CLIENT } },
    ],
    [{ type: "unexpected.Detail", value: new Uint8Array() }],
    [{ type: PersonalMcpErrorDetailSchema.typeName, value: new Uint8Array([255]) }],
  ])
    assert.deepEqual(mcpPersonalPreconditionFault(new ConnectError("not a classification input", Code.FailedPrecondition, undefined, details)), {
      status: 502,
      code: "mcp_personal_response_invalid",
      retryable: false,
    })
  assert.equal(mcpPersonalPreconditionFault(new ConnectError("unavailable", Code.Unavailable)), null)
})

test("connector receipt classifiers consume only the pinned marker/code and publish one private recovery policy", async () => {
  const { connectorCommandFault, CONNECTOR_COMMAND_FAULT_POLICY } = await import("../src/infrastructure/clients/platform/connector-command-fault.js")
  const { readFile } = await import("node:fs/promises")
  assert.deepEqual(JSON.parse(await readFile(new URL("../contract/connector-command-errors-v1.json", import.meta.url), "utf8")), CONNECTOR_COMMAND_FAULT_POLICY)
  assert.equal(CONNECTOR_COMMAND_FAULT_POLICY.automatic_retries, false)
  assert.equal(CONNECTOR_COMMAND_FAULT_POLICY.new_command_authorized, false)
  for (const surface of ["mcp", "custom_api"] as const) {
    for (const [reason, rpcCode] of [
      ["in_progress", Code.Aborted],
      ["outcome_unknown", Code.Unavailable],
      ["replay_expired", Code.FailedPrecondition],
      ["identity_conflict", Code.AlreadyExists],
      ["ownership_lost", Code.Aborted],
      ["invalid", Code.Internal],
    ] as const) {
      const expected = CONNECTOR_COMMAND_FAULT_POLICY[surface][reason]
      const actual = connectorCommandFault(
        new ConnectError("not a decision source", rpcCode, { "x-kokoro-error-code": `command_receipt_${reason}` }),
        surface,
        true,
      )
      assert.deepEqual(actual, { status: expected.status, code: expected.code, retryable: expected.retryable })
    }
  }
})

test("connector receipt markers fail closed when ambiguous, out of scope or inconsistent, without message guessing", async () => {
  const { connectorCommandFault } = await import("../src/infrastructure/clients/platform/connector-command-fault.js")
  const marker = "command_receipt_outcome_unknown"
  for (const surface of ["mcp", "custom_api"] as const) {
    const cases: Array<[unknown, boolean]> = [
      [new ConnectError("safe", Code.AlreadyExists, { "x-kokoro-error-code": marker }), true],
      [new ConnectError("safe", Code.Unavailable, { "x-kokoro-error-code": "command_receipt_future" }), true],
      [new ConnectError("safe", Code.Unavailable, { "x-kokoro-error-code": `${marker}, ${marker}` }), true],
      [new ConnectError("safe", Code.Unavailable, { "x-kokoro-error-code": "" }), true],
      [new ConnectError("safe", Code.Unavailable, { "x-kokoro-error-code": "publish_dependency_unavailable" }), true],
      [new ConnectError("safe", Code.Unavailable, { "x-kokoro-error-code": marker }), false],
      [
        new ConnectError("safe", Code.Unavailable, { "x-kokoro-error-code": marker }, [
          { desc: PersonalMcpErrorDetailSchema, value: { reason: PersonalMcpErrorReason.NEEDS_CLIENT } },
        ]),
        true,
      ],
    ]
    for (const [failure, mutation] of cases)
      assert.deepEqual(connectorCommandFault(failure, surface, mutation), {
        status: 502,
        code: surface === "mcp" ? "mcp_personal_response_invalid" : "custom_api_response_invalid",
        retryable: false,
      })
    assert.equal(connectorCommandFault(new Error(marker), surface, true), null)
    assert.equal(connectorCommandFault(new ConnectError(marker, Code.Unavailable), surface, true), null)
  }
})

// Returned descriptors retain revoked history; only input/current execution configuration has a 32-active limit.
test("private server reads retain revoked header history alongside 32 current slots", () => {
  const server = create(PersonalMcpServerSchema, {
    transport: 2,
    availability: 5,
    serverId: { value: "server-history" },
    displayName: "History",
    serverUrl: "https://tools.example/mcp",
    status: "pending",
    stateVersion: 1n,
    prepareStatus: PersonalMcpPrepareStatus.PENDING_PREPARE,
    declarationsAvailable: false,
    headers: Array.from({ length: 33 }, (_, index) => ({
      name: `x-fixture-${index}`,
      configured: index !== 0,
      status: index === 0 ? "revoked" : "active",
      stateVersion: 1n,
    })),
  })
  const result = projectMcpPersonalServer("server", create(GetPersonalMcpServerResponseSchema, { server }), { ...input, id: "server-history" }) as {
    server: { headers: { configured: boolean }[]; availability: string }
  }
  assert.equal(result.server.headers.length, 33)
  assert.equal(result.server.headers.filter((row) => row.configured).length, 32)
})

// Scope contraction commits renewed credentials, then rejects the original Prepare CAS.
// The owner's generic FailedPrecondition is valid; it is not a malformed success.
test("private Prepare preserves a generic owner CAS precondition without inventing a typed reason", () => {
  const error = new ConnectError("not a classification input", Code.FailedPrecondition)
  const fault = mcpPersonalPreconditionFault(error) ?? mcpPersonalFault(error, false, true)
  assert.deepEqual(fault, { status: 412, code: "mcp_personal_precondition_failed", retryable: false })
})

for (const kind of ["tool", "resource", "prompt"] as const) {
  test(`private MCP ${kind} discovery preserves long owner display text in reads and replayed prepare receipts`, () => {
    for (const displayName of ["x".repeat(2006), "界".repeat(334) + "\nSecond paragraph"]) {
      const declaration = {
        kind: {
          case: kind,
          value: { selector: "read_docs", displayName, ...(kind === "tool" ? { inputSchemaDigest: "b".repeat(64), requiredScopes: [] } : {}) },
        },
      }
      const server = create(PersonalMcpServerSchema, {
        transport: 2,
        availability: 1,
        serverId: { value: "server-one" },
        displayName: input.displayName,
        serverUrl: input.serverUrl,
        status: "registered",
        stateVersion: 2n,
        prepareStatus: PersonalMcpPrepareStatus.READY,
        declarationsAvailable: true,
        declarationDigest: "a".repeat(64),
        declarations: [declaration],
      })
      const connector = create(PersonalMcpConnectorSchema, {
        availability: 1,
        connectorId: { value: "connector-one" },
        connectorType: 3,
        providerKey: "private-server-one",
        serverId: { value: "server-one" },
        status: 2,
        enabled: true,
        stateVersion: 2n,
      })
      const read = projectMcpPersonalServer("server", create(GetPersonalMcpServerResponseSchema, { server }), { ...input, id: "server-one" })
      assert.equal((read as { server: { declarations: { display_name: string }[] } }).server.declarations[0]?.display_name, displayName)
      for (const replayed of [false, true]) {
        const prepared = projectMcpPersonalServer(
          "prepareServer",
          create(PreparePersonalMcpServerResponseSchema, {
            server,
            connector,
            declarations: server.declarations,
            replayed,
          }),
          { ...input, id: "server-one", expectedStateVersion: "1" },
        ) as {
          server: { declaration_digest: string; declarations: { display_name: string }[] }
          declarations: { display_name: string }[]
          replayed: boolean
        }
        assert.equal(prepared.server.declarations[0]?.display_name, displayName)
        assert.equal(prepared.declarations[0]?.display_name, displayName)
        assert.equal(prepared.server.declaration_digest, "a".repeat(64))
        assert.equal(prepared.replayed, replayed)
      }
      server.declarations[0]!.kind.value!.displayName = "invalid\uD800text"
      assert.throws(() => projectMcpPersonalServer("server", create(GetPersonalMcpServerResponseSchema, { server }), { ...input, id: "server-one" }))
    }
  })
}

test("Prepare-only inspection recovery publishes explicit original-command authority without relaxing other faults", async () => {
  const { CONNECTOR_COMMAND_FAULT_POLICY: policy } = await import("../src/infrastructure/clients/platform/connector-command-fault.js")
  assert.equal(policy.version, "1.1.0")
  assert.deepEqual(policy.prepare_inspection_recovery, {
    operation: "prepareServer",
    failure: "invalid",
    reads: ["server", "connector"],
    binding: "exact_server_connector",
    same_actor: true,
    server_version: "not_older_than_original",
    replay: "same_command",
    automatic_retries: false,
    new_command_authorized: false,
  })
  const { readFile } = await import("node:fs/promises")
  const { prepare_inspection_recovery: _added, ...parent } = JSON.parse(
    await readFile(new URL("../contract/connector-command-errors-v1.json", import.meta.url), "utf8"),
  )
  parent.version = "1.0.0"
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(parent, null, 2) + "\n")
      .digest("hex"),
    "24158f50a6f4dac1b34553797f0b1afcc8f99dbc79f36b916d03b56999a67a71",
  )
})

test("icon-only server updates bind the exact staged selector and explicit clear without changing no-icon command identity", () => {
  const icon = { intent_id: "12345678-1234-1234-1234-123456789abc", expected_state_version: "3" }
  const selected = parseMcpPersonalServer("updateServer", bytes({ expected_state_version: "7", icon }))
  assert.deepEqual((selected as Record<string, unknown>).icon, { intentId: icon.intent_id, expectedStateVersion: "3" })
  const clear = parseMcpPersonalServer("updateServer", bytes({ expected_state_version: "7", clear_icon: true }))
  assert.equal((clear as Record<string, unknown>).clearIcon, true)
  const base = { ...input, id: "server-one", expectedStateVersion: "7", displayName: "Renamed" }
  assert.notEqual(
    bindMcpPersonalServerCommand("updateServer", { ...base, ...selected }).requestDigest,
    bindMcpPersonalServerCommand("updateServer", base).requestDigest,
  )
  for (const invalid of [
    { icon, clear_icon: true },
    { clear_icon: false },
    { icon: { ...icon, expected_state_version: 3 } },
    { icon: { ...icon, expected_state_version: "2147483647" } },
    { icon: { ...icon, owner_scope: "other" } },
    { icon: null },
  ])
    assert.throws(() => parseMcpPersonalServer("updateServer", bytes({ expected_state_version: "7", ...invalid })))
})

// Transport is a current owner fact; an absent historic ACK is not a GET.
function transportFixture(transport?: unknown) {
  const server = Object.assign(
    create(PersonalMcpServerSchema, {
      availability: 5,
      serverId: { value: "server-one" },
      displayName: input.displayName,
      serverUrl: input.serverUrl,
      status: "pending",
      stateVersion: 1n,
      prepareStatus: PersonalMcpPrepareStatus.PENDING_PREPARE,
      declarationsAvailable: false,
    }),
    transport === undefined ? {} : { transport },
  )
  const connector = create(PersonalMcpConnectorSchema, {
    availability: 5,
    connectorId: { value: "connector-one" },
    connectorType: 3,
    providerKey: "private-server-one",
    serverId: server.serverId,
    status: 1,
    approvedScopes: [],
    enabled: false,
    stateVersion: 1n,
  })
  return { server, connector, replayed: false }
}

test("SSE successor: Register preserves absent HTTP and explicitly binds each real transport", () => {
  const canonical =
    '{"input":{"display_name":"Private tools","headers":[],"notes":null,"oauth_client_id":null,"oauth_client_present":false,"server_url":"https://tools.example/mcp","transport":3},"method":"kokoro.platform.v1.ProductMcpPersonalService/RegisterPersonalMcpServer","subject_id":"subject","tenant_id":"tenant"}'
  for (const [token, transport] of [
    ["streamable_http", 2],
    ["sse_compat", 3],
  ] as const) {
    const parsed = parseMcpPersonalServer("registerServer", bytes({ display_name: input.displayName, server_url: input.serverUrl, transport: token }))
    assert.equal((parsed as { transport?: number }).transport, transport)
    const request = { ...input, ...parsed }
    assert.equal(
      bindMcpPersonalServerCommand("registerServer", request).requestDigest,
      createHash("sha256")
        .update(canonical.replace('"transport":3', `"transport":${transport}`))
        .digest("hex"),
    )
  }
  for (const transport of [null, 0, 1, 2, 3, "sse", "http", "MCP_TRANSPORT_SSE_COMPAT", "stdio"]) {
    assert.throws(() => parseMcpPersonalServer("registerServer", bytes({ display_name: input.displayName, server_url: input.serverUrl, transport })))
  }
  assert.throws(() => parseMcpPersonalServer("updateServer", bytes({ expected_state_version: "1", transport: "sse_compat" })))
})

test("SSE successor: fresh Get and new ACK require real transport; only exact completed replay qualifies as history", () => {
  for (const transport of [2, 3]) {
    const raw = transportFixture(transport)
    const fresh = projectMcpPersonalServer("server", { server: raw.server }, { ...input, id: "server-one" }) as { server: { transport: string } }
    assert.equal(fresh.server.transport, transport === 2 ? "streamable_http" : "sse_compat")
    const ack = projectMcpPersonalServer("registerServer", raw, { ...input, transport } as typeof input) as { server: { transport: string } }
    assert.equal(ack.server.transport, fresh.server.transport)
    assert.throws(() => projectMcpPersonalServer("registerServer", raw, { ...input, transport: transport === 2 ? 3 : 2 } as typeof input))
  }
  const absent = transportFixture()
  assert.throws(() => projectMcpPersonalServer("server", { ...absent, replayed: true }, { ...input, id: "server-one" }))
  assert.throws(() => projectMcpPersonalServer("registerServer", absent, input))
  const old = projectMcpPersonalServer("registerServer", { ...absent, replayed: true }, input) as { server: { transport?: string }; replayed: boolean }
  assert.equal(old.replayed, true)
  assert.equal(Object.hasOwn(old.server, "transport"), false)
  for (const transport of [2, 3])
    assert.throws(() => projectMcpPersonalServer("registerServer", { ...absent, replayed: true }, { ...input, transport } as typeof input))
  for (const transport of [null, 0, 1, 4, "sse_compat"])
    assert.throws(() => projectMcpPersonalServer("registerServer", { ...transportFixture(transport), replayed: true }, input))
  assert.throws(() => projectMcpPersonalServer("registerServer", { ...absent, replayed: true }, { ...input, commandId: undefined } as unknown as typeof input))
})

test("SSE successor: historical Prepare/Update ACK remains confirmed but never substitutes for Current", () => {
  for (const operation of ["prepareServer", "updateServer"] as const) {
    const raw = transportFixture()
    raw.server.stateVersion = 2n
    const original = { ...input, id: "server-one", expectedStateVersion: "1" }
    const response = { ...raw, replayed: true, ...(operation === "prepareServer" ? { declarations: [] } : {}) }
    const projected = projectMcpPersonalServer(operation, response, original) as { server: { transport?: string }; replayed: boolean }
    assert.equal(projected.replayed, true)
    assert.equal(Object.hasOwn(projected.server, "transport"), false)
    assert.throws(() => projectMcpPersonalServer(operation, { ...response, replayed: false }, original))
    assert.throws(() => projectMcpPersonalServer("server", response, original))
  }
})

test("SSE successor: JSON digest uses actual SSE transport and preserves the outer replay/original item binding", () => {
  const configJson = JSON.stringify({ mcpServers: { [input.displayName]: { type: "sse", url: input.serverUrl } } })
  const request = { ...input, configJson }
  const canonical =
    '{"input":{"servers":[{"display_name":"Private tools","headers":[],"notes":null,"server_url":"https://tools.example/mcp","transport":3}]},"method":"kokoro.platform.v1.ProductMcpPersonalService/ImportPersonalMcpJson","subject_id":"subject","tenant_id":"tenant"}'
  assert.equal(bindMcpPersonalJsonImport(request).requestDigest, createHash("sha256").update(canonical).digest("hex"))
  const entry = transportFixture(3)
  assert.equal(
    (projectMcpPersonalJsonImport({ imports: [entry], replayed: false }, request) as { imports: { server: { transport: string } }[] }).imports[0]?.server
      .transport,
    "sse_compat",
  )
  assert.throws(() => projectMcpPersonalJsonImport({ imports: [transportFixture()], replayed: true }, request))
  const http = { ...request, configJson: configJson.replace('"sse"', '"streamableHttp"') }
  const historic = projectMcpPersonalJsonImport({ imports: [transportFixture()], replayed: true }, http) as {
    replayed: boolean
    imports: { server: { transport?: string } }[]
  }
  assert.equal(historic.replayed, true)
  assert.equal(Object.hasOwn(historic.imports[0]!.server, "transport"), false)
  assert.throws(() => projectMcpPersonalJsonImport({ imports: [transportFixture()], replayed: false }, http))
  for (const patch of [{ displayName: "another" }, { serverUrl: "https://other.example/mcp" }]) {
    const wrong = transportFixture(3)
    Object.assign(wrong.server, patch)
    assert.throws(() => projectMcpPersonalJsonImport({ imports: [wrong], replayed: false }, request))
  }
  assert.throws(() => projectMcpPersonalJsonImport({ imports: [entry, entry], replayed: false }, request))
})

test("SSE successor: production binary client and native ProtoJSON preserve real optional presence without replay", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter, createConnectTransport } = await import("@connectrpc/connect-node")
  const { createClient } = await import("@connectrpc/connect")
  const { ProductMcpPersonalService, RegisterPersonalMcpServerRequestSchema } =
    await import("../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const { McpPersonalConnectClient } = await import("../src/infrastructure/clients/platform/mcp-personal-connect.js")
  const seen: Array<number | undefined> = []
  const native = createServer(
    connectNodeAdapter({
      routes: (router) =>
        router.service(ProductMcpPersonalService, {
          registerPersonalMcpServer(request, context) {
            seen.push(request.transport)
            assert.equal(context.requestHeader.get("x-kokoro-subject"), input.subject)
            assert.equal(
              request.command?.requestDigest,
              bindMcpPersonalServerCommand("registerServer", {
                ...input,
                ...(request.transport === undefined ? {} : { transport: request.transport as 2 | 3 }),
              }).requestDigest,
            )
            context.responseHeader.set("cache-control", "no-store")
            context.responseHeader.set("x-request-id", input.requestId)
            return transportFixture(request.transport ?? 2)
          },
        }),
    }),
  )
  await new Promise<void>((resolve) => native.listen(0, "127.0.0.1", resolve))
  const address = native.address()
  assert.ok(address && typeof address === "object")
  const baseUrl = `http://127.0.0.1:${address.port}`
  const client = new McpPersonalConnectClient(baseUrl, { get: async () => "fixture-only" })
  const json = createClient(ProductMcpPersonalService, createConnectTransport({ baseUrl, httpVersion: "1.1", useBinaryFormat: false }))
  try {
    for (const transport of [undefined, 2, 3] as const) {
      const original = { ...input, ...(transport === undefined ? {} : { transport }) }
      const result = (await client.server("registerServer", original, new AbortController().signal, performance.now() + 2000)) as {
        server: { transport: string }
      }
      assert.equal(result.server.transport, transport === 3 ? "sse_compat" : "streamable_http")
      const direct = await json.registerPersonalMcpServer(
        create(RegisterPersonalMcpServerRequestSchema, {
          requestId: input.requestId,
          command: bindMcpPersonalServerCommand("registerServer", original),
          displayName: input.displayName,
          serverUrl: input.serverUrl,
          ...(transport === undefined ? {} : { transport }),
        }),
        { headers: { "x-kokoro-subject": input.subject } },
      )
      assert.equal(direct.server?.transport, transport ?? 2)
    }
    assert.deepEqual(seen, [undefined, undefined, 2, 2, 3, 3])
  } finally {
    client.close()
    native.closeAllConnections()
    await new Promise<void>((resolve) => native.close(() => resolve()))
  }
})

test("SSE successor: mixed JSON ACK cannot hide a missing HTTP transport behind the batch replay flag", () => {
  const first = transportFixture(2),
    second = transportFixture(3)
  second.server.serverId = { $typeName: "kokoro.platform.v1.McpServerId", value: "server-two" }
  second.server.displayName = "Second"
  second.server.serverUrl = "https://second.example/mcp"
  second.connector.connectorId = { $typeName: "kokoro.platform.v1.McpConnectorId", value: "connector-two" }
  second.connector.serverId = second.server.serverId
  const request = {
    ...input,
    configJson: JSON.stringify({
      mcpServers: {
        [input.displayName]: { type: "streamableHttp", url: input.serverUrl },
        Second: { type: "sse", url: second.server.serverUrl },
      },
    }),
  }
  assert.doesNotThrow(() => projectMcpPersonalJsonImport({ imports: [first, second], replayed: true }, request))
  delete (first.server as { transport?: unknown }).transport
  assert.throws(() => projectMcpPersonalJsonImport({ imports: [first, second], replayed: true }, request))
})

test("Prepare receipt lookup strictly wraps only the historical completed ACK without current CAS rebasing", async () => {
  const module = await import("../src/infrastructure/clients/platform/mcp-personal-server-response.js")
  const project = Reflect.get(module, "projectMcpPersonalPrepareReceipt")
  assert.equal(typeof project, "function")
  const raw = transportFixture()
  raw.server.stateVersion = 2n
  raw.server.prepareStatus = PersonalMcpPrepareStatus.NEEDS_OAUTH
  const completed = { ...raw, declarations: [], replayed: true }
  const original = { ...input, id: "server-one", expectedStateVersion: "1" }
  const result = project({ completed }, original)
  assert.equal(result.completed.server.state_version, "2")
  assert.equal(result.completed.replayed, true)
  assert.equal(Object.hasOwn(result.completed.server, "transport"), false)
  for (const invalid of [
    undefined,
    {},
    { completed, extra: true },
    { completed: { ...completed, replayed: false } },
    { completed: { ...completed, server: { ...raw.server, stateVersion: 3n } } },
    { completed: { ...completed, $unknown: [{ no: 999, wireType: 0, data: new Uint8Array([1]) }] } },
  ])
    assert.throws(() => project(invalid, original))
  assert.throws(() => project({ completed }, { ...original, id: "server-other" }))
  assert.throws(() => project({ completed }, { ...original, expectedStateVersion: "2" }))
})

test("Prepare receipt lookup has its own lookup-only policy and narrow receipt error boundary", async () => {
  const module = await import("../src/infrastructure/clients/platform/connector-command-fault.js")
  const fault = Reflect.get(module, "mcpPrepareReceiptFault")
  assert.equal(typeof fault, "function")
  const { connectorCommandFault } = module
  const error = new ConnectError("not a decision source", Code.Unavailable, { "x-kokoro-error-code": "command_receipt_outcome_unknown" })
  assert.deepEqual(fault(error), { status: 503, code: "mcp_personal_command_outcome_unknown", retryable: false })
  assert.deepEqual(connectorCommandFault(error, "mcp", false), { status: 502, code: "mcp_personal_response_invalid", retryable: false })
  assert.deepEqual(fault(new ConnectError("safe", Code.NotFound)), { status: 404, code: "mcp_personal_not_found", retryable: false })
  for (const bad of [
    new ConnectError("safe", Code.Aborted, { "x-kokoro-error-code": "command_receipt_outcome_unknown" }),
    new ConnectError("safe", Code.Unavailable, { "x-kokoro-error-code": "command_receipt_future" }),
  ])
    assert.deepEqual(fault(bad), { status: 502, code: "mcp_personal_response_invalid", retryable: false })
})

test("Prepare receipt publication binds same_command only to GET and never authorizes Prepare", async () => {
  const { MCP_PREPARE_RECEIPT_POLICY: policy } = await import("../src/http/mcp-prepare-receipt.contract.js")
  assert.equal(policy.lookup_only, true)
  assert.equal(policy.negative_ack, false)
  assert.equal(policy.automatic_retries, false)
  assert.equal(policy.new_command_authorized, false)
  assert.equal(policy.prepare_authorized, false)
  assert.deepEqual(policy.same_command, { method: "GET", target: "original_lookup" })
})

test("Prepare receipt generated browser profile has closed distinct fault alternatives and lookup-only authority", async () => {
  const { readFile } = await import("node:fs/promises")
  const document = JSON.parse(await readFile(new URL("../contract/openapi/browser/v1/mcp-prepare-receipt.json", import.meta.url), "utf8"))
  assert.equal(document["x-kokoro-lookup-policy"].lookup_only, true)
  assert.equal(document["x-kokoro-lookup-policy"].prepare_authorized, false)
  assert.deepEqual(document["x-kokoro-lookup-policy"].same_command, { method: "GET", target: "original_lookup" })
  const operation = document.paths["/browser/v1/mcp/servers/{server_id}/prepare-receipt"].get
  assert.equal(Object.hasOwn(operation, "requestBody"), false)
  assert.equal(operation.parameters.find((value) => value.name === "Idempotency-Key").required, true)
  for (const [status, response] of Object.entries(operation.responses)) {
    if (status === "200") continue
    const alternatives = response.content["application/json"].schema.oneOf
    assert.ok(alternatives.length > 0)
    const tuples = alternatives.map((value) => JSON.stringify(value.properties.error.properties))
    assert.equal(new Set(tuples).size, tuples.length)
    assert.ok(alternatives.every((value) => value.additionalProperties === false && value.properties.error.additionalProperties === false))
  }
})

test("Prepare receipt completed wrapper rejects a nonterminal preparation status", async () => {
  const { projectMcpPersonalPrepareReceipt } = await import("../src/infrastructure/clients/platform/mcp-personal-server-response.js")
  const raw = transportFixture()
  raw.server.stateVersion = 2n
  assert.throws(() =>
    projectMcpPersonalPrepareReceipt({ completed: { ...raw, declarations: [], replayed: true } }, { ...input, id: "server-one", expectedStateVersion: "1" }),
  )
})

test("Prepare receipt production Native client performs only Get with original digest and strict historical ACK", async () => {
  const { createServer } = await import("node:http")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ProductMcpPersonalService } = await import("../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const { McpPersonalConnectClient } = await import("../src/infrastructure/clients/platform/mcp-personal-connect.js")
  const original = { ...input, id: "server-one", expectedStateVersion: "1" }
  let queries = 0,
    prepares = 0,
    bad = false
  const native = createServer(
    connectNodeAdapter({
      routes: (router) =>
        router.service(ProductMcpPersonalService, {
          getPersonalMcpPrepareReceipt(request, context) {
            queries++
            assert.equal(request.expectedStateVersion, 1n)
            assert.equal(request.serverId?.value, original.id)
            assert.deepEqual(
              { commandId: request.command?.commandId, requestDigest: request.command?.requestDigest },
              bindMcpPersonalServerCommand("prepareServer", original),
            )
            assert.equal(context.requestHeader.get("x-kokoro-tenant"), original.tenant)
            assert.equal(context.requestHeader.get("x-kokoro-subject"), original.subject)
            context.responseHeader.set("cache-control", "no-store")
            context.responseHeader.set("x-request-id", original.requestId)
            const raw = transportFixture()
            raw.server.stateVersion = 2n
            raw.server.prepareStatus = PersonalMcpPrepareStatus.NEEDS_OAUTH
            return bad ? {} : { completed: { ...raw, declarations: [], replayed: true } }
          },
          preparePersonalMcpServer() {
            prepares++
            throw Error("mutation forbidden")
          },
        }),
    }),
  )
  await new Promise<void>((resolve) => native.listen(0, "127.0.0.1", resolve))
  const address = native.address()
  assert.ok(address && typeof address === "object")
  const client = new McpPersonalConnectClient(`http://127.0.0.1:${address.port}`, { get: async () => "fixture-only" })
  try {
    const lookup = Reflect.get(client, "prepareReceipt")
    assert.equal(typeof lookup, "function")
    const result = await lookup.call(client, original, new AbortController().signal, performance.now() + 2000)
    assert.equal(result.completed.server.state_version, "2")
    assert.equal(result.completed.replayed, true)
    assert.equal(Object.hasOwn(result.completed.server, "transport"), false)
    bad = true
    await assert.rejects(() => lookup.call(client, original, new AbortController().signal, performance.now() + 2000), /mcp_personal_response_invalid/u)
    assert.equal(queries, 2)
    assert.equal(prepares, 0)
  } finally {
    client.close()
    native.closeAllConnections()
    await new Promise<void>((resolve) => native.close(() => resolve()))
  }
})
