import type { IncomingMessage } from "node:http"

export function rawHeaderCount(request: IncomingMessage, name: string): number {
  let count = 0
  for (let index = 0; index < request.rawHeaders.length; index += 2) if (request.rawHeaders[index]?.toLowerCase() === name) count++
  return count
}

export async function readBodyBeforeDeadline(request: IncomingMessage, signal: AbortSignal, maxBytes = 1024 * 1024): Promise<Buffer> {
  if (signal.aborted) throw new Error("deadline exceeded")
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const cleanup = (): void => {
      request.removeListener("data", onData)
      request.removeListener("end", onEnd)
      request.removeListener("error", onError)
      signal.removeEventListener("abort", onAbort)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      request.resume()
      reject(error)
    }
    const onData = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.byteLength
      if (size > maxBytes) fail(new Error("request body too large"))
      else chunks.push(bytes)
    }
    const onEnd = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const onError = (error: Error): void => fail(error)
    const onAbort = (): void => fail(new Error("deadline exceeded"))
    request.on("data", onData)
    request.once("end", onEnd)
    request.once("error", onError)
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}
