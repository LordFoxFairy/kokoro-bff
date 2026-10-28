import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import { messageFeedbackId } from "../../application/chat/message-feedback-input.js"
import { readAgentRunDisplay } from "../../infrastructure/clients/agent/run-display.js"
import { failure } from "../../contracts/index.js"
import { send } from "../response.js"
export class RunDisplayAdmissionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfter?: string,
  ) {
    super("Run display admission failed")
  }
}
export async function runDisplayRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
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
      const stop = () => reject(new Error("run_display_unavailable"))
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
    if (!response.destroyed && !response.writableEnded) send(response, status, failure(code, "Run display read failed", context.requestId), retryAfter)
  }
  try {
    const url = new URL(request.url ?? "", "http://bff.invalid"),
      sessionId = path[1],
      runId = path[3]
    if (
      path.length !== 5 ||
      path[0] !== "sessions" ||
      path[2] !== "runs" ||
      path[4] !== "display" ||
      !messageFeedbackId(sessionId) ||
      !messageFeedbackId(runId) ||
      url.pathname !== `/v1/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/display` ||
      url.search ||
      ["content-length", "transfer-encoding", "content-type", "content-encoding", "idempotency-key", "if-match"].some((k) => request.headers[k] !== undefined)
    ) {
      fail(400, "invalid_run_display_request")
      return
    }
    if (request.method !== "GET") {
      fail(405, "method_not_allowed")
      return
    }
    if (!store?.submittedAgentRuns) throw Error("run_display_unavailable")
    const checkedStore = store
    const check = async () => {
      await within(() => currentAdmission(controller.signal))
      const run = await within(() =>
        checkedStore.submittedAgentRuns!.readSubmittedAgentRun({ tenantId: context.identity.namespace, runId, signal: controller.signal }),
      )
      if (
        !run ||
        run.tenantId !== context.identity.namespace ||
        run.userId !== context.identity.userId ||
        run.conversationId !== sessionId ||
        run.runId !== runId
      )
        throw Error("run_display_not_found")
      const owned = await within(() =>
        checkedStore.services.chat.findConversation(context.identity.namespace, context.identity.userId, sessionId, undefined, {
          signal: controller.signal,
          deadlineAt,
        }),
      )
      if (!owned) throw Error("run_display_not_found")
    }
    await check()
    const data = await within(() => readAgentRunDisplay(config, context, runId, controller.signal))
    await check()
    controller.signal.throwIfAborted()
    if (Buffer.byteLength(JSON.stringify({ data })) > 1048576) throw Error("run_display_response_invalid")
    if (!response.destroyed && !response.writableEnded) send(response, 200, { data })
  } catch (error) {
    if (error instanceof RunDisplayAdmissionError) fail(error.status, error.code, error.retryAfter)
    else if (error instanceof Error && error.message === "run_display_not_found") fail(404, "run_not_found")
    else if (error instanceof Error && error.message === "run_display_response_invalid") fail(502, "run_display_response_invalid")
    else fail(503, "run_display_unavailable")
  } finally {
    clearTimeout(timer)
    controller.abort()
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
}
