import type { DescMessage, Message } from "@bufbuild/protobuf"
import { Code, ConnectError, createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { z } from "zod"
import * as p from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { PLATFORM_COMMAND_RECEIPT_ERRORS } from "../../../generated/platform-connect/command-receipt-errors.js"
import { bindCustomApiAdminCommand, type CustomApiAdminCommandInput, type CustomApiAdminIdentity } from "./custom-api-admin-command-binding.js"
import type { PlatformServiceCredentialSource } from "./platform-service-credential.js"

const ascii = z.string().regex(/^[\x21-\x7e]{1,191}$/u)
const opaque = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u)
const status = z.enum(["active", "quarantined", "revoked"])
const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/u)
const reason = z.enum(["security_review", "policy_violation", "operator_request", "review_completed"])
const version = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/u)
  .refine((value) => BigInt(value) <= 2147483647n)
const identitySchema = z
  .object({
    tenantId: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^\s\x00-\x1f\x7f]+$/u),
    subjectId: ascii,
    requestId: ascii,
  })
  .strict()
const page = { limit: z.number().int().min(1).max(100).optional(), cursor: cursor.optional() }
const command = { profileId: opaque, commandId: ascii, expectedStateVersion: version.refine((value) => BigInt(value) <= 2147483646n), reasonCode: reason }
const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list"), ...page, ownerUserId: ascii.optional(), governanceStatus: status.optional() }).strict(),
  z.object({ kind: z.literal("get"), profileId: opaque }).strict(),
  z.object({ kind: z.literal("audit"), profileId: opaque, ...page }).strict(),
  z.object({ kind: z.literal("quarantine"), ...command }).strict(),
  z.object({ kind: z.literal("restore"), ...command }).strict(),
  z.object({ kind: z.literal("revoke"), ...command }).strict(),
])
export type CustomApiAdminInput = Readonly<z.infer<typeof inputSchema>>
const currentProfile = z
  .object({
    profile_id: opaque,
    owner_user_id: ascii,
    name: z.string().min(1).max(400),
    governance_status: status,
    state_version: version,
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict()
const immutableAck = z
  .object({ profile_id: opaque, owner_user_id: ascii, governance_status: status, state_version: version, audit_ref: opaque, replayed: z.boolean() })
  .strict()
const auditEvent = z
  .object({
    audit_ref: opaque,
    profile_id: opaque,
    owner_user_id: ascii,
    actor_id: ascii,
    action: z.enum(["quarantined", "restored", "revoked", "deleted"]),
    from_status: status,
    to_status: z.enum(["active", "quarantined", "revoked", "deleted"]),
    from_version: version,
    to_version: version.optional(),
    command_id: ascii,
    request_id: ascii,
    reason_code: z.enum(["security_review", "policy_violation", "operator_request", "review_completed", "owner_delete"]),
    occurred_at: z.string().datetime(),
  })
  .strict()
export type CustomApiAdminResult =
  | Readonly<{ kind: "list"; items: readonly z.infer<typeof currentProfile>[]; next_cursor: string | null }>
  | Readonly<{ kind: "get"; profile: z.infer<typeof currentProfile> }>
  | Readonly<{ kind: "audit"; items: readonly z.infer<typeof auditEvent>[]; next_cursor: string | null }>
  | Readonly<{ kind: "quarantine" | "restore" | "revoke"; ack: z.infer<typeof immutableAck> }>
const invalid = () => new ConnectError("Custom API administration response invalid", Code.DataLoss)
function known(value: Message | undefined, schema: DescMessage): asserts value is Message {
  if (!value || value.$typeName !== schema.typeName || value.$unknown?.length) throw invalid()
  const keys = new Set(["$typeName", "$unknown", ...schema.fields.map((field) => field.localName)])
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.has(key))) throw invalid()
  for (const field of schema.fields) {
    const child = (value as Record<string, unknown>)[field.localName]
    if (field.fieldKind === "message" && child !== undefined) known(child as Message, field.message)
    else if (field.fieldKind === "list" && field.listKind === "message") {
      if (!Array.isArray(child)) throw invalid()
      for (const item of child) known(item as Message, field.message)
    }
  }
}
function timestamp(value: { seconds: bigint; nanos: number } | undefined): string {
  if (!value || value.seconds < -62135596800n || value.seconds > 253402300799n || !Number.isInteger(value.nanos) || value.nanos < 0 || value.nanos > 999999999)
    throw invalid()
  return new Date(Number(value.seconds) * 1000 + Math.floor(value.nanos / 1000000)).toISOString()
}
function profile(value: p.AdminCustomApiProfile | undefined) {
  if (!value) throw invalid()
  return currentProfile.parse({
    profile_id: value.profileId?.value,
    owner_user_id: value.ownerUserId,
    name: value.name,
    governance_status: value.governanceStatus,
    state_version: String(value.stateVersion),
    created_at: timestamp(value.createdAt),
    updated_at: timestamp(value.updatedAt),
  })
}
function nextCursor(value: { nextCursor?: string | undefined } | undefined): string | null {
  if (!value) throw invalid()
  return value.nextCursor === undefined ? null : cursor.parse(value.nextCursor)
}
function projectAudit(value: p.CustomApiAdminAuditEvent, profileId: string) {
  const item = auditEvent.parse({
    audit_ref: value.auditRef,
    profile_id: value.profileId?.value,
    owner_user_id: value.ownerUserId,
    actor_id: value.actorId,
    action: value.action,
    from_status: value.fromStatus,
    to_status: value.toStatus,
    from_version: String(value.fromVersion),
    ...(value.toVersion === undefined ? {} : { to_version: String(value.toVersion) }),
    command_id: value.commandId,
    request_id: value.requestId,
    reason_code: value.reasonCode,
    occurred_at: timestamp(value.occurredAt),
  })
  const valid =
    item.action === "deleted"
      ? item.to_status === "deleted" && item.to_version === undefined && item.reason_code === "owner_delete" && item.actor_id === item.owner_user_id
      : item.to_version === String(BigInt(item.from_version) + 1n) &&
        item.reason_code !== "owner_delete" &&
        ((item.action === "quarantined" && item.from_status === "active" && item.to_status === "quarantined") ||
          (item.action === "restored" && item.from_status === "quarantined" && item.to_status === "active") ||
          (item.action === "revoked" && item.from_status !== "revoked" && item.to_status === "revoked"))
  if (!valid || item.profile_id !== profileId) throw invalid()
  return item
}
function projectAck(value: p.CustomApiAdminAck | undefined, input: CustomApiAdminCommandInput) {
  if (!value) throw invalid()
  const ack = immutableAck.parse({
    profile_id: value.profileId?.value,
    owner_user_id: value.ownerUserId,
    governance_status: value.governanceStatus,
    state_version: String(value.stateVersion),
    audit_ref: value.auditRef,
    replayed: value.replayed,
  })
  const expectedStatus = { quarantine: "quarantined", restore: "active", revoke: "revoked" }[input.kind]
  if (ack.profile_id !== input.profileId || ack.state_version !== String(BigInt(input.expectedStateVersion) + 1n) || ack.governance_status !== expectedStatus)
    throw invalid()
  return ack
}

