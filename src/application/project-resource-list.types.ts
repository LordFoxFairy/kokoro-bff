export type ProjectResourcePageInput = Readonly<{ limit: number; cursor: string }>
export type ProjectResourceListItem = Readonly<{
  asset_id: string
  filename: string
  mime_type: string
  size_bytes: string
  content_sha256: string
  scan_state: "clean"
  created_at: string
}>
export type ProjectResourcePage = Readonly<{ items: ProjectResourceListItem[]; next_cursor: string | null }>
