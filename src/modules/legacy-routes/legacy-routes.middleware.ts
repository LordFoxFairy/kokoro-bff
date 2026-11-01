import { Injectable } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { LegacyRoutesRuntime } from "./legacy-routes.runtime.js"
import { isChatNativeRequest } from "../../http/routes/chat-native.js"
import { isChatBusinessReadRequest } from "../../http/routes/chat-business-native.js"
import { isMessageFeedbackRequest } from "../../http/routes/message-feedback-native.js"
import { isMessageRegenerationNativeRequest } from "../../http/routes/message-regeneration-native.js"
import { isSharedPublicRequest } from "../../http/routes/shared-native.js"
import { isChatMutationRequest } from "../../http/routes/chat-mutation-native.js"
import { isChatEventsNativeRequest } from "../../http/routes/chat-events-native.js"
import { isChatMessageNativeRequest } from "../../http/routes/chat-message-native.js"
import { isAgentControlNativeRequest } from "../../http/routes/agent-control-native.js"
import { isAgentRunsInternalRequest } from "../../http/routes/agent-runs-native.js"
import { isRunDisplayRequest } from "../../http/routes/run-display.js"

export function isMigratedChatRoute(request: IncomingMessage): boolean {
  try {
    if (isSharedPublicRequest(request) || isChatNativeRequest(request) || isChatBusinessReadRequest(request) || isChatMutationRequest(request) || isChatEventsNativeRequest(request) || isChatMessageNativeRequest(request) || isAgentControlNativeRequest(request) || isAgentRunsInternalRequest(request) || isRunDisplayRequest(request)) return true
    if (isMessageFeedbackRequest(request) || isMessageRegenerationNativeRequest(request)) return true
    const path = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean)
    return request.method === "POST" && path[0] === "v1" && path[1] === "sessions" && path.length === 4 && path[3] === "move"
  } catch {
    return false
  }
}

@Injectable()
export class LegacyRoutesMiddleware {
  public constructor(private readonly runtime: LegacyRoutesRuntime) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    if (isMigratedChatRoute(request)) {
      next()
      return
    }
    void this.runtime.use(request, response).catch(() => {
      if (!response.headersSent) {
        response.statusCode = 500
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } }))
      } else {
        response.destroy()
      }
      next()
    })
  }
}
