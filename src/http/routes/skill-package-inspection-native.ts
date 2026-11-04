import { Code, ConnectError } from "@connectrpc/connect"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ProjectLookup } from "../../application/projects/project-repository.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { requestId } from "../request.js"
import { skillPackageInspectionRoute, type SkillPackageInspectionProvider } from "./skill-package-inspection.js"

const PATH = /^\/v1\/(?:self\/skills\/[^/]+\/package|skill-installations\/[^/]+\/package|projects\/[^/]+\/skill-installations\/[^/]+\/package)$/u

export async function handleSkillPackageInspectionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  provider: SkillPackageInspectionProvider,
  project: ProjectLookup | null,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://bff.local")
  if (request.method !== "GET" || !PATH.test(url.pathname)) return false
  const projectPath = url.pathname.startsWith("/v1/projects/")
  if (projectPath && project === null) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const access = async (
    projectRef: string,
    context: { requestId: string; identity: { namespace: string; userId: string } },
    signal: AbortSignal,
  ): Promise<string | null> => {
    const fresh = await authorizeUserRequest(request, config, admission, id, signal, response)
    signal.throwIfAborted()
    if (!fresh.ok) throw new ConnectError("Project admission failed", fresh.status >= 500 ? Code.Unavailable : Code.PermissionDenied)
    if (fresh.context.identity.namespace !== context.identity.namespace || fresh.context.identity.userId !== context.identity.userId)
      throw new ConnectError("Project not found", Code.NotFound)
    if (project === null) throw new ConnectError("Project owner unavailable", Code.Unavailable)
    const value = await project.find({ tenantId: context.identity.namespace, subjectId: context.identity.userId }, projectRef)
    signal.throwIfAborted()
    if (!value) throw new ConnectError("Project not found", Code.NotFound)
    return value.id
  }
  const path = url.pathname.slice(1).split("/").slice(1)
  await skillPackageInspectionRoute(request, response, config, admission, id, path, { access, installations: provider.installations }, provider.client)
  return true
}
