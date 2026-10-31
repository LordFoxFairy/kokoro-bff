import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ExactSkillDownloadSource } from "../../application/exact-skill-download.js"
import type { SkillDownloadHandles } from "../../application/skill-download-handles.js"
import type { SkillSpecificationSource } from "../../application/skill-specification.types.js"
import { pathOf, requestId } from "../request.js"
import { exactSkillDownloadRoute, skillDownloadHandleRoute, type SkillDownloadProvider } from "./skill-download.js"

export async function handleSkillDownloadRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  handles: SkillDownloadHandles,
  specification: SkillSpecificationSource | null,
  exact: ExactSkillDownloadSource | null,
  projectAccess?: (projectId: string, context: { requestId: string; identity: { namespace: string; userId: string } }, signal: AbortSignal) => Promise<string | null>,
): Promise<boolean> {
  let path: string[]
  try { path = pathOf(request) } catch { return false }
  const projectPath = path.length === 7 && path[0] === "browser" && path[1] === "v1" && path[2] === "projects" && path[4] === "skill-installations" && path[6] === "download"
  const exactPath = path.length === 5 && path[0] === "browser" && path[1] === "v1" && path[4] === "download" && ["skill-installations", "skills", "skill-shares"].includes(path[2] ?? "")
  const handlePath = path.length === 2 && path[0] === "skill-downloads"
  if (handlePath && !projectAccess) return false
  if (!exactPath && !(projectPath && projectAccess) && !handlePath) return false
  const provider: SkillDownloadProvider = { sessionAdmission: admission, skillDownloadHandles: handles, skillSpecificationSource: specification, exactSkillDownloadSource: exact }
  if (handlePath) return skillDownloadHandleRoute(request, response, config, provider, requestId(request), path, projectAccess)
  return exactSkillDownloadRoute(request, response, config, provider, requestId(request), path, projectAccess)
}
