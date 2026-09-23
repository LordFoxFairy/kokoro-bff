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
