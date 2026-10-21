import type { PlatformServiceCredentialSource } from "./platform-service-credential.js"
import { fromJson, type JsonValue, type MessageShape } from "@bufbuild/protobuf"
import { Code, ConnectError, createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { SkillCatalogService } from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { projectSkillProductCommand } from "./create-skill-draft-projector.js"

import { skillPublicationPreconditionWire, type SkillPublicationPrecondition } from "./skill-product-schema.js"

type Context = { requestId: string; commandId: string; digest: string; tenant: string; user: string; expectedStateVersion?: string }
type Metadata = { displayName: string; summary: string; tags: string[]; examplePrompts?: string[]; categoryKeys?: string[] }
function metadata(input: Metadata): Record<string, JsonValue> {
  return {
    display_name: input.displayName,
    summary: input.summary,
    tags: input.tags,
    metadata_json: "e30",
    ...(input.examplePrompts === undefined ? {} : { example_prompts: { prompts: input.examplePrompts } }),
    ...(input.categoryKeys === undefined ? {} : { category_keys: { keys: input.categoryKeys } }),
  }
}
/** Ordinary catalog credential only. Every call uses one bounded budget and the current owner canonicalizer. */
export class CatalogConnectClient {
  readonly #client
  constructor(
    baseUrl: string,
    private readonly credentials: Pick<PlatformServiceCredentialSource, "get">,
    private readonly timeoutMs: number,
  ) {
    this.#client = createClient(
      SkillCatalogService,
      createConnectTransport({ baseUrl, httpVersion: "1.1", useBinaryFormat: true, readMaxBytes: 1024 * 1024, writeMaxBytes: 1024 * 1024 }),
    )
  }
  async #call<K extends keyof typeof SkillCatalogService.method>(
    operation: K,
    input: Omit<Context, "commandId" | "digest"> & Partial<Pick<Context, "commandId" | "digest">>,
    members: Record<string, JsonValue>,
    outer?: AbortSignal,
    deadlineAt = performance.now() + this.timeoutMs,
  ): Promise<MessageShape<(typeof SkillCatalogService.method)[K]["output"]>> {
    const remainingBudget = Math.min(this.timeoutMs, Math.floor(deadlineAt - performance.now()))
    if (remainingBudget <= 0) throw new ConnectError("catalog deadline exceeded", Code.DeadlineExceeded)
    const signal = outer ? AbortSignal.any([outer, AbortSignal.timeout(remainingBudget)]) : AbortSignal.timeout(remainingBudget)
    signal.throwIfAborted()
    const token = await this.credentials.get(input.tenant, signal, deadlineAt)
    signal.throwIfAborted()
    const remaining = Math.min(this.timeoutMs, Math.floor(deadlineAt - performance.now()))
    if (remaining <= 0) throw new ConnectError("catalog deadline exceeded", Code.DeadlineExceeded)
    const descriptor = SkillCatalogService.method[operation]
    const request = {
      ...members,
      ...(input.expectedStateVersion === undefined ? {} : { expected_state_version: input.expectedStateVersion }),
      product_context: { subject_id: input.user, owner_scope: { kind: "user", id: input.user } },
    }
    const digest =
      input.commandId === undefined
        ? undefined
        : projectSkillProductCommand(
            JSON.stringify({
              command_digest_version: "3.0.0",
              fq_method: `${SkillCatalogService.typeName}/${descriptor.name}`,
              tenant_ref: input.tenant,
              request,
            }),
            true,
          ).sha256
    if (digest !== undefined && digest !== input.digest) throw new Error("skill_request_digest_mismatch")
    const wire = fromJson(descriptor.input, {
      ...request,
      request_id: input.requestId,
      ...(input.commandId === undefined ? {} : { command: { command_id: input.commandId, request_digest: digest! } }),
    })
    let requestId: string | null = null,
      cache: string | null = null
    const options = {
      signal,
      timeoutMs: remaining,
      headers: { authorization: `Bearer ${token}`, "x-kokoro-request-id": input.requestId, "x-tenant-ref": input.tenant, "x-kokoro-subject": input.user },
      onHeader: (headers: Headers) => {
        requestId = headers.get("x-kokoro-request-id")
        cache = headers.get("cache-control")
      },
    }
    const rpc = this.#client[operation] as unknown as (
      request: typeof wire,
      callOptions: typeof options,
    ) => Promise<MessageShape<(typeof SkillCatalogService.method)[K]["output"]>>
    const result = await rpc(wire, options)
    if (requestId !== input.requestId || cache !== "no-store") throw new Error("skill_response_invalid")
    signal.throwIfAborted()
    return result
  }
  create(input: Context & Metadata, signal?: AbortSignal, deadlineAt?: number) {
    return this.#call("createSkillDraft", input, { owner_scope: { kind: "user", id: input.user }, metadata: metadata(input) }, signal, deadlineAt)
  }
  getPackageUpload(input: { requestId: string; skillId: string; tenant: string; user: string }, signal?: AbortSignal, deadlineAt?: number) {
    return this.#call("getSkillPackageUpload", input, { skill_id: { value: input.skillId } }, signal, deadlineAt)
  }
  beginPackageUpload(
    input: Context & {
      expectedStateVersion: string
      skillId: string
      filename: string
      mimeType: "application/zip"
      sizeBytes: number
      contentSha256: string
      replacesAttemptId?: string
    },
    signal?: AbortSignal,
    deadlineAt?: number,
  ) {
    return this.#call(
      "beginSkillPackageUpload",
      input,
      {
        skill_id: { value: input.skillId },
        filename: input.filename,
        mime_type: input.mimeType,
        size_bytes: String(input.sizeBytes),
        content_sha256: input.contentSha256,
        ...(input.replacesAttemptId === undefined ? {} : { replaces_attempt_id: input.replacesAttemptId }),
      },
      signal,
      deadlineAt,
    )
  }
  completePackageUpload(
    input: Context & {
      expectedStateVersion: string
      skillId: string
      attemptId: string
      uploadId: string
      sourceVersionId: string
      contentSha256: string
      sizeBytes: number
    },
    signal?: AbortSignal,
    deadlineAt?: number,
  ) {
    return this.#call(
      "completeSkillPackageUpload",
      input,
      {
        skill_id: { value: input.skillId },
        attempt_id: input.attemptId,
        upload_id: input.uploadId,
        source_version_id: input.sourceVersionId,
        content_sha256: input.contentSha256,
        size_bytes: String(input.sizeBytes),
      },
      signal,
      deadlineAt,
    )
  }
  validateDraft(input: Context & { expectedStateVersion: string; skillId: string; attemptId: string }, signal?: AbortSignal, deadlineAt?: number) {
    return this.#call("validateSkillDraft", input, { skill_id: { value: input.skillId }, attempt_id: input.attemptId }, signal, deadlineAt)
  }
  publish(
    input: Context & {
      skillId: string
      audience: "owner" | "tenant" | "catalog"
      expectedStateVersion: string
      expectedPublication: SkillPublicationPrecondition
    },
    signal?: AbortSignal,
    deadlineAt?: number,
  ) {
    return this.#call(
      "publishSkill",
      input,
      {
        skill_id: { value: input.skillId },
        visibility: 1,
        audience: input.audience,
        expected_publication: skillPublicationPreconditionWire(input.expectedPublication),
      },
      signal,
      deadlineAt,
    )
  }
  createPersonalVersion(
    input: Omit<Context, "expectedStateVersion"> & Metadata & { baseSkillId: string; expectedStateVersion?: never },
    signal: AbortSignal,
    deadlineAt: number,
  ) {
    if (Object.hasOwn(input, "expectedStateVersion")) throw new Error("invalid_skill_request")
    return this.#call(
      "createSkillVersion",
      input,
      { owner_scope: { kind: "user", id: input.user }, base_skill_id: { value: input.baseSkillId }, metadata: metadata(input) },
      signal,
      deadlineAt,
    )
  }
  withdrawPersonal(input: Context & { skillId: string; reason: string; expectedStateVersion: string }, signal: AbortSignal, deadlineAt: number) {
    return this.#call("withdrawSkill", input, { source_ref: { value: `skill:${input.skillId}` }, reason: input.reason }, signal, deadlineAt)
  }
}
