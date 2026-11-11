import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { IncomingMessage, ServerResponse } from "node:http"
import {
  AGUI_PROJECTION,
  AGUI_PROJECTION_CONSUMERS,
  AGUI_RUN_PROCESS_READER,
  AGUI_RUNTIME,
  AGUI_SOURCE_PROJECTION_ACTIVE,
  BFF_CONFIG,
  CHAT_IDEMPOTENCY,
  CHAT_CONVERSATION_LOOKUP,
  CHAT_SESSION_READS,
  CHAT_SESSION_MUTATIONS,
  CHAT_ARCHIVE,
  CHAT_SHARED_TASKS,
  CHAT_MESSAGE_FEEDBACK,
  CHAT_MOVE,
  CHAT_TURN_SERVICE,
  PROJECT_LOOKUP,
  PUBLIC_SHARE_SERVICE,
  SESSION_ADMISSION,
  SKILL_INSTALLATION_CLIENT,
} from "../../common/tokens.js"
import type { AgUiRunProcessReader } from "../../infrastructure/postgres/agui-process-page.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ChatSessionReads } from "../../application/chat/session-reads.js"
import type { ChatSessionMutations } from "../../infrastructure/postgres/chat-session-store.js"
import type { ChatConversationLookup } from "../../infrastructure/postgres/chat-conversation-lookup.js"
import type { ChatArchive } from "../../infrastructure/postgres/archived-tasks.js"
import type { SharedTasksReader } from "../../infrastructure/postgres/shared-tasks.js"
import type { MessageFeedbackProvider } from "../../infrastructure/postgres/message-feedback.js"
import type { ChatMove } from "../../application/chat/move-conversation.js"
import type { PublicShareApplicationService } from "../../application/public-share-service.js"
import type { ChatTurnApplicationService } from "../../application/chat-turn-service.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import { handleChatNativeRequest } from "../../http/routes/chat-native.js"
import { handleMessageFeedbackRequest } from "../../http/routes/message-feedback-native.js"
import { handleSharedPublicRequest } from "../../http/routes/shared-native.js"
import { handleMoveSessionRequest } from "../../http/routes/move-session-native.js"
import { handleMessageRegenerationRequest } from "../../http/routes/message-regeneration-native.js"
import { handleChatBusinessReadRequest } from "../../http/routes/chat-business-native.js"
import { handleChatMutationRequest } from "../../http/routes/chat-mutation-native.js"
import { handleChatEventsRequest } from "../../http/routes/chat-events-native.js"
import type { AgUiProjectionService } from "../../application/agui/project-session-events.js"
import type { AgUiProjectionConsumerRepository } from "../../application/agui/ports/agui-projection-repository.js"
import type { AgUiSessionRuntime } from "../../application/agui/session-runtime.js"
import type { ProjectLookup } from "../../application/projects/types.js"
import type { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import { handleChatMessageRequest } from "../../http/routes/chat-message-native.js"

@Injectable()
export class ChatMiddleware implements NestMiddleware {
  private readonly idempotency = new Map<string, IdempotencyEntry>()

  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(SESSION_ADMISSION) private readonly admission: SessionAdmission,
    @Inject(CHAT_CONVERSATION_LOOKUP) private readonly findConversation: ChatConversationLookup,
    @Inject(CHAT_SESSION_READS) private readonly reads: ChatSessionReads,
    @Inject(CHAT_SESSION_MUTATIONS) private readonly mutations: ChatSessionMutations,
    @Inject(CHAT_ARCHIVE) private readonly archive: ChatArchive,
    @Inject(CHAT_SHARED_TASKS) private readonly shared: SharedTasksReader,
    @Inject(CHAT_MESSAGE_FEEDBACK) private readonly feedback: MessageFeedbackProvider,
    @Inject(CHAT_MOVE) private readonly move: ChatMove,
    @Inject(PROJECT_LOOKUP) private readonly projects: ProjectLookup,
    @Inject(SKILL_INSTALLATION_CLIENT) private readonly installations: SkillInstallationConnectClient | null,
    @Inject(CHAT_TURN_SERVICE) private readonly chatTurns: ChatTurnApplicationService,
    @Inject(PUBLIC_SHARE_SERVICE) private readonly publicShare: PublicShareApplicationService,
    @Inject(CHAT_IDEMPOTENCY) private readonly chatIdempotency: IdempotencyRepository,
    @Inject(AGUI_PROJECTION) private readonly agUiProjection: AgUiProjectionService,
    @Inject(AGUI_PROJECTION_CONSUMERS) private readonly agUiConsumers: AgUiProjectionConsumerRepository,
    @Inject(AGUI_RUN_PROCESS_READER) private readonly readProcess: AgUiRunProcessReader,
    @Inject(AGUI_RUNTIME) private readonly agUiRuntime: AgUiSessionRuntime,
    @Inject(AGUI_SOURCE_PROJECTION_ACTIVE) private readonly sourceProjectionActive: boolean,
  ) {}

  public use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    void handleSharedPublicRequest(request, response, this.config, this.publicShare)
      .then((handled) => handled || handleChatNativeRequest(request, response, this.config, this.admission, this.archive, this.shared))
      .then(
        (handled) =>
          handled ||
          handleChatBusinessReadRequest(request, response, this.config, this.admission, this.reads, this.findConversation, this.projects, this.readProcess),
      )
      .then((handled) => handled || handleMessageFeedbackRequest(request, response, this.config, this.admission, this.feedback))
      .then((handled) => handled || handleMessageRegenerationRequest(request, response, this.config, this.admission, this.chatTurns))
      .then((handled) => handled || handleMoveSessionRequest(request, response, this.config, this.admission, this.move))
      .then(
        (handled) =>
          handled ||
          handleChatMutationRequest(
            request,
            response,
            this.config,
            this.admission,
            this.mutations,
            this.findConversation,
            this.projects,
            this.idempotency,
            this.chatIdempotency,
          ),
      )
      .then(
        (handled) =>
          handled ||
          handleChatEventsRequest(
            request,
            response,
            this.config,
            this.admission,
            this.findConversation,
            this.projects,
            this.agUiProjection,
            this.agUiConsumers,
            this.agUiRuntime,
            this.sourceProjectionActive,
          ),
      )
      .then((handled) => handled || handleChatMessageRequest(request, response, this.config, this.admission, this.chatTurns, this.projects, this.installations))
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
