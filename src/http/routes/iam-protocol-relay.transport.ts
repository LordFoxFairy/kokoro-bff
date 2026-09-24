import { request as httpRequest, type IncomingMessage } from "node:http"
import { request as httpsRequest } from "node:https"

import { IAM_RELAY_POLICY } from "./iam-protocol-relay.policy.js"

export type IamRelayUpstream = Readonly<{
  status: number
  headers: Headers
  setCookies: readonly string[]
  body: Buffer
}>

export class IamRelayTransportError extends Error {
  public constructor() {
    super("IAM relay upstream unavailable")
    this.name = "IamRelayTransportError"
  }
}

async function requestBrowserNavigation(target: URL, headers: Headers, signal: AbortSignal, maxResponseBytes: number): Promise<IamRelayUpstream> {
  return new Promise<IamRelayUpstream>((resolve, reject) => {
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(
      target,
      { method: "GET", headers: Object.fromEntries(headers), signal },
      (response: IncomingMessage) => {
        void (async () => {
          let headerBytes = 2
          const responseHeaders = new Headers()
          const setCookies: string[] = []
          for (let index = 0; index < response.rawHeaders.length; index += 2) {
            const name = response.rawHeaders[index] ?? ""
            const value = response.rawHeaders[index + 1] ?? ""
            headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4
            if (headerBytes > IAM_RELAY_POLICY.maxHeaderBytes) throw new IamRelayTransportError()
            if (name.toLowerCase() === "set-cookie") setCookies.push(value)
            else responseHeaders.append(name, value)
          }
          const chunks: Buffer[] = []
          let bytes = 0
          for await (const value of response) {
            const chunk = Buffer.from(value)
            bytes += chunk.length
            if (bytes > maxResponseBytes) throw new IamRelayTransportError()
            chunks.push(chunk)
          }
          resolve({ status: response.statusCode ?? 0, headers: responseHeaders, setCookies, body: Buffer.concat(chunks) })
        })().catch((error: unknown) => {
          request.destroy()
          reject(error)
        })
      },
    )
    request.once("error", reject)
    request.end()
  })
}

export async function requestIamRelay(
  input: Readonly<{
    baseUrl: string
    rawTarget: string
    method: string
    headers: Headers
    body: Buffer
    timeoutMs: number
    maxResponseBytes: number
    signal: AbortSignal
    browserNavigation: boolean
  }>,
): Promise<IamRelayUpstream> {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  input.signal.addEventListener("abort", onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), Math.min(input.timeoutMs, IAM_RELAY_POLICY.maxDurationMs))
  try {
    if (input.signal.aborted) throw new IamRelayTransportError()
    const target = new URL(input.rawTarget, `${input.baseUrl}/`)
    if (target.origin !== input.baseUrl) throw new IamRelayTransportError()
    if (input.browserNavigation) {
      if (input.method !== "GET" || target.pathname !== "/iam/oauth2/end-session" || input.headers.get("sec-fetch-mode") !== "navigate") {
        throw new IamRelayTransportError()
      }
      return await requestBrowserNavigation(target, input.headers, controller.signal, Math.min(input.maxResponseBytes, IAM_RELAY_POLICY.maxResponseBytes))
    }
    const response = await fetch(target, {
      method: input.method,
      headers: input.headers,
      ...(input.body.length === 0 ? {} : { body: new Uint8Array(input.body) }),
      redirect: "manual",
      signal: controller.signal,
    })
    const setCookies = response.headers.getSetCookie()
    let headerBytes = 2
    for (const [name, value] of response.headers) headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4
    for (const value of setCookies) headerBytes += Buffer.byteLength(value) + 14
    if (headerBytes > IAM_RELAY_POLICY.maxHeaderBytes) {
      controller.abort()
      await response.body?.cancel().catch(() => undefined)
      throw new IamRelayTransportError()
    }
    const chunks: Buffer[] = []
    let bytes = 0
    const cap = Math.min(input.maxResponseBytes, IAM_RELAY_POLICY.maxResponseBytes)
    if (response.body !== null) {
      const reader = response.body.getReader()
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          const chunk = Buffer.from(next.value)
          bytes += chunk.length
          if (bytes > cap) {
            controller.abort()
            await reader.cancel().catch(() => undefined)
            throw new IamRelayTransportError()
          }
          chunks.push(chunk)
        }
      } finally {
        reader.releaseLock()
      }
    }
    return {
      status: response.status,
      headers: response.headers,
      setCookies,
      body: Buffer.concat(chunks),
    }
  } catch {
    throw new IamRelayTransportError()
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener("abort", onAbort)
  }
}
