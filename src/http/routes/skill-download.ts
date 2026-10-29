import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { BffConfig } from "../../config/runtime.js"
import type { BffServerComposition } from "../../bootstrap/runtime.js"
import { spoolVerifiedArtifact } from "../../infrastructure/clients/storage/artifact-download-transfer.js"
import { skillRequestRemaining } from "./skill-drafts.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createReadStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import { ConnectError, Code } from "@connectrpc/connect"
import type { RequestContext } from "../../domain/request-context.js"
import type { SkillProductConnectClient } from "../../infrastructure/clients/platform/skill-product-connect.js"
import { assertSkillWireKnown } from "../../infrastructure/clients/platform/skill-product-response.js"
import { projectSkillPackageInspectionResponse, validSkillPackagePath } from "../../infrastructure/clients/platform/skill-package-inspection-response.js"
import { skillIdSchema } from "../skill-product-input.js"
import { assertSkillReadRequest, runSkillRoute } from "./skill-drafts.js"
import { send } from "../response.js"
import type { ProjectSkillContentAccess } from "./skill-package-inspection.js"
import type { ExactSkillDownloadQualifier } from "../../application/exact-skill-download.js"
export async function publishedSkillPackageInspectionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  skillId: string,
  client: SkillProductConnectClient | null,
) {
  await runSkillRoute(request, response, context, async (signal, deadlineAt) => {
    skillIdSchema.parse(skillId)
    const query = assertSkillReadRequest(request, ["file_path"])
    if (!client) throw new ConnectError("Skill read dependency missing", Code.Unavailable)
    const filePath = query.get("file_path") ?? undefined
    if (filePath !== undefined && !validSkillPackagePath(filePath)) throw new ConnectError("File path invalid", Code.InvalidArgument)
    const sourceRef = `skill:${skillId}`
    const owner = await client.inspect(
      {
        requestId: context.requestId,
        tenant: context.identity.namespace,
        subject: context.identity.userId,
        sourceRef,
        ...(filePath === undefined ? {} : { filePath }),
      },
      signal,
      deadlineAt,
    )
    assertSkillWireKnown(owner)
    const data = projectSkillPackageInspectionResponse(owner, { sourceRef, ...(filePath === undefined ? {} : { selectedFilePath: filePath }) })
    signal.throwIfAborted()
    send(response, 200, { data })
  })
}

