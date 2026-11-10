import type { ProjectResourcePageInput } from "./project-resource-list.types.js"

export const LIBRARY_FILE_TYPES = ["all", "documents", "images", "media", "other"] as const
export type LibraryFileType = (typeof LIBRARY_FILE_TYPES)[number]
export type PersonalFilePageInput = ProjectResourcePageInput & Readonly<{ query: string; type: LibraryFileType }>
