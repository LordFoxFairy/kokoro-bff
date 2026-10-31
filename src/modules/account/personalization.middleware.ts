import { Inject, Injectable } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { PERSONALIZATION_PROVIDER, type PersonalizationProvider } from "./personalization.provider.js"
import { handlePersonalizationRequest } from "../../http/routes/personalization.js"

/** Account-owned transport adapter for personalization; LegacyRoutes never receives this path. */
@Injectable()
export class AccountPersonalizationMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(PERSONALIZATION_PROVIDER)
    private readonly provider: PersonalizationProvider,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse): void {
    void handlePersonalizationRequest(request, response, this.config, this.admission, this.provider)
  }
}
