import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ChatConversationLookup } from "../../infrastructure/postgres/chat-conversation-lookup.js"
import type { ProjectLookup } from "../../application/projects/types.js"
import type { AgUiRunControlReader } from "../../infrastructure/postgres/agui-run-state-read.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure, ok } from "../../contracts/index.js"
import { mutationTicket } from "../../application/idempotency.js"
import { buildAgentControl } from "../../infrastructure/clients/agent/control.js"
import { commitRunSteer, isRunSteerText } from "../../infrastructure/postgres/run-steer-commit.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { authorizeChatRequest } from "./chat-authorization.js"
import { runAgentControl } from "./agent.js"
import { idempotencyKey, mutationFingerprint, pathOf, queryOf, readBody, requestBodyJson, requestId } from "../request.js"
import { send } from "../response.js"

function agentControlPath(request: IncomingMessage): boolean {
  try {
    const path = pathOf(request)
    return request.method === "POST" && path[0] === "v1" && path[1] === "sessions" && path[3] === "runs" && path.length === 6 && path[5] === "control"
  } catch {
    return false
  }
}

export function isAgentControlNativeRequest(request: IncomingMessage): boolean {
  return agentControlPath(request)
}

/** AgentRuns-owned Chat run control with Chat/Project owner rechecks and durable idempotency. */
export async function handleAgentControlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  findConversation: ChatConversationLookup,
  projects: ProjectLookup,
  readControl: AgUiRunControlReader,
  idempotency: Map<string, IdempotencyEntry>,
  persistent: IdempotencyRepository | null,
  database: PostgresBffDatabase,
): Promise<boolean> {
  if (!agentControlPath(request)) return false
  const id = requestId(request)
  const abort = new AbortController()
  const onAborted = (): void => abort.abort()
  request.once("aborted", onAborted)
  response.once("close", onAborted)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal, response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    const body = await readBody(request)
    const json = requestBodyJson(request, body)
    if (json === null) {
      send(response, 400, failure("invalid_json", "Request body must be a JSON object", id))
      return true
    }
    const businessPath = pathOf(request).slice(1)
    let canDispatchControl = false
    const findControlConversation: ChatConversationLookup = async (...args) => {
      const conversation = await findConversation(...args)
      canDispatchControl = conversation !== null && (conversation.projectRef === null || conversation.projectAccess?.capabilities.includes("edit") === true)
      return conversation
    }
    const authorization = await authorizeChatRequest(request, admitted.context, businessPath, findControlConversation, projects)
    if (authorization === null) return false
    if (!authorization.ok) {
      send(response, authorization.status, failure(authorization.code, authorization.message, id))
      return true
    }
    const key = idempotencyKey(request)
    if (key === null) {
      send(response, 400, failure("idempotency_key_required", "Control requests require Idempotency-Key", id))
      return true
    }
    if (json.kind === "run.steer") {
      response.setHeader("x-request-id", id)
      const sessionId = businessPath[1] ?? ""
      const runId = businessPath[3] ?? ""
      const control = buildAgentControl(sessionId, json)
      if (control?.kind !== "run.steer" || ![runId, control.message_id, control.content].every(isRunSteerText)) {
        send(response, 400, failure("invalid_run_control", "Control request does not match the v1 contract", id))
        return true
      }
      if (!config.agentEnabled || (config.upstreams.agents ?? null) === null) {
        send(response, 503, failure("agent_not_configured", "Agent execution is disabled or not configured", id))
        return true
      }
      const { namespace, userId } = admitted.context.identity
      const result = await commitRunSteer(database, {
        tenantId: namespace,
        subjectId: userId,
        actorId: userId,
        conversationId: sessionId,
        runId,
        requestId: id,
        scope: queryOf(request).get("scope")?.trim() === "direct" ? "direct" : "all",
        ...(authorization.projectRef === undefined ? {} : { projectRef: authorization.projectRef }),
        idempotencyKey: key,
        clientMessageId: control.message_id,
        content: control.content,
        lifetime: { signal: abort.signal, deadlineAt: performance.now() + config.upstreamTimeoutMs },
      })
      abort.signal.throwIfAborted()
      switch (result.kind) {
        case "accepted":
        case "replay":
          send(response, 202, ok({ ...result.receipt, replayed: result.kind === "replay" }, id))
          break
        case "not_found":
          send(response, 404, failure("session_not_found", "Session was not found", id))
          break
        case "run_not_current":
          send(response, 409, failure("run_control_conflict", "Control does not match the current Run", id))
          break
        case "idempotency_conflict":
          send(response, 409, failure("idempotency_conflict", "Idempotency key already used with a different request payload", id))
          break
      }
      return true
    }
    const ticket = await mutationTicket(
      key,
      "POST",
      `/${businessPath.join("/")}`,
      admitted.context,
      mutationFingerprint(request, businessPath, json, body),
      idempotency,
      persistent ?? undefined,
    )
    if (ticket.replay !== null) {
      send(response, ticket.replay.status, ticket.replay.body)
      return true
    }
    if (ticket.conflict) {
      send(response, 409, failure("idempotency_conflict", "Idempotency key already used with a different request payload", id))
      return true
    }
    if (ticket.pending) {
      send(response, 409, failure("idempotency_in_progress", "An identical mutation is already in progress", id))
      return true
    }
    if (!canDispatchControl) {
      // Read access still permits an original actor's safe ACK replay above.
      // This newly claimed command was never sent; release only our own claim.
      if (ticket.ticket?.persistent) await ticket.ticket.persistent.releaseReceipt(ticket.ticket.scope, ticket.ticket.fingerprint)
      else if (ticket.ticket) idempotency.delete(ticket.ticket.scope)
      send(response, 404, failure("session_not_found", "Session was not found", id))
      return true
    }
    await runAgentControl(
      request,
      response,
      config,
      admitted.context,
      businessPath[1] ?? "",
      businessPath[3] ?? "",
      json,
      ticket.ticket,
      idempotency,
      authorization.projectRef,
      readControl,
    )
    return true
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed)
      send(response, 503, failure("agent_control_unavailable", "Agent control request failed", id))
    return true
  } finally {
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onAborted)
  }
}
