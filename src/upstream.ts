import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

import type { BffConfig } from "./config.js"

export type UpstreamResponse = {
  status: number
  headers: Headers
  body: Buffer
}

export type TrustedUpstreamHeaders = Readonly<Record<string, string>>

const TRUSTED_HEADER_NAMES = new Set([
  "x-kokoro-tenant-ref",
  "x-kokoro-subject-ref",
  "x-kokoro-actor-ref",
  "x-kokoro-subject-kind",
  "x-kokoro-actor-kind",
  "x-kokoro-identity-assertion-ref",
  "x-kokoro-tenant-id",
  "x-kokoro-subject-id",
  "x-kokoro-subject",
  "x-kokoro-actor-id",
  "x-kokoro-iam-permissions",
])

function requestHeaders(
  config: BffConfig,
  requestId: string,
  incoming: Headers,
  trusted: TrustedUpstreamHeaders,
  callerService: string,
): Record<string, string> {
  const headers = new Headers()
  for (const name of ["accept", "content-type", "idempotency-key", "authorization"] as const) {
    const value = incoming.get(name)
    if (value !== null) headers.set(name, value)
  }
  headers.set("x-kokoro-service", callerService)
  headers.set("x-kokoro-request-id", requestId)
  headers.set("forwarded", `host=${config.domain}`)
  if (config.upstreamSecret !== null) headers.set("x-kokoro-internal-secret", config.upstreamSecret)
  for (const [name, value] of Object.entries(trusted)) {
    if (TRUSTED_HEADER_NAMES.has(name.toLowerCase()) && value.trim() !== "") headers.set(name, value)
  }
  return Object.fromEntries(headers.entries())
}

function incomingHeaders(input: import("node:http").IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value)
  }
  return headers
}

export async function proxyUpstream(
  config: BffConfig,
  baseUrl: string,
  path: string,
  method: string,
  requestId: string,
  incoming: Headers,
  body: Buffer | undefined,
  trustedHeaders: TrustedUpstreamHeaders = {},
  callerService = "kokoro-bff",
): Promise<UpstreamResponse> {
  const target = new URL(path, `${baseUrl.replace(/\/+$/u, "/")}`)
  const requestFn = target.protocol === "https:" ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const client = requestFn(target, {
      method,
      headers: requestHeaders(config, requestId, incoming, trustedHeaders, callerService),
    }, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 502,
          headers: incomingHeaders(response.headers),
          body: Buffer.concat(chunks),
        })
      })
    })
    client.once("error", reject)
    if (body !== undefined) client.write(body)
    client.end()
  })
}
