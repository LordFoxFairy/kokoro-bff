import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, PERSONAL_KNOWLEDGE_REPOSITORY, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { PERSONALIZATION_PROVIDER, type PersonalizationProvider } from "./personalization.provider.js"
import { handleAccountNativeRequest } from "../../http/routes/account-native.js"
import { handlePersonalKnowledgeRequest } from "../../http/routes/personal-knowledge-native.js"
import { handleAdminIdentityRequest } from "../../http/routes/admin-identity-native.js"
import type { PersonalKnowledgeRepository } from "../../application/ports/personal-knowledge-repository.js"

/** Account-owned routes terminate here; unrelated traffic continues to the transitional dispatcher. */
@Injectable()
export class AccountMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(PERSONALIZATION_PROVIDER) private readonly personalizationProvider: PersonalizationProvider,
    @Inject(PERSONAL_KNOWLEDGE_REPOSITORY) private readonly knowledgeRepository: PersonalKnowledgeRepository,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleAdminIdentityRequest(request, response, this.config, this.admission)
      .then((handled) => handled || handlePersonalKnowledgeRequest(request, response, this.config, this.admission, this.knowledgeRepository))
      .then((handled) => handled || handleAccountNativeRequest(request, response, this.config, this.admission, this.personalizationProvider))
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
