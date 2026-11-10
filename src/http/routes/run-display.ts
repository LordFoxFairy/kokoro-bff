import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { AgentRunsReader } from "../../infrastructure/postgres/project-execution-binding.js"
import type { ChatConversationLookup } from "../../infrastructure/postgres/chat-conversation-lookup.js"
import type { RunFinalAnswerLookup } from "../../infrastructure/postgres/run-final-answer-read.js"
import { messageFeedbackId } from "../../application/chat/message-feedback-input.js"
import { readAgentRunDisplay, workspaceOutputVersionId } from "../../infrastructure/clients/agent/run-display.js"
import { readWorkspaceOutputBytes } from "../../infrastructure/clients/storage/workspace-output-download.js"
import type { VerifiedArtifactSpool } from "../../infrastructure/clients/storage/artifact-download-transfer.js"
import { ProjectResourceError } from "../../application/project-resource.error.js"
import { failure } from "../../contracts/index.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"
import { writeVerifiedDownload } from "../verified-download.js"
export class RunDisplayAdmissionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfter?: string,
  ) {
    super("Run display admission failed")
  }
}

export type RunDisplayProvider = Readonly<{
  submittedAgentRuns: Pick<AgentRunsReader, "readSubmittedAgentRun">
  findConversation: ChatConversationLookup
  readRunFinalAnswer: RunFinalAnswerLookup
}>

export async function runDisplayRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  path: readonly string[],
  store: RunDisplayProvider | null,
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
  let spool: VerifiedArtifactSpool | undefined
  try {
    const url = new URL(request.url ?? "", "http://bff.invalid"),
      sessionId = path[1],
      runId = path[3]
    const display = path.length === 5 && path[4] === "display"
    const version = path.length === 7 && path[4] === "workspace-outputs" && path[6] === "content" ? path[5] : undefined
    if (
      (!display && (version === undefined || !workspaceOutputVersionId.safeParse(version).success)) ||
      path[0] !== "sessions" ||
      path[2] !== "runs" ||
      !messageFeedbackId(sessionId) ||
      !messageFeedbackId(runId) ||
      url.pathname !==
        `/v1/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/${display ? "display" : `workspace-outputs/${version}/content`}` ||
      url.search ||
      url.hash ||
      [
        "content-length",
        "transfer-encoding",
        "content-type",
        "content-encoding",
        "idempotency-key",
        "if-match",
        ...(display ? [] : ["range", "if-range", "if-none-match", "if-modified-since", "if-unmodified-since"]),
      ].some((k) => request.headers[k] !== undefined)
    ) {
      fail(400, "invalid_run_display_request")
      return
    }
    if (request.method !== "GET") {
      fail(405, "method_not_allowed")
      return
    }
    if (!store) throw Error("run_display_unavailable")
    const checkedStore = store
    const checkOwned = async () => {
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
        checkedStore.findConversation(context.identity.namespace, context.identity.userId, sessionId, undefined, {
          signal: controller.signal,
          deadlineAt,
        }),
      )
      if (!owned) throw Error("run_display_not_found")
    }
    // The enclosing handler just admitted the user. Repeat that admission
    // after owner I/O, not twice in a row before the first read.
    await checkOwned()
    const { final_message_id, workspace_outputs, ...facts } = await within(() => readAgentRunDisplay(config, context, runId, controller.signal))
    if (version !== undefined) {
      const file = workspace_outputs?.find((candidate) => candidate.version_id === version)
      if (!file) throw new ProjectResourceError("workspace_output_not_found", 404)
      if (!config.storage) throw new ProjectResourceError("storage_unavailable", 503, true)
      spool = await readWorkspaceOutputBytes(config.storage, context, sessionId, file, controller.signal)
      await within(() => currentAdmission(controller.signal))
      await checkOwned()
      controller.signal.throwIfAborted()
      await writeVerifiedDownload(
        response,
        spool,
        {
          filename: file.virtual_path.split("/").at(-1)!,
          mimeType: file.mime_type,
          requestId: context.requestId,
        },
        controller.signal,
      )
      return
    }
    const finalAnswer = final_message_id
      ? await within(() =>
          checkedStore.readRunFinalAnswer({
            tenantId: context.identity.namespace,
            subjectId: context.identity.userId,
            conversationId: sessionId,
            runId,
            finalMessageId: final_message_id,
            signal: controller.signal,
            deadlineAt,
          }),
        )
      : null
    const data = {
      ...facts,
      ...(finalAnswer ? { final_answer: finalAnswer } : {}),
      ...(workspace_outputs
        ? {
            workspace_outputs: workspace_outputs.map(({ version_id, virtual_path, content_sha256, size_bytes, mime_type }) => ({
              version_id,
              virtual_path,
              content_sha256,
              size_bytes,
              mime_type,
            })),
          }
        : {}),
    }
    await within(() => currentAdmission(controller.signal))
    await checkOwned()
    controller.signal.throwIfAborted()
    if (Buffer.byteLength(JSON.stringify({ data })) > 1048576) throw Error("run_display_response_invalid")
    if (!response.destroyed && !response.writableEnded) send(response, 200, { data })
  } catch (error) {
    if (response.headersSent) {
      if (!response.writableFinished && !response.destroyed) response.destroy()
    } else if (error instanceof ProjectResourceError) fail(error.status, error.code)
    else if (error instanceof RunDisplayAdmissionError) fail(error.status, error.code, error.retryAfter)
    else if (error instanceof Error && error.message === "run_display_not_found") fail(404, "run_not_found")
    else if (error instanceof Error && error.message === "run_display_response_invalid") fail(502, "run_display_response_invalid")
    else fail(503, "run_display_unavailable")
  } finally {
    clearTimeout(timer)
    controller.abort()
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
    await spool?.cleanup()
  }
}

export function isRunDisplayRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  return /^\/v1\/sessions\/[^/]+\/runs\/[^/]+\/(?:display|workspace-outputs\/[^/]+\/content)$/u.test(path)
}

/** AgentRuns/AG-UI-owned run display adapter with fresh human admission before and after owner reads. */
export async function handleRunDisplayRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  provider: RunDisplayProvider | null,
): Promise<boolean> {
  if (!isRunDisplayRequest(request)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const abort = new AbortController()
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 5_000)
  const timer = setTimeout(() => abort.abort(), Math.max(0, deadlineAt - performance.now()))
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal, response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    await runDisplayRoute(request, response, config, admitted.context, pathOf(request).slice(1), provider, deadlineAt, async (signal) => {
      const fresh = await authorizeUserRequest(request, config, admission, id, signal, response)
      if (!fresh.ok) throw new RunDisplayAdmissionError(fresh.status, fresh.code, fresh.retryAfter)
      if (fresh.context.identity.namespace !== admitted.context.identity.namespace || fresh.context.identity.userId !== admitted.context.identity.userId)
        throw new RunDisplayAdmissionError(404, "run_not_found")
    })
    return true
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed)
      send(response, 503, failure("run_display_unavailable", "Run display read failed", id))
    return true
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
}
