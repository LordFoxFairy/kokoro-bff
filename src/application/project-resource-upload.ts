import { createHash } from "node:crypto"
import type { IdempotencyRepository } from "./ports/idempotency-repository.js"
import type { ProjectResourceContext, ProjectResourceInput, ProjectResourceStorage, ProjectResource } from "./project-resource.types.js"
import { ProjectResourceError } from "./project-resource.error.js"

export function projectResourceFingerprint(input: ProjectResourceInput): string {
  return createHash("sha256")
    .update(JSON.stringify(["project-resource-v1", input.filename, input.mimeType, input.bytes.length, input.sha256]))
    .digest("hex")
}

export async function uploadProjectResource(
  context: ProjectResourceContext,
  input: ProjectResourceInput,
  receipts: IdempotencyRepository,
  storage: ProjectResourceStorage,
  signal: AbortSignal,
): Promise<ProjectResource> {
  const scope = JSON.stringify([context.tenantId, context.subjectId, "project-resource-upload:v1", context.projectId, context.key])
  const fingerprint = projectResourceFingerprint(input)
  const identity = createHash("sha256").update(scope).digest("hex")
  const command = (operation: string): string => `bff.resource.${operation}.${identity}`
  let uploadId: string | null = null
  let completeAttempted = false
  try {
    const existing = await receipts.getReceipt(scope)
    if (existing !== null && existing.fingerprint !== fingerprint) throw new ProjectResourceError("idempotency_conflict", 409)
    if (existing?.status === 200) {
      const body = existing.body as { upload_id?: unknown }
      if (typeof body?.upload_id !== "string" || body.upload_id.length === 0) throw new ProjectResourceError("resource_checkpoint_invalid", 503)
      uploadId = body.upload_id
      completeAttempted = true // Restored outcome is uncertain until the owner confirms pending.
    } else {
      const claim = await receipts.claimReceipt(scope, fingerprint)
      if (!claim.claimed)
        throw new ProjectResourceError(claim.receipt?.fingerprint !== fingerprint ? "idempotency_conflict" : "idempotency_in_progress", 409, true)
      try {
        const created = await storage.createUpload(command("create"), fingerprint, input, signal)
        uploadId = created.uploadId
        await receipts.putReceipt(scope, { fingerprint, status: 200, body: { stage: "admitted", upload_id: uploadId } })
        const persisted = await receipts.getReceipt(scope)
        if (persisted?.status !== 200 || persisted.fingerprint !== fingerprint || (persisted.body as { upload_id?: unknown }).upload_id !== uploadId)
          throw new ProjectResourceError("resource_checkpoint_unavailable", 503, true)
      } catch (error) {
        await receipts.releaseReceipt(scope, fingerprint).catch(() => undefined)
        throw error
      }
    }
    signal.throwIfAborted()
    const status = await storage.getUploadStatus(uploadId, signal)
    if (status.sha256 !== input.sha256 || status.sizeBytes !== String(input.bytes.length) || status.mimeType !== input.mimeType)
      throw new ProjectResourceError("storage_response_invalid", 502)
    if (status.state === "completed") {
      completeAttempted = true
      if (status.assetId === null) throw new ProjectResourceError("storage_response_invalid", 502)
      return await storage.getAsset(uploadId, status.assetId, input, signal)
    }
    if (status.state === "aborted") throw new ProjectResourceError("resource_upload_aborted", 409)
    completeAttempted = false
    const checkpoint = await receipts.getReceipt(scope)
    const body = checkpoint?.body as {
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
      if (status.sourceVersionId !== null && status.sourceVersionId !== sourceVersionId) throw new ProjectResourceError("storage_response_invalid", 502)
    } else {
      if (body.stage !== "admitted" || body.upload_id !== uploadId || status.sourceVersionId !== null)
        throw new ProjectResourceError("resource_checkpoint_invalid", 503, true)
      const created = await storage.createUpload(command("create"), fingerprint, input, signal)
      if (created.uploadId !== uploadId) throw new ProjectResourceError("storage_response_invalid", 502)
      sourceVersionId = await storage.put(created.reference, input, signal)
      completeCommandId = command("complete")
      completeDigest = createHash("sha256")
        .update(JSON.stringify([fingerprint, uploadId, sourceVersionId]))
        .digest("hex")
      completeAttempted = true
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
      const cas = await receipts.compareAndSetReceipt(scope, fingerprint, checkpoint!, selected)
      if (!cas.updated && JSON.stringify(cas.receipt) !== JSON.stringify(selected)) throw new ProjectResourceError("resource_checkpoint_unavailable", 503, true)
    }
    completeAttempted = true
    const completed = await storage.completeUpload(completeCommandId, completeDigest, uploadId, sourceVersionId, input, signal)
    return await storage.getAsset(uploadId, completed.assetId, input, signal)
  } catch (error) {
    // A Complete response may be lost after committing an Asset. Never abort that uncertain outcome.
    if (uploadId !== null && !completeAttempted && !(error instanceof ProjectResourceError && error.code === "resource_upload_aborted")) {
      await storage.abortUpload(command("abort"), fingerprint, uploadId, AbortSignal.timeout(2000)).catch(() => undefined)
    }
    throw error
  }
}
