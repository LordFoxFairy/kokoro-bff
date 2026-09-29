import { create } from "@bufbuild/protobuf"
import { createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { CommandIdentitySchema } from "../../../generated/platform-connect/kokoro/common/v1/common_pb.js"
import {
  CreateSkillDraftRequestSchema,
  OwnerScopeSchema,
  ProductCatalogContextSchema,
  SkillCatalogService,
  SkillMetadataSchema,
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
}
