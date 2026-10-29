import type { IncomingMessage, ServerResponse } from "node:http"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import { messageFeedbackId } from "../../application/chat/message-feedback-input.js"
import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import { idempotencyKey } from "../request.js"
import { readBodyBeforeDeadline, rawHeaderCount } from "../request-body.js"
import { send } from "../response.js"
import { failure } from "../../contracts/index.js"
export class MessageRegenerationAdmissionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfter?: string,
  ) {
    super("Regeneration admission failed")
  }
}
export async function messageRegenerationRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  path: readonly string[],
  store: BffBusinessStore | null,
  deadlineAt: number,
  currentAdmission: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - performance.now()))
  const abort = () => {
    if (!response.writableEnded) controller.abort()
  }
  request.once("aborted", abort)
  response.once("close", abort)
  if (request.aborted || response.destroyed) controller.abort()
  const within = <T>(start: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const stop = () => reject(new Error("message_regeneration_unavailable"))
      controller.signal.addEventListener("abort", stop, { once: true })
      if (controller.signal.aborted) {
        stop()
        controller.signal.removeEventListener("abort", stop)
        return
      }
      void Promise.resolve()
        .then(() => {
          controller.signal.throwIfAborted()
          return start()
        })
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener("abort", stop))
    })
  const fail = (status: number, code: string, retryAfter?: string) => {
    if (!response.destroyed && !response.writableEnded)
      send(response, status, failure(code, "Message regeneration request failed", context.requestId), retryAfter)
  }
  const invalid = (): never => {
    throw new Error("message_regeneration_request_invalid")
  }
  try {
    response.setHeader("x-request-id", context.requestId)
    const url = new URL(request.url ?? "", "http://bff.invalid"),
      conversationId = path[1],
      sourceMessageId = path[3]
    if (
      path.length !== 5 ||
      path[0] !== "sessions" ||
      path[2] !== "messages" ||
      path[4] !== "regenerate" ||
      !messageFeedbackId(conversationId) ||
      !messageFeedbackId(sourceMessageId) ||
      url.pathname !== `/v1/sessions/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(sourceMessageId)}/regenerate` ||
      url.search
    )
      invalid()
    if (request.method !== "POST") {
      fail(405, "method_not_allowed")
      return
    }
    const key = idempotencyKey(request)
    if (
      key === null ||
      rawHeaderCount(request, "idempotency-key") !== 1 ||
      ["if-match", "transfer-encoding", "content-encoding"].some((k) => request.headers[k] !== undefined)
    )
      invalid()
    if (rawHeaderCount(request, "content-type") !== 1 || !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(String(request.headers["content-type"]))) {
      fail(415, "message_regeneration_content_type_unsupported")
      return
    }
    const length = request.headers["content-length"]
    if (rawHeaderCount(request, "content-length") !== 1 || typeof length !== "string" || !/^\d+$/u.test(length) || Number(length) > 1024) invalid()
    const bytes = await within(() => readBodyBeforeDeadline(request, controller.signal, 1024))
    if (bytes.length !== Number(length)) invalid()
    let body: unknown
    try {
      body = strictParseRawJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes))
    } catch {
      invalid()
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) invalid()
    await within(() => currentAdmission(controller.signal))
    if (!store) throw Error("message_regeneration_unavailable")
    const data = await within(() =>
      store.services.chatTurns.regenerate({
        tenantId: context.identity.namespace,
        subjectId: context.identity.userId,
        actorId: context.identity.userId,
        conversationId: conversationId!,
        sourceMessageId: sourceMessageId!,
        requestId: context.requestId,
        idempotencyKey: key!,
        signal: controller.signal,
        deadlineAt,
      }),
    )
    if (data === null) {
      fail(404, "message_not_found")
      return
    }
    if (
      data.regenerated_from_message_id !== sourceMessageId ||
      ![data.run_id, data.user_message_id, data.assistant_message_id].every(messageFeedbackId) ||
      Object.keys(data).sort().join(",") !== "assistant_message_id,regenerated_from_message_id,run_id,user_message_id"
    )
      throw Error("message_regeneration_unavailable")
    await within(() => currentAdmission(controller.signal))
    controller.signal.throwIfAborted()
    if (!response.destroyed && !response.writableEnded) send(response, 202, { data })
  } catch (error) {
    if (error instanceof MessageRegenerationAdmissionError) fail(error.status, error.code, error.retryAfter)
    else if (error instanceof Error && error.message === "message_regeneration_request_invalid") fail(400, error.message)
    else if (
      error instanceof Error &&
      ["MESSAGE_REGENERATION_NOT_READY", "MESSAGE_REGENERATION_SOURCE_CHANGED", "CHAT_TURN_IDEMPOTENCY_CONFLICT"].includes(error.message)
    )
      fail(409, error.message === "CHAT_TURN_IDEMPOTENCY_CONFLICT" ? "idempotency_conflict" : "message_regeneration_not_ready")
    else fail(503, "message_regeneration_unavailable")
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
}
