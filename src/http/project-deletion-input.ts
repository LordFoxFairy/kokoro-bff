import type { IncomingMessage } from "node:http"

import { isCanonicalRenameProjectId, renameProjectHeaderValues, validRenameProjectKey } from "./project-rename-input.js"

export const isProjectDeletionId = isCanonicalRenameProjectId
export const projectDeletionHeaderValues = renameProjectHeaderValues
export const validProjectDeletionKey = validRenameProjectKey

export function isEmptyProjectDeletionRequest(request: IncomingMessage, requireKey: boolean): boolean {
  if (request.headers["transfer-encoding"] !== undefined) return false
  const lengths = projectDeletionHeaderValues(request.rawHeaders, "content-length")
  if (lengths.length > 1) return false
  if (lengths[0] !== undefined && lengths[0] !== "0") return false
  if (!requireKey && lengths.length !== 0) return false
  return true
}
