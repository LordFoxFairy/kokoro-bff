import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import { authorizeServerOnly } from "../request.js"
import { queryOf, requestId } from "../request.js"
import { failure, ok } from "../../contracts/index.js"
import { send } from "../response.js"
import { publicShareSnapshot, type PublicShareApplicationService } from "../../application/public-share-service.js"

export function isSharedPublicRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  return request.method === "GET" && /^\/v1\/shared\/[^/]+$/u.test(path)
}

/** Public share projection owned by Chat; service auth is the only caller identity. */
export async function handleSharedPublicRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  service: PublicShareApplicationService | null,
): Promise<boolean> {
  if (!isSharedPublicRequest(request)) return false
  const id = requestId(request)
  if (!authorizeServerOnly(request, config)) {
    send(response, config.sharedSecret !== null ? 403 : 401, failure("service_auth_failed", "BFF authentication failed", id))
    return true
  }
  if (service === null) {
    send(response, 503, failure("share_projection_not_configured", "Share projection is not configured", id))
    return true
  }
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  const shareId = path.slice("/v1/shared/".length)
  const scope = queryOf(request).get("scope")?.trim() || undefined
  const projectRef = queryOf(request).get("project_ref")?.trim() || undefined
  try {
    const shared = await service.findActiveShare(shareId, scope, projectRef)
    if (shared === null) {
      send(response, 404, failure("share_not_found", "Share was not found", id))
      return true
    }
    const messages = await service.listMessages(shareId, shared.conversation.tenantId, shared.conversation.conversationId, 100)
    if (messages === null) {
      send(response, 404, failure("share_not_found", "Share was not found", id))
      return true
    }
    const snapshot = publicShareSnapshot({
      session: {
        session_id: shared.conversation.conversationId,
        title: shared.conversation.title,
        owner_id: shared.conversation.ownerId,
        created_at: shared.conversation.createdAt.toISOString(),
        updated_at: shared.conversation.updatedAt.toISOString(),
      },
      ...(messages.messages.length === 0 ? {} : { messages: messages.messages }),
    })
    if (snapshot === null) {
      send(response, 503, failure("share_projection_invalid", "Share projection is invalid", id))
      return true
    }
    send(response, 200, ok(snapshot, id))
  } catch {
    send(response, 503, failure("share_projection_unavailable", "Share projection is unavailable", id))
  }
  return true
}

export async function handleSharedReaderRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  reader: {
    findSharedSession(shareId: string, scope?: string, projectRef?: string): { session_id: string } | undefined
    readSession(sessionId: string, scope?: string, projectRef?: string): unknown | undefined
  } | undefined,
): Promise<boolean> {
  if (!isSharedPublicRequest(request) || reader === undefined) return false
  const id = requestId(request)
  if (!authorizeServerOnly(request, config)) {
    send(response, config.sharedSecret !== null ? 403 : 401, failure("service_auth_failed", "BFF authentication failed", id))
    return true
  }
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  const shareId = path.slice("/v1/shared/".length)
  const scope = queryOf(request).get("scope")?.trim() || undefined
  const projectRef = queryOf(request).get("project_ref")?.trim() || undefined
  const session = reader.findSharedSession(shareId, scope, projectRef)
  if (session === undefined) {
    send(response, 404, failure("share_not_found", "Share was not found", id))
    return true
  }
  const snapshot = publicShareSnapshot(reader.readSession(session.session_id, scope, projectRef))
  if (snapshot === null) {
    send(response, 503, failure("share_projection_invalid", "Share projection is invalid", id))
    return true
  }
  send(response, 200, ok(snapshot, id))
  return true
}
