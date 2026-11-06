import { z } from "zod"
import { sha256Jcs } from "./jcs.js"
import { assertMcpPersonalWireKnown, type McpPersonalInput } from "./mcp-personal-response.js"
import { strictParseRawJson } from "../../raw-json.js"

export const mcpIconId = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u)
const decimal = (maximum: bigint) =>
  z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/u)
    .refine((v) => BigInt(v) <= maximum)
const version = decimal(2147483646n)
const mime = z.enum(["image/png", "image/jpeg"])
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
export const mcpIconSelection = z.object({ intent_id: mcpIconId, expected_state_version: version }).strict()
export type McpIconSelection = Readonly<{ intentId: string; expectedStateVersion: string }>
export type McpIconSaveFields = { icon?: McpIconSelection; clearIcon?: boolean }
export function iconSaveDigest(input: McpIconSaveFields): Record<string, unknown> {
  return input.icon === undefined
    ? input.clearIcon === true
      ? { icon_change: { clear: true } }
      : {}
    : { icon_change: { intent_id: input.icon.intentId, expected_state_version: input.icon.expectedStateVersion } }
}
export function iconSaveWire(input: McpIconSaveFields) {
  return input.icon === undefined
    ? input.clearIcon === true
      ? { iconChange: { case: "clearIcon" as const, value: true } }
      : {}
    : { iconChange: { case: "icon" as const, value: { intentId: input.icon.intentId, expectedStateVersion: BigInt(input.icon.expectedStateVersion) } } }
}
export function iconCreateWire(input: McpIconSaveFields) {
  return input.icon === undefined ? {} : { icon: { intentId: input.icon.intentId, expectedStateVersion: BigInt(input.icon.expectedStateVersion) } }
}
export type McpIconOperation = "beginIcon" | "completeIcon" | "getIcon" | "cancelIcon" | "importIcon"
export type McpIconInput = McpPersonalInput & {
  commandId?: string
  intentId?: string
  expectedStateVersion?: string
  filename?: string
  mimeType?: "image/png" | "image/jpeg"
  contentSha256?: string
  sizeBytes?: string
  sourceVersionId?: string
  imageUrl?: string
}
const selection = { expected_state_version: version }
const filename = z
  .string()
  .refine((v) => v.trim() === v && v.length > 0 && Buffer.byteLength(v) <= 255 && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(v))
