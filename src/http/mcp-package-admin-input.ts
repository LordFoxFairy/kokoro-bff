import { z } from "zod"
import type { IncomingMessage } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import {
  parseMcpPackageAdminInput,
  type McpPackageAdminIdentity,
  type McpPackageAdminInput,
} from "../infrastructure/clients/platform/mcp-package-admin-input.js"
const source = { upload_source_version_id: z.string(), content_sha256: z.string(), size_bytes: z.string() }
const schemas = {
  begin: z.object({ filename: z.string(), content_sha256: z.string(), size_bytes: z.string() }).strict(),
  complete: z.object(source).strict(),
  abort: z.object({ reason: z.string() }).strict(),
  publish: z.object({ ...source, upload_id: z.string(), asset_id: z.string(), provider_key: z.string() }).strict(),
}
export function parseMcpPackageHttpInput(
  identity: McpPackageAdminIdentity,
  kind: McpPackageAdminInput["kind"],
  packageId: string,
  uploadId: string | undefined,
  commandId: string | undefined,
  raw: Buffer,
): McpPackageAdminInput {
  try {
    if (kind === "status") return parseMcpPackageAdminInput(identity, { kind, packageId, uploadId: uploadId! }).input
    const decoded = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(raw))
    const scope = { packageId, commandId: commandId! }
    if (kind === "begin") {
      const body = schemas.begin.parse(decoded)
      return parseMcpPackageAdminInput(identity, { kind, ...scope, filename: body.filename, contentSha256: body.content_sha256, sizeBytes: body.size_bytes })
        .input
    }
    if (kind === "complete") {
      const body = schemas.complete.parse(decoded)
      return parseMcpPackageAdminInput(identity, {
        kind,
        ...scope,
        uploadId: uploadId!,
        uploadSourceVersionId: body.upload_source_version_id,
        contentSha256: body.content_sha256,
        sizeBytes: body.size_bytes,
      }).input
    }
    if (kind === "abort") {
      const body = schemas.abort.parse(decoded)
      return parseMcpPackageAdminInput(identity, { kind, ...scope, uploadId: uploadId!, reason: body.reason }).input
    }
    const body = schemas.publish.parse(decoded)
    return parseMcpPackageAdminInput(identity, {
      kind,
      ...scope,
      uploadId: body.upload_id,
      uploadSourceVersionId: body.upload_source_version_id,
      contentSha256: body.content_sha256,
      sizeBytes: body.size_bytes,
      assetId: body.asset_id,
      providerKey: body.provider_key,
    }).input
  } catch {
    throw new ConnectError("Invalid MCP package administration request", Code.InvalidArgument)
  }
}
/** Feature-local bounded body; the route's single deadline cancels pending reads too. */
export async function readMcpPackageBody(request: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  if (request.readableEnded) return Buffer.alloc(0)
  if (request.destroyed) throw new ConnectError("MCP package input canceled", Code.Canceled)
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
    const aborted = () => fail(new ConnectError("MCP package input canceled", Code.Canceled))
    const data = (raw: Buffer | string) => {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      size += chunk.byteLength
      if (size > 32768) {
        fail(new ConnectError("MCP package input too large", Code.InvalidArgument))
        request.resume()
        return
      }
      chunks.push(chunk)
    }
    const end = () => {
      if (!settled) {
        settled = true
        cleanup()
        resolve(Buffer.concat(chunks))
      }
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
