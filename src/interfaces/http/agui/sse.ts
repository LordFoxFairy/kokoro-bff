import { EventSchemas } from "@ag-ui/core"

import type { AgUiEvent } from "./events.js"

/** Match EventEncoder's SSE shape: one JSON AG-UI event per data frame. */
export function agUiSseFrame(event: AgUiEvent): string {
  EventSchemas.parse(event)
  const seq = event.metadata.kokoro.seq
  return `id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`
}
