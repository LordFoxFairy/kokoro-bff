import type { ProjectResourcePageInput } from "../application/project-resource-list.types.js"
import { ProjectResourceError } from "../application/project-resource.error.js"

export function libraryFileListInput(
  query: URLSearchParams,
): (ProjectResourcePageInput & { kind: "file" }) | (ProjectResourcePageInput & { kind: "artifact" }) {
  const kind = query.getAll("kind")
  if (kind.length !== 1 || (kind[0] !== "file" && kind[0] !== "artifact")) throw new ProjectResourceError("invalid_library_kind", 400)
  for (const key of query.keys()) {
    if (!["kind", "limit", "cursor"].includes(key) || query.getAll(key).length !== 1) throw new ProjectResourceError("invalid_library_page", 400)
  }
  const limit = query.get("limit") ?? "50"
  const cursor = query.get("cursor") ?? ""
  if (!/^(?:[1-9][0-9]?|100)$/u.test(limit) || (query.has("cursor") && !/^[\x21-\x7e]{1,4096}$/u.test(cursor))) {
    throw new ProjectResourceError("invalid_library_page", 400)
  }
  return kind[0] === "artifact" ? { kind: "artifact", limit: Number(limit), cursor } : { kind: "file", limit: Number(limit), cursor }
}
