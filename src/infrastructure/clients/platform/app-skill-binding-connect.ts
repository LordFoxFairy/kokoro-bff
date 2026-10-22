import { createClient, Code, ConnectError } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { create } from "@bufbuild/protobuf"
import {
  SkillCatalogService,
  ProductSkillReadService,
  PutAppSkillBindingRequestSchema,
  RemoveAppSkillBindingRequestSchema,
  ListAppSkillBindingsRequestSchema,
  type PutAppSkillBindingResponse,
  type RemoveAppSkillBindingResponse,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import type { AppSkillBindingClient, AppSkillBindingContext, AppSkillBindingPage } from "../../../application/app-skill-bindings.types.js"
import type { PlatformServiceCredentialSource } from "./platform-service-credential.js"
import { projectAppSkillBindingCommand } from "./app-skill-binding-command.js"
import { projectAppSkillBinding } from "./app-skill-binding-response.js"
import { assertSkillWireKnown } from "./skill-product-response.js"

/** One fixed Native owner, with distinct catalog write/projection read credentials. No body identity or automatic retries. */
export class AppSkillBindingConnectClient implements AppSkillBindingClient {
  readonly #catalog
  readonly #reads
  constructor(
    baseUrl: string,
    private readonly writes: Pick<PlatformServiceCredentialSource, "get">,
    private readonly reads: Pick<PlatformServiceCredentialSource, "get">,
    private readonly timeoutMs: number,
  ) {
    const transport = createConnectTransport({ baseUrl, httpVersion: "1.1", useBinaryFormat: true, readMaxBytes: 1024 * 1024, writeMaxBytes: 65_536 })
    this.#catalog = createClient(SkillCatalogService, transport)
    this.#reads = createClient(ProductSkillReadService, transport)
  }
  private async invoke<T>(
    write: boolean,
    context: AppSkillBindingContext,
    signal: AbortSignal,
    deadlineAt: number,
    call: (options: { signal: AbortSignal; timeoutMs: number; headers: Record<string, string>; onHeader: (headers: Headers) => void }) => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted()
    const token = await (write ? this.writes : this.reads).get(context.tenant, signal, deadlineAt)
    signal.throwIfAborted()
    const remaining = Math.min(this.timeoutMs, Math.floor(deadlineAt - performance.now()))
    if (remaining <= 0) throw new ConnectError("Skill deadline exceeded", Code.DeadlineExceeded)
    let correlation: string | null = null,
      cache: string | null = null
    const result = await call({
      signal,
      timeoutMs: remaining,
      headers: {
        authorization: `Bearer ${token}`,
        "x-kokoro-request-id": context.requestId,
        "x-tenant-ref": context.tenant,
        "x-kokoro-tenant": context.tenant,
        "x-kokoro-subject": context.subject,
        "x-kokoro-app-id": context.appId,
      },
      onHeader: (headers) => {
        correlation = headers.get("x-kokoro-request-id")
        cache = headers.get("cache-control")
      },
    })
    signal.throwIfAborted()
    if (performance.now() >= deadlineAt) throw new ConnectError("Skill deadline exceeded", Code.DeadlineExceeded)
    if (correlation !== context.requestId || cache !== "no-store") throw new Error("skill_response_invalid")
    assertSkillWireKnown(result)
    return result
  }
  async list(context: AppSkillBindingContext, page: AppSkillBindingPage, signal: AbortSignal, deadlineAt: number) {
    const response = await this.invoke(false, context, signal, deadlineAt, (options) =>
      this.#reads.listAppSkillBindings(create(ListAppSkillBindingsRequestSchema, { requestId: context.requestId, page }), options),
    )
    if (response.bindings.length > page.limit) throw new Error("skill_response_invalid")
    const items = response.bindings.map(projectAppSkillBinding),
      ids = new Set<string>(),
      series = new Set<string>()
    for (const item of items) {
      if (ids.has(item.binding_id) || series.has(item.series_id)) throw new Error("skill_response_invalid")
      ids.add(item.binding_id)
      series.add(item.series_id)
    }
    const cursor = response.page?.nextCursor
    if (cursor !== undefined && (!cursor || Buffer.byteLength(cursor, "utf8") > 4096)) throw new Error("skill_response_invalid")
    return { items, ...(cursor === undefined ? {} : { nextCursor: cursor }) }
  }
  async command(
    operation: "put" | "remove",
    context: AppSkillBindingContext & Readonly<{ commandId: string }>,
    input: Readonly<{ target: string; expectedBindingVersion: string }>,
    signal: AbortSignal,
    deadlineAt: number,
  ) {
    const digest = projectAppSkillBindingCommand({
      tenantId: context.tenant,
      subjectId: context.subject,
      appId: context.appId,
      operation: `skill.app_binding.${operation}`,
      target: input.target,
      expected_binding_version: input.expectedBindingVersion,
    }).sha256
    const common = {
      requestId: context.requestId,
      command: { commandId: context.commandId, requestDigest: digest },
      expectedBindingVersion: BigInt(input.expectedBindingVersion),
    }
    const response = await this.invoke<PutAppSkillBindingResponse | RemoveAppSkillBindingResponse>(true, context, signal, deadlineAt, (options) =>
      operation === "put"
        ? this.#catalog.putAppSkillBinding(create(PutAppSkillBindingRequestSchema, { ...common, skillId: { value: input.target } }), options)
        : this.#catalog.removeAppSkillBinding(create(RemoveAppSkillBindingRequestSchema, { ...common, seriesId: { value: input.target } }), options),
    )
    const binding = projectAppSkillBinding(response.binding)
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(response.eventId) ||
      (operation === "put"
        ? binding.skill_id !== input.target || binding.removed_at !== null
        : binding.series_id !== input.target || binding.removed_at === null) ||
      BigInt(binding.state_version) !== BigInt(input.expectedBindingVersion) + 1n
    )
      throw new Error("skill_response_invalid")
    return { binding, event_id: response.eventId, replayed: response.replayed }
  }
}
