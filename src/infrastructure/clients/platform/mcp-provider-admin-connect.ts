import { createClient, Code, ConnectError, type CallOptions } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { McpConnectorType, McpProviderAdminService } from "../../../generated/platform-provider-admin-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { bindMcpProviderAdminCommand, type McpProviderAdminCommandInput } from "./mcp-provider-admin-command-binding.js"
import { McpProviderAdminTokenSource } from "./mcp-provider-admin-token.js"

type ProviderInput = Record<string, unknown>
export type McpProviderAdminOperation = "list" | "get" | "create" | "update" | "enabled" | "remove"
export type McpProviderAdminInput = {
  requestId: string
  tenantId: string
  subjectId: string
  commandId?: string
  providerKey?: string
  expectedStateVersion?: string
  provider?: ProviderInput
  enabled?: boolean
  query?: string
  limit?: number
  cursor?: string
}

const connectorType = { builtin: McpConnectorType.BUILTIN, byok: McpConnectorType.BYOK, mcp: McpConnectorType.MCP } as const
const connectorTypeName = { [McpConnectorType.BUILTIN]: "builtin", [McpConnectorType.BYOK]: "byok", [McpConnectorType.MCP]: "mcp" } as const
function timestamp(value: { seconds: bigint; nanos: number } | undefined): string | undefined {
  if (value === undefined || value.seconds < -8_640_000_000_000n || value.seconds > 8_640_000_000_000n) throw new Error("mcp_provider_admin_response_invalid")
  return new Date(Number(value.seconds) * 1000 + Math.floor(value.nanos / 1_000_000)).toISOString()
}
function provider(value: Record<string, unknown>): Record<string, unknown> {
  const types = value.connectorTypes
  if (!Array.isArray(types) || types.some((item) => typeof item !== "number" || connectorTypeName[item as keyof typeof connectorTypeName] === undefined))
    throw new Error("mcp_provider_admin_response_invalid")
  const record = {
    provider_key: value.providerKey,
    display_name: value.displayName,
    directory_type: value.directoryType,
    category_keys: value.categoryKeys,
    example_prompts: value.examplePrompts,
    connector_types: types.map((item) => connectorTypeName[item as keyof typeof connectorTypeName]),
    default_scopes: value.defaultScopes,
    authorization_required: value.authorizationRequired,
    allowed_mcp_origins: (value.allowedMcpOrigins as Record<string, unknown>[]).map((origin) => ({
      scheme: origin.scheme,
      host: origin.host,
      port: origin.port,
      path_prefix: origin.pathPrefix,
    })),
    enabled: value.enabled,
    state_version: typeof value.stateVersion === "bigint" ? String(value.stateVersion) : undefined,
    created_at: timestamp(value.createdAt as { seconds: bigint; nanos: number } | undefined),
    updated_at: timestamp(value.updatedAt as { seconds: bigint; nanos: number } | undefined),
  }
  return {
    ...record,
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(value.author === undefined ? {} : { author: value.author }),
    ...(value.website === undefined ? {} : { website: value.website }),
    ...(value.privacyUrl === undefined ? {} : { privacy_url: value.privacyUrl }),
    ...(value.coverImageUrl === undefined ? {} : { cover_image_url: value.coverImageUrl }),
    ...(value.toolAuthorizationPolicy === undefined
      ? {}
      : {
          tool_authorization_policy: {
            version: (value.toolAuthorizationPolicy as Record<string, unknown>).version,
            rules: ((value.toolAuthorizationPolicy as Record<string, unknown>).rules as Record<string, unknown>[]).map((rule) => ({
              server_identity: rule.serverIdentity,
              selector: rule.selector,
              required_scopes: rule.requiredScopes,
            })),
          },
        }),
  }
}
function wireProvider(value: ProviderInput) {
  return {
    providerKey: value.provider_key as string,
    displayName: value.display_name as string,
    ...(value.description === undefined ? {} : { description: value.description as string }),
    directoryType: value.directory_type as string,
    categoryKeys: value.category_keys as string[],
    examplePrompts: value.example_prompts as string[],
    ...(value.author === undefined ? {} : { author: value.author as string }),
    ...(value.website === undefined ? {} : { website: value.website as string }),
    ...(value.privacy_url === undefined ? {} : { privacyUrl: value.privacy_url as string }),
    ...(value.cover_image_url === undefined ? {} : { coverImageUrl: value.cover_image_url as string }),
    connectorTypes: (value.connector_types as (keyof typeof connectorType)[]).map((item) => connectorType[item]),
    defaultScopes: value.default_scopes as string[],
    authorizationRequired: value.authorization_required as boolean,
    allowedMcpOrigins: (value.allowed_mcp_origins as Record<string, unknown>[]).map((origin) => ({
      scheme: origin.scheme as string,
      host: origin.host as string,
      port: origin.port as number,
      pathPrefix: origin.path_prefix as string,
    })),
    ...(value.tool_authorization_policy === undefined
      ? {}
      : {
          toolAuthorizationPolicy: {
            version: (value.tool_authorization_policy as Record<string, unknown>).version as number,
            rules: ((value.tool_authorization_policy as Record<string, unknown>).rules as Record<string, unknown>[]).map((rule) => ({
              serverIdentity: rule.server_identity as string,
              selector: rule.selector as string,
              requiredScopes: rule.required_scopes as string[],
            })),
          },
        }),
  }
}

