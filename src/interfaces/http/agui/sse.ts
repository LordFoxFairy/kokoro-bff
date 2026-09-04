import { EventSchemas } from "@ag-ui/core"

/** Match EventEncoder's SSE shape: one JSON AG-UI event per data frame. */
export function agUiSseFrame(event: unknown, cursor: string): string {
  const parsed = EventSchemas.parse(event)
  return `id: ${cursor}\ndata: ${JSON.stringify(parsed)}\n\n`
}
