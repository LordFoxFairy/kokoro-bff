import { parseRssFeedUrl } from "../../domain/scheduled-task/trigger.js"
import { lookup, type LookupAddress } from "node:dns"
import { request, type RequestOptions } from "node:https"
import type { ClientRequest, IncomingMessage } from "node:http"
import { checkServerIdentity } from "node:tls"
import { isPublicRssAddress } from "./rss-feed-address.js"

export type RssFeedNetwork = Readonly<{ lookup: typeof lookup; request: typeof request }>
export type RssFeedReadCode =
  | "rss_feed_url_invalid"
  | "rss_feed_address_forbidden"
  | "rss_feed_dns_unavailable"
  | "rss_feed_dns_busy"
  | "rss_feed_unavailable"
  | "rss_feed_timeout"
  | "rss_feed_cancelled"
  | "rss_feed_response_invalid"
  | "rss_feed_too_large"
export class RssFeedReadError extends Error {
  constructor(readonly code: RssFeedReadCode) {
    super(code)
  }
}
const MAX_BYTES = 1024 * 1024
// Physical lookups retain their slot even after their caller has settled.
let pendingLookups = 0
function responseLength(response: IncomingMessage): number | null {
  const headers = new Map<string, string>()
  const single = new Set(["content-type", "content-length", "content-encoding", "transfer-encoding", "location", "trailer"])
  for (let i = 0; i < response.rawHeaders.length; i += 2) {
    const key = response.rawHeaders[i]!.toLowerCase(),
      value = response.rawHeaders[i + 1]!
    if (single.has(key) && headers.has(key)) throw new RssFeedReadError("rss_feed_response_invalid")
    headers.set(key, value)
  }
  if (response.statusCode !== 200 || headers.has("location") || headers.has("trailer")) throw new RssFeedReadError("rss_feed_response_invalid")
  const mime = headers.get("content-type")
  if (!mime || !/^(?:application\/(?:rss\+xml|atom\+xml|xml)|text\/xml)(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-?8|"utf-?8"))?[ \t]*$/iu.test(mime))
    throw new RssFeedReadError("rss_feed_response_invalid")
  const encoding = headers.get("content-encoding")
  if (encoding !== undefined && encoding.toLowerCase() !== "identity") throw new RssFeedReadError("rss_feed_response_invalid")
  const transfer = headers.get("transfer-encoding")
  if (transfer !== undefined && transfer.toLowerCase() !== "chunked") throw new RssFeedReadError("rss_feed_response_invalid")
  const length = headers.get("content-length")
  if (length === undefined) return null
  if (transfer !== undefined || !/^(?:0|[1-9][0-9]*)$/u.test(length)) throw new RssFeedReadError("rss_feed_response_invalid")
  const parsed = Number(length)
  if (!Number.isSafeInteger(parsed) || parsed > MAX_BYTES) throw new RssFeedReadError("rss_feed_too_large")
  return parsed
}