/** Internal RPC adapter only. Every caller must freshly admit the current tenant member/platformAdmin through IAM first. */
export class CustomApiAdminConnectClient {
  readonly #client
  readonly #active = new Set<AbortController>()
  #closed = false
  constructor(
    baseUrl: string,
    private readonly credentials: Pick<PlatformServiceCredentialSource, "get">,
  ) {
    this.#client = createClient(
      p.CustomApiAdminService,
      createConnectTransport({ baseUrl, httpVersion: "1.1", useBinaryFormat: true, readMaxBytes: 1_048_576, writeMaxBytes: 65_536 }),
    )
  }
  close(): void {
    this.#closed = true
    for (const controller of this.#active) controller.abort()
    this.#active.clear()
  }
  async execute(
    originalIdentity: CustomApiAdminIdentity,
    originalInput: CustomApiAdminInput,
    outer: AbortSignal,
    deadlineAt: number,
  ): Promise<CustomApiAdminResult> {
    if (this.#closed) throw new ConnectError("Custom API administration client closed", Code.Unavailable)
    if (!Number.isFinite(deadlineAt) || performance.now() >= deadlineAt)
      throw new ConnectError("Custom API administration deadline exceeded", Code.DeadlineExceeded)
    let identity: CustomApiAdminIdentity, input: CustomApiAdminInput
    try {
      identity = identitySchema.parse(originalIdentity)
      input = inputSchema.parse(originalInput)
    } catch {
      throw new ConnectError("Custom API administration request invalid", Code.InvalidArgument)
    }
    const deadline = Math.min(deadlineAt, performance.now() + 10_000),
      controller = new AbortController(),
      signal = AbortSignal.any([outer, controller.signal])
    const active = () => {
      if (this.#closed) throw new ConnectError("Custom API administration client closed", Code.Unavailable)
      if (performance.now() >= deadline || (signal.aborted && (signal.reason as { name?: unknown } | undefined)?.name === "TimeoutError"))
        throw new ConnectError("Custom API administration deadline exceeded", Code.DeadlineExceeded)
      if (signal.aborted) throw new ConnectError("Custom API administration request canceled", Code.Canceled)
    }
    const remaining = () => Math.max(1, Math.ceil(deadline - performance.now()))
    const timer = setTimeout(() => controller.abort(new DOMException("Custom API administration deadline", "TimeoutError")), remaining())
    timer.unref()
    this.#active.add(controller)
    try {
      active()
      const token = await this.credentials.get(identity.tenantId, signal, deadline)
      active()
      let requestId: string | null = null,
        canonicalRequestId: string | null = null,
        cache: string | null = null
      const options = {
        signal,
        timeoutMs: remaining(),
        headers: {
          authorization: `Bearer ${token}`,
          "x-kokoro-tenant": identity.tenantId,
          "x-kokoro-subject": identity.subjectId,
          "x-kokoro-request-id": identity.requestId,
        },
        onHeader: (headers: Headers) => {
          requestId = headers.get("x-kokoro-request-id")
          canonicalRequestId = headers.get("x-request-id")
          cache = headers.get("cache-control")
        },
      }
      const checked = <T extends Message>(value: T, schema: DescMessage): T => {
        active()
        if (requestId !== identity.requestId || canonicalRequestId !== identity.requestId || cache !== "no-store") throw invalid()
        known(value, schema)
        return value
      }
      const scope = { requestId: identity.requestId }
      const page = { limit: "limit" in input ? (input.limit ?? 50) : 50, ...("cursor" in input && input.cursor !== undefined ? { cursor: input.cursor } : {}) }
      if (input.kind === "list") {
        const value = checked(
          await this.#client.listAdminCustomApis(
            {
              ...scope,
              page,
              ...(input.ownerUserId === undefined ? {} : { ownerUserId: input.ownerUserId }),
              ...(input.governanceStatus === undefined ? {} : { governanceStatus: input.governanceStatus }),
            },
            options,
          ),
          p.ListAdminCustomApisResponseSchema,
        )
        if (value.profiles.length > page.limit) throw invalid()
        const items = value.profiles.map(profile)
        if (
          new Set(items.map((item) => item.profile_id)).size !== items.length ||
          items.some(
            (item) =>
              (input.ownerUserId !== undefined && item.owner_user_id !== input.ownerUserId) ||
              (input.governanceStatus !== undefined && item.governance_status !== input.governanceStatus),
          )
        )
          throw invalid()
        return { kind: "list", items, next_cursor: nextCursor(value.page) }
      }
      const target = { ...scope, profileId: { value: input.profileId } }
      if (input.kind === "get") {
        const value = checked(await this.#client.getAdminCustomApi(target, options), p.GetAdminCustomApiResponseSchema),
          item = profile(value.profile)
        if (item.profile_id !== input.profileId) throw invalid()
        return { kind: "get", profile: item }
      }
      if (input.kind === "audit") {
        // Audit retention is independent of profile lifetime; never preflight a current Get.
        const value = checked(await this.#client.listAdminCustomApiAuditEvents({ ...target, page }, options), p.ListAdminCustomApiAuditEventsResponseSchema)
        if (value.events.length > page.limit) throw invalid()
        const items = value.events.map((item) => projectAudit(item, input.profileId))
        if (new Set(items.map((item) => item.audit_ref)).size !== items.length) throw invalid()
        return { kind: "audit", items, next_cursor: nextCursor(value.page) }
      }
      const mutation = {
        ...target,
        command: bindCustomApiAdminCommand(identity, input),
        expectedStateVersion: BigInt(input.expectedStateVersion),
        reasonCode: input.reasonCode,
      }
      const value =
        input.kind === "quarantine"
          ? checked(await this.#client.quarantineAdminCustomApi(mutation, options), p.QuarantineAdminCustomApiResponseSchema)
          : input.kind === "restore"
            ? checked(await this.#client.restoreAdminCustomApi(mutation, options), p.RestoreAdminCustomApiResponseSchema)
            : checked(await this.#client.revokeAdminCustomApi(mutation, options), p.RevokeAdminCustomApiResponseSchema)
      // Immutable receipt projection, not a fresh eligibility/current profile read.
      return { kind: input.kind, ack: projectAck(value.ack, input) }
    } catch (error) {
      active()
      const code =
        error instanceof z.ZodError
          ? Code.DataLoss
          : error instanceof ConnectError && ![Code.Unauthenticated, Code.PermissionDenied, Code.Unknown].includes(error.code)
            ? error.code
            : Code.Unavailable
      const reason = error instanceof ConnectError ? error.metadata.get("x-kokoro-error-code") : null
      const receipt = Object.values(PLATFORM_COMMAND_RECEIPT_ERRORS).find((item) => item.error_code === reason)
      const safeReason =
        "commandId" in input && error instanceof ConnectError && error.details.length === 0 && receipt?.rpc_code === error.code ? reason : undefined
      // A marker claims the closed receipt profile; malformed claims are response corruption,
      // not ordinary domain conflicts/preconditions with their classification silently erased.
      if (reason !== null && safeReason === undefined) throw invalid()
      throw new ConnectError("Custom API administration request failed", code, safeReason ? { "x-kokoro-error-code": safeReason } : undefined)
    } finally {
      clearTimeout(timer)
      this.#active.delete(controller)
    }
  }
}
