import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import { decodeProjectMcpRecommendations, recommendationIdentity, projectMcpId } from "../../domain/project/mcp-recommendations.js"
import {
  validateProjectMcpRecommendationCandidates,
  type RecommendationCandidateClients,
} from "../../infrastructure/clients/platform/project-mcp-recommendation-candidates.js"
import { parseProjectMcpRecommendationsInput } from "../project-mcp-recommendations-input.js"
import { rawHeaderCount, readBodyBeforeDeadline } from "../request-body.js"
import { mcpRequestRemaining } from "../mcp-request-budget.js"
import { send } from "../response.js"

class ProjectRecommendationNotFound extends Error {}
export class ProjectMcpRecommendationsAdmissionError extends Error {
  constructor(
    public readonly status: 401 | 403 | 429 | 503,
    public readonly code: string,
    public readonly retryAfter?: string,
  ) {
    super("Current recommendation admission failed")
  }
}

export async function projectMcpRecommendationsRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  path: readonly string[],
  store: BffBusinessStore | null,
  clients: RecommendationCandidateClients,
  currentAccess: (mcpRead: boolean, signal: AbortSignal, deadlineAt: number) => Promise<string>,
): Promise<void> {
  const controller = new AbortController(),
    deadlineAt = performance.now() + mcpRequestRemaining(request)
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - performance.now()))
  const abort = () => {
    if (!response.writableEnded) controller.abort()
  }
  request.once("aborted", abort)
  response.once("close", abort)
  const within = <T>(work: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const stop = () => reject(new Error("recommendation_request_retired"))
      controller.signal.addEventListener("abort", stop, { once: true })
      void work.then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", stop))
      if (controller.signal.aborted) stop()
    })
  const fail = (status: number, code: string, retryAfter?: string) => {
    if (!response.destroyed && !response.writableEnded)
      send(response, status, { error: { code, message: "Project recommendation request failed", retryable: status === 503 || status === 429 } }, retryAfter)
  }
  const invalid = (): never => {
    throw new Error("project_mcp_recommendations_request_invalid")
  }
  const access = async (mcpRead = false) => {
    let id: string
    try {
      id = await within(currentAccess(mcpRead, controller.signal, deadlineAt))
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) throw new ProjectRecommendationNotFound()
      throw error
    }
    controller.signal.throwIfAborted()
    if (id !== path[1]) throw new ProjectRecommendationNotFound()
  }
  try {
    response.setHeader("x-request-id", context.requestId)
    controller.signal.throwIfAborted()
    const url = new URL(request.url ?? "", "http://bff.invalid"),
      put = request.method === "PUT"
    if (!["GET", "PUT"].includes(request.method ?? "")) {
      response.setHeader("allow", "GET, PUT")
      fail(405, "method_not_allowed")
      return
    }
    if (
      path.length !== 3 ||
      path[0] !== "projects" ||
      path[2] !== "mcp-recommendations" ||
      !projectMcpId(path[1]) ||
      url.pathname !== `/v1/projects/${encodeURIComponent(path[1])}/mcp-recommendations` ||
      url.search ||
      url.hash ||
      request.headers["idempotency-key"] !== undefined ||
      request.headers["transfer-encoding"] !== undefined
    )
      invalid()
    if (!put && ["content-type", "content-length"].some((name) => request.headers[name] !== undefined)) invalid()
    let input: ReturnType<typeof parseProjectMcpRecommendationsInput> = null
    if (put) {
      const length = request.headers["content-length"]
      if (
        rawHeaderCount(request, "content-type") !== 1 ||
        !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(String(request.headers["content-type"] ?? "")) ||
        rawHeaderCount(request, "content-length") !== 1 ||
        typeof length !== "string" ||
        !/^(0|[1-9][0-9]*)$/u.test(length) ||
        Number(length) > 16384
      )
        invalid()
      const bytes = await readBodyBeforeDeadline(request, controller.signal, 16384)
      if (bytes.length !== Number(length)) invalid()
      input = parseProjectMcpRecommendationsInput(bytes)
      if (!input) invalid()
    }
    await access()
    if (!store) throw new Error("project_owner_unavailable")
    const query = { tenantId: context.identity.namespace, subjectId: context.identity.userId, projectId: path[1]!, signal: controller.signal, deadlineAt }
    const raw = await within(store.services.projects.mcpRecommendations(query))
    controller.signal.throwIfAborted()
    if (raw === null) throw new ProjectRecommendationNotFound()
    let current
    try {
      current = decodeProjectMcpRecommendations(raw.project_id, raw.recommendations, raw.state_version)
      if (current.project_id !== path[1]) throw new Error()
    } catch {
      throw new Error("project_mcp_recommendations_response_invalid")
    }
    let result = current
    if (input) {
      if (current.state_version !== input.expectedStateVersion) throw new ConnectError("Project recommendation changed", Code.FailedPrecondition)
      const prior = new Set(current.recommendations.map(recommendationIdentity))
      const added = input.recommendations.filter((ref) => !prior.has(recommendationIdentity(ref)))
      if (added.length) {
        await access(added.some((ref) => ref.kind !== "custom_api"))
        await within(
          validateProjectMcpRecommendationCandidates(
            added,
            clients,
            { tenant: query.tenantId, subject: query.subjectId, requestId: context.requestId },
            controller.signal,
            deadlineAt,
          ),
        )
      }
      await access()
      const changed = await within(store.services.projects.replaceMcpRecommendations({ ...query, ...input }))
      controller.signal.throwIfAborted()
      if (changed.kind === "not_found") throw new ProjectRecommendationNotFound()
      if (changed.kind === "precondition_failed") throw new ConnectError("Project recommendation changed", Code.FailedPrecondition)
      try {
        if (changed.kind !== "replaced") throw new Error()
        result = decodeProjectMcpRecommendations(changed.data.project_id, changed.data.recommendations, changed.data.state_version)
        const same = JSON.stringify(current.recommendations) === JSON.stringify(input.recommendations)
        if (
          result.project_id !== path[1] ||
          JSON.stringify(result.recommendations) !== JSON.stringify(input.recommendations) ||
          BigInt(result.state_version) !== BigInt(input.expectedStateVersion) + (same ? 0n : 1n)
        )
          throw new Error()
      } catch {
        throw new Error("project_mcp_recommendations_response_invalid")
      }
    }
    await access()
    controller.signal.throwIfAborted()
    if (!response.destroyed && !response.writableEnded) send(response, 200, { data: result })
  } catch (error) {
    if (error instanceof ProjectMcpRecommendationsAdmissionError) fail(error.status, error.code, error.status === 429 ? error.retryAfter : undefined)
    else if (error instanceof Error && error.message === "project_mcp_recommendations_request_invalid") fail(400, error.message)
    else if (
      error instanceof Error &&
      (error.message === "project_mcp_recommendations_response_invalid" ||
        error.message === "mcp_personal_response_invalid" ||
        error.message === "custom_api_response_invalid" ||
        error.message === "PROJECT_MCP_RECOMMENDATIONS_INVALID")
    )
      fail(502, "project_mcp_recommendations_response_invalid")
    else if (error instanceof ProjectRecommendationNotFound) fail(404, "project_not_found")
    else if (error instanceof ConnectError && [Code.NotFound, Code.FailedPrecondition].includes(error.code))
      fail(412, "project_mcp_recommendations_precondition_failed")
    else if (error instanceof ConnectError && error.code === Code.PermissionDenied) fail(403, "permission_denied")
    else fail(503, "project_mcp_recommendations_dependency_unavailable")
  } finally {
    clearTimeout(timer)
    controller.abort()
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
}
