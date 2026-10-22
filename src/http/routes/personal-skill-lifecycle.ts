import { Code, ConnectError } from "@connectrpc/connect"
import type { IncomingMessage, ServerResponse } from "node:http"

import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { BffConfig } from "../../config/runtime.js"
import type { AdmittedUserRequestContext } from "../../domain/request-context.js"

export type PersonalSkillLifecycleScope = Readonly<{
  context: AdmittedUserRequestContext
  signal: AbortSignal
  deadlineAt: number
  active: () => void
}>

const payload = (requestId: string, code: string, message: string) => ({
  error: { code, message },
  meta: { request_id: requestId },
})

export function replyPersonalSkillLifecycle(
  response: ServerResponse,
  scope: Pick<PersonalSkillLifecycleScope, "active"> | null,
  requestId: string,
  status: number,
  body: object,
  retryAfter?: string,
): void {
  const bytes = Buffer.from(JSON.stringify(body))
  scope?.active()
  if (response.destroyed || response.writableEnded) return
  const request = response.req
  const retireIncompleteRequest = !request.complete
  if (retireIncompleteRequest) {
    request.pause()
    response.setHeader("connection", "close")
  }
  response.setHeader("x-request-id", requestId)
  response.setHeader("cache-control", "no-store")
  response.setHeader("content-type", "application/json; charset=utf-8")
  response.setHeader("content-length", String(bytes.byteLength))
  if (retryAfter !== undefined) response.setHeader("retry-after", retryAfter)
  scope?.active()
  response.writeHead(status)
  response.end(bytes)
  if (retireIncompleteRequest) {
    const retire = (): void => {
      request.socket?.destroy()
    }
    if (response.writableFinished) retire()
    else response.once("finish", retire)
  }
}

function whileActive<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (): void => signal.removeEventListener("abort", aborted)
    const aborted = (): void => {
      if (settled) return
      settled = true
      finish()
      reject(signal.reason)
    }
    signal.addEventListener("abort", aborted, { once: true })
    void promise.then(
      (value) => {
        if (settled) return
        settled = true
        finish()
        if (signal.aborted) reject(signal.reason)
        else resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        finish()
        reject(error)
      },
    )
    if (signal.aborted) aborted()
  })
}

export async function withPersonalSkillLifecycle(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admissionSource: SessionAdmission,
  requestId: string,
  work: (scope: PersonalSkillLifecycleScope) => Promise<void>,
): Promise<void> {
  if (request.aborted || response.destroyed || response.writableEnded) return
  const deadlineAt = performance.now() + 10_000
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(
    () => {
      timedOut = true
      controller.abort(new Error("personal_skill_lifecycle_deadline"))
    },
    Math.max(0, deadlineAt - performance.now()),
  )
  timeout.unref()
  const cancel = (): void => controller.abort(new Error("personal_skill_lifecycle_cancelled"))
  const close = (): void => {
    if (!response.writableEnded) cancel()
  }
  request.once("aborted", cancel)
  response.once("close", close)
  const active = (): void => {
    if (performance.now() >= deadlineAt) {
      timedOut = true
      if (!controller.signal.aborted) controller.abort(new Error("personal_skill_lifecycle_deadline"))
    }
    controller.signal.throwIfAborted()
    if (request.aborted || response.destroyed || response.writableEnded) throw new Error("personal_skill_lifecycle_cancelled")
  }
  try {
    active()
    let admission: Awaited<ReturnType<typeof authorizeUserRequest>>
    try {
      admission = await whileActive(authorizeUserRequest(request, config, admissionSource, requestId, controller.signal), controller.signal)
    } catch {
      if (controller.signal.aborted || request.aborted || response.destroyed || response.writableEnded) {
        if (timedOut && !request.aborted && !response.destroyed && !response.writableEnded) throw controller.signal.reason
        return
      }
      active()
      replyPersonalSkillLifecycle(response, { active }, requestId, 503, payload(requestId, "iam_admission_unavailable", "BFF user admission failed"))
      return
    }
    active()
    if (!admission.ok) {
      if (
        admission.status === 429 &&
        (admission.retryAfter === undefined || !/^(?:[1-9][0-9]{0,3}|[1-7][0-9]{4}|8[0-5][0-9]{3}|86[0-3][0-9]{2}|86400)$/u.test(admission.retryAfter))
      ) {
        replyPersonalSkillLifecycle(
          response,
          { active },
          requestId,
          502,
          payload(requestId, "skill_response_invalid", "BFF user admission returned an invalid response"),
        )
        return
      }
      replyPersonalSkillLifecycle(
        response,
        { active },
        requestId,
        admission.status,
        payload(requestId, admission.code, "BFF user admission failed"),
        admission.retryAfter,
      )
      return
    }
    await whileActive(
      work({
        context: admission.context,
        signal: controller.signal,
        deadlineAt,
        active,
      }),
      controller.signal,
    )
  } catch {
    if (!response.destroyed && !response.writableEnded && timedOut) {
      replyPersonalSkillLifecycle(
        response,
        null,
        requestId,
        503,
        payload(requestId, "skill_dependency_unavailable", "Skill lifecycle dependency is unavailable"),
      )
    }
  } finally {
    clearTimeout(timeout)
    request.removeListener("aborted", cancel)
    response.removeListener("close", close)
  }
}

export async function readPersonalSkillLifecycleBody(request: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const cleanup = (): void => {
      request.removeListener("data", data)
      request.removeListener("end", end)
      request.removeListener("error", error)
      signal.removeEventListener("abort", abort)
    }
    const fail = (reason: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      request.pause()
      reject(reason)
    }
    const data = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.byteLength
      if (size > 65_536) fail(new Error("request_body_too_large"))
      else chunks.push(bytes)
    }
    const end = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const error = (reason: Error): void => fail(reason)
    const abort = (): void => fail(new Error("personal_skill_lifecycle_deadline"))
    request.on("data", data)
    request.once("end", end)
    request.once("error", error)
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
  })
}

export const lifecycleError = payload

export function personalSkillLifecycleFailure(error: unknown): {
  status: number
  code: string
  retryAfter?: string
} {
  if (!(error instanceof ConnectError))
    return error instanceof Error && error.message === "skill_response_invalid"
      ? { status: 502, code: "skill_response_invalid" }
      : { status: 503, code: "skill_dependency_unavailable" }
  if (error.code === Code.NotFound || error.code === Code.PermissionDenied) return { status: 404, code: "skill_not_found" }
  if (error.code === Code.AlreadyExists) return { status: 409, code: "skill_idempotency_conflict" }
  if (error.code === Code.Aborted) return { status: 409, code: "skill_command_in_progress" }
  if (error.code === Code.FailedPrecondition) return { status: 412, code: "skill_precondition_failed" }
  if (error.code === Code.ResourceExhausted) {
    const retryAfter = error.metadata.get("retry-after")
    return /^(?:[1-9][0-9]{0,3}|[1-7][0-9]{4}|8[0-5][0-9]{3}|86[0-3][0-9]{2}|86400)$/u.test(retryAfter ?? "")
      ? {
          status: 429,
          code: "skill_rate_limited",
          retryAfter: retryAfter as string,
        }
      : { status: 502, code: "skill_response_invalid" }
  }
  if ([Code.Unavailable, Code.DeadlineExceeded, Code.Canceled, Code.Unauthenticated].includes(error.code))
    return { status: 503, code: "skill_dependency_unavailable" }
  return { status: 502, code: "skill_response_invalid" }
}
