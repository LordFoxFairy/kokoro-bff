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
): Promise<boolean> {
  if (path[0] !== "skill-downloads" || path.length !== 2) return false
  if (request.method !== "GET") {
    response.setHeader("allow", "GET")
    send(response, 405, { error: { code: "MethodNotAllowed", message: "Request method is invalid" } })
    return true
  }
  await runSkillRoute(request, response, { requestId, identity: { namespace: "", userId: "" } }, async (signal, deadlineAt) => {
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
    const source = composition.skillSpecificationSource
    const objectOrigin = config.storageObjectOrigin ?? config.storage?.objectOrigin
    if (!source || !objectOrigin) throw new ConnectError("Download dependency missing", Code.Unavailable)
    const qualify = async (): Promise<boolean> => {
      try {
        await source.confirmDownload(entry.binding, context, signal, deadlineAt)
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
  })
  return true
}
