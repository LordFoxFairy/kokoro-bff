import { randomUUID } from "node:crypto"
import type { IncomingMessage } from "node:http"

import type { BffConfig } from "../config/runtime.js"
import { parseMessageCreateRequest } from "../application/chat/message-create-input.js"
import { isRecord } from "../domain/json.js"

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
    const fieldName = nameMatch?.[1]
    if (fieldName === undefined || fieldName === "") return null
    const filenameMatch = /filename="([^"]+)"/iu.exec(disposition)
    parts.push({
      name: fieldName,
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

function canonicalContentType(request: IncomingMessage): string {
  return requestContentType(request).split(";", 1)[0]?.trim() ?? ""
}

function canonicalQuery(request: IncomingMessage): Array<[string, string]> {
  return [...queryOf(request).entries()]
    .map(([name, value]): [string, string] => [name, value.trim()])
    .sort(([leftName, leftValue], [rightName, rightValue]) => (
      leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue)
    ))
}

function canonicalJsonBody(
  request: IncomingMessage,
  businessPath: readonly string[],
  json: Readonly<Record<string, unknown>>,
): unknown {
  if (
    request.method === "POST"
    && businessPath.length === 3
    && businessPath[0] === "sessions"
    && businessPath[2] === "messages"
  ) {
    return parseMessageCreateRequest(
      Object.fromEntries(Object.entries(json)),
      queryOf(request).get("project_ref") ?? undefined,
    ) ?? json
  }
  if (
    request.method === "PATCH"
    && businessPath.length === 3
    && businessPath[0] === "sessions"
    && businessPath[2] === "title"
    && typeof json.title === "string"
  ) return { ...json, title: json.title.trim() }
  return json
}

/** Canonical route semantics used by the outer idempotency receipt. */
export function mutationFingerprint(
  request: IncomingMessage,
  businessPath: readonly string[],
  json: Readonly<Record<string, unknown>>,
  body: Buffer,
): string {
  const contentType = canonicalContentType(request)
  const semanticBody = contentType === "application/json" || contentType.endsWith("+json")
    ? canonicalJsonBody(request, businessPath, json)
    : fingerprintBody(request, body)
  return stableStringify({
    method: request.method ?? "GET",
    path: businessPath,
    query: canonicalQuery(request),
    headers: {
      content_type: contentType,
      if_match: headerString(request.headers["if-match"]).trim() || null,
    },
    body: semanticBody,
  })
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
