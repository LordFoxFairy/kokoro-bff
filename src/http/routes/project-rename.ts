import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { RequestContext } from "../../domain/request-context.js"
import { isCanonicalRenameProjectId, parseProjectRenameName, renameProjectHeaderValues, validRenameProjectKey } from "../project-rename-input.js"
import { send } from "../response.js"

// Returning from the generic async iterator destroys the HTTP socket on overflow.
// Keep it alive long enough to deliver the published 400, without buffering excess bytes.
async function readRenameBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.byteLength
    if (size > 65_536) throw new Error("PROJECT_RENAME_BODY_TOO_LARGE")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export async function projectRenameRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  projectId: string,
  store: BffBusinessStore | null,
): Promise<void> {
  const failure = (status: number, code: string, message: string, retryable = false): void => {
    send(response, status, { error: { code, message, retryable } })
  }
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("cache-control", "no-store")
  if (request.method !== "PATCH" || request.url !== `/v1/projects/${projectId}/name` || !isCanonicalRenameProjectId(projectId)) {
    failure(400, "invalid_project_rename", "Project rename request is invalid")
    return
  }
  const keys = renameProjectHeaderValues(request.rawHeaders, "idempotency-key")
  const key = keys[0]
  if (keys.length !== 1 || key === undefined || !validRenameProjectKey(key)) {
    failure(400, keys.length === 0 ? "idempotency_key_required" : "invalid_project_rename", "One valid Idempotency-Key is required")
    return
  }
  const contentTypes = renameProjectHeaderValues(request.rawHeaders, "content-type")
  if (contentTypes.length !== 1 || contentTypes[0]?.toLowerCase().split(";", 1)[0]?.trim() !== "application/json") {
    failure(400, "invalid_project_rename", "Project rename requires one application/json Content-Type")
    return
  }
  let name: string | null
  try {
    name = parseProjectRenameName(await readRenameBody(request))
  } catch {
    response.setHeader("connection", "close")
    request.resume()
    failure(400, "invalid_project_rename", "Project rename body is invalid")
    return
  }
  if (name === null) {
    failure(400, "invalid_project_rename", "Project rename name is invalid")
    return
  }
  if (store === null) {
    failure(503, "business_store_unavailable", "Project store is unavailable", true)
    return
  }
  const abort = new AbortController()
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  if (request.aborted || response.destroyed) abort.abort()
  try {
    const result = await store.services.projects.rename(
      { tenantId: context.identity.namespace, subjectId: context.identity.userId },
      projectId,
      name,
      key,
      abort.signal,
    )
    if (response.destroyed) return
    if (result.kind === "renamed") send(response, 200, result.receipt)
    else if (result.kind === "not_found") failure(404, "project_not_found", "Project was not found")
    else failure(409, "idempotency_conflict", "Project rename key was used for different input")
  } catch {
    if (!response.destroyed) failure(503, "business_store_unavailable", "Project rename result is unavailable", true)
  } finally {
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
}
