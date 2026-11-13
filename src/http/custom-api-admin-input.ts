import type { IncomingMessage } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import { z } from "zod"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import type { CustomApiAdminInput } from "../infrastructure/clients/platform/custom-api-admin-connect.js"

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const ascii = /^[\x21-\x7e]{1,191}$/u
const mutationSchema = z
  .object({
    expected_state_version: z
      .string()
      .regex(/^[1-9][0-9]{0,9}$/u)
      .refine((value) => BigInt(value) <= 2147483646n),
    reason_code: z.enum(["security_review", "policy_violation", "operator_request", "review_completed"]),
  })
  .strict()
const invalid = () => new ConnectError("Invalid Custom API administration request", Code.InvalidArgument)
export type CustomApiAdminTarget = Readonly<{ kind: CustomApiAdminInput["kind"]; profileId?: string }>

export function customApiAdminTarget(path: readonly string[], method: string): CustomApiAdminTarget | null {
  if (path[0] !== "v1" || path[1] !== "admin" || path[2] !== "custom-apis") return null
  if (method === "GET" && path.length === 3) return { kind: "list" }
  if (method === "GET" && path.length === 4) return { kind: "get", profileId: path[3]! }
  if (path.length !== 5) return null
  if (method === "GET" && path[4] === "audit-events") return { kind: "audit", profileId: path[3]! }
  if (method === "POST" && (path[4] === "quarantine" || path[4] === "restore" || path[4] === "revoke")) return { kind: path[4], profileId: path[3]! }
  return null
}
function header(request: IncomingMessage, name: string): string | null {
  const values = request.rawHeaders.flatMap((key, index) => (index % 2 === 0 && key.toLowerCase() === name ? [request.rawHeaders[index + 1] ?? ""] : []))
  return values.length === 1 ? values[0]! : null
}
export function parseCustomApiAdminHead(request: IncomingMessage, target: CustomApiAdminTarget, path: readonly string[]) {
  const url = new URL(request.url ?? "", "http://bff.invalid")
  const allowed = target.kind === "list" ? ["limit", "cursor", "owner_user_id", "governance_status"] : target.kind === "audit" ? ["limit", "cursor"] : []
  const mutation = target.kind === "quarantine" || target.kind === "restore" || target.kind === "revoke"
  if (
    url.pathname !== "/" + path.map(encodeURIComponent).join("/") ||
    url.hash ||
    (target.profileId !== undefined && !identifier.test(target.profileId)) ||
    [...url.searchParams.keys()].some((key) => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
  )
    throw invalid()
  const query = url.searchParams
  if (
    (query.has("limit") && !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(query.get("limit")!)) ||
    (query.has("cursor") && !/^[A-Za-z0-9_-]{1,2048}$/u.test(query.get("cursor")!)) ||
    (query.has("owner_user_id") && !ascii.test(query.get("owner_user_id")!)) ||
    (query.has("governance_status") && !["active", "quarantined", "revoked"].includes(query.get("governance_status")!))
  )
    throw invalid()
  if (!mutation) {
    if (["content-type", "content-length", "transfer-encoding", "idempotency-key"].some((name) => request.headers[name] !== undefined)) throw invalid()
    return { mutation: false as const, length: 0, commandId: undefined, query }
  }
  const length = header(request, "content-length"),
    key = header(request, "idempotency-key"),
    type = header(request, "content-type")
  if (
    request.headers["transfer-encoding"] !== undefined ||
    !length ||
    !/^(?:0|[1-9][0-9]*)$/u.test(length) ||
    Number(length) > 4096 ||
    !key ||
    !ascii.test(key) ||
    !type ||
    !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(type)
  )
    throw invalid()
  return { mutation: true as const, length: Number(length), commandId: key, query }
}
export function parseCustomApiAdminInput(target: CustomApiAdminTarget, head: ReturnType<typeof parseCustomApiAdminHead>, raw: Buffer): CustomApiAdminInput {
  try {
    if (target.kind === "get") return { kind: "get", profileId: target.profileId! }
    if (target.kind === "list" || target.kind === "audit") {
      const page = {
        ...(head.query.has("limit") ? { limit: Number(head.query.get("limit")) } : {}),
        ...(head.query.has("cursor") ? { cursor: head.query.get("cursor")! } : {}),
      }
      return target.kind === "audit"
        ? { kind: "audit", profileId: target.profileId!, ...page }
        : {
            kind: "list",
            ...page,
            ...(head.query.has("owner_user_id") ? { ownerUserId: head.query.get("owner_user_id")! } : {}),
            ...(head.query.has("governance_status") ? { governanceStatus: head.query.get("governance_status")! as "active" | "quarantined" | "revoked" } : {}),
          }
    }
    if (!head.mutation || raw.byteLength !== head.length) throw invalid()
    const body = mutationSchema.parse(strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(raw)))
    return {
      kind: target.kind,
      profileId: target.profileId!,
      commandId: head.commandId,
      expectedStateVersion: body.expected_state_version,
      reasonCode: body.reason_code,
    }
  } catch {
    throw invalid()
  }
}
/** Feature-owned bounded body reader shares cancellation with admission and the RPC. */
export async function readCustomApiAdminBody(request: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  if (request.readableEnded) return Buffer.alloc(0)
  if (request.destroyed) throw new ConnectError("Custom API administration input canceled", Code.Canceled)
  return new Promise((resolve, reject) => {
    let size = 0,
      settled = false
    const chunks: Buffer[] = []
    const cleanup = () => {
      request.off("data", data)
      request.off("end", end)
      request.off("aborted", aborted)
      signal.removeEventListener("abort", aborted)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      chunks.length = 0
      request.pause()
      reject(error)
    }
    const aborted = () => fail(new ConnectError("Custom API administration input canceled", Code.Canceled))
    const data = (raw: Buffer | string) => {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      size += chunk.byteLength
      if (size > 4096) {
        fail(invalid())
        return
      }
      chunks.push(chunk)
    }
    const end = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    request.on("error", fail)
    request.once("close", () => {
      if (!settled) aborted()
      request.off("error", fail)
    })
    request.on("data", data)
    request.once("end", end)
    request.once("aborted", aborted)
    signal.addEventListener("abort", aborted, { once: true })
    if (signal.aborted) aborted()
  })
}
