import { sha256Jcs } from "./jcs.js"

export type McpProviderAdminCommandInput = Readonly<{
  commandId: string
  tenantId: string
  subjectId: string
  providerKey: string
  expectedStateVersion?: string
  provider?: Record<string, unknown>
  enabled?: boolean
}>

const methods = {
  create: "CreateMcpProviderAdminRecord",
  update: "UpdateMcpProviderAdminRecord",
  enabled: "SetMcpProviderAdminRecordEnabled",
  remove: "RemoveMcpProviderAdminRecord",
} as const

function providerWire(input: Record<string, unknown>): Record<string, unknown> {
  return {
    provider_key: input.provider_key,
    display_name: input.display_name,
    description: input.description ?? null,
    directory_type: input.directory_type,
    category_keys: input.category_keys,
    example_prompts: input.example_prompts,
    author: input.author ?? null,
    website: input.website ?? null,
    privacy_url: input.privacy_url ?? null,
    cover_image_url: input.cover_image_url ?? null,
    connector_types: (input.connector_types as string[]).map((value) => ({ builtin: 1, byok: 2, mcp: 3 })[value] ?? 0),
    default_scopes: input.default_scopes,
    authorization_required: input.authorization_required,
    allowed_mcp_origins: (input.allowed_mcp_origins as Record<string, unknown>[]).map((origin) => ({
      scheme: origin.scheme,
      host: origin.host,
      port: origin.port,
      path_prefix: origin.path_prefix,
    })),
    tool_authorization_policy:
      input.tool_authorization_policy === undefined || input.tool_authorization_policy === null
        ? null
        : {
            version: (input.tool_authorization_policy as Record<string, unknown>).version,
            rules: ((input.tool_authorization_policy as Record<string, unknown>).rules as Record<string, unknown>[]).map((rule) => ({
              server_identity: rule.server_identity,
              selector: rule.selector,
              required_scopes: rule.required_scopes,
            })),
          },
  }
}

export function bindMcpProviderAdminCommand(
  operation: keyof typeof methods,
  input: McpProviderAdminCommandInput,
): Readonly<{ commandId: string; requestDigest: string }> {
  const command =
    operation === "create"
      ? { administrator_subject_id: input.subjectId, provider: providerWire(input.provider!), enabled: input.enabled ?? null }
      : operation === "update"
        ? {
            administrator_subject_id: input.subjectId,
            provider_key: input.providerKey,
            expected_state_version: input.expectedStateVersion,
            provider: providerWire(input.provider!),
          }
        : operation === "enabled"
          ? {
              administrator_subject_id: input.subjectId,
              provider_key: input.providerKey,
              expected_state_version: input.expectedStateVersion,
              enabled: input.enabled,
            }
          : { administrator_subject_id: input.subjectId, provider_key: input.providerKey, expected_state_version: input.expectedStateVersion }
  return {
    commandId: input.commandId,
    requestDigest: sha256Jcs({
      command_digest_version: "3.0.0",
      fq_method: `kokoro.platform.v1.McpProviderAdminService/${methods[operation]}`,
      tenant_ref: input.tenantId,
      command,
    }).sha256,
  }
}