export class McpProviderAdminConnectClient {
  readonly #client
  readonly #active = new Set<AbortController>()
  #closed = false
  public constructor(
    baseUrl: string,
    private readonly tokens: McpProviderAdminTokenSource,
  ) {
    this.#client = createClient(
      McpProviderAdminService,
      createConnectTransport({ baseUrl, httpVersion: "1.1", useBinaryFormat: true, readMaxBytes: 1_048_576, writeMaxBytes: 1_048_576 }),
    )
  }
  public close(): void {
    this.#closed = true
    for (const controller of this.#active) controller.abort()
    this.#active.clear()
    this.tokens.close()
  }
  public async execute(operation: McpProviderAdminOperation, input: McpProviderAdminInput, outer: AbortSignal, deadlineAt: number): Promise<unknown> {
    return this.#call(input, outer, deadlineAt, async (options) => {
      if (operation === "list") {
        const response = await this.#client.listMcpProviderAdminRecords(
          {
            requestId: input.requestId,
            ...(input.query === undefined ? {} : { query: input.query }),
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
            page: { limit: input.limit ?? 50, ...(input.cursor === undefined ? {} : { cursor: input.cursor }) },
          },
          options,
        )
        return { items: response.providers.map((item) => provider(item as unknown as Record<string, unknown>)), next_cursor: response.page?.nextCursor ?? null }
      }
      if (operation === "get") {
        const response = await this.#client.getMcpProviderAdminRecord({ requestId: input.requestId, providerKey: input.providerKey! }, options)
        if (response.provider === undefined) throw new Error("mcp_provider_admin_response_invalid")
        return { provider: provider(response.provider as unknown as Record<string, unknown>) }
      }
      const command = bindMcpProviderAdminCommand(operation, {
        commandId: input.commandId!,
        tenantId: input.tenantId,
        subjectId: input.subjectId,
        providerKey: input.providerKey ?? (input.provider?.provider_key as string),
        ...(input.expectedStateVersion === undefined ? {} : { expectedStateVersion: input.expectedStateVersion }),
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      } satisfies McpProviderAdminCommandInput)
      if (operation === "create") {
        const response = await this.#client.createMcpProviderAdminRecord(
          { requestId: input.requestId, command, provider: wireProvider(input.provider!), ...(input.enabled === undefined ? {} : { enabled: input.enabled }) },
          options,
        )
        if (response.provider === undefined) throw new Error("mcp_provider_admin_response_invalid")
        return { provider: provider(response.provider as unknown as Record<string, unknown>), replayed: response.replayed }
      }
      if (operation === "update") {
        const response = await this.#client.updateMcpProviderAdminRecord(
          {
            requestId: input.requestId,
            command,
            providerKey: input.providerKey!,
            expectedStateVersion: BigInt(input.expectedStateVersion!),
            provider: wireProvider(input.provider!),
          },
          options,
        )
        if (response.provider === undefined) throw new Error("mcp_provider_admin_response_invalid")
        return { provider: provider(response.provider as unknown as Record<string, unknown>), replayed: response.replayed }
      }
      if (operation === "enabled") {
        const response = await this.#client.setMcpProviderAdminRecordEnabled(
          {
            requestId: input.requestId,
            command,
            providerKey: input.providerKey!,
            expectedStateVersion: BigInt(input.expectedStateVersion!),
            enabled: input.enabled!,
          },
          options,
        )
        if (response.provider === undefined) throw new Error("mcp_provider_admin_response_invalid")
        return { provider: provider(response.provider as unknown as Record<string, unknown>), replayed: response.replayed }
      }
      const response = await this.#client.removeMcpProviderAdminRecord(
        { requestId: input.requestId, command, providerKey: input.providerKey!, expectedStateVersion: BigInt(input.expectedStateVersion!) },
        options,
      )
      return { provider_key: response.providerKey, replayed: response.replayed }
    })
  }
  async #call<T>(input: McpProviderAdminInput, outer: AbortSignal, deadlineAt: number, action: (options: CallOptions) => Promise<T>): Promise<T> {
    if (this.#closed) throw new Error("mcp_provider_admin_closed")
    const controller = new AbortController()
    this.#active.add(controller)
    const remaining = () => Math.max(0, Math.floor(deadlineAt - performance.now()))
    const timer = setTimeout(() => controller.abort(), remaining())
    const signal = AbortSignal.any([outer, controller.signal])
    let token: string | undefined
    try {
      signal.throwIfAborted()
      token = await this.tokens.get(input.tenantId, signal, deadlineAt)
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
          "x-tenant-ref": input.tenantId,
          "x-kokoro-subject": input.subjectId,
          "x-kokoro-request-id": input.requestId,
        },
      })
      signal.throwIfAborted()
      if (responseRequestId !== input.requestId || responseCache !== "no-store") throw new Error("mcp_provider_admin_response_invalid")
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
