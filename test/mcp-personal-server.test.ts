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
