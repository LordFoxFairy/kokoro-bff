import { createHash } from "node:crypto"
import type { IdempotencyRepository } from "./ports/idempotency-repository.js"
import type { PersonalFile, PersonalFileContext, PersonalFileInput, PersonalFileStorage } from "./personal-file-upload.types.js"
import { PersonalFileError } from "./personal-file-upload.error.js"

export function personalFileFingerprint(input: PersonalFileInput): string {
  return createHash("sha256")
    .update(JSON.stringify(["personal-file-upload:v1", input.filename, input.mimeType, input.bytes.length, input.sha256]))
    .digest("hex")
}

export async function uploadPersonalFile(
  context: PersonalFileContext,
  input: PersonalFileInput,
  receipts: IdempotencyRepository,
  storage: PersonalFileStorage,
  signal: AbortSignal,
): Promise<PersonalFile> {
  const scope = JSON.stringify([context.tenantId, context.subjectId, "personal-file-upload:v1", context.key])
  const fingerprint = personalFileFingerprint(input)
  const identity = createHash("sha256").update(scope).digest("hex")
  const command = (operation: string): string => `bff.personal-file.${operation}.${identity}`
  const checkpoint = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof PersonalFileError) throw error
      throw new PersonalFileError("file_checkpoint_unavailable", 503, true)
    }
  }
  let uploadId: string
  const existing = await checkpoint(() => receipts.getReceipt(scope))
  if (existing !== null && existing.fingerprint !== fingerprint) throw new PersonalFileError("idempotency_conflict", 409)
  if (existing?.status === 200) {
    const body = existing.body as { upload_id?: unknown }
    if (typeof body?.upload_id !== "string" || body.upload_id.length === 0) throw new PersonalFileError("file_checkpoint_unavailable", 503, true)
    uploadId = body.upload_id
  } else {
    const claim = await checkpoint(() => receipts.claimReceipt(scope, fingerprint))
    if (!claim.claimed) throw new PersonalFileError(claim.receipt?.fingerprint !== fingerprint ? "idempotency_conflict" : "idempotency_in_progress", 409, true)
    try {
      const created = await storage.createUpload(command("create"), fingerprint, input, signal)
      uploadId = created.uploadId
      await checkpoint(() => receipts.putReceipt(scope, { fingerprint, status: 200, body: { stage: "admitted", upload_id: uploadId } }))
      const persisted = await checkpoint(() => receipts.getReceipt(scope))
      if (persisted?.status !== 200 || persisted.fingerprint !== fingerprint || (persisted.body as { upload_id?: unknown }).upload_id !== uploadId)
        throw new PersonalFileError("file_checkpoint_unavailable", 503, true)
    } catch (error) {
      await receipts.releaseReceipt(scope, fingerprint).catch(() => undefined)
      throw error
    }
  }
  signal.throwIfAborted()
  const status = await storage.getUploadStatus(uploadId, signal)
  if (status.sha256 !== input.sha256 || status.sizeBytes !== String(input.bytes.length) || status.mimeType !== input.mimeType)
    throw new PersonalFileError("storage_response_invalid", 502)
  if (status.state === "completed") {
    if (status.assetId === null) throw new PersonalFileError("storage_response_invalid", 502)
    return { kind: "file", ...(await storage.getAsset(uploadId, status.assetId, input, signal)) }
  }
  if (status.state === "aborted") throw new PersonalFileError("file_upload_aborted", 409)
  const checkpointReceipt = await checkpoint(() => receipts.getReceipt(scope))
  const body = checkpointReceipt?.body as {
    stage?: unknown
    upload_id?: unknown
    source_version_id?: unknown
    complete_command_id?: unknown
    complete_request_digest?: unknown
  }
  let sourceVersionId: string
  let completeCommandId: string
  let completeDigest: string
  if (
    body.stage === "selected" &&
    body.upload_id === uploadId &&
    typeof body.source_version_id === "string" &&
    typeof body.complete_command_id === "string" &&
    typeof body.complete_request_digest === "string"
  ) {
    sourceVersionId = body.source_version_id
    completeCommandId = body.complete_command_id
    completeDigest = body.complete_request_digest
    if (status.sourceVersionId !== null && status.sourceVersionId !== sourceVersionId) throw new PersonalFileError("storage_response_invalid", 502)
  } else {
    if (body.stage !== "admitted" || body.upload_id !== uploadId || status.sourceVersionId !== null)
      throw new PersonalFileError("file_checkpoint_unavailable", 503, true)
    const created = await storage.createUpload(command("create"), fingerprint, input, signal)
    if (created.uploadId !== uploadId) throw new PersonalFileError("storage_response_invalid", 502)
    sourceVersionId = await storage.put(created.reference, input, signal)
    completeCommandId = command("complete")
    completeDigest = createHash("sha256")
      .update(JSON.stringify([fingerprint, uploadId, sourceVersionId]))
      .digest("hex")
    const selected = {
      fingerprint,
      status: 200,
      body: {
        stage: "selected",
        upload_id: uploadId,
        source_version_id: sourceVersionId,
        complete_command_id: completeCommandId,
        complete_request_digest: completeDigest,
      },
    }
    const cas = await checkpoint(() => receipts.compareAndSetReceipt(scope, fingerprint, checkpointReceipt!, selected))
    if (!cas.updated && JSON.stringify(cas.receipt) !== JSON.stringify(selected)) throw new PersonalFileError("file_checkpoint_unavailable", 503, true)
  }
  const completed = await storage.completeUpload(completeCommandId, completeDigest, uploadId, sourceVersionId, input, signal)
  return { kind: "file", ...(await storage.getAsset(uploadId, completed.assetId, input, signal)) }
}
