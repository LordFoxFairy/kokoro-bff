import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BFF_CONFIG, CHAT_SERVICE, PUBLIC_SHARE_SERVICE, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import type { PublicShareApplicationService } from "../../application/public-share-service.js"
import { handleChatNativeRequest } from "../../http/routes/chat-native.js"
import { handleMessageFeedbackRequest } from "../../http/routes/message-feedback-native.js"
import { handleSharedPublicRequest } from "../../http/routes/shared-native.js"
import { handleMoveSessionRequest } from "../../http/routes/move-session-native.js"

@Injectable()
export class ChatMiddleware implements NestMiddleware {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(CHAT_SERVICE) private readonly chat: ChatApplicationService,
    @Inject(PUBLIC_SHARE_SERVICE) private readonly publicShare: PublicShareApplicationService,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleSharedPublicRequest(request, response, this.config, this.publicShare)
      .then((handled) => handled || handleChatNativeRequest(request, response, this.config, this.admission, this.chat))
      .then((handled) => handled || handleMessageFeedbackRequest(request, response, this.config, this.admission, this.chat))
      .then((handled) => handled || handleMoveSessionRequest(request, response, this.config, this.admission, this.chat))
      .then((handled) => {
        if (!handled && !response.writableEnded && !response.destroyed) next()
      })
      .catch(() => {
        if (!response.headersSent && !response.destroyed) {
          response.statusCode = 500
          response.setHeader("content-type", "application/json")
          response.end(JSON.stringify({ error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } }))
        } else if (!response.writableEnded && !response.destroyed) response.destroy()
      })
  }
}
