import { z } from "zod"

import { strictParseRawJson } from "../infrastructure/raw-json.js"

const text = (minimum: number, maximum: number) =>
  z
    .string()
    .refine(
      (value) =>
        value.trim() === value &&
        [...value].length >= minimum &&
        [...value].length <= maximum &&
        !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value),
    )
const key = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u)
const version = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/u)
  .refine((value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER))
const scopes = z
  .array(z.string().regex(/^[^\s]{1,128}$/u))
  .max(100)
  .refine((value) => new Set(value).size === value.length)
const origin = z
  .object({ scheme: z.enum(["http", "https"]), host: text(1, 253), port: z.int().min(1).max(65535), path_prefix: z.string().max(2048).startsWith("/") })
  .strict()
const policy = z
  .object({
    version: z.int().min(1).max(100),
    rules: z.array(z.object({ server_identity: text(1, 256), selector: text(1, 256), required_scopes: scopes }).strict()).max(100),
  })
  .strict()
const provider = z
  .object({
    provider_key: key,
    display_name: text(1, 100),
    description: text(1, 1000).optional(),
    directory_type: z.enum(["app", "data_source"]),
    category_keys: z
      .array(z.enum(["efficiency", "creation", "business", "development", "finance", "travel", "health"]))
      .max(16)
      .refine((value) => new Set(value).size === value.length),
    example_prompts: z.array(text(1, 1000)).max(10),
    author: text(1, 100).optional(),
    website: z
      .url({ protocol: /^https:$/u })
      .max(2048)
      .optional(),
    privacy_url: z
      .url({ protocol: /^https:$/u })
      .max(2048)
      .optional(),
    connector_types: z
      .array(z.enum(["builtin", "byok", "mcp"]))
      .min(1)
      .max(3)
      .refine((value) => new Set(value).size === value.length),
    default_scopes: scopes,
    authorization_required: z.boolean(),
    allowed_mcp_origins: z.array(origin).max(100),
    tool_authorization_policy: policy.optional(),
  })
  .strict()

const create = z.object({ provider, enabled: z.boolean().optional() }).strict()
const update = z.object({ expected_state_version: version, provider }).strict()
const enabled = z.object({ expected_state_version: version, enabled: z.boolean() }).strict()
const remove = z.object({ expected_state_version: version }).strict()

export type McpProviderAdminMutation =
  | Readonly<{ kind: "create"; provider: z.infer<typeof provider>; enabled?: boolean }>
  | Readonly<{ kind: "update"; provider: z.infer<typeof provider>; expectedStateVersion: string }>
  | Readonly<{ kind: "enabled"; enabled: boolean; expectedStateVersion: string }>
  | Readonly<{ kind: "remove"; expectedStateVersion: string }>

export function parseMcpProviderAdminMutation(kind: McpProviderAdminMutation["kind"], raw: Buffer): McpProviderAdminMutation {
  let source: unknown
  try {
    source = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(raw))
  } catch {
    throw new Error("invalid_mcp_provider_admin_request")
  }
  try {
    if (kind === "create") {
      const value = create.parse(source)
      return { kind, provider: value.provider, ...(value.enabled === undefined ? {} : { enabled: value.enabled }) }
    }
    if (kind === "update") {
      const value = update.parse(source)
      return { kind, provider: value.provider, expectedStateVersion: value.expected_state_version }
    }
    if (kind === "enabled") {
      const value = enabled.parse(source)
      return { kind, enabled: value.enabled, expectedStateVersion: value.expected_state_version }
    }
    const value = remove.parse(source)
    return { kind, expectedStateVersion: value.expected_state_version }
  } catch {
    throw new Error("invalid_mcp_provider_admin_request")
  }
}
