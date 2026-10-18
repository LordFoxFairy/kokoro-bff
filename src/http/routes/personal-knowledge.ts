import type { IncomingMessage, ServerResponse } from "node:http"
import { performance } from "node:perf_hooks"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { PersonalKnowledgeOutcome } from "../../application/ports/personal-knowledge-repository.js"
import type { RequestContext } from "../../domain/request-context.js"
import { KNOWLEDGE_ID_PATTERN, knowledgeText, parsePersonalKnowledgeBody } from "../personal-knowledge-input.js"
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
      reject(new Error("KNOWLEDGE_BODY_UNAVAILABLE"))
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
        reject(new Error("KNOWLEDGE_BODY_TOO_LARGE"))
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

export async function personalKnowledgeRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  store: BffBusinessStore | null,
): Promise<void> {
  if (request.aborted || response.destroyed || response.writableEnded) return
  const controller = new AbortController(),
    deadline = performance.now() + 5000
  const timer = setTimeout(() => controller.abort(), 5000)
  const cancel = () => controller.abort(),
    close = () => {
      if (!response.writableEnded) cancel()
    }
  request.once("aborted", cancel)
  response.once("close", close)
  response.setHeader("cache-control", "no-store")
  response.setHeader("x-request-id", context.requestId)
  const fail = (status: number, code: string, message: string, retryable = false) => {
    if (!response.destroyed && !response.writableEnded) send(response, status, { error: { code, message, retryable } })
  }
  try {
    const url = new URL(request.url ?? "/", "http://bff.invalid"),
      path = url.pathname
    const list = path === "/v1/preferences/knowledge",
      usage = path === "/v1/preferences/knowledge-usage"
    const id = path.startsWith("/v1/preferences/knowledge/") ? path.slice("/v1/preferences/knowledge/".length) : null
    if (
      (!list && !usage && (id === null || !KNOWLEDGE_ID_PATTERN.test(id))) ||
      ["idempotency-key", "if-match", "if-none-match"].some((k) => request.headers[k] !== undefined)
    ) {
      fail(400, "invalid_knowledge_request", "Invalid knowledge request")
      return
    }
    if (request.url?.includes("?") && url.searchParams.size === 0) {
      fail(400, "invalid_knowledge_request", "Invalid knowledge query")
      return
    }
    const params = [...url.searchParams.entries()]
    if (params.length > (list ? 1 : 0) || params.some(([key, value]) => key !== "query" || !knowledgeText(value, 500, false))) {
      fail(400, "invalid_knowledge_request", "Invalid knowledge query")
      return
    }
    const method = request.method,
      allowed = list ? ["GET"] : usage ? ["GET", "PUT"] : ["GET", "PUT", "DELETE"]
    if (!allowed.includes(method ?? "")) {
      response.setHeader("allow", allowed.join(", "))
      fail(405, "method_not_allowed", "Method not allowed")
      return
    }
    const repository = store?.services.personalKnowledge
    if (!repository) {
      fail(503, "knowledge_unavailable", "Knowledge store is unavailable", method === "GET")
      return
    }
    const scope = { tenantId: context.identity.namespace, subjectId: context.identity.userId },
      options = { deadline, signal: controller.signal }
    let result: PersonalKnowledgeOutcome<unknown>,
      status = 200
    if (method === "GET") {
      if (
        request.headers["transfer-encoding"] !== undefined ||
        (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")
      ) {
        fail(400, "invalid_knowledge_request", "Read requests must have no body")
        return
      }
      result = list
        ? await repository.list(scope, url.searchParams.get("query") ?? "", options)
        : usage
          ? await repository.readUsage(scope, options)
          : await repository.get(scope, id!, options)
    } else {
      const types = request.rawHeaders.filter((_, i) => i % 2 === 0 && request.rawHeaders[i]?.toLowerCase() === "content-type")
      if (types.length !== 1 || !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] ?? "")) {
        fail(400, "invalid_knowledge_request", "A single JSON content type is required")
        return
      }
      let raw: Buffer
      try {
        raw = await readBody(request, controller.signal)
      } catch (e) {
        if (e instanceof Error && e.message === "KNOWLEDGE_BODY_TOO_LARGE") fail(413, "request_body_too_large", "Knowledge request is too large")
        else fail(503, "knowledge_unavailable", "Knowledge request did not complete")
        return
      }
      const mutation = parsePersonalKnowledgeBody(raw, usage ? "usage" : method === "DELETE" ? "remove" : "replace")
      if (!mutation) {
        fail(400, "invalid_knowledge_request", "Invalid knowledge body")
        return
      }
      if (usage && "enabled" in mutation) result = await repository.replaceUsage(scope, mutation.expectedRevision, mutation.enabled, options)
      else if (method === "DELETE") {
        result = await repository.remove(scope, id!, mutation.expectedRevision, options)
        status = 204
      } else if ("fields" in mutation) {
        result = await repository.replace(scope, id!, mutation.expectedRevision, mutation.fields, options)
        status = mutation.expectedRevision === 0 ? 201 : 200
      } else {
        fail(400, "invalid_knowledge_request", "Invalid knowledge body")
        return
      }
    }
    if (controller.signal.aborted || performance.now() >= deadline) {
      fail(503, method === "GET" ? "knowledge_unavailable" : "knowledge_save_unknown", "Knowledge result could not be confirmed", method === "GET")
      return
    }
    if (result.kind === "ok") {
      if (status === 204) {
        response.statusCode = 204
        response.end()
        return
      }
      if (status === 201) response.setHeader("location", path)
      send(response, status, { data: list ? { items: result.value, max_items: 100 } : result.value })
      return
    }
    const failures = {
      not_found: [404, "knowledge_not_found"],
      conflict: [409, "knowledge_revision_conflict"],
      exhausted: [409, "knowledge_revision_exhausted"],
      limit: [409, "knowledge_limit_exceeded"],
      unavailable: [503, "knowledge_unavailable"],
      unknown: [503, "knowledge_save_unknown"],
    } as const
    const [code, error] = failures[result.kind]
    fail(code, error, "Knowledge request did not complete", method === "GET" && result.kind === "unavailable")
  } catch {
    fail(503, "knowledge_unavailable", "Knowledge store is unavailable", request.method === "GET")
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", cancel)
    response.removeListener("close", close)
  }
}
