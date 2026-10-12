import { createClient, Code, ConnectError, type CallOptions } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import {
  ProductMcpPersonalService as generatedProductMcpPersonalService,
  McpConnectorStatus,
} from "../../../generated/platform-mcp-product-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { projectMcpPersonalResponse, projectMcpPersonalCommand, type McpPersonalOperation, type McpPersonalInput } from "./mcp-personal-response.js"
import { bindMcpPersonalCommand, type McpPersonalCommandInput, type McpPersonalCommandOperation } from "./mcp-personal-command-binding.js"
import { bindMcpPersonalConnection, type McpPersonalAuthorizationInput, type McpPersonalAuthorizationOperation } from "./mcp-personal-authorization-binding.js"
import { projectMcpPersonalAuthorization } from "./mcp-personal-authorization-response.js"
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
      createConnectTransport({ baseUrl, httpVersion: "1.1", useBinaryFormat: true, readMaxBytes: 1_048_576, writeMaxBytes: 1_048_576 }),
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
      const page = { limit: input.limit ?? 50, ...(input.cursor === undefined ? {} : { cursor: input.cursor }) }
      const requestId = input.requestId
      let value: unknown
      switch (operation) {
        case "connectors":
          value = await this.#client.listPersonalMcpConnectors(
            {
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
            },
            options,
          )
          break
        case "connector":
          value = await this.#client.getPersonalMcpConnector({ requestId, connectorId: { value: input.id! } }, options)
          break
        case "connections":
          value = await this.#client.listPersonalMcpConnections({ requestId, connectorId: { value: input.id! }, page }, options)
          break
        case "connection":
          value = await this.#client.getPersonalMcpConnection({ requestId, connectionId: { value: input.id! } }, options)
          break
        case "providers":
          value = await this.#client.listPersonalMcpProviders(
            {
              requestId,
              page,
              ...(input.query === undefined ? {} : { query: input.query }),
              ...(input.directoryType === undefined ? {} : { directoryType: input.directoryType }),
              ...(input.categoryKey === undefined ? {} : { categoryKey: input.categoryKey }),
            },
            options,
          )
          break
        case "provider":
          value = await this.#client.getPersonalMcpProvider({ requestId, providerKey: input.id! }, options)
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
          {
            requestId,
            command,
            providerKey: input.providerKey!,
            connectorType: { builtin: 1, byok: 2, mcp: 3 }[input.connectorType!],
            displayName: input.displayName!,
            description: input.description!,
          },
          options,
        )
      else {
        const common = { requestId, command, connectorId: { value: input.id! }, expectedStateVersion: BigInt(input.expectedStateVersion!) }
        if (operation === "update")
          value = await this.#client.updatePersonalMcpConnector({ ...common, displayName: input.displayName!, description: input.description! }, options)
        else if (operation === "enabled") value = await this.#client.setPersonalMcpConnectorEnabled({ ...common, enabled: input.enabled! }, options)
        else value = await this.#client.removePersonalMcpConnector(common, options)
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
            ? await this.#client.beginPersonalMcpConnectorAuthorization(request, options)
            : await this.#client.reconnectPersonalMcpConnectorAuthorization(request, options)
      } else if (operation === "complete") {
        value = await this.#client.completePersonalMcpConnectorAuthorization(
          { requestId, state: input.state!, ...(input.code === undefined ? { error: input.error! } : { code: input.code }) },
          options,
        )
      } else {
        value = await this.#client.createPersonalMcpConnection(
          {
            requestId,
            command: bindMcpPersonalConnection(input),
            connectorId: { value: input.id! },
            serverId: { value: input.serverId! },
            allowedSelectors: input.allowedSelectors!,
            expectedStateVersion: BigInt(input.expectedStateVersion!),
          },
          options,
        )
      }
      return projectMcpPersonalAuthorization(operation, value, input)
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
        headers: { authorization: `Bearer ${token}`, "x-tenant-ref": input.tenant, "x-kokoro-subject": input.subject, "x-kokoro-request-id": input.requestId },
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
