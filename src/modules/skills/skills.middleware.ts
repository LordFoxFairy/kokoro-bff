import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, SESSION_ADMISSION, SKILL_ADMIN_CLIENT, SKILL_AUTHORIZATION, SKILL_DRAFT_CLIENT, SKILL_INSTALLATION_CLIENT, SKILL_PRODUCT_CLIENT, SKILL_USAGE_READER } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import type { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import { handlePersonalSkillInstallationRequest } from "../../http/routes/skill-installations.js"
import { handleManagedPersonalSkillsRequest } from "../../http/routes/managed-personal-skills.js"
import { handleSkillSpecificationEnabledRequest } from "../../http/routes/skill-specification-enabled.js"
import { handleSkillUsageRequest } from "../../http/routes/skill-usage.js"
import { handlePersonalSkillLifecycleRequest } from "../../http/routes/personal-skill-lifecycle-native.js"
import { handleSkillDraftRequest } from "../../http/routes/skill-draft-native.js"
import { handleSkillDraftMutationRequest } from "../../http/routes/skill-draft-mutations-native.js"
import { handleSkillCatalogCommandRequest, handleSkillCoverRequest, handleSkillPackageUploadReadRequest } from "../../http/routes/skill-catalog-command-native.js"
import { handlePublishedSkillPackageRequest } from "../../http/routes/skill-published-package-native.js"
import { handleSkillAdminRequest } from "../../http/routes/skill-admin-native.js"
import { handleSkillGithubPreviewRequest } from "../../http/routes/skill-catalog-command-native.js"
import type { SkillUsageResult } from "../../application/agui/skill-usage.js"
import type { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"
import type { SkillProductConnectClient } from "../../infrastructure/clients/platform/skill-product-connect.js"
import type { SkillAdminConnectClient } from "../../infrastructure/clients/platform/skill-admin-connect.js"

@Injectable()
export class SkillsMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(SKILL_AUTHORIZATION) private readonly skillAuthorization: Pick<SkillAuthorizationClient, "check">,
    @Inject(SKILL_DRAFT_CLIENT) private readonly draftClient: CatalogConnectClient | null,
    @Inject(SKILL_PRODUCT_CLIENT) private readonly productClient: SkillProductConnectClient | null,
    @Inject(SKILL_ADMIN_CLIENT) private readonly adminClient: SkillAdminConnectClient | null,
    @Inject(SKILL_INSTALLATION_CLIENT) private readonly client: SkillInstallationConnectClient | null,
    @Inject(SKILL_USAGE_READER) private readonly usageReader: (tenant: string, refs: readonly string[]) => Promise<Map<string, SkillUsageResult>>,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handlePersonalSkillInstallationRequest(request, response, this.config, this.admission, this.skillAuthorization, this.client)
      .then((handled) => handled || handleManagedPersonalSkillsRequest(request, response, this.config, this.admission))
      .then((handled) => handled || handleSkillSpecificationEnabledRequest(request, response, this.config, this.admission, this.client))
      .then((handled) => handled || handleSkillDraftRequest(request, response, this.config, this.admission, this.skillAuthorization, this.draftClient))
      .then((handled) => handled || handleSkillDraftMutationRequest(request, response, this.config, this.admission, this.skillAuthorization, this.productClient))
      .then((handled) => handled || handleSkillCatalogCommandRequest(request, response, this.config, this.admission, this.skillAuthorization, this.draftClient))
      .then((handled) => handled || handleSkillPackageUploadReadRequest(request, response, this.config, this.admission, this.draftClient))
      .then((handled) => handled || handleSkillCoverRequest(request, response, this.config, this.admission, this.skillAuthorization, this.productClient))
      .then((handled) => handled || handlePublishedSkillPackageRequest(request, response, this.config, this.admission, this.productClient))
      .then((handled) => handled || handleSkillAdminRequest(request, response, this.config, this.admission, this.skillAuthorization, this.adminClient))
      .then((handled) => handled || handleSkillGithubPreviewRequest(request, response, this.config, this.admission))
      .then((handled) => handled || handlePersonalSkillLifecycleRequest(request, response, this.config, this.admission, this.skillAuthorization, this.draftClient))
      .then((handled) => handled || handleSkillUsageRequest(request, response, this.config, this.admission, this.usageReader))
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
