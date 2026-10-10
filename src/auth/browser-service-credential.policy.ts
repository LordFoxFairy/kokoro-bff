import type { IncomingMessage } from "node:http"

import type { BffConfig } from "../config/runtime.js"

export type BrowserService = "web-bff" | "admin-web-bff"

function oneRawHeader(request: IncomingMessage, name: string): string | null {
  const values: string[] = []
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) values.push(request.rawHeaders[index + 1] ?? "")
  }
  return values.length === 1 ? values[0]! : null
}

function adminBusinessRoute(method: string, target: string): boolean {
  let path: string
  try {
    path = new URL(target, "http://bff.local").pathname
  } catch {
    return false
  }
  if (method === "GET" && path === "/v1/me") return true
  if (method === "GET" && ["/v1/admin/model-routing", "/v1/admin/model-labels", "/v1/admin/model-revisions", "/v1/admin/skills", "/v1/admin/identity/members", "/v1/admin/identity/invitations", "/v1/admin/identity/roles"].includes(path)) return true
  if (method === "GET" && /^\/v1\/admin\/skills\/[^/]+$/u.test(path)) return true
  if (method === "POST" && /^\/v1\/admin\/skills\/[^/]+\/(versions|publish|withdraw|quarantine|restore|audience|discard)$/u.test(path)) return true
  return method === "PUT" && /^\/v1\/admin\/model-routing\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(path)
}

export function admitBrowserService(
  request: IncomingMessage,
  config: Pick<BffConfig, "sharedSecret" | "adminWebSharedSecret">,
  surface: Readonly<{ kind: "business" } | { kind: "iam"; ownerPath: string }>,
): BrowserService | null {
  const service = oneRawHeader(request, "x-kokoro-service")
  const secret = oneRawHeader(request, "x-kokoro-internal-secret")
  if (service === null || secret === null) return null
  if (service === "web-bff") return config.sharedSecret !== null && secret === config.sharedSecret ? service : null
  if (service !== "admin-web-bff" || config.adminWebSharedSecret == null || secret !== config.adminWebSharedSecret) return null
  if (surface.kind === "business") return adminBusinessRoute(request.method ?? "", request.url ?? "") ? service : null
  return ["/jwks", "/oauth2/token", "/oauth2/userinfo", "/oauth2/revoke"].includes(surface.ownerPath) ? service : null
}
