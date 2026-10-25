import { iconCreateWire, iconSaveWire, bindMcpIcon, projectMcpIcon, type McpIconOperation, type McpIconInput } from "./mcp-icon.js"
import * as iconProto from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { createClient, type CallOptions } from "@connectrpc/connect"
import { create } from "@bufbuild/protobuf"
import { createConnectTransport } from "@connectrpc/connect-node"
import {
  ProductMcpPersonalService as generatedProductMcpPersonalService,
  McpConnectorStatus,
  ListPersonalMcpConnectorsRequestSchema,
  GetPersonalMcpConnectorRequestSchema,
  ListPersonalMcpConnectionsRequestSchema,
  GetPersonalMcpConnectionRequestSchema,
  ListPersonalMcpProvidersRequestSchema,
  GetPersonalMcpProviderRequestSchema,
  CreatePersonalMcpConnectorRequestSchema,
  UpdatePersonalMcpConnectorRequestSchema,
  SetPersonalMcpConnectorEnabledRequestSchema,
  RemovePersonalMcpConnectorRequestSchema,
  BeginPersonalMcpConnectorAuthorizationRequestSchema,
  ReconnectPersonalMcpConnectorAuthorizationRequestSchema,
  CompletePersonalMcpConnectorAuthorizationRequestSchema,
  CreatePersonalMcpConnectionRequestSchema,
  RegisterPersonalMcpServerRequestSchema,
  ImportPersonalMcpJsonRequestSchema,
  GetPersonalMcpServerRequestSchema,
  PreparePersonalMcpServerRequestSchema,
  UpdatePersonalMcpServerRequestSchema,
  DeletePersonalMcpServerRequestSchema,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { projectMcpPersonalResponse, projectMcpPersonalCommand, type McpPersonalOperation, type McpPersonalInput } from "./mcp-personal-response.js"
import { bindMcpPersonalCommand, type McpPersonalCommandInput, type McpPersonalCommandOperation } from "./mcp-personal-command-binding.js"
import { bindMcpPersonalConnection, type McpPersonalAuthorizationInput, type McpPersonalAuthorizationOperation } from "./mcp-personal-authorization-binding.js"
import { projectMcpPersonalAuthorization } from "./mcp-personal-authorization-response.js"
import { bindMcpPersonalServerCommand, type McpPersonalServerInput, type McpPersonalServerOperation } from "./mcp-personal-server-binding.js"
import { projectMcpPersonalServer } from "./mcp-personal-server-response.js"
import { bindMcpPersonalJsonImport, type McpPersonalJsonImportInput } from "./mcp-personal-json-import-binding.js"
import { projectMcpPersonalJsonImport } from "./mcp-personal-json-import-response.js"
import type { PlatformServiceCredentialSource } from "./platform-service-credential.js"

export class McpPersonalConnectClient {
  readonly #client
  readonly #active = new Set<AbortController>()
  #closed = false
  constructor(
    baseUrl: string,
    private readonly credentials: Pick<PlatformServiceCredentialSource, "get">,
  ) {
    this.#client = createClient(
      generatedProductMcpPersonalService,
      createConnectTransport({
        baseUrl,
        httpVersion: "1.1",
        useBinaryFormat: true,
        readMaxBytes: 1_048_576,
        writeMaxBytes: 1_048_576,
      }),
    )
  }
  close(): void {
    this.#closed = true
    for (const controller of this.#active) controller.abort()
    this.#active.clear()
  }
  async read(operation: McpPersonalOperation, input: McpPersonalInput, outer: AbortSignal, deadlineAt: number): Promise<unknown> {
    return this.#call(input, outer, deadlineAt, async (options) => {
      const page = {
        limit: input.limit ?? 50,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      }
      const requestId = input.requestId
      let value: unknown
      switch (operation) {
        case "connectors":
          value = await this.#client.listPersonalMcpConnectors(
            create(ListPersonalMcpConnectorsRequestSchema, {
              requestId,
              page,
              ...(input.status === undefined
                ? {}
                : {
                    status: {
                      pending: McpConnectorStatus.PENDING,
                      active: McpConnectorStatus.ACTIVE,
                      error: McpConnectorStatus.ERROR,
                      revoked: McpConnectorStatus.REVOKED,
                    }[input.status],
                  }),
            }),
            options,
          )
          break
        case "connector":
          value = await this.#client.getPersonalMcpConnector(
            create(GetPersonalMcpConnectorRequestSchema, {
              requestId,
              connectorId: { value: input.id! },
            }),
            options,
          )
          break
        case "connections":
          value = await this.#client.listPersonalMcpConnections(
            create(ListPersonalMcpConnectionsRequestSchema, {
              requestId,
              connectorId: { value: input.id! },
              page,
            }),
            options,
          )
          break
        case "connection":
          value = await this.#client.getPersonalMcpConnection(
            create(GetPersonalMcpConnectionRequestSchema, {
              requestId,
              connectionId: { value: input.id! },
            }),
            options,
          )
          break
        case "providers":
          value = await this.#client.listPersonalMcpProviders(
            create(ListPersonalMcpProvidersRequestSchema, {
              requestId,
              page,
              ...(input.query === undefined ? {} : { query: input.query }),
              ...(input.directoryType === undefined ? {} : { directoryType: input.directoryType }),
              ...(input.categoryKey === undefined ? {} : { categoryKey: input.categoryKey }),
            }),
            options,
          )
          break
        case "provider":
          value = await this.#client.getPersonalMcpProvider(
            create(GetPersonalMcpProviderRequestSchema, {
              requestId,
              providerKey: input.id!,
            }),
            options,
          )
          break
      }
      return projectMcpPersonalResponse(operation, value, input)
    })
  }
  async command(operation: McpPersonalCommandOperation, input: McpPersonalCommandInput, outer: AbortSignal, deadlineAt: number): Promise<unknown> {
    return this.#call(input, outer, deadlineAt, async (options) => {
      const command = bindMcpPersonalCommand(operation, input)
      const requestId = input.requestId
      let value: unknown
      if (operation === "create")
        value = await this.#client.createPersonalMcpConnector(
          create(CreatePersonalMcpConnectorRequestSchema, {
            requestId,
            command,
            providerKey: input.providerKey!,
            connectorType: { builtin: 1, byok: 2, mcp: 3 }[input.connectorType!],
            displayName: input.displayName!,
            description: input.description!,
          }),
          options,
        )
      else {
        const common = {
          requestId,
          command,
          connectorId: { value: input.id! },
          expectedStateVersion: BigInt(input.expectedStateVersion!),
        }
        if (operation === "update")
          value = await this.#client.updatePersonalMcpConnector(
            create(UpdatePersonalMcpConnectorRequestSchema, {
              ...common,
              displayName: input.displayName!,
              description: input.description!,
            }),
            options,
          )
        else if (operation === "enabled")
          value = await this.#client.setPersonalMcpConnectorEnabled(
            create(SetPersonalMcpConnectorEnabledRequestSchema, {
              ...common,
              enabled: input.enabled!,
            }),
            options,
          )
        else value = await this.#client.removePersonalMcpConnector(create(RemovePersonalMcpConnectorRequestSchema, common), options)
      }
      return projectMcpPersonalCommand(operation, value, input)
    })
  }
  async authorization(
    operation: McpPersonalAuthorizationOperation,
    input: McpPersonalAuthorizationInput,
    outer: AbortSignal,
    deadlineAt: number,
  ): Promise<unknown> {
    return this.#call(
      input,
      outer,
      deadlineAt,
      async (options) => {
        const requestId = input.requestId
        let value: unknown
        if (operation === "begin" || operation === "reconnect") {
          const request = {
            requestId,
            connectorId: { value: input.id! },
            serverId: { value: input.serverId! },
            expectedStateVersion: BigInt(input.expectedStateVersion!),
          }
          value =
            operation === "begin"
              ? await this.#client.beginPersonalMcpConnectorAuthorization(create(BeginPersonalMcpConnectorAuthorizationRequestSchema, request), options)
              : await this.#client.reconnectPersonalMcpConnectorAuthorization(create(ReconnectPersonalMcpConnectorAuthorizationRequestSchema, request), options)
        } else if (operation === "complete") {
          value = await this.#client.completePersonalMcpConnectorAuthorization(
            create(CompletePersonalMcpConnectorAuthorizationRequestSchema, {
              requestId,
              state: input.state!,
              ...(input.code === undefined ? { error: input.error! } : { code: input.code }),
            }),
            options,
          )
        } else {
          value = await this.#client.createPersonalMcpConnection(
            create(CreatePersonalMcpConnectionRequestSchema, {
              requestId,
              command: bindMcpPersonalConnection(input),
              connectorId: { value: input.id! },
              serverId: { value: input.serverId! },
              allowedSelectors: input.allowedSelectors!,
              expectedStateVersion: BigInt(input.expectedStateVersion!),
            }),
            options,
          )
        }
        return projectMcpPersonalAuthorization(operation, value, input)
      },
      { allowMissingCorrelationHeader: true },
    )
  }
  async server(operation: McpPersonalServerOperation, input: McpPersonalServerInput, outer: AbortSignal, deadlineAt: number): Promise<unknown> {
    return this.#call(input, outer, deadlineAt, async (options) => {
      let value: unknown
      if (operation === "registerServer")
        value = await this.#client.registerPersonalMcpServer(
          create(RegisterPersonalMcpServerRequestSchema, {
            ...iconCreateWire(input),
            requestId: input.requestId,
            command: bindMcpPersonalServerCommand(operation, input),
            ...(input.transport === undefined ? {} : { transport: input.transport }),
            displayName: input.displayName!,
            serverUrl: input.serverUrl!,
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            headers: input.headers ?? [],
            ...(input.oauthClient === undefined ? {} : { oauthClient: input.oauthClient }),
          }),
          options,
        )
      else if (operation === "server")
        value = await this.#client.getPersonalMcpServer(
          create(GetPersonalMcpServerRequestSchema, {
            requestId: input.requestId,
            serverId: { value: input.id! },
          }),
          options,
        )
      else if (operation === "prepareServer")
        value = await this.#client.preparePersonalMcpServer(
          create(PreparePersonalMcpServerRequestSchema, {
            requestId: input.requestId,
            command: bindMcpPersonalServerCommand(operation, input),
            serverId: { value: input.id! },
            expectedStateVersion: BigInt(input.expectedStateVersion!),
          }),
          options,
        )
      else if (operation === "updateServer")
        value = await this.#client.updatePersonalMcpServer(
          create(UpdatePersonalMcpServerRequestSchema, {
            ...iconSaveWire(input),
            requestId: input.requestId,
            command: bindMcpPersonalServerCommand(operation, input),
            serverId: { value: input.id! },
            expectedStateVersion: BigInt(input.expectedStateVersion!),
            ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            clearNotes: input.clearNotes ?? false,
            ...(input.serverUrl === undefined ? {} : { serverUrl: input.serverUrl }),
            headerUpserts: input.headerUpserts ?? [],
            headerRemovals: input.headerRemovals ?? [],
            ...(input.oauthClient === undefined ? {} : { oauthClient: input.oauthClient }),
            revokeOauthClient: input.revokeOauthClient ?? false,
          }),
          options,
        )
      else
        value = await this.#client.deletePersonalMcpServer(
          create(DeletePersonalMcpServerRequestSchema, {
            requestId: input.requestId,
            command: bindMcpPersonalServerCommand(operation, input),
            serverId: { value: input.id! },
            expectedStateVersion: BigInt(input.expectedStateVersion!),
          }),
          options,
        )
      return projectMcpPersonalServer(operation, value, input)
    })
  }
  async icon(operation: McpIconOperation, input: McpIconInput, outer: AbortSignal, deadlineAt: number): Promise<unknown> {
    return this.#call(input, outer, deadlineAt, async (options) => {
      const command = operation === "getIcon" ? undefined : bindMcpIcon(operation, input)
      const selected = {
        requestId: input.requestId,
        command,
        intentId: input.intentId!,
        expectedStateVersion: input.expectedStateVersion === undefined ? undefined : BigInt(input.expectedStateVersion),
      }
      let value: unknown
      if (operation === "beginIcon")
        value = await this.#client.beginPersonalMcpIconUpload(
          create(iconProto.BeginPersonalMcpIconUploadRequestSchema, {
            requestId: input.requestId,
            command,
            filename: input.filename!,
            mimeType: input.mimeType!,
            contentSha256: input.contentSha256!,
            sizeBytes: BigInt(input.sizeBytes!),
          }),
          options,
        )
      else if (operation === "importIcon")
        value = await this.#client.importPersonalMcpIconUrl(
          create(iconProto.ImportPersonalMcpIconUrlRequestSchema, { requestId: input.requestId, command, imageUrl: input.imageUrl! }),
          options,
        )
      else if (operation === "getIcon")
        value = await this.#client.getPersonalMcpIconIntent(
          create(iconProto.GetPersonalMcpIconIntentRequestSchema, { requestId: input.requestId, intentId: input.intentId! }),
          options,
        )
      else if (operation === "cancelIcon")
        value = await this.#client.cancelPersonalMcpIconIntent(create(iconProto.CancelPersonalMcpIconIntentRequestSchema, selected), options)
      else
        value = await this.#client.completePersonalMcpIconUpload(
          create(iconProto.CompletePersonalMcpIconUploadRequestSchema, { ...selected, sourceVersionId: input.sourceVersionId! }),
          options,
        )
      return projectMcpIcon(operation, value, input)
    })
  }
  async importJson(input: McpPersonalJsonImportInput, outer: AbortSignal, deadlineAt: number): Promise<unknown> {
    return this.#call(input, outer, deadlineAt, async (options) => {
      const value = await this.#client.importPersonalMcpJson(
        create(ImportPersonalMcpJsonRequestSchema, {
          requestId: input.requestId,
          command: bindMcpPersonalJsonImport(input),
          configJson: input.configJson,
        }),
        options,
      )
      return projectMcpPersonalJsonImport(value, input)
    })
  }
  async #call<T>(
    input: McpPersonalInput,
    outer: AbortSignal,
    deadlineAt: number,
    action: (options: CallOptions) => Promise<T>,
    options: Readonly<{ allowMissingCorrelationHeader?: boolean }> = {},
  ): Promise<T> {
    if (this.#closed) throw new Error("mcp_personal_closed")
    const controller = new AbortController()
    this.#active.add(controller)
    const remaining = () => Math.max(0, Math.floor(deadlineAt - performance.now()))
    const timer = setTimeout(() => controller.abort(), remaining())
    const signal = AbortSignal.any([outer, controller.signal])
    try {
      signal.throwIfAborted()
      const token = await this.credentials.get(input.tenant, signal, deadlineAt)
      signal.throwIfAborted()
      let responseRequestId: string | null = null
      let responseCache: string | null = null
      const value = await action({
        onHeader: (headers) => {
          // Platform Connect RPCs expose the correlation value as
          // x-request-id; older local fixtures used the HTTP projection name.
          // Accept either name while still requiring an exact request match.
          responseRequestId = headers.get("x-kokoro-request-id") ?? headers.get("x-request-id")
          responseCache = headers.get("cache-control")
        },
        signal,
        timeoutMs: remaining(),
        headers: {
          authorization: `Bearer ${token}`,
          "x-kokoro-tenant": input.tenant,
          "x-kokoro-subject": input.subject,
          "x-kokoro-request-id": input.requestId,
        },
      })
      signal.throwIfAborted()
      if (!options.allowMissingCorrelationHeader && (responseRequestId !== input.requestId || responseCache !== "no-store"))
        throw new Error("mcp_personal_response_invalid")
      return value
    } finally {
      clearTimeout(timer)
      this.#active.delete(controller)
    }
  }
}
