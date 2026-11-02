import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import { messageFeedbackId, type MessageFeedback } from "../../application/chat/message-feedback-input.js"
import { readBodyBeforeDeadline, rawHeaderCount } from "../request-body.js"
import { send } from "../response.js"
import { failure } from "../../contracts/index.js"
export class MessageFeedbackAdmissionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfter?: string,
  ) {
    super("Message feedback admission failed")
  }
}
export async function messageFeedbackRoute(
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
      const stop = () => reject(new Error("message_feedback_unavailable"))
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
    if (!response.destroyed && !response.writableEnded) send(response, status, failure(code, "Message feedback request failed", context.requestId), retryAfter)
  }
  const invalid = (): never => {
    throw new Error("message_feedback_request_invalid")
  }
  try {
    response.setHeader("x-request-id", context.requestId)
    const url = new URL(request.url ?? "", "http://bff.invalid")
    const conversationId = path[1],
      messageId = path[3]
    if (
      path.length !== 5 ||
      path[0] !== "sessions" ||
      path[2] !== "messages" ||
      path[4] !== "feedback" ||
      !messageFeedbackId(conversationId) ||
      !messageFeedbackId(messageId) ||
      url.pathname !== `/v1/sessions/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/feedback` ||
      url.search
    )
      invalid()
    if (request.method !== "GET" && request.method !== "PUT") {
      fail(405, "method_not_allowed")
      return
    }
    if (["idempotency-key", "if-match", "transfer-encoding", "content-encoding"].some((name) => request.headers[name] !== undefined)) invalid()
    let feedback: MessageFeedback = null
    if (request.method === "GET") {
      if (request.headers["content-type"] !== undefined || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0"))
        invalid()
    } else {
      if (rawHeaderCount(request, "content-type") !== 1 || !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(String(request.headers["content-type"]))) {
        fail(415, "message_feedback_content_type_unsupported")
        return
      }
      const length = request.headers["content-length"]
      if (rawHeaderCount(request, "content-length") !== 1 || typeof length !== "string" || !/^[1-9][0-9]*$/u.test(length)) invalid()
      if (Number(length) > 1024) {
        fail(413, "message_feedback_request_too_large")
        return
      }
      const bytes = await within(() => readBodyBeforeDeadline(request, controller.signal, 1024))
      if (bytes.byteLength !== Number(length)) invalid()
      feedback = parseMessageFeedbackInput(bytes)
    }
    await within(() => currentAdmission(controller.signal))
    if (!store) throw Error("message_feedback_unavailable")
    const input = {
      tenantId: context.identity.namespace,
      subjectId: context.identity.userId,
      conversationId: conversationId!,
      messageId: messageId!,
      signal: controller.signal,
      deadlineAt,
    }
    const data = await within(() =>
      request.method === "GET" ? store.services.chat.readMessageFeedback(input) : store.services.chat.setMessageFeedback({ ...input, feedback }),
    )
    if (data === null) {
      fail(404, "message_not_found")
      return
    }
    if (
      data.session_id !== conversationId ||
      data.message_id !== messageId ||
      (data.feedback !== null && data.feedback !== "up" && data.feedback !== "down") ||
      Object.keys(data).sort().join(",") !== "feedback,message_id,session_id" ||
      (request.method === "PUT" && data.feedback !== feedback)
    )
      throw Error("message_feedback_unavailable")
    await within(() => currentAdmission(controller.signal))
    controller.signal.throwIfAborted()
    if (Buffer.byteLength(JSON.stringify({ data })) > 65536) throw Error("message_feedback_unavailable")
    if (!response.destroyed && !response.writableEnded) send(response, 200, { data })
  } catch (error) {
    if (error instanceof MessageFeedbackAdmissionError) fail(error.status, error.code, error.retryAfter)
    else if (error instanceof Error && error.message === "message_feedback_request_invalid") fail(400, "message_feedback_request_invalid")
    else fail(503, "message_feedback_unavailable")
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
}

export function parseMessageFeedbackInput(bytes: Buffer): MessageFeedback {
  let value: unknown
  try {
    value = strictParseRawJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes))
  } catch {
    throw Error("message_feedback_request_invalid")
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join(",") !== "feedback")
    throw Error("message_feedback_request_invalid")
  const feedback: unknown = Reflect.get(value, "feedback")
  if (feedback !== null && feedback !== "up" && feedback !== "down") throw Error("message_feedback_request_invalid")
  return feedback
}
