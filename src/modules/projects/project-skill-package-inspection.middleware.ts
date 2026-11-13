import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, PROJECT_READ_LOOKUP, SESSION_ADMISSION, SKILL_INSTALLATION_CLIENT, SKILL_PACKAGE_INSPECTION_CLIENT } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ProjectLookup } from "../../application/projects/types.js"
import type { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import type { SkillPackageInspectionConnectClient } from "../../infrastructure/clients/platform/skill-package-inspection-connect.js"
import { handleSkillPackageInspectionRequest } from "../../http/routes/skill-package-inspection-native.js"

@Injectable()
export class ProjectSkillPackageInspectionMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(PROJECT_READ_LOOKUP) private readonly project: ProjectLookup,
    @Inject(SKILL_PACKAGE_INSPECTION_CLIENT) private readonly client: SkillPackageInspectionConnectClient | null,
    @Inject(SKILL_INSTALLATION_CLIENT) private readonly installations: SkillInstallationConnectClient | null,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleSkillPackageInspectionRequest(
      request,
      response,
      this.config,
      this.admission,
      { client: this.client, installations: this.installations },
      this.project,
    )
      .then((handled) => {
        if (!handled && !response.writableEnded && !response.destroyed) next()
      })
      .catch(() => {
        if (!response.headersSent && !response.destroyed) {
          response.statusCode = 500
          response.setHeader("content-type", "application/json")
          response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } }))
        } else if (!response.writableEnded && !response.destroyed) response.destroy()
      })
  }
}
