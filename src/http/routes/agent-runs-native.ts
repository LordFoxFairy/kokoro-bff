import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { AgentRunsReader } from "../../infrastructure/postgres/project-execution-binding.js"
import { agentModelAdmissionRoute } from "./model-admission.js"
import { projectExecutionBindingRoute } from "./project-execution-binding.js"

export function isAgentRunsInternalRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  return (
    path === "/internal/v1/model-admissions" || path.startsWith("/internal/v1/model-admissions/") || path === "/internal/v1/project-execution-bindings/verify"
  )
}

/** AgentRuns-owned internal adapters; service credentials and durable readers stay in the feature owner. */
export async function handleAgentRunsInternalRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  submittedRuns: Pick<AgentRunsReader, "readSubmittedAgentRun"> | null,
  projectBindings: Pick<AgentRunsReader, "readProjectExecutionBinding"> | null,
): Promise<boolean> {
  if (!isAgentRunsInternalRequest(request)) return false
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  if (path === "/internal/v1/project-execution-bindings/verify") {
    await projectExecutionBindingRoute(request, response, config.projectExecutionCredentialFile ?? null, projectBindings)
  } else {
    await agentModelAdmissionRoute(request, response, config, submittedRuns)
  }
  return true
}
