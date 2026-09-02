import { randomUUID } from "node:crypto"
import type { IncomingMessage } from "node:http"

import type { BffConfig } from "../config.js"

export type Context = {
  requestId: string
  identity: { namespace: string; userId: string }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`
  const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
  return `{${entries.join(",")}}`
}

export function headerString(value: string | string[] | undefined): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.join(", ")
  return ""
}

export function requestContentType(request: IncomingMessage): string {
  return headerString(request.headers["content-type"]).toLowerCase()
}

function parseBoundary(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/iu.exec(contentType)
  return match?.[1] ?? match?.[2] ?? null
}

function parseMultipartFingerprint(contentType: string, body: Buffer): string | null {
  const boundary = parseBoundary(contentType)
  if (boundary === null) return null
  const marker = `--${boundary}`
  const sections = body.toString("latin1").split(marker)
  if (sections.length < 2) return null
  const parts: Array<{ name: string; filename: string | null; content_type: string | null; body: string }> = []
  for (const section of sections.slice(1)) {
    if (section.startsWith("--")) break
    const trimmed = section.replace(/^\r?\n/u, "").replace(/\r?\n$/u, "")
    if (trimmed.length === 0) continue
    const splitAt = trimmed.indexOf("\r\n\r\n")
    if (splitAt < 0) return null
    const headers = trimmed.slice(0, splitAt).split("\r\n")
    const content = trimmed.slice(splitAt + 4).replace(/\r\n$/u, "")
    const headerMap = new Map<string, string>()
    for (const line of headers) {
      const colon = line.indexOf(":")
      if (colon < 0) return null
      headerMap.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
    }
    const disposition = headerMap.get("content-disposition") ?? ""
    const nameMatch = /name="([^"]+)"/iu.exec(disposition)
    if (nameMatch === null || nameMatch[1] === "") return null
    const filenameMatch = /filename="([^"]+)"/iu.exec(disposition)
    parts.push({
      name: nameMatch[1]!,
      filename: filenameMatch?.[1] ?? null,
      content_type: headerMap.get("content-type") ?? null,
      body: Buffer.from(content, "latin1").toString("base64"),
    })
  }
  return stableStringify(parts)
}

export function fingerprintBody(request: IncomingMessage, body: Buffer): string {
  const contentType = requestContentType(request)
  if (body.byteLength === 0) return "empty"
  if (contentType.startsWith("multipart/form-data")) {
    const multipart = parseMultipartFingerprint(contentType, body)
    if (multipart !== null) return `multipart:${multipart}`
  }
  if (contentType.includes("json")) {
    try {
      return `json:${stableStringify(JSON.parse(body.toString("utf8")) as unknown)}`
    } catch {
      // Fall through to the raw body fingerprint.
    }
  }
  return `raw:${body.toString("base64")}`
}

export function idempotencyKey(request: IncomingMessage): string | null {
  const key = headerString(request.headers["idempotency-key"]).trim()
  return key === "" ? null : key
}

export function requestId(request: IncomingMessage): string {
  const value = request.headers["x-kokoro-request-id"] ?? request.headers["x-request-id"]
  return typeof value === "string" && value.trim() ? value.trim() : randomUUID()
}

export function pathOf(request: IncomingMessage): string[] {
  const pathname = new URL(request.url || "/", "http://bff.local").pathname
  return pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment))
}

export function queryOf(request: IncomingMessage): URLSearchParams {
  return new URL(request.url || "/", "http://bff.local").searchParams
}

export function isMutation(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE"
}

export function requiresIdempotency(method: string, segments: string[]): boolean {
  if (!isMutation(method)) return false
  if (method === "POST" && segments[0] === "skills" && segments[1] === "github" && segments[2] === "preview") return false
  return true
}

export function authorizeServerOnly(request: IncomingMessage, config: BffConfig): boolean {
  const service = request.headers["x-kokoro-service"]
  return service === "web-bff" && config.sharedSecret !== null && request.headers["x-kokoro-internal-secret"] === config.sharedSecret
}

export function authorize(request: IncomingMessage, config: BffConfig, id: string): Context | null {
  const service = request.headers["x-kokoro-service"]
  if (service !== "web-bff") return null
  if (config.sharedSecret !== null && request.headers["x-kokoro-internal-secret"] !== config.sharedSecret) return null
  const namespace = request.headers["x-kokoro-namespace"]
  const userId = request.headers["x-kokoro-principal-id"]
  if (typeof namespace !== "string" || namespace.trim() === "" || typeof userId !== "string" || userId.trim() === "") return null
  return { requestId: id, identity: { namespace: namespace.trim(), userId: userId.trim() } }
}

export async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 1024 * 1024) throw new Error("request body too large")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export function requestBodyJson(request: IncomingMessage, body: Buffer): Record<string, unknown> | null {
  if (body.byteLength === 0 || requestContentType(request).startsWith("multipart/form-data")) return {}
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function incomingHeaders(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value)
  }
  return headers
}
