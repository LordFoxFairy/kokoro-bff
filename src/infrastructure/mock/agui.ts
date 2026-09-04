import { createHash } from "node:crypto"

import { createAgUiProjectionState, projectChatEvent } from "../../application/agui/project-chat-event.js"
import type { ChatEvent } from "../../contracts/chat.js"

export type MockAgUiFrame = {
  cursor: string
  payload: unknown
}

function frameCursor(event: ChatEvent, frameIndex: number): string {
  const digest = createHash("sha256")
    .update(`${event.session_id}\u0000${event.event_id}\u0000${frameIndex}`)
    .digest("hex")
    .slice(0, 32)
  return `agui_${digest}`
}

export function mockAgUiFrames(events: readonly ChatEvent[]): MockAgUiFrame[] {
  const state = createAgUiProjectionState()
  return events.flatMap((event) => projectChatEvent(event, state).map((payload, frameIndex) => ({
    cursor: frameCursor(event, frameIndex),
    payload,
  })))
}

export function mockAgUiWatermark(events: readonly ChatEvent[]): string | null {
  return mockAgUiFrames(events).at(-1)?.cursor ?? null
}
