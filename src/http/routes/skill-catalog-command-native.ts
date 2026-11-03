import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeSkillAction, authorizeUserRequest } from "../../auth/user-admission.js"
import type { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import type { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"
import { beginSkillPackageUploadRoute } from "./begin-skill-package-upload.js"
import { completeSkillPackageUploadRoute } from "./complete-skill-package-upload.js"
import { publishSkillRoute } from "./publish-skill.js"
import { validateSkillDraftRoute } from "./validate-skill-draft.js"
import { getSkillPackageUploadRoute } from "./get-skill-package-upload.js"
import { skillCoverRoute } from "./skill-cover.js"
import { skillGithubPreviewRoute } from "./skill-github-import.js"
import { requestId } from "../request.js"
import { send } from "../response.js"

type CatalogCommand = Readonly<{
  skillId: string
  operation: "begin" | "complete" | "validate" | "publish"
  action: "begin_upload" | "complete_upload" | "validate_draft" | "publish"
}>

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function match(request: IncomingMessage): CatalogCommand | null {
  if (request.method !== "POST") return null
  const parts = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean).map(decode)
  if (parts[0] !== "v1" || parts[1] !== "skills") return null
  if (parts.length === 4 && parts[3] === "package-upload") return { skillId: parts[2] ?? "", operation: "begin", action: "begin_upload" }
  if (parts.length === 5 && parts[3] === "package-upload" && parts[4] === "complete")
    return { skillId: parts[2] ?? "", operation: "complete", action: "complete_upload" }
  if (parts.length === 4 && parts[3] === "validate") return { skillId: parts[2] ?? "", operation: "validate", action: "validate_draft" }
  if (parts.length === 4 && parts[3] === "publish") return { skillId: parts[2] ?? "", operation: "publish", action: "publish" }
  return null
}

/** Catalog command routes share one SkillsModule admission and Catalog client boundary. */
export async function handleSkillCatalogCommandRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  skillAuthorization: Pick<SkillAuthorizationClient, "check">,
  client: CatalogConnectClient | null,
): Promise<boolean> {
  const operation = match(request)
  if (operation === null) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  response.setHeader("cache-control", "no-store")
  const signal = AbortSignal.timeout(10_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    if (!admitted.ok) {
      send(
        response,
        admitted.status,
        { error: { code: admitted.code, message: "BFF user admission failed", retryable: admitted.status === 429 || admitted.status === 503 } },
        admitted.retryAfter,
      )
      return true
    }
    const checked = await authorizeSkillAction(skillAuthorization, admitted, operation.action, signal)
    if (!checked.ok) {
      send(response, checked.status, {
        error: { code: checked.code, message: "Skill action admission failed", retryable: checked.status === 429 || checked.status === 503 },
      })
      return true
    }
    if (operation.operation === "begin") {
      await beginSkillPackageUploadRoute(
        request,
        response,
        admitted.context,
        operation.skillId,
        client,
        config.storageObjectOrigin ?? config.storage?.objectOrigin ?? null,
        signal,
      )
    } else if (operation.operation === "complete") {
      await completeSkillPackageUploadRoute(request, response, admitted.context, operation.skillId, client, signal)
    } else if (operation.operation === "validate") {
      await validateSkillDraftRoute(request, response, admitted.context, operation.skillId, client, signal)
    } else {
      await publishSkillRoute(request, response, admitted.context, operation.skillId, client, signal)
    }
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, { error: { code: "skill_dependency_unavailable", message: "Skill catalog is unavailable", retryable: true } })
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}

/** The package-upload reference read shares the SkillsModule session boundary without an action check. */
export async function handleSkillPackageUploadReadRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  client: CatalogConnectClient | null,
): Promise<boolean> {
  if (request.method !== "GET") return false
  const parts = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean).map(decode)
  if (parts.length !== 4 || parts[0] !== "v1" || parts[1] !== "skills" || parts[3] !== "package-upload") return false
  const id = requestId(request)
  const signal = AbortSignal.timeout(10_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    if (!admitted.ok) {
      send(
        response,
        admitted.status,
        { error: { code: admitted.code, message: "BFF user admission failed", retryable: admitted.status === 429 || admitted.status === 503 } },
        admitted.retryAfter,
      )
      return true
    }
    await getSkillPackageUploadRoute(request, response, admitted.context, parts[2] ?? "", client, signal)
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, { error: { code: "skill_dependency_unavailable", message: "Skill catalog is unavailable", retryable: true } })
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}

