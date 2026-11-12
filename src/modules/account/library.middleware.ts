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
import { requestId } from "../../http/request.js"
import { send } from "../../http/response.js"
import { handleLibraryRequest, libraryRequest } from "../../http/routes/library-native.js"
import { handleLibraryDeleteRequest, libraryDeleteRequest } from "../../http/routes/library-deletion.js"

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
    if (libraryDeleteRequest(request)) {
      void handleLibraryDeleteRequest(request, response, this.config, this.admission, this.artifactLibrary)
      return
    }
    if (!libraryRequest(request)) {
      next()
      return
    }
    void this.handle(request, response).catch(() => {
      if (!response.headersSent && !response.writableEnded && !response.destroyed)
        send(response, 503, failure("storage_unavailable", "Library request is unavailable", requestId(request)))
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = requestId(request)
    const admitted = await authorizeUserRequest(request, this.config, this.admission, id, AbortSignal.timeout(10_000), response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return
    }
    const body = request.method === "POST" ? await this.readUploadBody(request, response, id) : Buffer.alloc(0)
    if (body === null) return
    await handleLibraryRequest(
      request,
      response,
      this.config,
      admitted.context,
      {
        artifactLibrary: this.artifactLibrary,
        receipts: this.receipts,
        idempotency: this.idempotency,
      },
      body,
    )
  }

  private async readUploadBody(request: IncomingMessage, response: ServerResponse, id: string): Promise<Buffer | null> {
    const chunks: Buffer[] = []
    let size = 0
    // Keep the response writable when rejecting an unfinished upload; the 413 closes the connection.
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.byteLength
      if (size > 1024 * 1024) {
        response.setHeader("x-request-id", id)
        response.setHeader("connection", "close")
        send(response, 413, failure("request_body_too_large", "Personal file upload exceeds the request body limit", id))
        return null
      }
      chunks.push(buffer)
    }
    return Buffer.concat(chunks)
  }
}
