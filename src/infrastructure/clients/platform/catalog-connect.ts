import { create } from "@bufbuild/protobuf"
import { createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { CommandIdentitySchema } from "../../../generated/platform-connect/kokoro/common/v1/common_pb.js"
import {
  BeginSkillPackageUploadRequestSchema,
  CompleteSkillPackageUploadRequestSchema,
  CreateSkillDraftRequestSchema,
  GetSkillPackageUploadRequestSchema,
  OwnerScopeSchema,
  ProductCatalogContextSchema,
  PublishSkillRequestSchema,
  SkillCatalogService,
  SkillIdSchema,
  SkillMetadataSchema,
  SkillScopeKind,
  ValidateSkillDraftRequestSchema,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import type { CatalogTokenSource } from "./catalog-token.js"

export class CatalogConnectClient {
  readonly #client
  constructor(
    baseUrl: string,
    private readonly tokens: CatalogTokenSource,
    private readonly timeoutMs: number,
  ) {
    this.#client = createClient(
      SkillCatalogService,
      createConnectTransport({ baseUrl, httpVersion: "1.1", useBinaryFormat: true, readMaxBytes: 1024 * 1024, writeMaxBytes: 1024 * 1024 }),
    )
  }
  async create(
    input: { requestId: string; commandId: string; digest: string; tenant: string; user: string; displayName: string; summary: string; tags: string[] },
    signal?: AbortSignal,
  ) {
    const token = await this.tokens.get(input.tenant, signal)
    return this.#client.createSkillDraft(
      create(CreateSkillDraftRequestSchema, {
        requestId: input.requestId,
        command: create(CommandIdentitySchema, { commandId: input.commandId, requestDigest: input.digest }),
        ownerScope: create(OwnerScopeSchema, { kind: "user", id: input.user }),
        metadata: create(SkillMetadataSchema, {
          displayName: input.displayName,
          summary: input.summary,
          tags: input.tags,
          metadataJson: Buffer.from("{}", "utf8"),
        }),
        productContext: create(ProductCatalogContextSchema, { subjectId: input.user, ownerScope: create(OwnerScopeSchema, { kind: "user", id: input.user }) }),
      }),
      {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${token}`, "x-tenant-ref": input.tenant },
        timeoutMs: this.timeoutMs,
      },
    )
  }

  async getPackageUpload(input: { requestId: string; skillId: string; tenant: string; user: string }, signal?: AbortSignal) {
    const token = await this.tokens.get(input.tenant, signal)
    return this.#client.getSkillPackageUpload(
      create(GetSkillPackageUploadRequestSchema, {
        requestId: input.requestId,
        skillId: create(SkillIdSchema, { value: input.skillId }),
        productContext: create(ProductCatalogContextSchema, { subjectId: input.user, ownerScope: create(OwnerScopeSchema, { kind: "user", id: input.user }) }),
      }),
      {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${token}`, "x-tenant-ref": input.tenant },
        timeoutMs: this.timeoutMs,
      },
    )
  }

  async beginPackageUpload(
    input: {
      requestId: string
      commandId: string
      digest: string
      tenant: string
      user: string
      skillId: string
      filename: string
      mimeType: "application/zip"
      sizeBytes: number
      contentSha256: string
      replacesAttemptId?: string
    },
    signal?: AbortSignal,
  ) {
    const token = await this.tokens.get(input.tenant, signal)
    return this.#client.beginSkillPackageUpload(
      create(BeginSkillPackageUploadRequestSchema, {
        requestId: input.requestId,
        command: create(CommandIdentitySchema, { commandId: input.commandId, requestDigest: input.digest }),
        skillId: create(SkillIdSchema, { value: input.skillId }),
        productContext: create(ProductCatalogContextSchema, { subjectId: input.user, ownerScope: create(OwnerScopeSchema, { kind: "user", id: input.user }) }),
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        contentSha256: input.contentSha256,
        ...(input.replacesAttemptId === undefined ? {} : { replacesAttemptId: input.replacesAttemptId }),
      }),
      {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${token}`, "x-tenant-ref": input.tenant },
        timeoutMs: this.timeoutMs,
      },
    )
  }

  async completePackageUpload(
    input: {
      requestId: string
      commandId: string
      digest: string
      tenant: string
      user: string
      skillId: string
      attemptId: string
      uploadId: string
      contentSha256: string
      sizeBytes: number
    },
    signal?: AbortSignal,
  ) {
    const token = await this.tokens.get(input.tenant, signal)
    return this.#client.completeSkillPackageUpload(
      create(CompleteSkillPackageUploadRequestSchema, {
        requestId: input.requestId,
        command: create(CommandIdentitySchema, { commandId: input.commandId, requestDigest: input.digest }),
        skillId: create(SkillIdSchema, { value: input.skillId }),
        productContext: create(ProductCatalogContextSchema, { subjectId: input.user, ownerScope: create(OwnerScopeSchema, { kind: "user", id: input.user }) }),
        attemptId: input.attemptId,
        uploadId: input.uploadId,
        contentSha256: input.contentSha256,
        sizeBytes: BigInt(input.sizeBytes),
      }),
      {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${token}`, "x-tenant-ref": input.tenant },
        timeoutMs: this.timeoutMs,
      },
    )
  }

  async validateDraft(
    input: { requestId: string; commandId: string; digest: string; tenant: string; user: string; skillId: string; attemptId: string },
    signal?: AbortSignal,
  ) {
    const token = await this.tokens.get(input.tenant, signal)
    return this.#client.validateSkillDraft(
      create(ValidateSkillDraftRequestSchema, {
        requestId: input.requestId,
        command: create(CommandIdentitySchema, { commandId: input.commandId, requestDigest: input.digest }),
        skillId: create(SkillIdSchema, { value: input.skillId }),
        productContext: create(ProductCatalogContextSchema, { subjectId: input.user, ownerScope: create(OwnerScopeSchema, { kind: "user", id: input.user }) }),
        attemptId: input.attemptId,
      }),
      {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${token}`, "x-tenant-ref": input.tenant },
        timeoutMs: this.timeoutMs,
      },
    )
  }

  async publish(input: { requestId: string; commandId: string; digest: string; tenant: string; user: string; skillId: string }, signal?: AbortSignal) {
    const token = await this.tokens.get(input.tenant, signal)
    return this.#client.publishSkill(
      create(PublishSkillRequestSchema, {
        requestId: input.requestId,
        command: create(CommandIdentitySchema, { commandId: input.commandId, requestDigest: input.digest }),
        skillId: create(SkillIdSchema, { value: input.skillId }),
        visibility: SkillScopeKind.PERSONAL,
        productContext: create(ProductCatalogContextSchema, { subjectId: input.user, ownerScope: create(OwnerScopeSchema, { kind: "user", id: input.user }) }),
      }),
      {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${token}`, "x-tenant-ref": input.tenant },
        timeoutMs: this.timeoutMs,
      },
    )
  }
}
