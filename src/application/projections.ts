import { isRecord } from "../domain/json.js"
import type { RequestContext } from "../domain/request-context.js"

export function systemManifestData(body: unknown): Record<string, unknown> | null {
  const data = dataOf(body)
  if (data === null) return null
  const stringFields = ["tenant_id", "product_id", "locale", "config_version", "digest"]
  for (const field of stringFields) if (typeof data[field] !== "string" || data[field].trim() === "") return null
  for (const field of ["navigation", "locale_namespaces", "feature_flags", "references"]) if (!Array.isArray(data[field])) return null
  if (!isRecord(data.theme)) return null
  if (data.release_id !== null && typeof data.release_id !== "string") return null
  return {
    tenant_id: data.tenant_id,
    product_id: data.product_id,
    locale: data.locale,
    navigation: data.navigation,
    locale_namespaces: data.locale_namespaces,
    theme: data.theme,
    feature_flags: data.feature_flags,
    references: data.references,
    config_version: data.config_version,
    release_id: data.release_id,
    digest: data.digest,
  }
}

export function dataOf(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body) || !isRecord(body.data)) return null
  return body.data
}

export function agentSessionAssertion(context: RequestContext, sessionId: string): string {
  return `bff:session:${context.identity.namespace}:${sessionId}`
}
