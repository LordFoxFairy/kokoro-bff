import type { IncomingMessage, ServerResponse } from "node:http"
import { performance } from "node:perf_hooks"

import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { RequestContext } from "../../domain/request-context.js"
import { parsePersonalizationBody } from "../personalization-input.js"
import { send } from "../response.js"

async function readBody(request: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const cleanup = (): void => {
      request.removeListener("data", onData)
      request.removeListener("end", onEnd)
      request.removeListener("error", onError)
      signal.removeEventListener("abort", onAbort)
    }
    const onError = (): void => {
      cleanup()
      reject(new Error("PERSONALIZATION_BODY_UNAVAILABLE"))
    }
    const onAbort = (): void => {
      request.pause()
      onError()
    }
    const onEnd = (): void => {
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.byteLength
      if (size > 65_536) {
        request.pause()
        cleanup()
        reject(new Error("PERSONALIZATION_BODY_TOO_LARGE"))
        return
      }
      chunks.push(buffer)
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener("abort", onAbort, { once: true })
    request.on("data", onData)
    request.once("end", onEnd)
    request.once("error", onError)
  })
}

export async function personalizationRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  store: BffBusinessStore | null,
): Promise<void> {
  const deadline = performance.now() + 5000
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 5000)
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  if (request.aborted || response.destroyed) abort.abort()
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("cache-control", "no-store")
  const failure = (status: number, code: string, retryable = false): void => {
    if (!request.aborted && !response.destroyed && !response.writableEnded)
      send(response, status, { error: { code, message: "Personalization request could not be completed", retryable } })
  }
  try {
    if (request.url !== "/v1/preferences/personalization") {
      failure(400, "invalid_personalization_request")
      return
    }
    if (request.method !== "GET" && request.method !== "PUT") {
      response.setHeader("allow", "GET, PUT")
      failure(405, "method_not_allowed")
      return
    }
    if (request.method === "GET") {
      if (
        (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0") ||
        request.headers["transfer-encoding"] !== undefined
      ) {
        failure(400, "invalid_personalization_request")
        return
      }
      if (store === null) {
        failure(503, "personalization_unavailable", true)
        return
      }
      const result = await store.services.personalization.read(
        { tenantId: context.identity.namespace, subjectId: context.identity.userId },
        { deadline, signal: abort.signal },
      )
      if (request.aborted || response.destroyed || response.writableEnded) return
      if (result.kind === "read" && !abort.signal.aborted) send(response, 200, { data: result.snapshot })
      else failure(503, "personalization_unavailable", true)
      return
    }
    const contentTypes: string[] = []
    for (let index = 0; index < request.rawHeaders.length; index += 2)
      if (request.rawHeaders[index]?.toLowerCase() === "content-type") contentTypes.push(request.rawHeaders[index + 1] ?? "")
    if (contentTypes.length !== 1 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentTypes[0] ?? "")) {
      failure(400, "invalid_personalization_request")
      return
    }
    let raw: Buffer
    try {
      raw = await readBody(request, abort.signal)
    } catch (error) {
      response.setHeader("connection", "close")
      if (error instanceof Error && error.message === "PERSONALIZATION_BODY_TOO_LARGE") failure(413, "request_body_too_large")
      else failure(503, "personalization_unavailable")
      return
    }
    const replacement = parsePersonalizationBody(raw)
    if (replacement === null) {
      failure(400, "invalid_personalization_request")
      return
    }
    if (store === null || abort.signal.aborted) {
      failure(503, "personalization_unavailable")
      return
    }
    const result = await store.services.personalization.replace({ tenantId: context.identity.namespace, subjectId: context.identity.userId }, replacement, {
      deadline,
      signal: abort.signal,
    })
    if (request.aborted || response.destroyed || response.writableEnded) return
    if (result.kind === "saved" && !abort.signal.aborted) send(response, 200, { data: result.snapshot })
    else if (result.kind === "saved") failure(503, "personalization_save_unknown")
    else if (result.kind === "conflict") failure(409, "personalization_revision_conflict")
    else if (result.kind === "exhausted") failure(409, "personalization_revision_exhausted")
    else if (result.kind === "unknown") failure(503, "personalization_save_unknown")
    else failure(503, "personalization_unavailable")
  } catch {
    failure(503, "personalization_unavailable", request.method === "GET")
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
}
