import { z } from "zod"
import type { SlackConnectionConfig } from "../../config/runtime.js"
import { strictParseRawJson } from "../raw-json.js"

const appId = z.string().regex(/^A[A-Z0-9]{1,63}(?![\s\S])/u)
const teamId = z.string().regex(/^T[A-Z0-9]{1,63}(?![\s\S])/u)
const memberId = z.string().regex(/^[UW][A-Z0-9]{1,63}(?![\s\S])/u)
const scope = "team:read"
const token = z.string().regex(/^(?:xoxb-|xoxe\.xoxb-)[A-Za-z0-9._-]{1,4000}(?![\s\S])/u)
const exchangeReceipt = z.object({
  ok: z.literal(true),
  app_id: appId,
  team: z.object({ id: teamId }),
  authed_user: z.object({ id: memberId, scope: z.literal("").optional(), access_token: z.never().optional() }),
  bot_user_id: memberId,
  token_type: z.literal("bot"),
  access_token: token,
  scope: z.literal(scope),
  is_enterprise_install: z.literal(false).optional(),
})
const teamReceipt = z.object({ ok: z.literal(true), team: z.object({ id: teamId }) })

export const slackAuthorizationUrl = (config: SlackConnectionConfig, state: string): string =>
  "https://slack.com/oauth/v2/authorize?" + new URLSearchParams({
    client_id: config.clientId, scope, redirect_uri: config.redirectUri, state,
  }).toString()

async function slackJson(response: Response): Promise<unknown> {
  if (response.status !== 200 || !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(response.headers.get("content-type") ?? "")) {
    void response.body?.cancel().catch(() => undefined)
    return null
  }
  const reader = response.body?.getReader()
  if (!reader) return null
  let length = 0
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return strictParseRawJson(Buffer.concat(chunks))
      length += value.byteLength
      if (length > 16_384) return null
      chunks.push(value)
    }
  } finally {
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export async function exchangeSlackConnection(
  config: SlackConnectionConfig, code: string, signal: AbortSignal,
): Promise<{ namespace: string; externalUserId: string } | null> {
  signal.throwIfAborted()
  const basic = Buffer.from(config.clientId + ":" + config.clientSecret).toString("base64")
  const exchanged = exchangeReceipt.safeParse(await slackJson(await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { authorization: "Basic " + basic, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, redirect_uri: config.redirectUri }),
    redirect: "error", credentials: "omit", signal,
  })))
  if (!exchanged.success || exchanged.data.app_id !== config.appId || exchanged.data.authed_user.id === exchanged.data.bot_user_id) return null
  signal.throwIfAborted()
  // The sole granted scope is used here. No workspace credential is returned
  // to the caller or retained after proving the exact workspace.
  const team = teamReceipt.safeParse(await slackJson(await fetch("https://slack.com/api/team.info", {
    method: "GET", headers: { authorization: "Bearer " + exchanged.data.access_token },
    redirect: "error", credentials: "omit", signal,
  })))
  if (!team.success || team.data.team.id !== exchanged.data.team.id) return null
  return { namespace: config.appId + ":" + team.data.team.id, externalUserId: exchanged.data.authed_user.id }
}
