import type { ProjectResourcePageInput } from "../application/project-resource-list.types.js"
import { ProjectResourceError } from "../application/project-resource.error.js"

export function projectResourceListInput(query: URLSearchParams): ProjectResourcePageInput {
  for (const key of query.keys()) {
    if (!["limit", "cursor"].includes(key) || query.getAll(key).length !== 1) throw new ProjectResourceError("invalid_project_resource_page", 400)
  }
  const limit = query.get("limit") ?? "50"
  const cursor = query.get("cursor") ?? ""
  if (!/^(?:[1-9][0-9]?|100)$/u.test(limit) || (query.has("cursor") && !/^[\x21-\x7e]{1,4096}$/u.test(cursor))) {
    throw new ProjectResourceError("invalid_project_resource_page", 400)
  }
  return { limit: Number(limit), cursor }
}
