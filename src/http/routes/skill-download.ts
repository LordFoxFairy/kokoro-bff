import type { IncomingMessage, ServerResponse } from "node:http"
import { createReadStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import { ConnectError, Code } from "@connectrpc/connect"
import type { RequestContext } from "../../domain/request-context.js"
import type { SkillProductConnectClient } from "../../infrastructure/clients/platform/skill-product-connect.js"
import { assertSkillWireKnown } from "../../infrastructure/clients/platform/skill-product-response.js"
import { projectSkillPackageInspectionResponse, validSkillPackagePath } from "../../infrastructure/clients/platform/skill-package-inspection-response.js"
import { spoolSkillPackage } from "../../infrastructure/clients/storage/skill-product-transfer.js"
import { skillIdSchema } from "../skill-product-input.js"
import { assertSkillReadRequest, runSkillRoute } from "./skill-drafts.js"
import { send } from "../response.js"
export async function skillDownloadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  skillId: string,
  operation: "inspect" | "download",
  client: SkillProductConnectClient | null,
  objectOrigin: string | null,
  readmit?: (signal: AbortSignal) => Promise<void>,
) {
  await runSkillRoute(request, response, context, async (signal, deadlineAt) => {
    skillIdSchema.parse(skillId)
    const query = assertSkillReadRequest(request, operation === "inspect" ? ["file_path"] : [])
    const common = { requestId: context.requestId, tenant: context.identity.namespace, subject: context.identity.userId, sourceRef: `skill:${skillId}` }
    if (!client) throw new ConnectError("Skill read dependency missing", Code.Unavailable)
    if (operation === "inspect") {
      const filePath = query.get("file_path") ?? undefined
      if (filePath !== undefined && !validSkillPackagePath(filePath)) throw new ConnectError("File path invalid", Code.InvalidArgument)
      const owner = await client.inspect({ ...common, ...(filePath === undefined ? {} : { filePath }) }, signal, deadlineAt)
      assertSkillWireKnown(owner)
      const data = projectSkillPackageInspectionResponse(owner, {
        sourceRef: common.sourceRef,
        ...(filePath === undefined ? {} : { selectedFilePath: filePath }),
      })
      signal.throwIfAborted()
      send(response, 200, { data })
      return
    }
    if (!objectOrigin) throw new ConnectError("Skill object origin missing", Code.Unavailable)
    const owner = await client.download(common, signal, deadlineAt)
    assertSkillWireKnown(owner)
    if (
      owner.sourceRef?.value !== common.sourceRef ||
      owner.revision < 1n ||
      owner.revision > 18_446_744_073_709_551_615n ||
      !/^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]{1,255}$/u.test(owner.filename)
    )
      throw new Error("skill_response_invalid")
    const spool = await spoolSkillPackage(owner.transferReference, owner.sizeBytes, owner.contentSha256, objectOrigin, signal)
    try {
      const after = await client.download(common, signal, deadlineAt)
      assertSkillWireKnown(after)
      if (
        after.sourceRef?.value !== owner.sourceRef.value ||
        after.revision !== owner.revision ||
        after.filename !== owner.filename ||
        after.sizeBytes !== owner.sizeBytes ||
        after.contentSha256 !== owner.contentSha256
      )
        throw new ConnectError("Skill changed", Code.NotFound)
      await readmit?.(signal)
      signal.throwIfAborted()
      response.writeHead(200, {
        "content-type": "application/zip",
        "content-length": spool.size,
        "content-disposition": `attachment; filename="skill.zip"; filename*=UTF-8''${encodeURIComponent(owner.filename).replace(/['()*]/gu, (v) => `%${v.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      })
      await pipeline(createReadStream(spool.path), response, { signal })
    } finally {
      await spool.cleanup()
    }
  })
}