const bodies = {
  beginIcon: z.object({ filename, mime_type: mime, content_sha256: digest, size_bytes: decimal(1048576n) }).strict(),
  completeIcon: z
    .object({
      ...selection,
      source_version_id: z
        .string()
        .regex(/^[\x21-\x7e]{1,1024}$/u)
        .refine((v) => v !== "null"),
    })
    .strict(),
  cancelIcon: z.object(selection).strict(),
  importIcon: z
    .object({
      image_url: z
        .string()
        .max(4096)
        .refine((v) => {
          try {
            const u = new URL(v)
            return (
              v.trim() === v &&
              /^https:\/\//iu.test(v) &&
              !/[\\#\u0000-\u0020\u007f-\u009f\ud800-\udfff]/u.test(v) &&
              !u.username &&
              !u.password &&
              !v
                .slice(v.indexOf("://") + 3)
                .split(/[/?#]/u)[0]
                ?.includes("@")
            )
          } catch {
            return false
          }
        }),
    })
    .strict(),
}
export function parseMcpIcon(operation: Exclude<McpIconOperation, "getIcon">, bytes: Uint8Array): Partial<McpIconInput> {
  try {
    const value = bodies[operation].parse(strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
    return {
      ...("filename" in value ? { filename: value.filename, mimeType: value.mime_type, contentSha256: value.content_sha256, sizeBytes: value.size_bytes } : {}),
      ...("expected_state_version" in value ? { expectedStateVersion: value.expected_state_version } : {}),
      ...("source_version_id" in value && typeof value.source_version_id === "string" ? { sourceVersionId: value.source_version_id } : {}),
      ...("image_url" in value ? { imageUrl: value.image_url } : {}),
    }
  } catch {
    throw new Error("invalid_mcp_personal_request")
  }
}
const methods = {
  beginIcon: "BeginPersonalMcpIconUpload",
  completeIcon: "CompletePersonalMcpIconUpload",
  cancelIcon: "CancelPersonalMcpIconIntent",
  importIcon: "ImportPersonalMcpIconUrl",
}
export function bindMcpIcon(operation: Exclude<McpIconOperation, "getIcon">, input: McpIconInput) {
  const body =
    operation === "beginIcon"
      ? { filename: input.filename, mime_type: input.mimeType, content_sha256: input.contentSha256, size_bytes: input.sizeBytes }
      : operation === "importIcon"
        ? { image_url: input.imageUrl }
        : {
            intent_id: input.intentId,
            expected_state_version: input.expectedStateVersion,
            ...(operation === "completeIcon" ? { source_version_id: input.sourceVersionId } : {}),
          }
  return {
    commandId: input.commandId!,
    requestDigest: sha256Jcs({
      operation: `kokoro.platform.v1.ProductMcpPersonalService/${methods[operation]}`,
      tenant_id: input.tenant,
      subject_id: input.subject,
      input: body,
    }).sha256,
  }
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("mcp_personal_response_invalid")
  return value as Record<string, unknown>
}
function timestamp(value: unknown): string {
  const t = record(value)
  if (typeof t.seconds !== "bigint" || typeof t.nanos !== "number" || !Number.isInteger(t.nanos) || t.nanos < 0 || t.nanos > 999999999)
    throw new Error("mcp_personal_response_invalid")
  return new Date(Number(t.seconds) * 1000 + Math.floor(t.nanos / 1000000)).toISOString()
}
const date = z.string().datetime()
const referenceUrl = z.string().refine((v) => {
  try {
    const u = new URL(v)
    return (
      !u.username &&
      !u.password &&
      !u.hash &&
      (u.protocol === "https:" || (process.env.NODE_ENV !== "production" && u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
    )
  } catch {
    return false
  }
})
export const mcpIconReferenceSchema = z
  .object({
    url: referenceUrl,
    method: z.enum(["GET", "PUT"]),
    required_headers: z.record(
      z.string(),
      z.string().refine((v) => !/[\0\r\n]/u.test(v)),
    ),
    expires_at: date,
  })
  .strict()
  .refine((v) =>
    Object.keys(v.required_headers).every((k) => /^[!#$%&'*+.^_`|~0-9a-z-]+$/u.test(k) && !["authorization", "cookie", "proxy-authorization"].includes(k)),
  )
function reference(raw: unknown, method: "GET" | "PUT") {
  const v = record(raw)
  const parsed = mcpIconReferenceSchema.parse({ url: v.url, method: v.method, required_headers: v.requiredHeaders, expires_at: timestamp(v.expiresAt) })
  if (parsed.method !== method || (method === "GET" && Object.keys(parsed.required_headers).length !== 0)) throw new Error("mcp_personal_response_invalid")
  return parsed
}
const dimensions = { width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096) }
export const mcpIconBindingSchema = z
  .object({
    intent_id: mcpIconId,
    content_sha256: digest,
    mime_type: mime,
    size_bytes: decimal(1048576n),
    ...dimensions,
    preview_reference: mcpIconReferenceSchema.optional(),
  })
  .strict()
export function projectMcpIconBinding(raw: unknown) {
  assertMcpPersonalWireKnown(raw)
  const v = record(raw)
  return mcpIconBindingSchema.parse({
    intent_id: v.intentId,
    content_sha256: v.contentSha256,
    mime_type: v.mimeType,
    size_bytes: typeof v.sizeBytes === "bigint" ? String(v.sizeBytes) : undefined,
    width: v.width,
    height: v.height,
    ...(v.previewReference === undefined ? {} : { preview_reference: reference(v.previewReference, "GET") }),
  })
}
const intent = z
  .object({
    intent_id: mcpIconId,
    state: z.enum(["staged", "completing", "ready", "bound", "retiring", "released"]),
    state_version: decimal(2147483647n),
    filename,
    mime_type: mime,
    content_sha256: digest,
    size_bytes: decimal(1048576n),
    expires_at: date,
    expired: z.boolean(),
    width: dimensions.width.optional(),
    height: dimensions.height.optional(),
    created_at: date,
    updated_at: date,
  })
  .strict()
  .refine((v) => (v.width === undefined) === (v.height === undefined) && (!["ready", "bound"].includes(v.state) || v.width !== undefined))
export function projectMcpIcon(operation: McpIconOperation, raw: unknown, input: McpIconInput): unknown {
  assertMcpPersonalWireKnown(raw)
  const v = record(raw),
    i = record(v.intent)
  const item = intent.parse({
    intent_id: i.intentId,
    state: typeof i.state === "number" ? ["", "staged", "completing", "ready", "bound", "retiring", "released"][i.state] : undefined,
    state_version: typeof i.stateVersion === "bigint" ? String(i.stateVersion) : undefined,
    filename: i.filename,
    mime_type: i.mimeType,
    content_sha256: i.contentSha256,
    size_bytes: typeof i.sizeBytes === "bigint" ? String(i.sizeBytes) : undefined,
    expires_at: timestamp(i.expiresAt),
    expired: i.expired,
    ...(i.width === undefined ? {} : { width: i.width }),
    ...(i.height === undefined ? {} : { height: i.height }),
    created_at: timestamp(i.createdAt),
    updated_at: timestamp(i.updatedAt),
  })
  if (input.intentId !== undefined && item.intent_id !== input.intentId) throw new Error("mcp_personal_response_invalid")
  if (operation !== "getIcon" && typeof v.replayed !== "boolean") throw new Error("mcp_personal_response_invalid")
  if (
    (operation === "cancelIcon" && item.state !== "released") ||
    ((operation === "completeIcon" || operation === "importIcon") &&
      (!["ready", "bound", "retiring", "released"].includes(item.state) || item.width === undefined)) ||
    ((operation === "completeIcon" || operation === "cancelIcon") &&
      (input.expectedStateVersion === undefined || BigInt(item.state_version) <= BigInt(input.expectedStateVersion))) ||
    (operation === "beginIcon" && v.uploadReference !== undefined && (item.state !== "staged" || item.expired))
  )
    throw new Error("mcp_personal_response_invalid")
  if (
    operation === "beginIcon" &&
    ((input.filename !== undefined && item.filename !== input.filename) ||
      (input.mimeType !== undefined && item.mime_type !== input.mimeType) ||
      (input.contentSha256 !== undefined && item.content_sha256 !== input.contentSha256) ||
      (input.sizeBytes !== undefined && item.size_bytes !== input.sizeBytes))
  )
    throw new Error("mcp_personal_response_invalid")
  if (operation === "getIcon" && v.previewReference !== undefined && (item.state !== "ready" || item.expired)) throw new Error("mcp_personal_response_invalid")
  return {
    intent: item,
    ...(operation === "getIcon" ? {} : { replayed: v.replayed }),
    ...(operation === "beginIcon" && v.uploadReference !== undefined ? { upload_reference: reference(v.uploadReference, "PUT") } : {}),
    ...(operation === "getIcon" && v.previewReference !== undefined ? { preview_reference: reference(v.previewReference, "GET") } : {}),
  }
}
