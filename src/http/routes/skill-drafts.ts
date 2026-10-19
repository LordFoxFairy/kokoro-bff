import type { IncomingMessage, ServerResponse } from "node:http"
import { createHash } from "node:crypto"
import { Code, ConnectError } from "@connectrpc/connect"
import { ZodError } from "zod"
import type { JsonValue } from "@bufbuild/protobuf"
import type { RequestContext } from "../../domain/request-context.js"
import type { SkillProductConnectClient, SkillProductCommand } from "../../infrastructure/clients/platform/skill-product-connect.js"
import { projectSkillProductAck } from "../../infrastructure/clients/platform/skill-product-response.js"
import { parseSkillProductInput, skillMetadataInputSchema, skillIdSchema } from "../skill-product-input.js"
import { send } from "../response.js"

// The request owns one monotonic budget from admission through bytes and enrichment.
const requestDeadlines = new WeakMap<IncomingMessage, number>()
export function startSkillRequestBudget(request: IncomingMessage, timeoutMs = 10_000): number {
  const current = requestDeadlines.get(request)
  if (current !== undefined) return current
  const deadlineAt = performance.now() + timeoutMs
  requestDeadlines.set(request, deadlineAt)
  return deadlineAt
}
export function skillRequestRemaining(request: IncomingMessage): number {
  return Math.max(0, startSkillRequestBudget(request) - performance.now())
}

