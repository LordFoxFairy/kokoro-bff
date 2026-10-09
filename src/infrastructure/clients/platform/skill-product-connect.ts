import { createClient, ConnectError, Code } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { fromJson, type JsonValue } from "@bufbuild/protobuf"
import { SkillCatalogService, ProductSkillReadService } from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { projectSkillProductCommand } from "./create-skill-draft-projector.js"
import type { CatalogTokenSource } from "./catalog-token.js"
import type { ProjectionTokenSource } from "./projection-token.js"

export type SkillProductContext = { requestId: string; tenant: string; subject: string }
export type SkillProductCommand =
  | "createSkillDraft"
  | "beginSkillPackageUpload"
  | "completeSkillPackageUpload"
  | "validateSkillDraft"
  | "updateSkillDraft"
  | "discardSkillDraft"
  | "setSkillPublicationAudience"
  | "beginSkillCoverUpload"
  | "completeSkillCoverUpload"
export class SkillProductConnectClient {
  readonly #catalog
  readonly #reads
  constructor(
    baseUrl: string,
    private readonly writes: CatalogTokenSource,
    private readonly reads: ProjectionTokenSource,
    private readonly timeoutMs: number,
  ) {
    const transport = createConnectTransport({ baseUrl, httpVersion: "1.1", useBinaryFormat: true, readMaxBytes: 1024 * 1024, writeMaxBytes: 1024 * 1024 })
    this.#catalog = createClient(SkillCatalogService, transport)
    this.#reads = createClient(ProductSkillReadService, transport)
  }
  async #invoke<T>(
    source: { get(tenant: string, signal?: AbortSignal, deadlineAt?: number): Promise<string>; retire?(token: string): void },
    context: SkillProductContext,
    signal: AbortSignal,
    deadlineAt: number,
    call: (options: { signal: AbortSignal; timeoutMs: number; headers: Record<string, string>; onHeader: (headers: Headers) => void }) => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted()
    const token = await source.get(context.tenant, signal, deadlineAt)
    signal.throwIfAborted()
    const remaining = Math.min(this.timeoutMs, Math.floor(deadlineAt - performance.now()))
    if (remaining <= 0) throw new ConnectError("Skill deadline exceeded", Code.DeadlineExceeded)
    let requestId: string | null = null,
      cache: string | null = null
    try {
      const result = await call({
        signal,
        timeoutMs: remaining,
        headers: { authorization: `Bearer ${token}`, "x-kokoro-tenant": context.tenant, "x-tenant-ref": context.tenant, "x-kokoro-subject": context.subject },
        onHeader: (headers) => {
          requestId = headers.get("x-kokoro-request-id")
          cache = headers.get("cache-control")
        },
      })
      if (requestId !== context.requestId || cache !== "no-store") throw new Error("skill_response_invalid")
      signal.throwIfAborted()
      return result
    } catch (error) {
      if (error instanceof ConnectError && [Code.PermissionDenied, Code.Unauthenticated].includes(error.code)) source.retire?.(token)
      throw error
    }
  }
  async command(
    operation: SkillProductCommand,
    context: SkillProductContext & { commandId: string },
    members: Record<string, JsonValue>,
    signal: AbortSignal,
    deadlineAt: number,
  ) {
    const descriptor = SkillCatalogService.method[operation]
    const request = { ...members, product_context: { subject_id: context.subject, owner_scope: { kind: "user", id: context.subject } } }
    const digest = projectSkillProductCommand(
      JSON.stringify({ command_digest_version: "3.0.0", fq_method: `${SkillCatalogService.typeName}/${descriptor.name}`, tenant_ref: context.tenant, request }),
      true,
    ).sha256
    const wire = fromJson(descriptor.input, { ...request, request_id: context.requestId, command: { command_id: context.commandId, request_digest: digest } })
    return this.#invoke(this.writes, context, signal, deadlineAt, (options) => {
      const rpc = this.#catalog[operation] as (
        request: typeof wire,
        callOptions: typeof options,
      ) => Promise<ReturnType<typeof fromJson<typeof descriptor.output>>>
      return rpc(wire, options)
    })
  }
  async getPackageUpload(context: SkillProductContext & { skillId: string }, signal: AbortSignal, deadlineAt: number) {
    const request = fromJson(SkillCatalogService.method.getSkillPackageUpload.input, {
      request_id: context.requestId,
      skill_id: { value: context.skillId },
      product_context: { subject_id: context.subject, owner_scope: { kind: "user", id: context.subject } },
    })
    return this.#invoke(this.writes, context, signal, deadlineAt, (options) => this.#catalog.getSkillPackageUpload(request, options))
  }
  async getCoverUpload(context: SkillProductContext & { skillId: string }, signal: AbortSignal, deadlineAt: number) {
    const request = fromJson(SkillCatalogService.method.getSkillCoverUpload.input, {
      request_id: context.requestId,
      skill_id: { value: context.skillId },
      product_context: { subject_id: context.subject, owner_scope: { kind: "user", id: context.subject } },
    })
    return this.#invoke(this.writes, context, signal, deadlineAt, (options) => this.#catalog.getSkillCoverUpload(request, options))
  }
  async inspect(context: SkillProductContext & { sourceRef: string; filePath?: string }, signal: AbortSignal, deadlineAt: number) {
    const request = fromJson(ProductSkillReadService.method.inspectSkillPackage.input, {
      request_id: context.requestId,
      source_ref: { value: context.sourceRef },
      purpose: "product",
      ...(context.filePath === undefined ? {} : { file_path: context.filePath }),
    })
    return this.#invoke(this.reads, context, signal, deadlineAt, (options) => this.#reads.inspectSkillPackage(request, options))
  }
  async download(context: SkillProductContext & { sourceRef: string }, signal: AbortSignal, deadlineAt: number) {
    return this.#invoke(this.reads, context, signal, deadlineAt, (options) =>
      this.#reads.getSkillPackageDownload(
        fromJson(ProductSkillReadService.method.getSkillPackageDownload.input, {
          request_id: context.requestId,
          source_ref: { value: context.sourceRef },
          purpose: "product",
        }),
        options,
      ),
    )
  }
  async cover(context: SkillProductContext & { sourceRef: string }, signal: AbortSignal, deadlineAt: number) {
    return this.#invoke(this.reads, context, signal, deadlineAt, (options) =>
      this.#reads.getSkillCoverReference(
        fromJson(ProductSkillReadService.method.getSkillCoverReference.input, {
          request_id: context.requestId,
          source_ref: { value: context.sourceRef },
          purpose: "product",
        }),
        options,
      ),
    )
  }
}
