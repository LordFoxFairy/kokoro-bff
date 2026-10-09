import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import { authorizeLocalSkillImportWrite, authorizeUserRequest } from "../../auth/user-admission.js"
import { send } from "../response.js"
import {
  localImportCommandId,
  localImportDigest,
  localImportId,
  localImportKey,
  parseLocalImportBegin,
  parseLocalImportComplete,
} from "../local-skill-import-input.js"
import {
  projectLocalImportBegin,
  projectLocalImportComplete,
  projectLocalImportFinalize,
  projectLocalImportGet,
} from "../../infrastructure/clients/platform/local-skill-import-response.js"
import type { LocalSkillImportClient } from "../../infrastructure/clients/platform/local-skill-import-connect.js"

export type { LocalSkillImportClient } from "../../infrastructure/clients/platform/local-skill-import-connect.js"
const error = (code: string, message: string, retryable = false) => ({ error: { code, message, retryable } })
function body(request: IncomingMessage, signal: AbortSignal, limit = 65_536): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const cleanup = () => {
      request.off("data", onData)
      request.off("end", onEnd)
      request.off("error", onError)
      request.off("aborted", onRequestAborted)
      signal.removeEventListener("abort", onSignalAborted)
    }
    const finish = (fn: () => void) => {
      cleanup()
      fn()
    }
    const onData = (part: Buffer | string) => {
      const chunk = Buffer.from(part)
      size += chunk.length
      if (size > limit) finish(() => reject(new Error("request_body_too_large")))
      else chunks.push(chunk)
    }
    const onEnd = () => finish(() => resolve(Buffer.concat(chunks)))
    const onError = (cause: Error) => finish(() => reject(cause))
    const onRequestAborted = () => finish(() => reject(new Error("request_aborted")))
    const onSignalAborted = () => {
      request.resume()
      finish(() => reject(signal.reason ?? new Error("local_skill_import_cancelled")))
    }
    request.on("data", onData)
    request.once("end", onEnd)
    request.once("error", onError)
    request.once("aborted", onRequestAborted)
    signal.addEventListener("abort", onSignalAborted, { once: true })
    if (signal.aborted) onSignalAborted()
  })
}
export async function localSkillImportRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  session: SessionAdmission,
  auth: Pick<SkillAuthorizationClient, "check">,
  client: LocalSkillImportClient | undefined,
  requestId: string,
  segments: string[],
): Promise<boolean> {
  if (client === undefined || segments[0] !== "browser" || segments[1] !== "v1" || segments[2] !== "skills" || segments[3] !== "local-imports") return false
  const tail = segments.slice(4),
    method = request.method ?? "GET"
  const kind =
    tail.length === 0 && method === "POST"
      ? "begin"
      : tail.length === 1 && method === "GET"
        ? "get"
        : tail.length === 2 && method === "POST" && tail[1] === "complete"
          ? "complete"
          : tail.length === 2 && method === "POST" && tail[1] === "finalize"
            ? "finalize"
            : null
  if (kind === null) return false
  response.setHeader("x-request-id", requestId)
  response.setHeader("cache-control", "no-store")
  const budget = kind === "get" ? 2_000 : kind === "finalize" ? 20_000 : 10_000,
    deadlineAt = performance.now() + budget
  const controller = new AbortController(),
    abort = (reason: Error) => {
      if (!controller.signal.aborted) controller.abort(reason)
    },
    timer = setTimeout(() => abort(new Error("local_skill_import_deadline")), budget)
  const cancelRequest = () => abort(new Error("local_skill_import_request_aborted"))
  const cancelResponse = () => {
    if (!response.writableEnded) abort(new Error("local_skill_import_response_closed"))
  }
  request.once("aborted", cancelRequest)
  response.once("close", cancelResponse)
  try {
    const admitted = await authorizeUserRequest(request, config, session, requestId, controller.signal)
    controller.signal.throwIfAborted()
    if (!admitted.ok) {
      send(response, admitted.status, error(admitted.code, "Local Skill import admission failed"))
      return true
    }
    if (kind !== "get") {
      const checked = await authorizeLocalSkillImportWrite(auth, admitted, controller.signal)
      controller.signal.throwIfAborted()
      if (!checked.ok) {
        send(response, checked.status, error(checked.code, "Local Skill import is forbidden"))
        return true
      }
    }
    const common = { requestId, tenant: admitted.context.identity.namespace, subject: admitted.context.identity.userId }
    if (kind === "get") {
      if (request.headers["idempotency-key"] !== undefined || (await body(request, controller.signal, 1)).length)
        throw new Error("invalid_local_skill_import_request")
      controller.signal.throwIfAborted()
      const result = await client.get({ ...common, intentId: localImportId(tail[0]!) }, controller.signal, deadlineAt)
      controller.signal.throwIfAborted()
      send(response, 200, { data: projectLocalImportGet(result, localImportId(tail[0]!)) })
      return true
    }
    const keys = request.rawHeaders.flatMap((v, i) => (i % 2 === 0 && v.toLowerCase() === "idempotency-key" ? [request.rawHeaders[i + 1] ?? ""] : [])),
      key = localImportKey(keys)
    if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" && kind !== "finalize")
      throw new Error("invalid_local_skill_import_request")
    const raw = await body(request, controller.signal)
    controller.signal.throwIfAborted()
    const parsed =
      kind === "begin"
        ? parseLocalImportBegin(JSON.parse(raw.toString()))
        : kind === "complete"
          ? parseLocalImportComplete(JSON.parse(raw.toString()))
          : raw.length
            ? (() => {
                throw new Error("invalid_local_skill_import_request")
              })()
            : {}
    const intent = kind === "begin" ? "new" : localImportId(tail[0]!)
    const command = {
      ...common,
      commandId: localImportCommandId(kind, common.tenant, common.subject, intent, key),
      digest: localImportDigest(kind, common.tenant, common.subject, parsed),
    }
    let projected: unknown
    if (kind === "begin") {
      const input = { ...command, ...parseLocalImportBegin(JSON.parse(raw.toString())) }
      const result = await client.begin(input, controller.signal, deadlineAt)
      controller.signal.throwIfAborted()
      projected = projectLocalImportBegin(result, config.storageObjectOrigin ?? config.storage?.objectOrigin ?? "")
    } else if (kind === "complete") {
      const input = { ...command, ...parseLocalImportComplete(JSON.parse(raw.toString())), intentId: intent }
      const result = await client.complete(input, controller.signal, deadlineAt)
      controller.signal.throwIfAborted()
      projected = projectLocalImportComplete(result, {
        intentId: input.intentId,
        uploadId: input.uploadId,
        sourceVersionId: input.sourceVersionId,
        sizeBytes: BigInt(input.sizeBytes),
        contentSha256: input.contentSha256,
      })
    } else {
      const input = { ...command, intentId: intent }
      const result = await client.finalize(input, controller.signal, deadlineAt)
      controller.signal.throwIfAborted()
      projected = projectLocalImportFinalize(result, input.intentId)
    }
    send(response, kind === "begin" ? 201 : 200, { data: projected })
    return true
  } catch (e) {
    if (!response.writableEnded && !response.destroyed) {
      if (e instanceof ConnectError && e.code === Code.FailedPrecondition)
        send(response, 412, error("local_skill_import_precondition_failed", "Local Skill import phase precondition failed"))
      else if (e instanceof ConnectError && e.code === Code.NotFound)
        send(response, 404, error("local_skill_import_not_found", "Local Skill import was not found"))
      else if (e instanceof ConnectError && e.code === Code.AlreadyExists)
        send(response, 409, error("local_skill_import_idempotency_conflict", "Local Skill import command conflicts"))
      else if (e instanceof ConnectError && e.code === Code.ResourceExhausted)
        send(response, 429, error("local_skill_import_rate_limited", "Local Skill import was rate limited", true))
      else if (e instanceof ConnectError || controller.signal.aborted)
        send(response, 503, error("local_skill_import_dependency_unavailable", "Local Skill import owner is unavailable", true))
      else
        send(
          response,
          e instanceof Error && e.message === "request_body_too_large"
            ? 413
            : e instanceof Error && ["local_skill_import_response_invalid", "skill_response_invalid", "skill_installation_response_invalid"].includes(e.message)
              ? 502
              : 400,
          error(
            e instanceof Error && ["local_skill_import_response_invalid", "skill_response_invalid", "skill_installation_response_invalid"].includes(e.message)
              ? "local_skill_import_response_invalid"
              : e instanceof Error
                ? e.message
                : "invalid_local_skill_import_request",
            "Local Skill import request failed",
          ),
        )
    }
    return true
  } finally {
    clearTimeout(timer)
    request.off("aborted", cancelRequest)
    response.off("close", cancelResponse)
  }
}
