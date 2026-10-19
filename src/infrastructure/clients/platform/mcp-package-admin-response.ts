import type { DescMessage, Message } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import * as p from "../../../generated/platform-connect/kokoro/platform/v1/mcp_package_admin_pb.js"
import type { McpPackageAdminInput } from "./mcp-package-admin-input.js"
const invalid = () => new ConnectError("MCP package administration response invalid", Code.DataLoss)
function known(value: Message | undefined, schema: DescMessage): asserts value is Message {
  if (!value || value.$typeName !== schema.typeName || value.$unknown?.length) throw invalid()
  const keys = new Set(["$typeName", "$unknown", ...schema.fields.map((field) => field.localName)])
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.has(key))) throw invalid()
  for (const field of schema.fields)
    if (field.fieldKind === "message") {
      const child = (value as Record<string, unknown>)[field.localName]
      if (child !== undefined) known(child as Message, field.message)
    }
}
function id(value: string, max = 191): string {
  if (typeof value !== "string" || !value || value.length > max || /^[\x21-\x7e]+$/u.exec(value)?.[0] !== value) throw invalid()
  return value
}
const states = new Map<p.McpPackageUploadState, McpPackageUploadView["state"]>([
  [p.McpPackageUploadState.PENDING, "pending"],
  [p.McpPackageUploadState.COMPLETED, "completed"],
  [p.McpPackageUploadState.ABORTED, "aborted"],
] as const)
const scans = new Map<p.McpPackageScanState, Exclude<McpPackageUploadView["scan_state"], null>>([
  [p.McpPackageScanState.CLEAN, "clean"],
  [p.McpPackageScanState.PENDING, "pending"],
  [p.McpPackageScanState.INFECTED, "infected"],
  [p.McpPackageScanState.UNKNOWN, "unknown"],
] as const)
export type McpPackageUploadView = Readonly<{
  upload_id: string
  state: "pending" | "completed" | "aborted"
  content_sha256: string
  size_bytes: string
  upload_source_version_id?: string
  asset_id?: string
  scan_state: "clean" | "pending" | "infected" | "unknown" | null
}>
export type McpPackageAdminResult =
  | Readonly<{
      kind: "begin"
      package_id: string
      upload_id: string
      transfer_reference: { url: string; method: "PUT"; required_headers: Readonly<Record<string, string>>; expires_at: string }
    }>
  | Readonly<{ kind: "complete" | "status"; upload: McpPackageUploadView }>
  | Readonly<{ kind: "abort"; upload_id: string; state: "aborted" }>
  | Readonly<{ kind: "publish"; package_version_id: string; server_id: string; replayed: boolean }>
function snapshot(value: p.McpPackageUploadSnapshot | undefined, input: Extract<McpPackageAdminInput, { kind: "complete" | "status" }>): McpPackageUploadView {
  if (
    !value ||
    value.uploadId !== input.uploadId ||
    value.contentSha256.length !== 64 ||
    !/^[a-f0-9]{64}$/u.test(value.contentSha256) ||
    value.sizeBytes < 1n ||
    value.sizeBytes > 33_554_432n
  )
    throw invalid()
  const state = states.get(value.state),
    scan = scans.get(value.scanState)
  if (
    !state ||
    (state === "completed" && (!value.assetId || !value.uploadSourceVersionId)) ||
    (value.assetId === undefined ? value.scanState !== p.McpPackageScanState.UNSPECIFIED : !scan)
  )
    throw invalid()
  if (
    input.kind === "complete" &&
    (state !== "completed" ||
      value.uploadSourceVersionId !== input.uploadSourceVersionId ||
      value.contentSha256 !== input.contentSha256 ||
      value.sizeBytes.toString() !== input.sizeBytes)
  )
    throw invalid()
  return {
    upload_id: value.uploadId,
    state,
    content_sha256: value.contentSha256,
    size_bytes: value.sizeBytes.toString(),
    ...(value.uploadSourceVersionId === undefined ? {} : { upload_source_version_id: id(value.uploadSourceVersionId, 512) }),
    ...(value.assetId === undefined ? {} : { asset_id: id(value.assetId) }),
    scan_state: scan ?? null,
  }
}
function transfer(value: p.McpPackageUploadTransfer | undefined) {
  if (!value?.expiresAt || value.method !== "PUT" || value.expiresAt.nanos < 0 || value.expiresAt.nanos > 999_999_999) throw invalid()
  let url: URL
  try {
    url = new URL(value.url)
  } catch {
    throw invalid()
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || value.url.length > 32_768) throw invalid()
  const time = Number(value.expiresAt.seconds) * 1000 + Math.floor(value.expiresAt.nanos / 1_000_000),
    date = new Date(time)
  if (!Number.isFinite(date.getTime()) || time <= Date.now()) throw invalid()
  const headers: Record<string, string> = {}
  if (Object.keys(value.requiredHeaders).length > 32) throw invalid()
  for (const [name, content] of Object.entries(value.requiredHeaders)) {
    if (
      !/^[a-z0-9-]{1,64}$/u.test(name) ||
      name.startsWith("x-kokoro-") ||
      name.startsWith("proxy-") ||
      ["authorization", "cookie", "host", "connection", "set-cookie"].includes(name) ||
      !content ||
      content.length > 1024 ||
      /[\r\n]/u.test(content)
    )
      throw invalid()
    headers[name] = content
  }
  return { url: value.url, method: "PUT" as const, required_headers: headers, expires_at: date.toISOString() }
}
export function projectMcpPackageAdminResponse(input: McpPackageAdminInput, response: Message): McpPackageAdminResult {
  if (input.kind === "begin") {
    known(response, p.BeginMcpPackageUploadResponseSchema)
    const value = response as p.BeginMcpPackageUploadResponse
    if (value.packageId !== input.packageId) throw invalid()
    return { kind: input.kind, package_id: value.packageId, upload_id: id(value.uploadId), transfer_reference: transfer(value.transferReference) }
  }
  if (input.kind === "complete") {
    known(response, p.CompleteMcpPackageUploadResponseSchema)
    return { kind: input.kind, upload: snapshot((response as p.CompleteMcpPackageUploadResponse).upload, input) }
  }
  if (input.kind === "status") {
    known(response, p.GetMcpPackageUploadStatusResponseSchema)
    return { kind: input.kind, upload: snapshot((response as p.GetMcpPackageUploadStatusResponse).upload, input) }
  }
  if (input.kind === "abort") {
    known(response, p.AbortMcpPackageUploadResponseSchema)
    const value = response as p.AbortMcpPackageUploadResponse
    if (value.uploadId !== input.uploadId || value.state !== p.McpPackageUploadState.ABORTED) throw invalid()
    return { kind: input.kind, upload_id: value.uploadId, state: "aborted" }
  }
  known(response, p.PublishMcpPackageResponseSchema)
  const value = response as p.PublishMcpPackageResponse
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value.packageVersionId) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value.serverId)
  )
    throw invalid()
  return { kind: input.kind, package_version_id: value.packageVersionId, server_id: value.serverId, replayed: value.replayed }
}