/** Bounded reader does not destroy the incoming stream before its closed 413 reply. */
export async function readSkillBody(request: IncomingMessage, maxBytes = 65_536, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted()
  if (skillRequestRemaining(request) <= 0) throw new ConnectError("Skill input deadline exceeded", Code.DeadlineExceeded)
  if (request.readableEnded) return Buffer.alloc(0)
  if (request.destroyed) throw new ConnectError("Skill input cancelled", Code.Canceled)
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0,
      settled = false
    const cleanup = () => {
      clearTimeout(timer)
      request.off("data", data)
      request.off("end", end)
      request.off("aborted", aborted)
      signal?.removeEventListener("abort", aborted)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      chunks.length = 0
      request.pause()
      reject(error)
    }
    const aborted = () => fail(signal?.reason ?? new ConnectError("Skill input cancelled", Code.Canceled))
    const data = (chunk: Buffer | string) => {
      if (skillRequestRemaining(request) <= 0) return fail(new ConnectError("Skill input deadline exceeded", Code.DeadlineExceeded))
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > maxBytes) {
        fail(new Error("request_body_too_large"))
        request.resume()
        return
      }
      chunks.push(buffer)
    }
    const end = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const timer = setTimeout(() => fail(new ConnectError("Skill input deadline exceeded", Code.DeadlineExceeded)), skillRequestRemaining(request))
    // Keep a transport error listener until close: aborted can precede ECONNRESET.
    request.on("error", fail)
    request.once("close", () => {
      if (!settled) fail(new ConnectError("Skill input cancelled", Code.Canceled))
      request.off("error", fail)
    })
    request.once("end", end)
    request.once("aborted", aborted)
    signal?.addEventListener("abort", aborted, { once: true })
    request.on("data", data)
    if (signal?.aborted) aborted()
  })
}
export function skillCommandId(request: IncomingMessage, context: RequestContext, operation: string): string {
  const values = request.rawHeaders.flatMap((name, index) =>
    index % 2 === 0 && name.toLowerCase() === "idempotency-key" ? [request.rawHeaders[index + 1] ?? ""] : [],
  )
  if (values.length !== 1 || !/^[\x21-\x2B\x2D-\x7E]{1,128}$/u.test(values[0]!)) throw new ConnectError("Single Idempotency-Key required", Code.InvalidArgument)
  return `bff.skill.${createHash("sha256")
    .update(JSON.stringify(["product9", operation, context.identity.namespace, context.identity.userId, values[0]]))
    .digest("hex")}`
}
export function skillMetadataWire(input: import("zod").infer<typeof skillMetadataInputSchema>): Record<string, JsonValue> {
  return {
    display_name: input.display_name,
    summary: input.summary,
    tags: input.tags,
    metadata_json: "e30",
    ...(input.example_prompts === undefined ? {} : { example_prompts: { prompts: input.example_prompts } }),
    ...(input.category_keys === undefined ? {} : { category_keys: { keys: input.category_keys } }),
  }
}
export function assertSkillReadRequest(request: IncomingMessage, allowedQuery: readonly string[] = []): URLSearchParams {
  if (request.headers["content-length"] !== undefined || request.headers["transfer-encoding"] !== undefined || request.headers["idempotency-key"] !== undefined)
    throw new ConnectError("Read body/header forbidden", Code.InvalidArgument)
  const query = new URL(request.url ?? "/", "http://bff.local").searchParams
  if ([...query.keys()].some((key) => !allowedQuery.includes(key) || query.getAll(key).length !== 1 || query.get(key) === ""))
    throw new ConnectError("Query invalid", Code.InvalidArgument)
  return query
}
export async function runSkillRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  handler: (signal: AbortSignal, deadlineAt: number) => Promise<void>,
  errorPolicy: "default" | "exact-download" | "admin" = "default",
): Promise<void> {
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("cache-control", "no-store")
  const cancellation = new AbortController(),
    budget = new AbortController()
  const signal = AbortSignal.any([cancellation.signal, budget.signal]),
    deadlineAt = startSkillRequestBudget(request)
  const timer = setTimeout(() => budget.abort(new Error("skill_deadline")), skillRequestRemaining(request))
  const cancel = () => {
    if (!response.writableEnded) cancellation.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  try {
    if (deadlineAt <= performance.now()) throw new Error("skill_deadline")
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener("abort", abort, { once: true })
      void handler(signal, deadlineAt)
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort))
      if (signal.aborted) abort()
    })
  } catch (error) {
    if (response.destroyed || cancellation.signal.aborted || response.writableEnded) return
    if (response.headersSent) {
      response.destroy()
      return
    }
    let status = 503,
      code = "skill_dependency_unavailable",
      retryable = true
    if (errorPolicy === "exact-download") {
      if (error instanceof Error && (error.message === "skill_deadline" || (error instanceof ConnectError && error.code === Code.DeadlineExceeded))) {
        status = 504
        code = "skill_deadline_exceeded"
      } else if (error instanceof ZodError || error instanceof SyntaxError || (error instanceof ConnectError && error.code === Code.InvalidArgument)) {
        status = 400
        code = "invalid_skill_request"
        retryable = false
      } else if (error instanceof Error && /response_invalid/u.test(error.message)) {
        status = 502
        code = "skill_response_invalid"
        retryable = false
      } else if (error instanceof ConnectError && error.code === Code.Unauthenticated) {
        status = 401
        code = "session_authentication_required"
        retryable = false
      } else if (error instanceof ConnectError && error.code === Code.PermissionDenied) {
        status = 403
        code = "skill_download_forbidden"
        retryable = false
      } else if (error instanceof ConnectError && error.code === Code.NotFound) {
        status = 404
        code = "skill_not_found"
        retryable = false
      } else if (error instanceof ConnectError && error.code === Code.ResourceExhausted) {
        status = 429
        code = "skill_rate_limited"
      }
    } else if (errorPolicy === "admin" && error instanceof ConnectError && [Code.Unauthenticated, Code.PermissionDenied].includes(error.code)) {
      status = 403
      code = "service_auth_failed"
      retryable = false
    } else if (error instanceof Error && error.message === "request_body_too_large") {
      status = 413
      code = "request_body_too_large"
      retryable = false
    } else if (error instanceof Error && ["skill_not_found", "skill_idempotency_conflict", "skill_command_in_progress"].includes(error.message)) {
      status = error.message === "skill_not_found" ? 404 : 409
      code = error.message
      retryable = error.message === "skill_command_in_progress"
    } else if (error instanceof ZodError || error instanceof SyntaxError || (error instanceof ConnectError && error.code === Code.InvalidArgument)) {
      status = 400
      code = "invalid_skill_request"
      retryable = false
    } else if (error instanceof Error && /response_invalid/u.test(error.message)) {
      status = 502
      code = "skill_response_invalid"
      retryable = false
    } else if (error instanceof ConnectError) {
      if (error.code === Code.NotFound) {
        status = 404
        code = "skill_not_found"
        retryable = false
      } else if ([Code.AlreadyExists, Code.Aborted].includes(error.code)) {
        status = 409
        code = error.code === Code.Aborted ? "skill_command_in_progress" : "skill_idempotency_conflict"
        retryable = error.code === Code.Aborted
      } else if (error.code === Code.FailedPrecondition) {
        status = 412
        code = "skill_precondition_failed"
        retryable = false
      } else if (error.code === Code.ResourceExhausted) {
        status = 429
        code = "skill_rate_limited"
      }
    }
    send(response, status, { error: { code, message: "Skill request did not complete", retryable } })
  } finally {
    clearTimeout(timer)
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
export async function skillDraftsRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  skillId: string,
  operation: "update" | "discard" | "audience",
  client: SkillProductConnectClient | null,
) {
  await runSkillRoute(request, response, context, async (signal, deadlineAt) => {
    skillIdSchema.parse(skillId)
    if (new URL(request.url!, "http://bff.local").search !== "" || request.headers["content-type"]?.split(";", 1)[0] !== "application/json")
      throw new ConnectError("Invalid request", Code.InvalidArgument)
    const commandId = skillCommandId(request, context, operation)
    const input = parseSkillProductInput(operation, await readSkillBody(request, 65_536))
    const methods: Record<typeof operation, SkillProductCommand> = {
      update: "updateSkillDraft",
      discard: "discardSkillDraft",
      audience: "setSkillPublicationAudience",
    }
    const members = { ...input, skill_id: { value: skillId }, ...("metadata" in input ? { metadata: skillMetadataWire(input.metadata) } : {}) } as Record<
      string,
      JsonValue
    >
    if (!client) throw new ConnectError("Skill dependency missing", Code.Unavailable)
    const result = await client.command(
      methods[operation],
      { requestId: context.requestId, tenant: context.identity.namespace, subject: context.identity.userId, commandId },
      members,
      signal,
      deadlineAt,
    )
    signal.throwIfAborted()
    send(response, 200, { data: projectSkillProductAck(result as Parameters<typeof projectSkillProductAck>[0], skillId) })
  })
}
