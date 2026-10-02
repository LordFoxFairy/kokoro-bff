import { createHash } from "node:crypto"
import type { InteractionState } from "../../contracts/chat.js"
import { AgUiSourceContractError, AgUiSourceIdentityConflictError } from "./errors.js"

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (typeof value !== "object" || value === null) throw new AgUiSourceContractError()
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`
}

export function interactionDigest(state: InteractionState): string {
  return createHash("sha256").update(canonical(state), "utf8").digest("hex")
}

/** Cross-field invariants omitted by the owner's structural JSON Schema. */
export function assertInteractionState(state: InteractionState): void {
  const reject = (): never => {
    throw new AgUiSourceContractError()
  }
  const nonempty = (value: unknown): boolean => typeof value === "string" && value.trim() !== ""
  if (
    !Number.isSafeInteger(state.interaction_revision) ||
    state.interaction_revision < 1 ||
    !Number.isSafeInteger(state.pause_revision) ||
    state.pause_revision < 0 ||
    state.pause_revision > state.interaction_revision ||
    !["active", "waiting", "resuming", "terminal"].includes(state.phase) ||
    !Array.isArray(state.groups)
  )
    reject()
  if (state.pause_revision === 0 ? state.pause_ref !== null : !nonempty(state.pause_ref)) reject()
  const pending = state.phase === "waiting" || state.phase === "resuming"
  if (pending ? state.groups.length === 0 || state.pause_revision === 0 : state.groups.length !== 0) reject()
  const groups = new Set<string>(),
    items = new Set<string>()
  for (const group of state.groups) {
    if (!nonempty(group.group_id) || groups.has(group.group_id) || !Array.isArray(group.items) || group.items.length === 0) reject()
    groups.add(group.group_id)
    for (const item of group.items) {
      if (
        !nonempty(item.item_id) ||
        !nonempty(item.request_id) ||
        items.has(item.item_id) ||
        !Array.isArray(item.allowed_decisions) ||
        item.allowed_decisions.length === 0 ||
        new Set(item.allowed_decisions).size !== item.allowed_decisions.length
      )
        reject()
      items.add(item.item_id)
      if (typeof item.display.result_preview === "string" && (typeof item.display.truncated !== "boolean" || !nonempty(item.display.source))) reject()
      if (
        item.validation !== undefined &&
        item.validation !== null &&
        item.validation.instance_path.some((part) => typeof part !== "string" && !Number.isSafeInteger(part))
      )
        reject()
    }
  }
  const action = state.action_result
  if (
    action !== null &&
    (!nonempty(action.command_id) || !Number.isSafeInteger(action.pause_revision) || action.pause_revision < 1 || action.pause_revision > state.pause_revision)
  )
    reject()
  if (state.phase === "resuming" && (action === null || !["accepted", "unknown"].includes(action.kind) || action.pause_revision !== state.pause_revision))
    reject()
  if (state.phase === "waiting" && action?.kind === "validation_failed" && action.pause_revision >= state.pause_revision) reject()
}

/** One complete revision replaces another; equality never hides source-identity checks. */
export function replaceInteraction(previous: InteractionState | undefined, next: InteractionState): boolean {
  assertInteractionState(next)
  if (previous === undefined) return true
  assertInteractionState(previous)
  if (next.interaction_revision < previous.interaction_revision || next.pause_revision < previous.pause_revision) throw new AgUiSourceIdentityConflictError()
  if (next.interaction_revision === previous.interaction_revision) {
    if (interactionDigest(next) !== interactionDigest(previous)) throw new AgUiSourceIdentityConflictError()
    return false
  }
  if (next.pause_revision === previous.pause_revision && next.pause_ref !== previous.pause_ref) throw new AgUiSourceIdentityConflictError()
  return true
}
