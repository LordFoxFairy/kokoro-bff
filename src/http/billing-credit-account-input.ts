import type { IncomingMessage } from "node:http"
import { strictParseRawJson } from "../infrastructure/raw-json.js"

export function isBillingCreditAccountCandidate(request: IncomingMessage): boolean {
  if (request.method !== "PUT") return false
  const raw = request.url ?? ""
  if (raw.startsWith("/v1/billing/credit-account")) return true
  try {
    return new URL(raw, "http://bff.local").pathname.split("/").filter(Boolean).map(decodeURIComponent).join("/") === "v1/billing/credit-account"
  } catch {
    return false
  }
}

export async function readBillingCreditAccountInput(request: IncomingMessage, signal: AbortSignal): Promise<void> {
  const invalid = () => new Error("BILLING_CREDIT_INPUT")
  if (request.url !== "/v1/billing/credit-account") throw invalid()
  const counts = new Map<string, number>()
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    const name = request.rawHeaders[i]!.toLowerCase()
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  for (const name of ["content-type", "authorization", "x-kokoro-service", "x-kokoro-internal-secret", "content-length", "transfer-encoding"]) {
    if ((counts.get(name) ?? 0) > 1) throw invalid()
  }
  if (
    counts.has("idempotency-key") ||
    counts.has("content-encoding") ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] ?? "")
  )
    throw invalid()
  const length = request.headers["content-length"]
  if (length !== undefined && (!/^(?:0|[1-9][0-9]*)$/u.test(length) || Number(length) > 4096)) throw invalid()
  await new Promise<void>((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    const cleanup = () => {
      request.removeListener("data", data)
      request.removeListener("end", end)
      request.removeListener("error", error)
      signal.removeEventListener("abort", error)
    }
    const error = () => {
      cleanup()
      reject(new Error("BILLING_CREDIT_RETIRED"))
    }
    const data = (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 4096) {
        cleanup()
        request.resume()
        reject(invalid())
        return
      }
      chunks.push(chunk)
    }
    const end = () => {
      cleanup()
      try {
        const body = Buffer.concat(chunks)
        if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) throw invalid()
        const value = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(body))
        if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) throw invalid()
        resolve()
      } catch {
        reject(invalid())
      }
    }
    request.on("data", data)
    request.once("end", end)
    request.once("error", error)
    signal.addEventListener("abort", error, { once: true })
    if (signal.aborted) error()
    else if (request.readableEnded) end()
    else request.resume()
  })
}
