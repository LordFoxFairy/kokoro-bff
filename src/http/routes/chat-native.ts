import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import { archivedTasksRoute } from "./archived-tasks.js"
import { sharedTasksRoute } from "./shared-tasks.js"
import { requestId } from "../request.js"

function chatNativePath(request: IncomingMessage): string {
  return (request.url ?? "").split("?", 1)[0] ?? ""
}

export function isChatNativeRequest(request: IncomingMessage): boolean {
  const path = chatNativePath(request)
  return path === "/v1/account/archived-tasks" || path === "/v1/account/shared-tasks" || /^\/v1\/sessions\/[^/]+\/(?:archive|restore)$/u.test(path)
}

/** Chat-owned archive/share adapters; each route retains its own admission and bounded persistence contract. */
export async function handleChatNativeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  chat: ChatApplicationService | null,
): Promise<boolean> {
  if (!isChatNativeRequest(request)) return false
  const id = requestId(request)
  if ((request.url ?? "").split("?", 1)[0] === "/v1/account/shared-tasks") {
    await sharedTasksRoute(request, response, config, admission, chat ?? undefined, id)
    return true
  }
  await archivedTasksRoute(request, response, config, admission, chat ?? undefined, id)
  return true
}
