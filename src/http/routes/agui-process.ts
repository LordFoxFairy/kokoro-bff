import type { IncomingMessage, ServerResponse } from "node:http"
import type { RequestContext } from "../../domain/request-context.js"
import type { AgUiRunProcessReader } from "../../infrastructure/postgres/agui-process-page.js"
import { failure, ok } from "../../contracts/index.js"
import { parseChatProcessPageInput } from "../chat-process-page-input.js"
import { send } from "../response.js"

export function processReadError(error: unknown): { status: number; code: string; message: string } | null {
  if (!(error instanceof Error)) return null
  switch (error.message) {
    case "PROCESS_CURSOR_INVALID":
      return { status: 400, code: "invalid_process_cursor", message: "process cursor is invalid" }
    case "PROCESS_CURSOR_EXPIRED":
      return { status: 410, code: "process_cursor_expired", message: "process cursor has expired" }
    case "PROCESS_PROJECTION_UNAVAILABLE":
      return { status: 503, code: "process_projection_unavailable", message: "process projection is unavailable" }
    default:
      return null
  }
}

export async function sendAgUiRunProcess(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  conversationId: string,
  runId: string,
  projectRef: string | undefined,
  readProcess: AgUiRunProcessReader,
): Promise<void> {
  try {
    const input = parseChatProcessPageInput(request)
    if (input === null) {
      send(response, 400, failure("invalid_process_cursor", "process page query is invalid", context.requestId))
      return
    }
    const page = await readProcess(
      context.identity.namespace,
      context.identity.userId,
      conversationId,
      runId,
      projectRef,
      input.watermark,
      input.cursor,
      input.limit,
    )
    if (page === null) send(response, 404, failure("session_not_found", "Session or Run was not found", context.requestId))
    else send(response, 200, ok(page, context.requestId))
  } catch (error) {
    const known = processReadError(error)
    send(
      response,
      known?.status ?? 503,
      failure(known?.code ?? "business_store_unavailable", known?.message ?? "The BFF business store is unavailable", context.requestId),
    )
  }
}
