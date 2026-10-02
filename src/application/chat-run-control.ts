import type { ChatExecutionHead } from "./ports/chat-repository.js"

/** Read-only admission policy. The owner remains the final authority after this snapshot. */
export function resumeControlFailure(
  head: ChatExecutionHead | undefined,
  runId: string,
  commandId: string,
  control: { expected_pause_revision: number; pause_ref: string; decisions: ReadonlyArray<{ item_id: string; type: string }> },
): { status: 400 | 404 | 409; code: "invalid_run_control" | "run_not_found" | "run_control_conflict" } | null {
  if (head === undefined || head.runId !== runId) return { status: 404, code: "run_not_found" }
  const pause = head.pendingPauses[0]
  if (
    pause === undefined ||
    head.pendingPauses.length !== 1 ||
    control.expected_pause_revision !== pause.pause_revision ||
    control.pause_ref !== pause.pause_ref ||
    (head.state !== "waiting" && !(head.state === "resuming" && pause.action_result?.command_id === commandId))
  ) {
    return { status: 409, code: "run_control_conflict" }
  }
  const items = pause.groups.flatMap((group) => group.items)
  const decisions = new Map(control.decisions.map((decision) => [decision.item_id, decision.type]))
  if (
    decisions.size !== control.decisions.length ||
    decisions.size !== items.length ||
    items.some((item) => !item.allowed_decisions.some((type) => type === decisions.get(item.item_id)))
  ) {
    return { status: 400, code: "invalid_run_control" }
  }
  return null
}
