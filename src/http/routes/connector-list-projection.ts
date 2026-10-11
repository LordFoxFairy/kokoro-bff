import { z } from "zod"

const connector = z.object({
  connector_id: z.string().min(1).max(191),
  connector_type: z.enum(["builtin", "byok", "mcp"]),
  provider_key: z.string().min(1).max(64),
  status: z.enum(["pending", "active", "error", "revoked"]),
  display_name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
})

const provider = z.object({
  provider_key: z.string().min(1).max(64),
  display_name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  category_keys: z.array(z.string().min(1).max(128)).max(7),
})

export class ConnectorListProjectionError extends Error {
  constructor() {
    super("connector_response_invalid")
  }
}

export type ConnectorListPage = Readonly<{ items: readonly unknown[]; next_cursor: string | null }>

export function parseConnectorListPage(value: unknown): ConnectorListPage {
  try {
    return z
      .object({
        items: z.array(connector).max(100),
        next_cursor: z.string().min(1).max(2048).nullable(),
      })
      .parse(value)
  } catch {
    throw new ConnectorListProjectionError()
  }
}

export function parseProviderListPage(value: unknown): ConnectorListPage {
  try {
    return z
      .object({
        items: z.array(provider).max(100),
        next_cursor: z.string().min(1).max(2048).nullable(),
      })
      .parse(value)
  } catch {
    throw new ConnectorListProjectionError()
  }
}

export type PublicConnector = Readonly<{
  id: string
  name: string
  type: "builtin" | "byok" | "mcp"
  description: string
  category: string
}>

export function projectConnectorList(connectors: readonly unknown[], providers: readonly unknown[]): readonly PublicConnector[] {
  try {
    const providerByKey = new Map<string, z.infer<typeof provider>>()
    for (const candidate of providers) {
      const parsed = provider.parse(candidate)
      if (providerByKey.has(parsed.provider_key)) throw new ConnectorListProjectionError()
      providerByKey.set(parsed.provider_key, parsed)
    }
    const ids = new Set<string>()
    return connectors.map((candidate) => {
      const item = connector.parse(candidate)
      if (item.status !== "active" || ids.has(item.connector_id)) throw new ConnectorListProjectionError()
      ids.add(item.connector_id)
      const source = providerByKey.get(item.provider_key)
      if (!source || source.category_keys.length !== 1) throw new ConnectorListProjectionError()
      const name = item.display_name ?? source.display_name
      const description = item.description ?? source.description
      if (description === undefined) throw new ConnectorListProjectionError()
      return {
        id: item.connector_id,
        name,
        type: item.connector_type,
        description,
        category: source.category_keys[0]!,
      }
    })
  } catch (error) {
    if (error instanceof ConnectorListProjectionError) throw error
    throw new ConnectorListProjectionError()
  }
}
