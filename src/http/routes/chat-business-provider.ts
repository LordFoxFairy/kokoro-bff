import type { AgUiProjectionConsumerRepository } from "../../application/agui/ports/agui-projection-repository.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import type { ChatTurnApplicationService } from "../../application/chat-turn-service.js"
import type { BffApplicationServices } from "../../application/services.js"
import type { ProjectService } from "../../application/project-service.js"

/** Narrow feature-local provider used while the raw server composition drains. */
export type ChatBusinessProvider = Readonly<{
  chatService?: ChatApplicationService
  chatTurnService?: ChatTurnApplicationService
  projectService?: ProjectService
  services?: Partial<Pick<BffApplicationServices, "chat" | "chatTurns" | "projects">>
  agUiConsumers?: AgUiProjectionConsumerRepository
}>

export function chatServiceOf(provider: ChatBusinessProvider): ChatApplicationService {
  const service = provider.chatService ?? provider.services?.chat
  if (service === undefined) throw new Error("CHAT_SERVICE_UNAVAILABLE")
  return service
}

export function chatTurnServiceOf(provider: ChatBusinessProvider): ChatTurnApplicationService {
  const service = provider.chatTurnService ?? provider.services?.chatTurns
  if (service === undefined) throw new Error("CHAT_TURN_SERVICE_UNAVAILABLE")
  return service
}

export function projectServiceOf(provider: ChatBusinessProvider): ProjectService {
  const service = provider.projectService ?? provider.services?.projects
  if (service === undefined) throw new Error("PROJECT_SERVICE_UNAVAILABLE")
  return service
}
