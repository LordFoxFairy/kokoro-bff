export type PersonalFileInput = Readonly<{ filename: string; mimeType: string; bytes: Uint8Array; sha256: string }>
export type PersonalFileContext = Readonly<{ tenantId: string; subjectId: string; key: string; requestId: string }>
export type PersonalFile = Readonly<{
  kind: "file"
  asset_id: string
  filename: string
  mime_type: string
  size_bytes: string
  content_sha256: string
  scan_state: "clean"
}>
export type PersonalFileStorageRecord = Omit<PersonalFile, "kind">
export type PersonalFileTransfer = Readonly<{ url: string; method: string; headers: Record<string, string>; expiresAt: number }>

export interface PersonalFileStorage {
  createUpload(commandId: string, digest: string, input: PersonalFileInput, signal: AbortSignal): Promise<{ uploadId: string; reference: PersonalFileTransfer }>
  getUploadStatus(
    uploadId: string,
    signal: AbortSignal,
  ): Promise<{ state: "pending" | "completed" | "aborted"; assetId: string | null; sha256: string; sizeBytes: string; mimeType: string }>
  put(reference: PersonalFileTransfer, input: PersonalFileInput, signal: AbortSignal): Promise<void>
  completeUpload(
    commandId: string,
    digest: string,
    uploadId: string,
    input: PersonalFileInput,
    signal: AbortSignal,
  ): Promise<{ assetId: string; scanState: "clean" }>
  getAsset(uploadId: string, assetId: string, input: PersonalFileInput, signal: AbortSignal): Promise<PersonalFileStorageRecord>
}
