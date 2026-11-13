import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import {
  BFF_CONFIG,
  PROJECT_EXACT_DOWNLOAD_SOURCE,
  PROJECT_READ_LOOKUP,
  SESSION_ADMISSION,
  SKILL_DOWNLOAD_HANDLES,
  SKILL_EXACT_DOWNLOAD_SOURCE,
  SKILL_SPECIFICATION_SOURCE,
} from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ProjectLookup } from "../../application/projects/types.js"
import type { ExactSkillDownloadSource } from "../../application/exact-skill-download.js"
import type { SkillDownloadHandles } from "../../application/skill-download-handles.js"
import type { SkillSpecificationSource } from "../../application/skill-specification.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { handleSkillDownloadRequest } from "../../http/routes/skill-download-native.js"
import { requestId } from "../../http/request.js"

function exactSource(personal: ExactSkillDownloadSource | null, project: ExactSkillDownloadSource | null): ExactSkillDownloadSource {
  return {
    prepare: (qualifier, context, signal, deadlineAt) =>
      (qualifier.kind === "project_installation" ? project : personal)?.prepare(qualifier, context, signal, deadlineAt) ?? unavailable(),
    confirm: (binding, context, signal, deadlineAt) =>
      (binding.qualifier.kind === "project_installation" ? project : personal)?.confirm(binding, context, signal, deadlineAt) ?? unavailable(),
  }
}

function unavailable(): never {
  throw new ConnectError("Skill download dependency missing", Code.Unavailable)
}

@Injectable()
export class ProjectSkillDownloadMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(PROJECT_READ_LOOKUP) private readonly project: ProjectLookup,
    @Inject(PROJECT_EXACT_DOWNLOAD_SOURCE) private readonly exact: ExactSkillDownloadSource | null,
    @Inject(SKILL_EXACT_DOWNLOAD_SOURCE) private readonly personalExact: ExactSkillDownloadSource | null,
    @Inject(SKILL_SPECIFICATION_SOURCE) private readonly specification: SkillSpecificationSource | null,
    @Inject(SKILL_DOWNLOAD_HANDLES) private readonly handles: SkillDownloadHandles,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    const id = requestId(request)
    const access = async (
      projectId: string,
      context: { requestId: string; identity: { namespace: string; userId: string } },
      signal: AbortSignal,
    ): Promise<string | null> => {
      const fresh = await authorizeUserRequest(request, this.config, this.admission, id, signal, response)
      signal.throwIfAborted()
      if (!fresh.ok) throw new ConnectError("Project admission failed", fresh.status >= 500 ? Code.Unavailable : Code.PermissionDenied)
      if (fresh.context.identity.namespace !== context.identity.namespace || fresh.context.identity.userId !== context.identity.userId)
        throw new ConnectError("Project not found", Code.NotFound)
      const value = await this.project.find({ tenantId: context.identity.namespace, subjectId: context.identity.userId }, projectId)
      signal.throwIfAborted()
      if (!value) throw new ConnectError("Project not found", Code.NotFound)
      return value.id
    }
    void handleSkillDownloadRequest(
      request,
      response,
      this.config,
      this.admission,
      this.handles,
      this.specification,
      exactSource(this.personalExact, this.exact),
      access,
    )
      .then((handled) => {
        if (!handled && !response.writableEnded && !response.destroyed) next()
      })
      .catch(() => {
        if (!response.headersSent && !response.writableEnded && !response.destroyed) {
          response.statusCode = 500
          response.setHeader("content-type", "application/json")
          response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } }))
        } else if (!response.writableEnded && !response.destroyed) response.destroy()
      })
  }
}
