import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import type { RequestContext } from "../../domain/request-context.js"
import type { SkillShareRepository } from "../../application/ports/skill-share-repository.js"
import type { SkillProductConnectClient } from "../../infrastructure/clients/platform/skill-product-connect.js"
import { projectSkillPackageInspectionResponse } from "../../infrastructure/clients/platform/skill-package-inspection-response.js"
import { assertSkillWireKnown } from "../../infrastructure/clients/platform/skill-product-response.js"
import { skillIdSchema, parseSkillProductInput } from "../skill-product-input.js"
import { runSkillRoute, assertSkillReadRequest } from "./skill-drafts.js"
import { readSkillBody as readBody } from "./skill-drafts.js"
import { send } from "../response.js"
export async function skillShareRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  path: string[],
  repository: SkillShareRepository | undefined,
  client: SkillProductConnectClient | null,
  publicOrigin: string,
) {
  await runSkillRoute(request, response, context, async (signal, deadlineAt) => {
    if (!repository) throw new ConnectError("Share store missing", Code.Unavailable)
    const scope = { tenantId: context.identity.namespace, creatorSubjectId: context.identity.userId }
    const inspect = async (sourceRef: string) => {
      if (!client) throw new ConnectError("Share read dependency missing", Code.Unavailable)
      const owner = await client.inspect(
        { tenant: scope.tenantId, subject: scope.creatorSubjectId, requestId: context.requestId, sourceRef },
        signal,
        deadlineAt,
      )
      assertSkillWireKnown(owner)
      return projectSkillPackageInspectionResponse(owner, { sourceRef })
    }
    let share
    if (request.method === "POST" && path.length === 1) {
      if (
        new URL(request.url!, "http://bff.local").search ||
        request.headers["idempotency-key"] !== undefined ||
        request.headers["content-type"]?.split(";", 1)[0] !== "application/json"
      )
        throw new ConnectError("Share input invalid", Code.InvalidArgument)
      const input = parseSkillProductInput("share", await readBody(request, 65_536))
      const expiresAt = input.expires_at === undefined || input.expires_at === null ? null : new Date(input.expires_at)
      if (expiresAt !== null && (expiresAt.valueOf() <= Date.now() || expiresAt.valueOf() > Date.now() + 31_536_000_000))
        throw new ConnectError("Expiry invalid", Code.InvalidArgument)
      await inspect(input.source_ref)
      share = await repository.create(scope, input.source_ref, (id) => `${publicOrigin}/skills/shared/${encodeURIComponent(id)}`, expiresAt)
      if (
        share.sourceRef !== input.source_ref ||
        share.creatorSubjectId !== scope.creatorSubjectId ||
        share.tenantId !== scope.tenantId ||
        share.resourceKind !== "skill_revision"
      )
        throw new Error("skill_response_invalid")
      await inspect(share.sourceRef)
    } else {
      assertSkillReadRequest(request)
      const shareId = skillIdSchema.parse(path[1])
      if (request.method === "DELETE") share = await repository.revoke(scope, shareId)
      else if (request.method === "GET") {
        share = await repository.findActive(scope.tenantId, shareId)
        if (share) await inspect(share.sourceRef)
      } else throw new ConnectError("Share route invalid", Code.InvalidArgument)
    }
    if (!share || share.tenantId !== scope.tenantId || (request.method === "DELETE" && share.creatorSubjectId !== scope.creatorSubjectId))
      throw new ConnectError("Share missing", Code.NotFound)
    signal.throwIfAborted()
    send(response, request.method === "POST" ? 201 : 200, {
      data: {
        share_id: share.shareId,
        source_ref: share.sourceRef,
        url: share.url,
        created_at: share.createdAt.toISOString(),
        expires_at: share.expiresAt?.toISOString() ?? null,
        revoked_at: share.revokedAt?.toISOString() ?? null,
      },
    })
  })
}
