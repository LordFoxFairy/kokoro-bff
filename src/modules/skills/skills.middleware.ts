import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, SESSION_ADMISSION, SKILL_AUTHORIZATION, SKILL_INSTALLATION_CLIENT } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import type { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import { handlePersonalSkillInstallationRequest } from "../../http/routes/skill-installations.js"
import { handleManagedPersonalSkillsRequest } from "../../http/routes/managed-personal-skills.js"
import { handleSkillSpecificationEnabledRequest } from "../../http/routes/skill-specification-enabled.js"

@Injectable()
export class SkillsMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(SKILL_AUTHORIZATION) private readonly skillAuthorization: Pick<SkillAuthorizationClient, "check">,
    @Inject(SKILL_INSTALLATION_CLIENT) private readonly client: SkillInstallationConnectClient | null,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handlePersonalSkillInstallationRequest(request, response, this.config, this.admission, this.skillAuthorization, this.client)
      .then((handled) => handled || handleManagedPersonalSkillsRequest(request, response, this.config, this.admission))
      .then((handled) => handled || handleSkillSpecificationEnabledRequest(request, response, this.config, this.admission, this.client))
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
