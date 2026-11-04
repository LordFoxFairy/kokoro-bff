import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import {
  BFF_CONFIG,
  BFF_POOL,
  PROJECT_PINS,
  PROJECT_TASK_READER,
  PROJECT_SERVICE,
  PROJECT_SKILL_SELECTION_PROVIDER,
  SKILL_AUTHORIZATION,
  SKILL_INSTALLATION_CLIENT,
  SESSION_ADMISSION,
} from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { Pool } from "pg"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import type { ProjectPinProvider } from "../../infrastructure/postgres/project-pin.js"
import type { ProjectTaskReader } from "../../infrastructure/postgres/project-repository.js"
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
  type ProjectCoreReadProvider,
} from "../../http/routes/project-native.js"

@Injectable()
export class ProjectPinMiddleware implements NestMiddleware {
  private readonly projectResourceReceipts: PostgresIdempotencyRepository
  private readonly projectResourceIdempotency = new Map<string, import("../../application/idempotency.js").IdempotencyEntry>()

  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(PROJECT_SERVICE) private readonly projectService: ProjectCoreReadProvider,
    @Inject(PROJECT_PINS) private readonly pins: ProjectPinProvider,
    @Inject(PROJECT_TASK_READER) private readonly readTasks: ProjectTaskReader,
    @Inject(PROJECT_SKILL_SELECTION_PROVIDER) private readonly projectSkillSelection: ProjectSkillSelectionProvider,
    @Inject(SKILL_INSTALLATION_CLIENT) private readonly installationClient: SkillInstallationConnectClient | null,
    @Inject(SKILL_AUTHORIZATION) private readonly skillAuthorization: Pick<SkillAuthorizationClient, "check">,
    @Inject(BFF_POOL) pool: Pool,
  ) {
    this.projectResourceReceipts = new PostgresIdempotencyRepository(pool)
  }

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void (
      isProjectSkillInstallationRequest(request)
        ? handleProjectSkillInstallationRequest(
            request,
            response,
            this.config,
            this.admission,
            this.skillAuthorization,
            this.projectService,
            this.installationClient,
          )
        : isProjectSkillSelectionRequest(request)
          ? handleProjectSkillSelectionRequest(request, response, this.config, this.admission, this.projectSkillSelection, this.installationClient)
          : Promise.resolve(false)
    )
      .then((handled) => handled || handleProjectRenameRequest(request, response, this.config, this.admission, this.projectService))
      .then((handled) => handled || handleProjectDeleteRequest(request, response, this.config, this.admission, this.projectService))
      .then((handled) => handled || handleProjectDeletionStatusRequest(request, response, this.config, this.admission, this.projectService))
      .then((handled) => handled || handleProjectResourceDeleteRequest(request, response, this.config, this.admission, this.projectService))
      .then(
        (handled) =>
          handled ||
          handleProjectResourceUploadRequest(request, response, this.config, this.admission, {
            find: this.projectService.find.bind(this.projectService),
            receipts: this.projectResourceReceipts,
            idempotency: this.projectResourceIdempotency,
          }),
      )
      .then((handled) => handled || handleProjectResourceReadRequest(request, response, this.config, this.admission, this.projectService))
      .then((handled) => handled || handleProjectResourceListRequest(request, response, this.config, this.admission, this.projectService))
      .then((handled) => handled || handleProjectCoreReadRequest(request, response, this.config, this.admission, this.projectService, this.readTasks))
      .then((handled) => handled || handleProjectPinRequest(request, response, this.config, this.admission, this.pins))
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
