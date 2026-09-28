export type ProjectResourceInput = Readonly<{ filename: string; mimeType: string; bytes: Uint8Array; sha256: string }>
export type ProjectResourceContext = Readonly<{ tenantId: string; subjectId: string; projectId: string; key: string; requestId: string }>
export type ProjectResource = Readonly<{
  upload_id: string
  asset_id: string
  filename: string
  mime_type: string
  size_bytes: string
  content_sha256: string
  scan_state: "clean"
}>
export type StorageTransfer = Readonly<{ url: string; method: string; headers: Record<string, string>; expiresAt: number }>
export interface ProjectResourceStorage {
  createUpload(commandId: string, digest: string, input: ProjectResourceInput, signal: AbortSignal): Promise<{ uploadId: string; reference: StorageTransfer }>
  getUploadStatus(
    uploadId: string,
    signal: AbortSignal,
  ): Promise<{ state: "pending" | "completed" | "aborted"; assetId: string | null; sha256: string; sizeBytes: string; mimeType: string }>
  put(reference: StorageTransfer, input: ProjectResourceInput, signal: AbortSignal): Promise<void>
  completeUpload(
    commandId: string,
    digest: string,
    uploadId: string,
    input: ProjectResourceInput,
    signal: AbortSignal,
  ): Promise<{ assetId: string; scanState: "clean" }>
  getAsset(uploadId: string, assetId: string, input: ProjectResourceInput, signal: AbortSignal): Promise<ProjectResource>
  abortUpload(commandId: string, digest: string, uploadId: string, signal: AbortSignal): Promise<void>
}
