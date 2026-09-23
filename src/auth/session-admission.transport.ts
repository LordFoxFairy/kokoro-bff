import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders } from "node:http"
import { request as httpsRequest } from "node:https"

export const IAM_ADMISSION_TIMEOUT_MAX_MS = 5000
export const IAM_ADMISSION_RESPONSE_MAX_BYTES = 1024 * 1024

export type SessionAdmissionTransportOptions = Readonly<{
  baseUrl: string
  timeoutMs: number
  maxResponseBytes: number
}>

export type SessionAdmissionTransportInput = Readonly<{
  token: string
  requestId: string
  signal: AbortSignal
}>

export type SessionAdmissionTransportResponse = Readonly<{
  status: number
  headers: Headers
  body: Buffer
}>

export class SessionAdmissionTransportError extends Error {
  public constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = "SessionAdmissionTransportError"
  }
}

function responseHeaders(input: IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(input)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value)
  }
  return headers
}

function responseHeaderBytes(rawHeaders: readonly string[]): number {
  let size = 2
  for (let index = 0; index < rawHeaders.length; index += 2) {
    size += Buffer.byteLength(rawHeaders[index] ?? "", "latin1")
    size += 2
    size += Buffer.byteLength(rawHeaders[index + 1] ?? "", "latin1")
    size += 2
  }
  return size
}

export class SessionAdmissionTransport {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number

  public constructor(options: SessionAdmissionTransportOptions) {
    this.baseUrl = options.baseUrl
    this.timeoutMs = Math.min(options.timeoutMs, IAM_ADMISSION_TIMEOUT_MAX_MS)
    this.maxResponseBytes = Math.min(options.maxResponseBytes, IAM_ADMISSION_RESPONSE_MAX_BYTES)
  }

  public request(input: SessionAdmissionTransportInput): Promise<SessionAdmissionTransportResponse> {
    const target = new URL("/internal/v1/session-authorizations/verify", `${this.baseUrl.replace(/\/+$/u, "")}/`)
    const requestFn = target.protocol === "https:" ? httpsRequest : httpRequest
    return new Promise((resolve, reject) => {
      let settled = false
      let client: ClientRequest | null = null
      let timer: NodeJS.Timeout | undefined
      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer)
        input.signal.removeEventListener("abort", onAbort)
      }
      const fail = (message: string, cause?: unknown): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(new SessionAdmissionTransportError(message, cause))
      }
      const succeed = (result: SessionAdmissionTransportResponse): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }
      const onAbort = (): void => {
        fail("IAM admission request was cancelled")
        client?.destroy()
      }
      if (input.signal.aborted) {
        onAbort()
        return
      }
      input.signal.addEventListener("abort", onAbort, { once: true })
      timer = setTimeout(() => {
        fail("IAM admission request timed out")
        client?.destroy()
      }, this.timeoutMs)
      timer.unref()
      try {
        client = requestFn(
          target,
          {
            method: "POST",
            maxHeaderSize: this.maxResponseBytes,
            headers: {
              accept: "application/json",
              authorization: `Bearer ${input.token}`,
              "content-length": "0",
              "x-request-id": input.requestId,
            },
          },
          (response) => {
            const headerBytes = responseHeaderBytes(response.rawHeaders)
            if (headerBytes > this.maxResponseBytes) {
              fail("IAM admission response exceeded its byte limit")
              response.destroy()
              client?.destroy()
              return
            }
            const chunks: Buffer[] = []
            let size = headerBytes
            response.on("data", (chunk) => {
              if (settled) return
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
              size += buffer.byteLength
              if (size > this.maxResponseBytes) {
                fail("IAM admission response exceeded its byte limit")
                response.destroy()
                client?.destroy()
                return
              }
              chunks.push(buffer)
            })
            response.once("aborted", () => fail("IAM admission response was aborted"))
            response.once("error", (error) => fail("IAM admission response failed", error))
            response.once("end", () =>
              succeed({
                status: response.statusCode ?? 503,
                headers: responseHeaders(response.headers),
                body: Buffer.concat(chunks),
              }),
            )
          },
        )
        client.once("error", (error) => fail("IAM admission connection failed", error))
        client.end()
      } catch (error) {
        fail("IAM admission request failed", error)
        client?.destroy()
      }
    })
  }
}
