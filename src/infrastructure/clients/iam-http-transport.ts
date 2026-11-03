import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders } from "node:http"
import { request as httpsRequest } from "node:https"
import { createClient } from "../../generated/iam-http/client/index.js"
import { strictParseRawJson } from "../raw-json.js"

export type IamHttpOptions = Readonly<{ baseUrl: string; timeoutMs: number; maxResponseBytes: number }>
export type IamHttpResponse = Readonly<{ status: number; headers: Headers; body: Buffer }>
function responseHeaders(input: IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(input)) {
    if (value !== undefined) {
      if (Array.isArray(value)) for (const item of value) headers.append(name, item)
      else headers.set(name, value)
    }
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

/** Bounded network I/O only. No identity, policy, permission, cache or operation dispatch. */
export function requestIamHttp(
  options: IamHttpOptions,
  input: Readonly<{ target: URL; method: string; headers: Record<string, string>; body: string | null; signal: AbortSignal }>,
): Promise<IamHttpResponse> {
  const { target, body } = input
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
      reject(new Error(message, { cause }))
    }
    const succeed = (result: IamHttpResponse): void => {
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
    timer = setTimeout(
      () => {
        fail("IAM admission request timed out")
        client?.destroy()
      },
      Math.min(options.timeoutMs, 5000),
    )
    timer.unref()
    try {
      client = requestFn(
        target,
        {
          method: input.method,
          maxHeaderSize: Math.min(options.maxResponseBytes, 1024 * 1024),
          headers: {
            ...input.headers,
            ...(input.method === "GET" ? {} : { "content-length": String(body === null ? 0 : Buffer.byteLength(body)) }),
          },
        },
        (response) => {
          const headerBytes = responseHeaderBytes(response.rawHeaders)
          if (headerBytes > Math.min(options.maxResponseBytes, 1024 * 1024)) {
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
            if (size > Math.min(options.maxResponseBytes, 1024 * 1024)) {
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
      client.end(body)
    } catch (error) {
      fail("IAM admission request failed", error)
      client?.destroy()
    }
  })
}

/** Use the owner's generated SDK with bounded raw HTTP before its JSON decoder. */
export function createIamHttpClient(options: IamHttpOptions) {
  const boundedFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request && init === undefined ? input : new Request(input, init)
    const body = request.body === null ? null : await request.text()
    const response = await requestIamHttp(options, {
      target: new URL(request.url),
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body,
      signal: request.signal,
    })
    if (response.headers.has("set-cookie") || response.headers.has("location")) throw new Error("iam_business_response_invalid")
    strictParseRawJson(response.body)
    return new Response(new Uint8Array(response.body), { status: response.status, headers: response.headers })
  }
  return createClient({ baseUrl: options.baseUrl, fetch: boundedFetch })
}
