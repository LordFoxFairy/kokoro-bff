import { ProjectResourceError } from "../../application/project-resource.error.js"
import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import {
  BFF_CONFIG,
  BFF_POOL,
  PROJECT_PINS,
  PROJECT_TASKS,
  PROJECT_LOOKUP,
  PROJECT_READ_LOOKUP,
  PROJECT_EDIT_LOOKUP,
  PROJECT_READS,
  PROJECT_MUTATIONS,
  PROJECT_RENAME,
  PROJECT_DELETION,
  PROJECT_SKILL_SELECTION_PROVIDER,
  SKILL_AUTHORIZATION,
  SKILL_INSTALLATION_CLIENT,
  SESSION_ADMISSION,
} from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { Pool } from "pg"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import type { ProjectLookup } from "../../application/projects/types.js"
import type { ProjectDeletion, ProjectRenamer } from "../../application/projects/commands.js"
import type { ProjectPinProvider } from "../../infrastructure/postgres/project-pin.js"
import type { ProjectMutationStore, ProjectReadStore } from "../../infrastructure/postgres/project-store.js"
import type { ProjectTasks } from "../../infrastructure/postgres/project-tasks.js"
import { handleProjectTaskRequest } from "../../http/routes/project-tasks.js"
import { handleProjectWebsitesRequest } from "../../http/routes/project-websites.js"
import type { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import {
  handleProjectSkillSelectionRequest,
  isProjectSkillSelectionRequest,
  type ProjectSkillSelectionProvider,
} from "../../http/routes/project-skill-selection.js"
import { handleProjectSkillInstallationRequest, isProjectSkillInstallationRequest } from "../../http/routes/skill-installations.js"
import type { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import {
  handleProjectCoreReadRequest,
  handleProjectDeleteRequest,
  handleProjectDeletionStatusRequest,
  handleProjectPinRequest,
  handleProjectRenameRequest,
  handleProjectResourceListRequest,
  handleProjectResourceDeleteRequest,
  handleProjectResourceReadRequest,
  handleProjectResourceUploadRequest,
} from "../../http/routes/project-native.js"

@Injectable()
export class ProjectPinMiddleware implements NestMiddleware {
  private readonly resourceEdits: ProjectLookup
  private readonly projectResourceReceipts: PostgresIdempotencyRepository
  private readonly projectResourceIdempotency = new Map<string, import("../../application/idempotency.js").IdempotencyEntry>()

  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(PROJECT_LOOKUP) private readonly lookup: ProjectLookup,
    @Inject(PROJECT_READ_LOOKUP) private readonly readLookup: ProjectLookup,
    @Inject(PROJECT_EDIT_LOOKUP) private readonly editLookup: ProjectLookup,
    @Inject(PROJECT_READS) private readonly reads: ProjectReadStore,
    @Inject(PROJECT_MUTATIONS) private readonly mutations: ProjectMutationStore,
    @Inject(PROJECT_RENAME) private readonly rename: ProjectRenamer,
    @Inject(PROJECT_DELETION) private readonly deletion: ProjectDeletion,
    @Inject(PROJECT_PINS) private readonly pins: ProjectPinProvider,
    @Inject(PROJECT_TASKS) private readonly tasks: ProjectTasks,
    @Inject(PROJECT_SKILL_SELECTION_PROVIDER)
    private readonly projectSkillSelection: ProjectSkillSelectionProvider,
    @Inject(SKILL_INSTALLATION_CLIENT)
    private readonly installationClient: SkillInstallationConnectClient | null,
    @Inject(SKILL_AUTHORIZATION)
    private readonly skillAuthorization: Pick<SkillAuthorizationClient, "check">,
    @Inject(BFF_POOL) pool: Pool,
  ) {
    this.projectResourceReceipts = new PostgresIdempotencyRepository(pool)
    this.resourceEdits = {
      find: async (scope, id, lifetime) => {
        const editable = await this.editLookup.find(scope, id, lifetime)
        if (editable) return editable
        if (await this.readLookup.find(scope, id, lifetime)) throw new ProjectResourceError("project_edit_forbidden", 403)
        return null
      },
    }
  }

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void (
      isProjectSkillInstallationRequest(request)
        ? handleProjectSkillInstallationRequest(request, response, this.config, this.admission, this.skillAuthorization, this.lookup, this.installationClient)
        : isProjectSkillSelectionRequest(request)
          ? handleProjectSkillSelectionRequest(request, response, this.config, this.admission, this.projectSkillSelection, this.installationClient)
          : Promise.resolve(false)
    )
      .then((handled) => handled || handleProjectRenameRequest(request, response, this.config, this.admission, this.rename))
      .then((handled) => handled || handleProjectDeleteRequest(request, response, this.config, this.admission, this.deletion))
      .then((handled) => handled || handleProjectDeletionStatusRequest(request, response, this.config, this.admission, this.deletion))
      .then((handled) => handled || handleProjectResourceDeleteRequest(request, response, this.config, this.admission, this.resourceEdits))
      .then(
        (handled) =>
          handled ||
          handleProjectResourceUploadRequest(request, response, this.config, this.admission, {
            find: this.resourceEdits.find,
            receipts: this.projectResourceReceipts,
            idempotency: this.projectResourceIdempotency,
          }),
      )
      .then((handled) => handled || handleProjectResourceReadRequest(request, response, this.config, this.admission, this.readLookup))
      .then((handled) => handled || handleProjectResourceListRequest(request, response, this.config, this.admission, this.readLookup))
      .then((handled) => handled || handleProjectTaskRequest(request, response, this.config, this.admission, this.tasks))
      .then((handled) => handled || handleProjectWebsitesRequest(request, response, this.config, this.admission, this.reads, this.mutations))
      .then((handled) => handled || handleProjectCoreReadRequest(request, response, this.config, this.admission, this.reads, this.readLookup))
      .then((handled) => handled || handleProjectPinRequest(request, response, this.config, this.admission, this.pins))
      .then((handled) => {
        if (!handled && !response.writableEnded && !response.destroyed) next()
      })
      .catch(() => {
        if (!response.headersSent && !response.writableEnded && !response.destroyed) {
          response.statusCode = 500
          response.setHeader("content-type", "application/json")
          response.end(
            JSON.stringify({
              error: {
                code: "internal_error",
                message: "The BFF encountered an internal error",
                retryable: false,
              },
            }),
          )
        } else if (!response.writableEnded && !response.destroyed) response.destroy()
      })
  }
}
