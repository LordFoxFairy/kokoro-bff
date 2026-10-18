/** Product taxonomy and text matching over current, already-authorized FINAL metadata. */
export const LIBRARY_ARTIFACT_TYPES = ["all", "slides", "documents", "spreadsheets", "images", "video", "audio", "other"] as const
export type LibraryArtifactType = (typeof LIBRARY_ARTIFACT_TYPES)[number]
export type LibraryArtifactFilter = Readonly<{ query: string; type: LibraryArtifactType }>

export function normalizeLibraryQuery(value: string): string {
  return value.trim().normalize("NFC").toLowerCase()
}

export function libraryArtifactType(mimeType: string, title: string): Exclude<LibraryArtifactType, "all"> {
  const mime = mimeType.toLowerCase()
  const value = `${mime} ${title}`.toLowerCase()
  if (value.includes("presentation") || value.includes("powerpoint") || /\b(slides|deck|投影片)\b/u.test(value)) return "slides"
  if (value.includes("spreadsheet") || value.includes("excel") || value.includes("csv") || value.includes("试算表") || value.includes("試算表"))
    return "spreadsheets"
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/iu.test(title)) return "images"
  if (mime.startsWith("audio/") || /\.(mp3|wav|ogg|flac|m4a)$/iu.test(title)) return "audio"
  if (mime.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/iu.test(title)) return "video"
  if (mime.includes("text") || mime.includes("pdf") || mime.includes("document") || /\.(docx?|pdf|txt|md)$/iu.test(title)) return "documents"
  return "other"
}

export function matchesLibraryArtifact(metadata: Readonly<{ title: string; filename: string; mimeType: string }>, filter: LibraryArtifactFilter): boolean {
  if (filter.type !== "all" && libraryArtifactType(metadata.mimeType, metadata.title) !== filter.type) return false
  return filter.query === "" || [metadata.title, metadata.filename].some((value) => normalizeLibraryQuery(value).includes(filter.query))
}
