import { createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import type { LineConnectionConfig } from "../../config/runtime.js"
import { lineLinkToken } from "../../domain/agent-connection.js"
import { strictParseRawJson } from "../raw-json.js"

const userId = z.string().regex(/^U[0-9a-f]{32}(?![\s\S])/u)
export const lineConnectionEnvelope = z.object({
  destination: userId,
  events: z.array(z.record(z.string(), z.unknown())).max(32),
})
const privateEvent = {
  mode: z.literal("active"),
  source: z.object({ type: z.literal("user"), userId }),
  webhookEventId: z.string().regex(/^[A-Za-z0-9_-]{1,128}(?![\s\S])/u),
}
const messageEvent = z.object({
  type: z.literal("message"),
  ...privateEvent,
  replyToken: z.string().regex(/^[A-Za-z0-9_-]{1,128}(?![\s\S])/u),
  message: z.object({ type: z.literal("text"), text: z.string().regex(/^Kokoro connect [A-Za-z0-9_-]{32}(?![\s\S])/u) }),
})
const linkEvent = z.object({
  type: z.literal("accountLink"),
  ...privateEvent,
  link: z.object({ result: z.literal("ok"), nonce: z.string().regex(/^[A-Za-z0-9_-]{64}(?![\s\S])/u) }),
})

export function lineConnectionEvent(raw: unknown) {
  const message = messageEvent.safeParse(raw)
  if (message.success)
    return {
      kind: "message" as const,
      setupId: message.data.message.text.slice("Kokoro connect ".length),
      externalUserId: message.data.source.userId,
      updateId: message.data.webhookEventId,
      replyToken: message.data.replyToken,
    }
  const link = linkEvent.safeParse(raw)
  if (link.success)
    return { kind: "link" as const, setupId: link.data.link.nonce.slice(0, 32), externalUserId: link.data.source.userId, nonce: link.data.link.nonce }
  return null
}

export function matchesLineSignature(raw: Buffer, signature: string, channelSecret: string): boolean {
  if (!/^[A-Za-z0-9+/]{43}=(?![\s\S])/u.test(signature)) return false
  const actual = Buffer.from(signature, "base64")
  return actual.toString("base64") === signature && timingSafeEqual(actual, createHmac("sha256", channelSecret).update(raw).digest())
}

export const lineAccountLinkUrl = (linkToken: string, nonce: string): string =>
  "https://access.line.me/dialog/bot/accountLink?" + new URLSearchParams({ linkToken, nonce }).toString()

async function readIssuedToken(response: Response): Promise<string | null> {
  if (response.status !== 200 || !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(response.headers.get("content-type") ?? "")) {
    await response.body?.cancel()
    return null
  }
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Buffer[] = []
  let count = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      count += result.value.byteLength
      if (count > 4096) return null
      chunks.push(Buffer.from(result.value))
    }
    const token = z.object({ linkToken: lineLinkToken }).safeParse(strictParseRawJson(Buffer.concat(chunks)))
    return token.success ? token.data.linkToken : null
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export async function sendLineContinuation(
  config: LineConnectionConfig,
  event: { setupId: string; externalUserId: string; replyToken: string },
  timeoutMs: number,
): Promise<void> {
  const signal = AbortSignal.timeout(timeoutMs)
  const authorization = `Bearer ${config.accessToken}`
  try {
    const issued = await fetch(`https://api.line.me/v2/bot/user/${event.externalUserId}/linkToken`, {
      method: "POST",
      headers: { authorization },
      credentials: "omit",
      redirect: "error",
      signal,
    })
    const linkToken = await readIssuedToken(issued)
    if (!linkToken) return
    const fragment = new URLSearchParams({ line_setup: event.setupId, link_token: linkToken })
    const url = `${config.webOrigin}/app/agents#${fragment.toString()}`
    const reply = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      credentials: "omit",
      redirect: "error",
      signal,
      body: JSON.stringify({ replyToken: event.replyToken, messages: [{ type: "text", text: `Continue in Kokoro to link LINE: ${url}` }] }),
    })
    await reply.body?.cancel()
  } catch {
    // No response attests delivery or binding. This claimed event is never resent.
  }
}
