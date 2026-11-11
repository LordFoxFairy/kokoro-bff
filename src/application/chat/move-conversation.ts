import { createHash } from "node:crypto"
import { mutationScope } from "../idempotency.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { MoveConversationCommand, MoveConversationResult } from "./types.js"

export function createChatMove(write: (command: MoveConversationCommand) => Promise<MoveConversationResult>) {
  return function moveConversation(context: RequestContext, conversationId: string, targetProjectId: string | null, key: string, signal: AbortSignal) {
    const scope = mutationScope(context, "POST", `/sessions/${conversationId}/move`, key)
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(["moveSession", targetProjectId]))
      .digest("hex")
    return write({
      tenantId: context.identity.namespace,
      subjectId: context.identity.userId,
      conversationId,
      targetProjectId,
      scope,
      fingerprint,
      signal,
    })
  }
}

export type ChatMove = ReturnType<typeof createChatMove>
