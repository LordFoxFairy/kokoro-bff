import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { requestIamAccountProfile } from "../../infrastructure/clients/iam-account-profile.js"
import { accountProfileMetadataValid, parseAccountProfileBody } from "../account-profile-input.js"
import { send } from "../response.js"

/** One request lifetime, reusing the normal Product admission and no BFF mutation store. */
export async function accountProfileRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  requestId: string,
): Promise<void> {
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 10000)
  const abort = new AbortController()
  let rejectBudget!: (error: Error) => void
  const budget = new Promise<never>((_resolve, reject) => {
    rejectBudget = reject
  })
  const interrupt = () => {
    abort.abort()
    rejectBudget(new Error("profile_retired"))
  }
  const timer = setTimeout(interrupt, Math.max(0, deadlineAt - performance.now()))
  const onClose = () => {
    if (!response.writableEnded) interrupt()
  }
  request.once("aborted", interrupt)
  response.once("close", onClose)
  response.setHeader("x-request-id", requestId)
  response.setHeader("cache-control", "no-store")
  const active = () => {
    if (abort.signal.aborted || request.aborted || response.destroyed || performance.now() >= deadlineAt) throw new Error("profile_retired")
  }
  const failure = (status: number, code: string, retryAfter?: string) => {
    if (!response.destroyed && !response.writableEnded && !request.aborted)
      send(response, status, { error: { code, message: code, retryable: status === 429 || status === 503 } }, retryAfter)
  }
  const bounded = async <T>(work: Promise<T>): Promise<T> => {
    const result = await Promise.race([work, budget])
    active()
    return result
  }
  try {
    active()
    if (!accountProfileMetadataValid(request)) {
      failure(400, "account_profile_input_invalid")
      return
    }
    const admitted = await bounded(
      authorizeUserRequest(request, config, admission, requestId, abort.signal).catch(() => {
        throw new Error("profile_admission_unavailable")
      }),
    )
    if (!admitted.ok) {
      failure(admitted.status, admitted.code, admitted.retryAfter)
      return
    }
    const body = await bounded(
      new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        let size = 0
        const cleanup = () => {
          request.removeListener("data", onData)
          request.removeListener("end", onEnd)
          request.removeListener("error", onError)
          abort.signal.removeEventListener("abort", onAbort)
        }
        const onError = () => {
          cleanup()
          reject(new Error("profile_body_unavailable"))
        }
        const onAbort = () => {
          request.pause()
          onError()
        }
        const onEnd = () => {
          cleanup()
          resolve(Buffer.concat(chunks))
        }
        const onData = (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += bytes.length
          if (size > 65536) {
            cleanup()
            request.pause()
            reject(new Error("profile_body_too_large"))
            return
          }
          chunks.push(bytes)
        }
        abort.signal.addEventListener("abort", onAbort, { once: true })
        request.on("data", onData)
        request.once("end", onEnd)
        request.once("error", onError)
        if (abort.signal.aborted) onAbort()
      }),
    )
    const input = parseAccountProfileBody(body)
    if (input === null) {
      failure(400, "account_profile_input_invalid")
      return
    }
    active()
    const result = await bounded(
      requestIamAccountProfile({
        ...input,
        expectedSubject: admitted.context.identity.userId,
        baseUrl: config.iamBaseUrl,
        token: admitted.bearerToken,
        requestId,
        signal: abort.signal,
        deadlineAt,
        maxResponseBytes: config.upstreamMaxResponseBytes,
      }),
    )
    if (!result.ok) {
      failure(result.status, result.code, result.retryAfter)
      return
    }
    active()
    send(response, 200, { data: result.data })
  } catch (error) {
    const cause = error instanceof Error ? error.message : ""
    if (cause === "profile_body_too_large") failure(413, "account_profile_request_too_large")
    else if (["profile_retired", "profile_body_unavailable", "profile_admission_unavailable"].includes(cause)) failure(503, "account_profile_unavailable")
    else failure(500, "internal_error")
  } finally {
    clearTimeout(timer)
    abort.abort()
    request.removeListener("aborted", interrupt)
    response.removeListener("close", onClose)
  }
}
