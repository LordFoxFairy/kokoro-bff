export type AssetDownloadContext = Readonly<{
  tenantId: string
  subjectId: string
  requestId: string
  scope: Readonly<{ kind: "personal" | "project"; id: string }>
}>

export type DownloadedAsset = Readonly<{ bytes: Buffer; mimeType: string; filename: string }>
export type AssetDownloadReference = Readonly<{ url: string; method: string; requiredHeaders: Record<string, string>; expiresAt: number }>
