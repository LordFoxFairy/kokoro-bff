import type { IncomingMessage } from "node:http"

const deadlines = new WeakMap<IncomingMessage, number>()
/** One monotonic deadline from BFF entry through session, human action and owner read. */
export function startMcpRequestBudget(request: IncomingMessage, timeoutMs = 10_000): number {
  const existing = deadlines.get(request)
  if (existing !== undefined) return existing
  const deadline = performance.now() + timeoutMs
  deadlines.set(request, deadline)
  return deadline
}
export function mcpRequestRemaining(request: IncomingMessage): number {
  return Math.max(0, startMcpRequestBudget(request) - performance.now())
}