/** Explicit internal network seam for controlled tests; production uses only readRssFeed. */
export function createRssFeedReader(network: RssFeedNetwork) {
  return (input: Readonly<{ url: string; signal: AbortSignal }>): Promise<Uint8Array> => {
    const started = performance.now(),
      deadline = started + 10000
    return new Promise((resolve, reject) => {
      let settled = false,
        req: ClientRequest | undefined,
        res: IncomingMessage | undefined
      let idle: ReturnType<typeof setTimeout> | undefined, total: ReturnType<typeof setTimeout> | undefined
      let bytes = 0,
        expected: number | null = null,
        idleDeadline = started + 5000
      const chunks: Buffer[] = []
      const cleanup = () => {
        clearTimeout(idle)
        clearTimeout(total)
        input.signal.removeEventListener("abort", onAbort)
      }
      const fail = (code: RssFeedReadCode) => {
        if (settled) return
        settled = true
        cleanup()
        chunks.length = 0
        // Keep error listeners attached while destroy emits its asynchronous error.
        res?.destroy()
        req?.destroy()
        reject(new RssFeedReadError(code))
      }
      const onAbort = () => fail("rss_feed_cancelled")
      const active = () => {
        if (settled) return false
        if (input.signal.aborted) {
          onAbort()
          return false
        }
        if (performance.now() >= Math.min(deadline, idleDeadline)) {
          fail("rss_feed_timeout")
          return false
        }
        return true
      }
      const progress = () => {
        idleDeadline = performance.now() + 5000
        clearTimeout(idle)
        idle = setTimeout(() => fail("rss_feed_timeout"), Math.min(5000, Math.max(0, deadline - performance.now())))
      }
      if (!active()) return
      let url: URL
      try {
        url = parseRssFeedUrl(input.url)
      } catch {
        fail("rss_feed_url_invalid")
        return
      }
      input.signal.addEventListener("abort", onAbort, { once: true })
      total = setTimeout(() => fail("rss_feed_timeout"), Math.max(0, deadline - performance.now()))
      progress()
      if (!active()) return
      if (pendingLookups >= 8) {
        fail("rss_feed_dns_busy")
        return
      }
      pendingLookups++
      let lookupFinished = false
      const resolved = (error: NodeJS.ErrnoException | null, answers: LookupAddress[]) => {
        if (lookupFinished) return
        lookupFinished = true
        pendingLookups--
        if (!active()) return
        if (error) {
          fail("rss_feed_dns_unavailable")
          return
        }
        if (
          !Array.isArray(answers) ||
          answers.length === 0 ||
          answers.length > 32 ||
          answers.some((a) => !a || typeof a.address !== "string" || !isPublicRssAddress(a.address, a.family))
        ) {
          fail("rss_feed_address_forbidden")
          return
        }
        const pin = answers[0]!
        progress()
        if (!active()) return
        try {
          const options: RequestOptions & Readonly<{ autoSelectFamily: false }> = {
            protocol: "https:",
            hostname: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method: "GET",
            servername: url.hostname,
            checkServerIdentity,
            rejectUnauthorized: true,
            agent: false,
            autoSelectFamily: false,
            maxHeaderSize: 16384,
            headers: { Host: url.hostname, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", "Accept-Encoding": "identity" },
            lookup: (_hostname, _options, callback) => callback(null, pin.address, pin.family),
          }
          req = network.request(options, (response) => {
            res = response
            res.on("error", () => fail("rss_feed_response_invalid"))
            res.on("aborted", () => fail("rss_feed_response_invalid"))
            res.on("close", () => {
              if (!res?.complete) fail("rss_feed_response_invalid")
            })
            if (!active()) {
              res.destroy()
              return
            }
            try {
              expected = responseLength(res)
            } catch (error) {
              fail(error instanceof RssFeedReadError ? error.code : "rss_feed_response_invalid")
              return
            }
            progress()
            res.on("data", (chunk: Buffer) => {
              if (!active()) return
              bytes += chunk.length
              if (bytes > MAX_BYTES) {
                fail("rss_feed_too_large")
                return
              }
              chunks.push(Buffer.from(chunk))
              progress()
            })
            res.on("end", () => {
              if (!active()) return
              if (!res?.complete || res.rawTrailers.length !== 0 || (expected !== null && bytes !== expected)) {
                fail("rss_feed_response_invalid")
                return
              }
              settled = true
              cleanup()
              resolve(Buffer.concat(chunks, bytes))
              chunks.length = 0
            })
          })
          req.on("error", (error: NodeJS.ErrnoException) =>
            fail(error.code === "HPE_HEADER_OVERFLOW" || error.code?.startsWith("HPE_") ? "rss_feed_response_invalid" : "rss_feed_unavailable"),
          )
          req.on("socket", (socket) => {
            socket.once("connect", () => {
              if (active()) progress()
            })
            socket.once("secureConnect", () => {
              if (active()) progress()
            })
          })
          if (active()) req.end()
          else req.destroy()
        } catch {
          fail("rss_feed_unavailable")
        }
      }
      try {
        network.lookup(url.hostname, { all: true, verbatim: true }, resolved)
      } catch {
        if (!lookupFinished) {
          lookupFinished = true
          pendingLookups--
        }
        fail("rss_feed_dns_unavailable")
      }
    })
  }
}
export const readRssFeed = createRssFeedReader({ lookup, request })
