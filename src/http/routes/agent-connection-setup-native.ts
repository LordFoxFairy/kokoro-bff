import type { IncomingMessage, ServerResponse } from "node:http"
import type { Pool } from "pg"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { BffConfig } from "../../config/runtime.js"
import { failure, ok } from "../../contracts/index.js"
import { connectionCommand, lineContinueCommand, newTelegramProof, secretMatches } from "../../domain/agent-connection.js"
import { sendTelegramProof, telegramStart, validTelegramUpdate } from "../../infrastructure/clients/telegram-connection.js"
import {
  lineAccountLinkUrl,
  lineConnectionEnvelope,
  lineConnectionEvent,
  matchesLineSignature,
  sendLineContinuation,
} from "../../infrastructure/clients/line-connection.js"
import {
  authorizeLineSetup,
  changeAgentConnection,
  claimLineSetup,
  claimTelegramSetup,
  completeLineSetup,
  readAgentConnection,
} from "../../infrastructure/postgres/agent-connection.js"
import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import { rawHeaderCount, readBodyBeforeDeadline } from "../request-body.js"
import { requestId } from "../request.js"
import { send } from "../response.js"

const setupPath = "/v1/agents/connections/setup"
const webhookPath = "/v1/agents/connections/telegram/webhook"
const lineWebhookPath = "/v1/agents/connections/line/webhook"
const lineContinuePath = "/v1/agents/connections/line/continue"
const telegramSecretHeader = "x-telegram-bot-api-secret-token"

function platformOf(url: URL): "telegram" | "line" | "slack" | null {
  const entries = [...url.searchParams.entries()]
  if (entries.length !== 1 || entries[0]?.[0] !== "platform") return null
  const value = entries[0][1]
  return value === "telegram" || value === "line" || value === "slack" ? value : null
}

async function jsonBytes(request: IncomingMessage, signal: AbortSignal, limit: number): Promise<Buffer | null> {
  if (
    rawHeaderCount(request, "content-type") !== 1 ||
    !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] ?? "") ||
    request.headers["content-encoding"] !== undefined
  ) {
    request.resume()
    return null
  }
  try {
    return await readBodyBeforeDeadline(request, signal, limit)
  } catch {
    return null
  }
}
function parseJson(bytes: Buffer | null): unknown {
  try {
    return bytes === null ? null : strictParseRawJson(bytes)
  } catch {
    return null
  }
}

export async function handleAgentConnectionSetupRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  pool: Pool,
): Promise<boolean> {
  const rawUrl = request.url ?? ""
  const rawPath = rawUrl.split("?", 1)[0]
  const webhook = rawPath === webhookPath && request.method === "POST"
  const lineWebhook = rawPath === lineWebhookPath && request.method === "POST"
  const lineContinue = rawPath === lineContinuePath && request.method === "POST"
  const read = request.method === "GET"
  if (!webhook && !lineWebhook && !lineContinue && (rawPath !== setupPath || (!read && request.method !== "POST"))) return false

  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const fail = (status: number, code: string, message: string, retryAfter?: string): true => {
    if (!response.writableEnded && !response.destroyed) send(response, status, failure(code, message, id), retryAfter)
    return true
  }
  const unavailable = () => fail(503, "agent_connection_provider_unavailable", "The external connection provider is unavailable")
  const invalid = () => fail(400, "invalid_agent_connection_request", "The external connection request is invalid")
  const acknowledge = (): true => {
    if (!response.destroyed && !response.writableEnded) {
      response.writeHead(204, { "cache-control": "no-store" })
      response.end()
    }
    return true
  }
  const timeoutMs = Math.min(config.upstreamTimeoutMs, 5000)
  const cancel = new AbortController()
  const onClose = () => {
    if (!response.writableEnded) cancel.abort()
  }
  request.once("aborted", onClose)
  response.once("close", onClose)
  const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(timeoutMs)])
  const telegram = config.telegramConnection ?? null
  const line = config.lineConnection ?? null
  try {
    if (request.aborted || response.destroyed) return true
    if (webhook) {
      if (telegram === null || !config.tenantId) {
        request.resume()
        return unavailable()
      }
      const provided = request.headers[telegramSecretHeader]
      if (rawHeaderCount(request, telegramSecretHeader) !== 1 || typeof provided !== "string" || !secretMatches(provided, telegram.webhookSecret)) {
        request.resume()
        return fail(403, "telegram_webhook_forbidden", "Telegram webhook authentication failed")
      }
      if (rawUrl !== webhookPath) {
        request.resume()
        return invalid()
      }
      const update = parseJson(await jsonBytes(request, signal, 16_384))
      signal.throwIfAborted()
      if (!validTelegramUpdate(update)) return invalid()
      const start = telegramStart(update)
      if (start !== null) {
        const proof = newTelegramProof()
        const claimed = await claimTelegramSetup(pool, { ...start, proof, tenantId: config.tenantId, botId: telegram.botId, signal, timeoutMs })
        // After a durable claim this single attempt is independent of the
        // callback connection; provider redelivery must never send it twice.
        if (claimed) await sendTelegramProof(telegram, start.externalUserId, proof, timeoutMs)
      }
      return acknowledge()
    }
    if (lineWebhook) {
      if (line === null || !config.tenantId) {
        request.resume()
        return unavailable()
      }
      const provided = request.headers["x-line-signature"]
      const forbidden = () => fail(403, "line_webhook_forbidden", "LINE webhook authentication failed")
      if (rawHeaderCount(request, "x-line-signature") !== 1 || typeof provided !== "string") {
        request.resume()
        return forbidden()
      }
      if (rawUrl !== lineWebhookPath) {
        request.resume()
        return invalid()
      }
      const raw = await jsonBytes(request, signal, 65_536)
      signal.throwIfAborted()
      if (raw === null) return invalid()
      if (!matchesLineSignature(raw, provided, line.channelSecret)) return forbidden()
      const envelope = lineConnectionEnvelope.safeParse(parseJson(raw))
      if (!envelope.success) return invalid()
      if (envelope.data.destination !== line.botId) return forbidden()
      for (const event of envelope.data.events) {
        const received = lineConnectionEvent(event)
        if (received === null) continue
        const context = { tenantId: config.tenantId, botId: line.botId, signal, timeoutMs }
        if (received.kind === "message") {
          if (await claimLineSetup(pool, { ...received, ...context })) await sendLineContinuation(line, received, timeoutMs)
        } else await completeLineSetup(pool, { ...received, ...context })
      }
      return acknowledge()
    }

    const url = new URL(rawUrl, "http://bff.local")
    const contentLength = request.headers["content-length"]
    if (url.hash || (read && (request.headers["transfer-encoding"] !== undefined || (contentLength !== undefined && contentLength !== "0")))) {
      request.resume()
      return invalid()
    }
    if (lineContinue && rawUrl !== lineContinuePath) {
      request.resume()
      return invalid()
    }
    const platform = lineContinue ? "line" : platformOf(url)
    if (platform === null) {
      request.resume()
      return fail(400, "invalid_agent_platform", "platform must be telegram, line, or slack")
    }
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    signal.throwIfAborted()
    if (!admitted.ok) {
      request.resume()
      return fail(admitted.status, admitted.code, "BFF user admission failed", admitted.retryAfter)
    }
    if (platform === "slack") {
      request.resume()
      return unavailable()
    }
    const { namespace: tenantId, userId: subjectId } = admitted.context.identity
    const scope = { tenantId, subjectId, platform, signal, timeoutMs }
    const bot = platform === "telegram" ? telegram : line
    let result
    if (lineContinue) {
      response.setHeader("referrer-policy", "no-referrer")
      const command = lineContinueCommand.safeParse(parseJson(await jsonBytes(request, signal, 1024)))
      signal.throwIfAborted()
      if (!command.success) return invalid()
      const { setup_id, expected_state_version, link_token } = command.data
      result = await authorizeLineSetup(pool, { ...scope, platform: "line" }, line, setup_id, expected_state_version)
      signal.throwIfAborted()
      if (result.kind === "line_continuation") {
        send(response, 200, ok({ ...result.data, continue_url: lineAccountLinkUrl(link_token, result.nonce) }, id))
        return true
      }
    } else {
      const command = read ? null : connectionCommand.safeParse(parseJson(await jsonBytes(request, signal, 1024)))
      signal.throwIfAborted()
      if (command !== null && (!command.success || (platform === "line" && command.data.action === "confirm"))) return invalid()
      result = command === null ? await readAgentConnection(pool, scope, bot) : await changeAgentConnection(pool, scope, bot, command.data)
    }
    signal.throwIfAborted()
    switch (result.kind) {
      case "state":
        send(response, 200, ok(result.data, id))
        return true
      case "provider_unavailable":
        return unavailable()
      case "stale":
        return fail(412, "agent_connection_precondition_failed", "The external connection state is no longer current")
      case "already_connected":
        return fail(409, "agent_connection_already_connected", "Disconnect the existing connection explicitly")
      case "proof_invalid":
        return fail(409, "agent_connection_proof_invalid", "The private proof was not accepted")
      case "identity_in_use":
        return fail(409, "agent_connection_identity_in_use", "This external account cannot be connected")
      case "conflict":
        return fail(409, "agent_connection_state_conflict", "The command does not match the current connection")
    }
  } catch {
    return fail(503, "agent_connection_unavailable", "External connection state is unavailable")
  } finally {
    request.off("aborted", onClose)
    response.off("close", onClose)
  }
}
