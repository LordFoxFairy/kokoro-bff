import { Code, ConnectError } from "@connectrpc/connect"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import { CHAT_TURN_TOTAL_BUDGET_MS, type ChatTurnApplicationService } from "../../application/chat-turn-service.js"
import { parseMessageCreateRequest } from "../../application/chat/message-create-input.js"
import type { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import { projectInstallation } from "../../infrastructure/clients/platform/skill-installation-response.js"
import { failure, ok } from "../../contracts/index.js"
import { idempotencyKey } from "../request.js"
import { send } from "../response.js"

function messageFault(error: unknown): { status: number; code: string; message: string } | null {
  if (!(error instanceof Error)) return null
  if (error.message === "skill_installation_response_invalid")
    return { status: 502, code: "skill_installation_response_invalid", message: "Installation owner returned an invalid response" }
  if (error instanceof ConnectError && error.code === Code.PermissionDenied)
    return { status: 403, code: "permission_denied", message: "Current Project access is required" }
  if (error instanceof ConnectError && error.code === Code.NotFound) return { status: 404, code: "project_not_found", message: "Project was not found" }
  if (error.message === "CHAT_SKILL_SELECTION_INVALID")
    return { status: 400, code: "invalid_skill_selection", message: "Project Skill selection is no longer usable; update the selection" }
  if (error.message === "CHAT_TURN_IDEMPOTENCY_CONFLICT") {
    return { status: 409, code: "idempotency_conflict", message: "Idempotency key was already used with different Chat input" }
  }
  if (error.message === "CHAT_INTERRUPT_TARGET_NOT_CURRENT") {
    return { status: 409, code: "run_delivery_conflict", message: "The selected Run is no longer available for interruption" }
  }
  if (error.message === "CHAT_SKILL_SELECTION_CHANGED")
    return { status: 409, code: "skill_selection_changed", message: "Project Skill selection changed before submission; retry the original intent" }
  if (error.message === "CHAT_TURN_PROJECT_NOT_FOUND") {
    return { status: 404, code: "project_not_found", message: "Project was not found" }
  }
  if (
    error.message === "CHAT_TURN_INPUT_INVALID" ||
    error.message === "AGENT_DISPATCH_PAYLOAD_INVALID" ||
    error.message === "AGENT_DISPATCH_LINEAGE_MISMATCH"
  ) {
    return { status: 400, code: "invalid_message", message: "Chat message input is invalid" }
  }
  return null
}

/** One Message handler; the canonical ChatTurn outbox is its only receipt owner. */
export async function chatMessageRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  conversationId: string,
  json: Record<string, unknown>,
  projectRef: string | undefined,
  chatTurns: ChatTurnApplicationService,
  installationClient?: SkillInstallationConnectClient | null,
  projectAccess?: (projectId: string, signal: AbortSignal) => Promise<string>,
): Promise<void> {
  response.setHeader("x-request-id", context.requestId)
  const fail = (status: number, code: string, message: string): void => {
    if (!request.aborted && !response.destroyed && !response.writableEnded) send(response, status, failure(code, message, context.requestId))
  }
  const input = parseMessageCreateRequest(json, projectRef)
  if (input === null) {
    fail(400, "invalid_message", "Message request does not match the v1 contract")
    return
  }
  const key = idempotencyKey(request)
  if (key === null) {
    fail(400, "idempotency_key_required", "Mutations require Idempotency-Key")
    return
  }
  if (!config.agentEnabled || (config.upstreams.agents ?? null) === null) {
    fail(503, "agent_not_configured", "Agent execution is disabled or not configured")
    return
  }
  const selectionAbort = new AbortController()
  const cancelSelection = () => {
    if (!response.writableEnded) selectionAbort.abort()
  }
  request.once("aborted", cancelSelection)
  response.once("close", cancelSelection)
  if (request.aborted || response.destroyed) selectionAbort.abort()
  const tenantId = context.identity.namespace,
    subjectId = context.identity.userId
  try {
    const receipt = await chatTurns.submit(
      { tenantId, conversationId, ...input, subjectId, actorId: subjectId, requestId: context.requestId, idempotencyKey: key },
      async (projectId, installationIds, lifetime) => {
        const selectionSignal = lifetime.signal
        if (!installationClient || !projectAccess || (await projectAccess(projectId, selectionSignal)) !== projectId)
          throw new Error("CHAT_SKILL_SELECTION_UNAVAILABLE")
        const refs: string[] = []
        for (const installationId of installationIds) {
          selectionSignal.throwIfAborted()
          const result = await installationClient
            .get({ requestId: context.requestId, tenant: tenantId, subject: subjectId, projectRef: projectId, installationId }, selectionSignal)
            .catch((error: unknown) => {
              if (error instanceof ConnectError && [Code.NotFound, Code.FailedPrecondition].includes(error.code))
                throw new Error("CHAT_SKILL_SELECTION_INVALID")
              throw error
            })
          const view = projectInstallation(result.installation)
          if (view.installation_id !== installationId || !view.installed || !view.enabled || view.source_status !== "active")
            throw new Error("CHAT_SKILL_SELECTION_INVALID")
          refs.push(view.source_ref)
        }
        if ((await projectAccess(projectId, selectionSignal)) !== projectId) throw new Error("CHAT_SKILL_SELECTION_CHANGED")
        selectionSignal.throwIfAborted()
        return refs
      },
      { signal: selectionAbort.signal, deadlineAt: performance.now() + CHAT_TURN_TOTAL_BUDGET_MS },
    )
    if (receipt === null) {
      fail(404, "session_not_found", "Session was not found")
      return
    }
    if (!request.aborted && !response.destroyed && !response.writableEnded) send(response, 202, ok(receipt, context.requestId))
  } catch (error) {
    const fault = messageFault(error)
    fail(fault?.status ?? 503, fault?.code ?? "business_store_unavailable", fault?.message ?? "The BFF business store is unavailable")
  } finally {
    request.removeListener("aborted", cancelSelection)
    response.removeListener("close", cancelSelection)
  }
}
