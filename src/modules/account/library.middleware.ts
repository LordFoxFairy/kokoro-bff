import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { ACCOUNT_IDEMPOTENCY, BFF_CONFIG, LIBRARY_ARTIFACT_REPOSITORY, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import type { ArtifactLibraryRepository } from "../../application/account/artifact-library-repository.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { readBody, requestId } from "../../http/request.js"
import { send } from "../../http/response.js"
import { handleLibraryRequest, libraryRequest } from "../../http/routes/library-native.js"

@Injectable()
export class LibraryMiddleware implements NestMiddleware {
  private readonly idempotency = new Map<string, IdempotencyEntry>()

  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(ACCOUNT_IDEMPOTENCY) private readonly receipts: IdempotencyRepository,
    @Inject(LIBRARY_ARTIFACT_REPOSITORY) private readonly artifactLibrary: ArtifactLibraryRepository,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    if (!libraryRequest(request)) {
      next()
      return
    }
    void this.handle(request, response).catch(() => {
      if (!response.headersSent && !response.writableEnded && !response.destroyed) send(response, 503, failure("storage_unavailable", "Library request is unavailable", requestId(request)))
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = requestId(request)
    const admitted = await authorizeUserRequest(request, this.config, this.admission, id, AbortSignal.timeout(10_000))
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return
    }
    const body = request.method === "POST" ? await readBody(request) : Buffer.alloc(0)
    await handleLibraryRequest(request, response, this.config, admitted.context, {
      artifactLibrary: this.artifactLibrary,
      receipts: this.receipts,
      idempotency: this.idempotency,
    }, body)
  }
}
