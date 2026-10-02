import { zChatInteractionState } from "../../../generated/agent-http/zod.gen.js"
import type { InteractionState } from "../../../contracts/chat.js"
import { assertInteractionState } from "../../../application/agui/interaction-state.js"
import { AgUiSourceContractError } from "../../../application/agui/errors.js"

/** Closed generated owner schema first; preserve optional presence and all business null. */
export function parseAgentInteractionState(value: unknown): InteractionState {
  const parsed = zChatInteractionState.safeParse(value)
  if (!parsed.success) throw new AgUiSourceContractError()
  const state: InteractionState = parsed.data
  assertInteractionState(state)
  return state
}
