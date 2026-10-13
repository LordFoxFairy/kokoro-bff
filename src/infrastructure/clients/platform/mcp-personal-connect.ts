import { createClient, Code, ConnectError, type CallOptions } from "@connectrpc/connect"
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
  GetPersonalMcpServerRequestSchema,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { projectMcpPersonalResponse, projectMcpPersonalCommand, type McpPersonalOperation, type McpPersonalInput } from "./mcp-personal-response.js"
import { bindMcpPersonalCommand, type McpPersonalCommandInput, type McpPersonalCommandOperation } from "./mcp-personal-command-binding.js"
import { bindMcpPersonalConnection, type McpPersonalAuthorizationInput, type McpPersonalAuthorizationOperation } from "./mcp-personal-authorization-binding.js"
import { projectMcpPersonalAuthorization } from "./mcp-personal-authorization-response.js"
import { bindMcpPersonalServerRegistration, type McpPersonalServerInput, type McpPersonalServerOperation } from "./mcp-personal-server-binding.js"
import { projectMcpPersonalServer } from "./mcp-personal-server-response.js"
import { McpPersonalTokenSource } from "./mcp-personal-token.js"

export class McpPersonalConnectClient {
  readonly #client
  readonly #active = new Set<AbortController>()
  #closed = false
  constructor(
    baseUrl: string,
    private readonly tokens: McpPersonalTokenSource,
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
    this.tokens.close()
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
    return this.#call(input, outer, deadlineAt, async (options) => {
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
    })
  }
  async server(operation: McpPersonalServerOperation, input: McpPersonalServerInput, outer: AbortSignal, deadlineAt: number): Promise<unknown> {
    return this.#call(input, outer, deadlineAt, async (options) => {
      const value =
        operation === "registerServer"
          ? await this.#client.registerPersonalMcpServer(
              create(RegisterPersonalMcpServerRequestSchema, {
                requestId: input.requestId,
                command: bindMcpPersonalServerRegistration(input),
                displayName: input.displayName!,
                serverUrl: input.serverUrl!,
              }),
              options,
            )
          : await this.#client.getPersonalMcpServer(
              create(GetPersonalMcpServerRequestSchema, {
                requestId: input.requestId,
                serverId: { value: input.id! },
              }),
              options,
            )
      return projectMcpPersonalServer(operation, value, input)
    })
  }
  async #call<T>(input: McpPersonalInput, outer: AbortSignal, deadlineAt: number, action: (options: CallOptions) => Promise<T>): Promise<T> {
    if (this.#closed) throw new Error("mcp_personal_closed")
    const controller = new AbortController()
    this.#active.add(controller)
    const remaining = () => Math.max(0, Math.floor(deadlineAt - performance.now()))
    const timer = setTimeout(() => controller.abort(), remaining())
    const signal = AbortSignal.any([outer, controller.signal])
    let token: string | undefined
    try {
      signal.throwIfAborted()
      token = await this.tokens.get(input.tenant, signal, deadlineAt)
      signal.throwIfAborted()
      let responseRequestId: string | null = null
      let responseCache: string | null = null
      const value = await action({
        onHeader: (headers) => {
          responseRequestId = headers.get("x-kokoro-request-id")
          responseCache = headers.get("cache-control")
        },
        signal,
        timeoutMs: remaining(),
        headers: {
          authorization: `Bearer ${token}`,
          "x-tenant-ref": input.tenant,
          "x-kokoro-subject": input.subject,
          "x-kokoro-request-id": input.requestId,
        },
      })
      signal.throwIfAborted()
      if (responseRequestId !== input.requestId || responseCache !== "no-store") throw new Error("mcp_personal_response_invalid")
      return value
    } catch (error) {
      if (token !== undefined && error instanceof ConnectError && [Code.Unauthenticated, Code.PermissionDenied].includes(error.code)) this.tokens.retire(token)
      throw error
    } finally {
      clearTimeout(timer)
      this.#active.delete(controller)
    }
  }
}