/** Download metadata refers only to this private byte resource, never to an internal object URL. */
export async function skillDownloadHandleRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: BffServerComposition,
  requestId: string,
  path: string[],
  projectAccess?: ProjectSkillContentAccess,
): Promise<boolean> {
  if (path[0] !== "skill-downloads" || path.length !== 2) return false
  if (request.method !== "GET") {
    response.setHeader("allow", "GET")
    send(response, 405, { error: { code: "MethodNotAllowed", message: "Request method is invalid" } })
    return true
  }
  await runSkillRoute(
    request,
    response,
    { requestId, identity: { namespace: "", userId: "" } },
    async (signal, deadlineAt) => {
      assertSkillReadRequest(request, [])
      const admit = async () => {
        const result = await authorizeUserRequest(request, config, composition.sessionAdmission, requestId, signal)
        signal.throwIfAborted()
        if (!result.ok) {
          if (result.retryAfter !== undefined) response.setHeader("retry-after", result.retryAfter)
          send(response, result.status, { error: { code: result.code, message: "Current user admission is required" } })
          return null
        }
        return Object.freeze({ ...result.context, identity: Object.freeze({ ...result.context.identity }), humanBearer: result.bearerToken })
      }
      const context = await admit()
      if (context === null) return
      let entry: ReturnType<typeof composition.skillDownloadHandles.resolve>
      try {
        entry = composition.skillDownloadHandles.resolve(path[1] ?? "", context.identity.namespace, context.identity.userId)
      } catch (cause) {
        const forbidden = cause instanceof Error && cause.message === "skill_download_forbidden"
        send(response, forbidden ? 403 : 410, {
          error: { code: forbidden ? "PermissionDenied" : "Gone", message: forbidden ? "Download is not permitted" : "Download qualification has expired" },
        })
        return
      }
      const objectOrigin = config.storageObjectOrigin ?? config.storage?.objectOrigin
      if (!objectOrigin) throw new ConnectError("Download dependency missing", Code.Unavailable)
      const qualify = async (): Promise<boolean> => {
        try {
          if (entry.binding.qualifier.kind === "project_installation") {
            if (!projectAccess) throw new ConnectError("Project download not permitted", Code.PermissionDenied)
            const projectId = await projectAccess(entry.binding.qualifier.projectId, context, signal)
            if (projectId === null) return false
            if (projectId !== entry.binding.qualifier.projectId) throw new ConnectError("Project not found", Code.NotFound)
          }
          if (entry.binding.qualifier.kind === "catalog_current") {
            if (!composition.skillSpecificationSource) throw new ConnectError("Download dependency missing", Code.Unavailable)
            await composition.skillSpecificationSource.confirmDownload(entry.binding, context, signal, deadlineAt)
          } else {
            if (!composition.exactSkillDownloadSource) throw new ConnectError("Download dependency missing", Code.Unavailable)
            await composition.exactSkillDownloadSource.confirm(entry.binding, context, signal, deadlineAt)
          }
          signal.throwIfAborted()
          return true
        } catch (cause) {
          if (cause instanceof ConnectError && [Code.PermissionDenied, Code.Unauthenticated, Code.NotFound].includes(cause.code)) {
            signal.throwIfAborted()
            const status = cause.code === Code.PermissionDenied ? 403 : cause.code === Code.Unauthenticated ? 401 : 404
            send(response, status, {
              error: { code: status === 403 ? "PermissionDenied" : status === 401 ? "Unauthenticated" : "NotFound", message: "Download is not permitted" },
            })
            return false
          }
          throw cause
        }
      }
      if (!(await qualify())) return
      if (entry.expiresAt <= Date.now()) {
        send(response, 410, { error: { code: "Gone", message: "Download qualification has expired" } })
        return
      }
      const remaining = skillRequestRemaining(request)
      const spool = await spoolVerifiedArtifact(
        entry.binding.transfer,
        entry.binding.sizeBytes,
        entry.binding.contentSha256,
        objectOrigin,
        signal,
        fetch,
        undefined,
        { totalMs: remaining, idleMs: Math.min(remaining, 45_000) },
      )
      try {
        if (!(await qualify())) return
        const current = await admit()
        if (current === null) return
        if (current.identity.namespace !== context.identity.namespace || current.identity.userId !== context.identity.userId) {
          send(response, 403, { error: { code: "PermissionDenied", message: "Download is not permitted" } })
          return
        }
        if (entry.expiresAt <= Date.now()) {
          send(response, 410, { error: { code: "Gone", message: "Download qualification has expired" } })
          return
        }
        if (entry.binding.qualifier.kind === "project_installation") {
          if (!(await qualify())) return
          if (entry.expiresAt <= Date.now()) {
            send(response, 410, { error: { code: "Gone", message: "Download qualification has expired" } })
            return
          }
        }
        signal.throwIfAborted()
        response.writeHead(200, {
          "content-type": "application/zip",
          "content-length": spool.size,
          "content-disposition": `attachment; filename="skill.zip"; filename*=UTF-8''${encodeURIComponent(entry.binding.filename).replace(/['()*]/gu, (v) => `%${v.charCodeAt(0).toString(16).toUpperCase()}`)}`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        })
        await pipeline(createReadStream(spool.path), response, { signal })
      } finally {
        await spool.cleanup()
      }
    },
    "exact-download",
  )
  return true
}

const PRIVATE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
function exactQualifier(path: string[]): ExactSkillDownloadQualifier | null {
  if (path.length === 7 && path[0] === "browser" && path[1] === "v1" && path[2] === "projects" && path[4] === "skill-installations" && path[6] === "download") {
    if (!PRIVATE_ID.test(path[3] ?? "") || !PRIVATE_ID.test(path[5] ?? "")) return null
    return { kind: "project_installation", projectId: path[3]!, installationId: path[5]! }
  }
  if (path.length !== 5 || path[0] !== "browser" || path[1] !== "v1" || path[4] !== "download") return null
  const id = path[3] ?? ""
  if (!PRIVATE_ID.test(id)) return null
  if (path[2] === "skill-installations") return { kind: "installation", installationId: id }
  if (path[2] === "skills") return { kind: "managed", versionId: id }
  if (path[2] === "skill-shares") return { kind: "share", shareId: id }
  return null
}

