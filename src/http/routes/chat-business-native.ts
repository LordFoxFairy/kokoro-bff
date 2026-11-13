import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { ChatSessionReads } from "../../application/chat/session-reads.js"
import type { ChatConversationLookup } from "../../infrastructure/postgres/chat-conversation-lookup.js"
import type { ProjectLookup } from "../../application/projects/types.js"
import { failure } from "../../contracts/index.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"
import { authorizeChatRequest } from "./chat-authorization.js"
import type { AgUiRunProcessReader } from "../../infrastructure/postgres/agui-process-page.js"
import { sendAgUiRunProcess } from "./agui-process.js"
import { readChatBusiness } from "./chat.js"

export function isChatBusinessReadRequest(request: IncomingMessage): boolean {
  if (request.method !== "GET") return false
  const path = pathOf(request)
  if (path[0] !== "v1" || path[1] !== "sessions") return false
  const valid =
    path.length === 2 ||
    path.length === 3 ||
    (path.length === 4 && ["messages", "share"].includes(path[3] ?? "")) ||
    (path.length === 6 && path[3] === "messages" && path[5] === "parts") ||
    (path.length === 6 && path[3] === "runs" && path[5] === "process")
  if (!valid) return false
  return true
}

/** Chat-owned direct reads with feature-local admission and application-service dependencies. */
export async function handleChatBusinessReadRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  reads: ChatSessionReads,
  findConversation: ChatConversationLookup,
  projects: ProjectLookup,
  readProcess: AgUiRunProcessReader,
  findReadableConversation: ChatConversationLookup,
  readableProjects: ProjectLookup,
): Promise<boolean> {
  if (!isChatBusinessReadRequest(request)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const abort = new AbortController()
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 10_000)
  const timer = setTimeout(() => abort.abort(), Math.max(0, deadlineAt - performance.now()))
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  try {
    if (request.aborted || response.destroyed) abort.abort()
    abort.signal.throwIfAborted()
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal, response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    const businessPath = pathOf(request).slice(1)
    const contentRead = businessPath[2] !== "share" && businessPath[2] !== "runs"
    const lookup = contentRead ? findReadableConversation : findConversation
    const projectLookup = contentRead ? readableProjects : projects
    const observed: { current: Awaited<ReturnType<ChatConversationLookup>> } = { current: null }
    const observeConversation: ChatConversationLookup = async (...args) => {
      const current = await lookup(...args)
      observed.current = current
      return current
    }
    const authorization = await authorizeChatRequest(request, admitted.context, businessPath, observeConversation, projectLookup, abort.signal)
    if (authorization === null) return false
    if (!authorization.ok) {
      send(response, authorization.status, failure(authorization.code, authorization.message, id))
      return true
    }
    if (businessPath.length === 5 && businessPath[2] === "runs" && businessPath[4] === "process") {
      await sendAgUiRunProcess(request, response, admitted.context, businessPath[1] ?? "", businessPath[3] ?? "", authorization.projectRef, readProcess)
      return true
    }
    const initialProject = observed.current?.projectAccess?.project_id ?? observed.current?.projectRef ?? null
    let projection: Readonly<{ projectId: string | null; requiresEdit: boolean }> | undefined
    await readChatBusiness(
      request,
      response,
      admitted.context,
      businessPath,
      reads,
      authorization,
      {
        signal: abort.signal,
        deadlineAt,
        onProjectRead: (access) => {
          if (projection !== undefined) throw new Error("CHAT_READ_PROJECTION_CHANGED")
          projection = { projectId: access?.project_id ?? null, requiresEdit: access?.capabilities.includes("edit") ?? false }
        },
      },
      async () => {
        const fresh = await authorizeChatRequest(request, admitted.context, businessPath, observeConversation, projectLookup, abort.signal)
        if (fresh?.ok !== true) return false
        if (!contentRead || businessPath.length === 1) return true
        const currentProject = observed.current?.projectAccess?.project_id ?? observed.current?.projectRef ?? null
        // Project projections must report their actual RR scope, not fall back to the earlier HTTP lookup.
        if (projection === undefined) return initialProject === null && currentProject === null
        return projection.projectId === currentProject && (!projection.requiresEdit || observed.current?.projectAccess?.capabilities.includes("edit") === true)
      },
    )
    return true
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed)
      send(response, 503, failure("chat_unavailable", "Chat read request failed", id))
    return true
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
}
