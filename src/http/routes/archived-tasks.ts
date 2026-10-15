import { createHash } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import {
  parseArchiveInput,
  parseArchiveBody,
  decodeArchivedCursor,
  encodeArchivedCursor,
  archiveStateValid,
  archivedItemsValid,
} from "../archived-tasks-input.js"
import { send } from "../response.js"

export async function archivedTasksRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  chat: ChatApplicationService | undefined,
  requestId: string,
): Promise<void> {
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 10000)
  const controller = new AbortController()
  let reject!: (error: Error) => void
  const interrupted = new Promise<never>((_, fail) => {
    reject = fail
  })
  const stop = () => {
    controller.abort()
    reject(new Error("ARCHIVE_RETIRED"))
  }
  const timer = setTimeout(stop, Math.max(0, deadlineAt - performance.now()))
  const close = () => {
    if (!response.writableEnded) stop()
  }
  response.once("close", close)
  request.once("aborted", stop)
  response.setHeader("x-request-id", requestId)
  response.setHeader("cache-control", "no-store")
  let list = (request.url ?? "").startsWith("/v1/account/")
  const unavailable = () => (list ? "archived_tasks_unavailable" : "archive_state_unavailable")
  const active = () => {
    if (controller.signal.aborted || request.aborted || response.destroyed || performance.now() >= deadlineAt) throw new Error("ARCHIVE_RETIRED")
  }
  const fail = (status: number, code: string, retryAfter?: string) => {
    if (!response.destroyed && !response.writableEnded)
      send(response, status, { error: { code, message: code, retryable: status === 429 || status === 503 } }, status === 429 ? retryAfter : undefined)
  }
  const output = (body: unknown) => {
    active()
    if (Buffer.byteLength(JSON.stringify(body)) > 1048576) throw new Error("ARCHIVE_OUTPUT_INVALID")
    send(response, 200, body)
  }
  try {
    active()
    const input = parseArchiveInput(request)
    list = input.kind === "list"
    const admitted = await Promise.race([authorizeUserRequest(request, config, admission, requestId, controller.signal), interrupted])
    active()
    if (!admitted.ok) {
      const allowed: Record<number, readonly string[]> = {
        401: ["session_authentication_required", "session_invalid"],
        403: ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"],
        429: ["session_rate_limited"],
        503: ["product_tenant_not_configured", "iam_admission_unavailable"],
      }
      fail(
        allowed[admitted.status]?.includes(admitted.code) ? admitted.status : 503,
        allowed[admitted.status]?.includes(admitted.code) ? admitted.code : unavailable(),
        admitted.retryAfter,
      )
      return
    }
    const { namespace: tenantId, userId: subjectId } = admitted.context.identity
    const identity = { tenantId, subjectId, signal: controller.signal, deadlineAt }
    if (!chat) {
      fail(503, unavailable())
      return
    }
    if (input.kind === "list") {
      const cursorIdentity = { tenantId, subjectId, limit: input.limit }
      const position = decodeArchivedCursor(input.cursor, cursorIdentity)
      const result = await Promise.race([chat.listOwnedArchivedTasks({ ...identity, limit: input.limit, position }), interrupted])
      active()
      if (!result || Object.keys(result).sort().join() !== "items,nextPosition" || !archivedItemsValid(result.items, input.limit))
        throw new Error("ARCHIVE_OUTPUT_INVALID")
      if (
        position &&
        result.items.some(
          (item) =>
            item.archived_at > position.archivedAt ||
            (item.archived_at === position.archivedAt && Buffer.compare(Buffer.from(item.session_id), Buffer.from(position.sessionId)) <= 0),
        )
      )
        throw new Error("ARCHIVE_OUTPUT_INVALID")
      const last = result.items.at(-1)
      if (
        result.nextPosition !== null &&
        (!last ||
          Object.keys(result.nextPosition).sort().join() !== "archivedAt,sessionId" ||
          result.nextPosition.archivedAt !== last.archived_at ||
          result.nextPosition.sessionId !== last.session_id)
      )
        throw new Error("ARCHIVE_OUTPUT_INVALID")
      output({ data: { items: result.items, next_cursor: result.nextPosition === null ? null : encodeArchivedCursor(result.nextPosition, cursorIdentity) } })
      return
    }
    if (input.kind === "state") {
      const result = await Promise.race([chat.readArchiveState({ ...identity, conversationId: input.conversationId }), interrupted])
      active()
      if (result === null) {
        fail(404, "session_not_found")
        return
      }
      if (!archiveStateValid(result, input.conversationId)) throw new Error("ARCHIVE_OUTPUT_INVALID")
      output({ data: result })
      return
    }
    const mime = request.headers["content-type"]
    const encoding = request.headers["content-encoding"]
    if (typeof mime !== "string" || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(mime) || (encoding !== undefined && encoding !== "identity")) {
      fail(415, "archive_state_content_type_unsupported")
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    const readBody = new Promise<void>((resolve, rejectBody) => {
      const cleanup = () => {
        request.removeListener("data", data)
        request.removeListener("end", end)
        request.removeListener("error", error)
        controller.signal.removeEventListener("abort", abort)
      }
      const data = (chunk: Buffer) => {
        size += chunk.length
        if (size > 4096) {
          cleanup()
          request.resume()
          rejectBody(new Error("ARCHIVE_BODY_LARGE"))
          return
        }
        chunks.push(Buffer.from(chunk))
      }
      const end = () => {
        cleanup()
        resolve()
      }
      const error = () => {
        cleanup()
        rejectBody(new Error("ARCHIVE_RETIRED"))
      }
      const abort = () => {
        cleanup()
        rejectBody(new Error("ARCHIVE_RETIRED"))
      }
      request.on("data", data)
      request.once("end", end)
      request.once("error", error)
      controller.signal.addEventListener("abort", abort, { once: true })
      if (controller.signal.aborted) abort()
    })
    await Promise.race([readBody, interrupted])
    active()
    parseArchiveBody(Buffer.concat(chunks))
    const scope = `archive-state:v1:${createHash("sha256")
      .update(JSON.stringify([tenantId, subjectId, input.key]))
      .digest("hex")}`
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([input.kind, input.conversationId]))
      .digest("hex")
    const result = await Promise.race([
      chat.changeArchiveState({ ...identity, conversationId: input.conversationId, action: input.kind, scope, fingerprint }),
      interrupted,
    ])
    active()
    if (result.kind === "not_found") {
      fail(404, "session_not_found")
      return
    }
    if (result.kind === "conflict") {
      fail(409, "archive_state_conflict")
      return
    }
    if (result.kind !== "changed") throw new Error("ARCHIVE_OUTPUT_INVALID")
    if (
      Object.keys(result).sort().join() !== "kind,receipt" ||
      !result.receipt ||
      Object.keys(result.receipt).sort().join() !== "data" ||
      !archiveStateValid(result.receipt.data, input.conversationId)
    )
      throw new Error("ARCHIVE_OUTPUT_INVALID")
    output(result.receipt)
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (code === "ARCHIVE_INPUT_INVALID") fail(400, list ? "archived_tasks_input_invalid" : "archive_state_input_invalid")
    else if (code === "ARCHIVE_BODY_LARGE") fail(413, "archive_state_payload_too_large")
    else fail(503, unavailable())
  } finally {
    controller.abort()
    clearTimeout(timer)
    response.removeListener("close", close)
    request.removeListener("aborted", stop)
  }
}
