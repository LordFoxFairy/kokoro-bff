import { LIBRARY_ARTIFACT_TYPES, normalizeLibraryQuery, type LibraryArtifactFilter } from "../application/library-artifact-filter.js"
import { LIBRARY_FILE_TYPES, type PersonalFilePageInput } from "../application/library-file-filter.js"
import type { ProjectResourcePageInput } from "../application/project-resource-list.types.js"
import { ProjectResourceError } from "../application/project-resource.error.js"

export type ArtifactLibraryPageInput = ProjectResourcePageInput & { kind: "artifact" } & LibraryArtifactFilter

export function libraryFileListInput(query: URLSearchParams): (PersonalFilePageInput & { kind: "file" }) | ArtifactLibraryPageInput {
  const kind = query.getAll("kind")
  if (kind.length !== 1 || (kind[0] !== "file" && kind[0] !== "artifact")) throw new ProjectResourceError("invalid_library_kind", 400)
  for (const key of query.keys()) {
    if (!["kind", "limit", "cursor", "q", "type"].includes(key) || query.getAll(key).length !== 1)
      throw new ProjectResourceError("invalid_library_page", 400)
  }
  const limit = query.get("limit") ?? "50"
  const cursor = query.get("cursor") ?? ""
  if (!/^(?:[1-9][0-9]?|100)$/u.test(limit) || (query.has("cursor") && !/^[\x21-\x7e]{1,4096}$/u.test(cursor))) {
    throw new ProjectResourceError("invalid_library_page", 400)
  }
  const rawQuery = query.get("q") ?? ""
  if ([...rawQuery].length > 200 || /[\u0000-\u001f\u007f]/u.test(rawQuery)) throw new ProjectResourceError("invalid_library_page", 400)
  const requestedType = query.get("type") ?? "all"
  if (kind[0] === "file") {
    const type = LIBRARY_FILE_TYPES.find((candidate) => candidate === requestedType)
    if (type === undefined) throw new ProjectResourceError("invalid_library_page", 400)
    return { kind: "file", limit: Number(limit), cursor, query: rawQuery, type }
  }
  const type = LIBRARY_ARTIFACT_TYPES.find((candidate) => candidate === requestedType)
  if (type === undefined) throw new ProjectResourceError("invalid_library_page", 400)
  return { kind: "artifact", limit: Number(limit), cursor, query: normalizeLibraryQuery(rawQuery), type }
}