/** Cover reads and upload commands share the SkillsModule product client and fresh admission. */
export async function handleSkillCoverRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  skillAuthorization: Pick<SkillAuthorizationClient, "check">,
  client: import("../../infrastructure/clients/platform/skill-product-connect.js").SkillProductConnectClient | null,
): Promise<boolean> {
  const parts = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean).map(decode)
  if (parts[0] !== "v1" || parts[1] !== "skills") return false
  let operation: "cover" | "get" | "begin" | "complete"
  let action: "begin_upload" | "complete_upload" | null = null
  if (parts.length === 4 && parts[3] === "cover" && request.method === "GET") operation = "cover"
  else if (parts.length === 4 && parts[3] === "cover-upload" && request.method === "GET") operation = "get"
  else if (parts.length === 4 && parts[3] === "cover-upload" && request.method === "POST") {
    operation = "begin"
    action = "begin_upload"
  } else if (parts.length === 5 && parts[3] === "cover-upload" && parts[4] === "complete" && request.method === "POST") {
    operation = "complete"
    action = "complete_upload"
  } else return false
  const id = requestId(request)
  const signal = AbortSignal.timeout(10_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    if (!admitted.ok) {
      send(
        response,
        admitted.status,
        { error: { code: admitted.code, message: "BFF user admission failed", retryable: admitted.status === 429 || admitted.status === 503 } },
        admitted.retryAfter,
      )
      return true
    }
    if (action !== null) {
      const checked = await authorizeSkillAction(skillAuthorization, admitted, action, signal)
      if (!checked.ok) {
        send(response, checked.status, {
          error: { code: checked.code, message: "Skill action admission failed", retryable: checked.status === 429 || checked.status === 503 },
        })
        return true
      }
    }
    const readmit = async (currentSignal: AbortSignal): Promise<void> => {
      const current = await authorizeUserRequest(request, config, admission, id, currentSignal, response)
      if (!current.ok && current.status >= 500) throw new Error("skill_dependency_unavailable")
      if (
        !current.ok ||
        current.context.identity.namespace !== admitted.context.identity.namespace ||
        current.context.identity.userId !== admitted.context.identity.userId
      )
        throw new Error("skill_not_found")
    }
    await skillCoverRoute(
      request,
      response,
      admitted.context,
      parts[2] ?? "",
      operation,
      client,
      config.storageObjectOrigin ?? config.storage?.objectOrigin ?? null,
      readmit,
    )
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, { error: { code: "skill_dependency_unavailable", message: "Skill cover dependency is unavailable", retryable: true } })
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}

/** GitHub preview is a read-only SkillsModule route with a final session recheck. */
export async function handleSkillGithubPreviewRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
): Promise<boolean> {
  if (request.method !== "POST" || new URL(request.url ?? "/", "http://bff.local").pathname !== "/v1/skills/github/preview") return false
  const id = requestId(request)
  const signal = AbortSignal.timeout(10_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    if (!admitted.ok) {
      send(
        response,
        admitted.status,
        { error: { code: admitted.code, message: "BFF user admission failed", retryable: admitted.status === 429 || admitted.status === 503 } },
        admitted.retryAfter,
      )
      return true
    }
    const readmit = async (currentSignal: AbortSignal): Promise<void> => {
      const current = await authorizeUserRequest(request, config, admission, id, currentSignal, response)
      if (!current.ok && current.status >= 500) throw new Error("skill_dependency_unavailable")
      if (
        !current.ok ||
        current.context.identity.namespace !== admitted.context.identity.namespace ||
        current.context.identity.userId !== admitted.context.identity.userId
      )
        throw new Error("skill_not_found")
    }
    await skillGithubPreviewRoute(request, response, admitted.context, readmit)
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, { error: { code: "skill_dependency_unavailable", message: "GitHub Skill dependency is unavailable", retryable: true } })
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}
