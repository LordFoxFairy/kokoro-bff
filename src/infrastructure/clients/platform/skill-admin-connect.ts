import { createClient, Code, ConnectError } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { fromJson, type JsonValue } from "@bufbuild/protobuf"
import { SkillAdminService } from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import type { SkillAdminTokenSource } from "./skill-admin-token.js"
import type { SkillProductContext } from "./skill-product-connect.js"
import { projectSkillProductCommand } from "./create-skill-draft-projector.js"

export type SkillAdminCommand =
  | "createAdminSkillDraft"
  | "createAdminSkillVersion"
  | "publishOfficialSkill"
  | "withdrawAdminSkill"
  | "quarantineSkill"
  | "restoreSkill"
  | "setAdminSkillPublicationAudience"
  | "discardAdminSkillDraft"
export class SkillAdminConnectClient {
  readonly #client
  constructor(
    baseUrl: string,
    private readonly tokens: SkillAdminTokenSource,
    private readonly timeoutMs: number,
  ) {
    this.#client = createClient(
      SkillAdminService,
      createConnectTransport({ baseUrl, httpVersion: "1.1", useBinaryFormat: true, readMaxBytes: 1024 * 1024, writeMaxBytes: 1024 * 1024 }),
    )
  }
  async #invoke<T>(
    context: SkillProductContext,
    signal: AbortSignal,
    deadlineAt: number,
    call: (options: { signal: AbortSignal; timeoutMs: number; headers: Record<string, string>; onHeader: (headers: Headers) => void }) => Promise<T>,
  ) {
    const token = await this.tokens.get(context.tenant, signal, deadlineAt)
    signal.throwIfAborted()
    const remaining = Math.min(this.timeoutMs, Math.floor(deadlineAt - performance.now()))
    if (remaining <= 0) throw new ConnectError("Skill admin deadline exceeded", Code.DeadlineExceeded)
    let requestId: string | null = null,
      cache: string | null = null
    try {
      const value = await call({
        signal,
        timeoutMs: remaining,
        headers: {
          authorization: `Bearer ${token}`,
          "x-kokoro-request-id": context.requestId,
          "x-kokoro-tenant": context.tenant,
          "x-kokoro-subject": context.subject,
        },
        onHeader: (headers) => {
          requestId = headers.get("x-kokoro-request-id")
          cache = headers.get("cache-control")
        },
      })
      if (requestId !== context.requestId || cache !== "no-store") throw new Error("skill_response_invalid")
      signal.throwIfAborted()
      return value
    } catch (error) {
      if (error instanceof ConnectError && [Code.PermissionDenied, Code.Unauthenticated].includes(error.code)) this.tokens.retire(token)
      throw error
    }
  }
  async command(
    operation: SkillAdminCommand,
    context: SkillProductContext & { commandId: string },
    members: Record<string, JsonValue>,
    signal: AbortSignal,
    deadlineAt: number,
  ) {
    const descriptor = SkillAdminService.method[operation]
    const request = { ...members, product_context: { subject_id: context.subject, owner_scope: { kind: "user", id: context.subject } } }
    const digest = projectSkillProductCommand(
      JSON.stringify({ command_digest_version: "3.0.0", fq_method: `${SkillAdminService.typeName}/${descriptor.name}`, tenant_ref: context.tenant, request }),
      true,
    ).sha256
    const wire = fromJson(descriptor.input, { ...request, request_id: context.requestId, command: { command_id: context.commandId, request_digest: digest } })
    return this.#invoke(context, signal, deadlineAt, (options) => {
      const rpc = this.#client[operation] as (
        request: typeof wire,
        callOptions: typeof options,
      ) => Promise<ReturnType<typeof fromJson<typeof descriptor.output>>>
      return rpc(wire, options)
    })
  }
  async get(context: SkillProductContext & { skillId: string }, signal: AbortSignal, deadlineAt: number) {
    return this.#invoke(context, signal, deadlineAt, (options) =>
      this.#client.getAdminSkill(
        fromJson(SkillAdminService.method.getAdminSkill.input, {
          request_id: context.requestId,
          skill_id: { value: context.skillId },
          product_context: { subject_id: context.subject, owner_scope: { kind: "user", id: context.subject } },
        }),
        options,
      ),
    )
  }
  async list(context: SkillProductContext, filters: Record<string, JsonValue>, signal: AbortSignal, deadlineAt: number) {
    return this.#invoke(context, signal, deadlineAt, (options) =>
      this.#client.listAdminSkills(
        fromJson(SkillAdminService.method.listAdminSkills.input, {
          ...filters,
          request_id: context.requestId,
          product_context: { subject_id: context.subject, owner_scope: { kind: "user", id: context.subject } },
        }),
        options,
      ),
    )
  }
}
