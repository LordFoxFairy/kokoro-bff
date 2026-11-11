import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SkillSpecificationProvider } from "./platform-projection.js"
import { skillSpecificationReadRoute } from "./platform-projection.js"
import { requestId } from "../request.js"

const PATHS = new Set([
  "/v1/skill.list",
  "/skill.v1.SkillOptionalService/ListSkills",
  "/skill.v1.SkillOptionalService/ListHubSkills",
  "/skill.v1.SkillOptionalService/GetSkill",
  "/skill.v1.SkillService/DownloadSkill",
])

export async function handleSkillSpecificationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  provider: SkillSpecificationProvider,
): Promise<boolean> {
  const pathname = new URL(request.url ?? "/", "http://bff.local").pathname
  if (!PATHS.has(pathname)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  return skillSpecificationReadRoute(request, response, config, provider, id, pathname)
}
