import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, PROJECT_GRANTS, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ProjectGrantStore } from "../../infrastructure/postgres/project-grants.js"
import { handleProjectGrantRequest } from "../../http/routes/project-grants.js"

@Injectable()
export class ProjectGrantMiddleware implements NestMiddleware {
  constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(PROJECT_GRANTS) private readonly store: ProjectGrantStore,
  ) {}
  use(request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void): void {
    void handleProjectGrantRequest(request, response, this.config, this.admission, this.store).then(
      (handled) => {
        if (!handled) next()
      },
      (error) => next(error),
    )
  }
}
