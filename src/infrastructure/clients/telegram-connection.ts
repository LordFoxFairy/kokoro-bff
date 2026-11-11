import { z } from "zod"
import type { TelegramConnectionConfig } from "../../config/runtime.js"

const telegramId = z.number().int().positive().max(2 ** 52 - 1)
const updateId = z.object({ update_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
const privateStart = updateId.extend({
  message: z.object({
    from: z.object({ id: telegramId, is_bot: z.literal(false) }),
    chat: z.object({ id: telegramId, type: z.literal("private") }),
    text: z.string().max(64),
  }),
})

export function telegramStart(input: unknown): { setupId: string; externalUserId: string; updateId: string } | null {
  const parsed = privateStart.safeParse(input)
  if (!parsed.success) return null
  const { message, update_id } = parsed.data
  if (message.from.id !== message.chat.id) return null
  const token = /^\/start ([A-Za-z0-9_-]{32})$/u.exec(message.text)?.[1]
  return token ? { setupId: token, externalUserId: String(message.from.id), updateId: String(update_id) } : null
}

export const validTelegramUpdate = (input: unknown): boolean => updateId.safeParse(input).success
export async function sendTelegramProof(
  config: TelegramConnectionConfig,
  externalUserId: string,
  proof: string,
  timeoutMs: number,
  send: typeof fetch = fetch,
): Promise<void> {
  try {
    const response = await send(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: Number(externalUserId),
        text: `Enter this one-time code in the Kokoro connection dialog: ${proof}`,
        protect_content: true,
      }),
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(Math.min(timeoutMs, 5000)),
    })
    await response.body?.cancel()
  } catch {
    // A send may already have reached Telegram. Never repeat it automatically;
    // receiving and submitting the proof, not an HTTP response, confirms possession.
  }
}
