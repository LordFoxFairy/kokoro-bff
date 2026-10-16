import { create } from "@bufbuild/protobuf"
import { createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { CommandIdentitySchema } from "../../../generated/platform-connect/kokoro/common/v1/common_pb.js"
import {
  BeginLocalSkillImportRequestSchema,
  CompleteLocalSkillImportRequestSchema,
  FinalizeLocalSkillImportRequestSchema,
  GetLocalSkillImportRequestSchema,
  SkillCatalogService,
  SkillImportIntentIdSchema,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import type {
  BeginLocalSkillImportResponse,
  CompleteLocalSkillImportResponse,
  FinalizeLocalSkillImportResponse,
  GetLocalSkillImportResponse,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import type { CatalogTokenSource } from "./catalog-token.js"
import type { PlatformServiceCredentialSource } from "./platform-service-credential.js"

export type LocalSkillImportCommonInput = { requestId: string; tenant: string; subject: string }
type Write = LocalSkillImportCommonInput & { commandId: string; digest: string }
export type LocalSkillImportBeginInput = Write & { filename: string; sizeBytes: number; contentSha256: string }
export type LocalSkillImportCompleteInput = Write & { intentId: string; uploadId: string; sourceVersionId: string; sizeBytes: number; contentSha256: string }
export type LocalSkillImportFinalizeInput = Write & { intentId: string }
export type LocalSkillImportGetInput = LocalSkillImportCommonInput & { intentId: string }
export interface LocalSkillImportClient {
  begin(input: LocalSkillImportBeginInput, signal: AbortSignal, deadlineAt: number): Promise<BeginLocalSkillImportResponse>
  complete(input: LocalSkillImportCompleteInput, signal: AbortSignal, deadlineAt: number): Promise<CompleteLocalSkillImportResponse>
  finalize(input: LocalSkillImportFinalizeInput, signal: AbortSignal, deadlineAt: number): Promise<FinalizeLocalSkillImportResponse>
  get(input: LocalSkillImportGetInput, signal: AbortSignal, deadlineAt: number): Promise<GetLocalSkillImportResponse>
}
export class LocalSkillImportConnectClient implements LocalSkillImportClient {
  readonly #client
  constructor(
    baseUrl: string,
    private readonly writes: CatalogTokenSource,
    private readonly reads: PlatformServiceCredentialSource,
  ) {
    this.#client = createClient(
      SkillCatalogService,
      createConnectTransport({ baseUrl, httpVersion: "1.1", useBinaryFormat: true, readMaxBytes: 1_048_576, writeMaxBytes: 1_048_576 }),
    )
  }
  async #options(input: LocalSkillImportCommonInput, signal: AbortSignal, deadlineAt: number, read = false) {
    const remaining = Math.floor(deadlineAt - performance.now())
    if (remaining <= 0) throw signal.reason ?? new Error("local_skill_import_deadline")
    const token = await (read ? this.reads : this.writes).get(input.tenant, signal, deadlineAt)
    signal.throwIfAborted()
    const remainingAfterToken = Math.floor(deadlineAt - performance.now())
    if (remainingAfterToken <= 0) throw signal.reason ?? new Error("local_skill_import_deadline")
    return {
      signal,
      timeoutMs: remainingAfterToken,
      headers: { authorization: `Bearer ${token}`, "x-tenant-ref": input.tenant, "x-kokoro-subject": input.subject, "x-kokoro-request-id": input.requestId },
    }
  }
  #context(subject: string) {
    return { subjectId: subject, ownerScope: { kind: "user", id: subject } }
  }
  begin(input: LocalSkillImportBeginInput, signal: AbortSignal, deadlineAt: number) {
    return this.#options(input, signal, deadlineAt).then((o) =>
      this.#client.beginLocalSkillImport(
        create(BeginLocalSkillImportRequestSchema, {
          requestId: input.requestId,
          command: create(CommandIdentitySchema, { commandId: input.commandId, requestDigest: input.digest }),
          productContext: this.#context(input.subject),
          filename: input.filename,
          sizeBytes: BigInt(input.sizeBytes),
          contentSha256: input.contentSha256,
        }),
        o,
      ),
    )
  }
  complete(input: LocalSkillImportCompleteInput, signal: AbortSignal, deadlineAt: number) {
    return this.#options(input, signal, deadlineAt).then((o) =>
      this.#client.completeLocalSkillImport(
        create(CompleteLocalSkillImportRequestSchema, {
          requestId: input.requestId,
          command: create(CommandIdentitySchema, { commandId: input.commandId, requestDigest: input.digest }),
          productContext: this.#context(input.subject),
          intentId: create(SkillImportIntentIdSchema, { value: input.intentId }),
          uploadId: input.uploadId,
          sourceVersionId: input.sourceVersionId,
          sizeBytes: BigInt(input.sizeBytes),
          contentSha256: input.contentSha256,
        }),
        o,
      ),
    )
  }
  finalize(input: LocalSkillImportFinalizeInput, signal: AbortSignal, deadlineAt: number) {
    return this.#options(input, signal, deadlineAt).then((o) =>
      this.#client.finalizeLocalSkillImport(
        create(FinalizeLocalSkillImportRequestSchema, {
          requestId: input.requestId,
          command: create(CommandIdentitySchema, { commandId: input.commandId, requestDigest: input.digest }),
          productContext: this.#context(input.subject),
          intentId: create(SkillImportIntentIdSchema, { value: input.intentId }),
        }),
        o,
      ),
    )
  }
  get(input: LocalSkillImportGetInput, signal: AbortSignal, deadlineAt: number) {
    return this.#options(input, signal, deadlineAt, true).then((o) =>
      this.#client.getLocalSkillImport(
        create(GetLocalSkillImportRequestSchema, {
          requestId: input.requestId,
          productContext: this.#context(input.subject),
          intentId: create(SkillImportIntentIdSchema, { value: input.intentId }),
        }),
        o,
      ),
    )
  }
}
