import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import { parseProjectSkillSelection } from "../../domain/project/skill-selection.js"
import type { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import { projectInstallation } from "../../infrastructure/clients/platform/skill-installation-response.js"
import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import { exactIdempotencyKey } from "../skill-installation-input.js"
import { runSkillRoute, readSkillBody } from "./skill-drafts.js"
import { send } from "../response.js"

export async function projectSkillSelectionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  store: BffBusinessStore | null,
  client: SkillInstallationConnectClient | null,
  projectAccess: (signal: AbortSignal) => Promise<string>,
): Promise<void> {
  const currentProject = async (signal: AbortSignal): Promise<string | null> => {
    try {
      return await projectAccess(signal)
    } catch (error) {
      if (!(error instanceof ConnectError) || ![Code.PermissionDenied, Code.NotFound].includes(error.code)) throw error
      send(response, error.code === Code.NotFound ? 404 : 403, {
        error: {
          code: error.code === Code.NotFound ? "project_not_found" : "permission_denied",
          message: "Current Project access is required",
          retryable: false,
        },
      })
      return null
    }
  }
  await runSkillRoute(request, response, context, async (signal) => {
    const fail = (status: number, code: string) =>
      send(response, status, { error: { code, message: "Project Skill selection request failed", retryable: status >= 500 } })
    if (!["GET", "PUT"].includes(request.method ?? "")) {
      response.setHeader("allow", "GET, PUT")
      fail(405, "method_not_allowed")
      return
    }
    if (new URL(request.url ?? "", "http://bff.local").search) throw new ConnectError("Query is not accepted", Code.InvalidArgument)
    if (!store) throw new ConnectError("Project store unavailable", Code.Unavailable)
    const projectId = await currentProject(signal)
    if (projectId === null) return
    const scope = { tenantId: context.identity.namespace, subjectId: context.identity.userId }
    if (request.method === "GET") {
      if (request.headers["idempotency-key"] !== undefined || (await readSkillBody(request, 1, signal)).length)
        throw new ConnectError("Read body invalid", Code.InvalidArgument)
      const selected = await store.services.projects.skillSelection(scope, projectId)
      const current = await currentProject(signal)
      if (current === null) return
      if (!selected || current !== projectId) {
        fail(404, "project_not_found")
        return
      }
      signal.throwIfAborted()
      send(response, 200, { data: selected })
      return
    }
    const keyCount = request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === "idempotency-key").length
    const typeCount = request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === "content-type").length
    if (keyCount !== 1 || typeCount !== 1 || request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")
      throw new ConnectError("Headers invalid", Code.InvalidArgument)
    let key: string
    try {
      key = exactIdempotencyKey(request.headers["idempotency-key"])
    } catch {
      throw new ConnectError("Key invalid", Code.InvalidArgument)
    }
    let input: unknown
    try {
      input = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(await readSkillBody(request, 65536, signal)))
    } catch (error) {
      if (signal.aborted) throw error
      throw new ConnectError("JSON invalid", Code.InvalidArgument)
    }
    if (typeof input !== "object" || input === null || Array.isArray(input) || Object.keys(input).length !== 1 || !("installation_ids" in input))
      throw new ConnectError("Selection invalid", Code.InvalidArgument)
    const ids = parseProjectSkillSelection(input.installation_ids)
    if (ids === null) throw new ConnectError("Selection invalid", Code.InvalidArgument)
    const receiptScope = JSON.stringify([scope.tenantId, scope.subjectId, "project.skill-selection:v1", projectId, key])
    // Presence only skips external re-resolution. The locked repository validates the complete receipt before returning it.
    if ((await store.getReceipt(receiptScope)) === null) {
      for (const installationId of ids) {
        if (!client) throw new ConnectError("Installation owner unavailable", Code.Unavailable)
        signal.throwIfAborted()
        const result = await client.get(
          { requestId: context.requestId, tenant: scope.tenantId, subject: scope.subjectId, projectRef: projectId, installationId },
          signal,
        )
        const view = projectInstallation(result.installation)
        if (view.installation_id !== installationId) throw new Error("skill_installation_response_invalid")
        if (!view.installed || !view.enabled || view.source_status !== "active") throw new ConnectError("Installation is not usable", Code.FailedPrecondition)
      }
    }
    const current = await currentProject(signal)
    if (current === null) return
    if (current !== projectId) {
      fail(404, "project_not_found")
      return
    }
    signal.throwIfAborted()
    const result = await store.services.projects.replaceSkillSelection(scope, projectId, ids, key, signal)
    signal.throwIfAborted()
    if (result.kind === "not_found") fail(404, "project_not_found")
    else if (result.kind === "conflict") fail(409, "idempotency_conflict")
    else if (result.kind === "replaced") send(response, 200, result.receipt)
  })
}