function emptyBody(request: IncomingMessage, signal: AbortSignal): Promise<boolean> {
  const length = request.headers["content-length"]
  if (request.headers["transfer-encoding"] !== undefined || (length !== undefined && length !== "0")) return Promise.resolve(false)
  if (request.readableEnded) return Promise.resolve(true)
  return new Promise<boolean>((resolve, reject) => {
    let settled = false
    const finish = (value?: boolean, error?: unknown) => {
      if (settled) return
      settled = true
      request.removeListener("data", data)
      request.removeListener("end", end)
      request.removeListener("error", failed)
      signal.removeEventListener("abort", aborted)
      if (error !== undefined) reject(error)
      else resolve(value ?? false)
    }
    const data = (chunk: Buffer | string) => {
      if (Buffer.byteLength(chunk) > 0) finish(false)
    }
    const end = () => finish(true)
    const failed = (error: unknown) => finish(undefined, error)
    const aborted = () => finish(undefined, signal.reason)
    request.on("data", data)
    request.once("end", end)
    request.once("error", failed)
    signal.addEventListener("abort", aborted, { once: true })
    if (signal.aborted) aborted()
    else request.resume()
  })
}

export async function exactSkillDownloadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: BffServerComposition,
  requestId: string,
  path: string[],
  projectAccess?: ProjectSkillContentAccess,
): Promise<boolean> {
  const candidate = path.length === 5 && path[0] === "browser" && path[1] === "v1" && path[4] === "download"
  const projectCandidate =
    path.length === 7 && path[0] === "browser" && path[1] === "v1" && path[2] === "projects" && path[4] === "skill-installations" && path[6] === "download"
  if (!(candidate && ["skill-installations", "skills", "skill-shares"].includes(path[2] ?? "")) && !projectCandidate) return false
  response.setHeader("x-request-id", requestId)
  if (request.method !== "POST") {
    response.setHeader("allow", "POST")
    send(response, 405, { error: { code: "MethodNotAllowed", message: "Request method is invalid", retryable: false } })
    return true
  }
  await runSkillRoute(
    request,
    response,
    { requestId, identity: { namespace: "", userId: "" } },
    async (signal, deadlineAt) => {
      let qualifier = exactQualifier(path)
      if (
        !qualifier ||
        new URL(request.url ?? "/", "http://bff.local").search ||
        request.headers["idempotency-key"] !== undefined ||
        !(await emptyBody(request, signal))
      )
        throw new ConnectError("Skill download input invalid", Code.InvalidArgument)
      const admission = await authorizeUserRequest(request, config, composition.sessionAdmission, requestId, signal)
      signal.throwIfAborted()
      if (!admission.ok) {
        if (admission.retryAfter !== undefined) response.setHeader("retry-after", admission.retryAfter)
        send(response, admission.status, { error: { code: admission.code, message: "Current user admission is required", retryable: admission.status >= 500 } })
        return
      }
      const source = composition.exactSkillDownloadSource
      if (!source) throw new ConnectError("Skill download dependency missing", Code.Unavailable)
      const context = Object.freeze({ ...admission.context, identity: Object.freeze({ ...admission.context.identity }), humanBearer: admission.bearerToken })
      if (qualifier.kind === "project_installation") {
        if (!projectAccess) throw new ConnectError("Project download not permitted", Code.PermissionDenied)
        const projectId = await projectAccess(qualifier.projectId, context, signal)
        if (projectId === null) return
        qualifier = { ...qualifier, projectId }
      }
      const entry = await source.prepare(qualifier, context, signal, deadlineAt)
      if (qualifier.kind === "project_installation") {
        const projectId = await projectAccess!(qualifier.projectId, context, signal)
        if (projectId === null) return
        if (projectId !== qualifier.projectId) throw new ConnectError("Project not found", Code.NotFound)
        await source.confirm(entry.binding, context, signal, deadlineAt)
      }
      signal.throwIfAborted()
      send(response, 200, {
        data: {
          source_ref: entry.binding.sourceRef,
          revision: entry.binding.revision,
          download_info: {
            download_url: `/skill-downloads/${entry.handle}`,
            filename: entry.binding.filename,
            expires_at: new Date(entry.expiresAt).toISOString(),
          },
        },
      })
    },
    "exact-download",
  )
  return true
}
